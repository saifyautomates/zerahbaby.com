-- ==============================================================================
-- HARDEN POS SALE VOID, REVERSAL & INVENTORY SAFETY ARCHITECTURE
-- Migration: 20260928000043_harden_pos_sale_void_reversal_safety.sql
-- 
-- 1. Eliminates dangerous hard-delete of completed POS sales.
-- 2. Preserves historical records in offline_sales and offline_sale_items.
-- 3. Implements canonical admin_void_offline_sale RPC with audit trail.
-- 4. Records compensating inventory adjustments in inventory_transactions.
-- 5. Restricts direct SQL DELETE on completed sales via RLS.
-- ==============================================================================

-- 1. Add audit columns to offline_sales
ALTER TABLE public.offline_sales 
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_voided boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_offline_sales_is_voided 
  ON public.offline_sales(is_voided) 
  WHERE is_voided = true;

-- 2. Canonical admin_void_offline_sale RPC
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  v_prod record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text;
BEGIN
  v_clean_reason := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');

  -- 1. Authorization check: authenticated admin, staff, manager, or owner
  IF uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role IN ('admin', 'staff', 'manager', 'owner')
    ) THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can void POS sales';
    END IF;
  END IF;

  -- 2. Verify sale exists and lock it
  SELECT id, sale_number, status, customer_id, total, subtotal, is_voided INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SALE_NOT_FOUND',
      'message', 'Sale record not found'
    );
  END IF;

  -- 3. Idempotency & Status Check: Prevent double-voiding
  IF target_sale.status IN ('voided', 'cancelled') OR target_sale.is_voided = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_voided', true,
      'sale_number', target_sale.sale_number,
      'message', 'Sale #' || target_sale.sale_number || ' has already been voided.'
    );
  END IF;

  -- 4. Compensating Inventory Restoration (if requested)
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT 
        si.id as item_id,
        si.product_id, 
        si.product_slug, 
        si.qty, 
        si.name, 
        si.sku, 
        si.barcode,
        COALESCE(SUM(ri.qty), 0) as already_returned_qty
      FROM public.offline_sale_items si
      LEFT JOIN public.offline_return_items ri ON ri.original_sale_item_id = si.id
      WHERE si.sale_id = _sale_id
      GROUP BY si.id, si.product_id, si.product_slug, si.qty, si.name, si.sku, si.barcode
    LOOP
      DECLARE
        net_restore_qty integer := GREATEST(0, target_item.qty - target_item.already_returned_qty);
      BEGIN
        IF net_restore_qty > 0 AND target_item.product_id IS NOT NULL THEN
          -- Atomically restore product stock
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = target_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            UPDATE public.products
            SET stock = stock + net_restore_qty
            WHERE id = v_prod.id;

            -- Also update variant if matching SKU/barcode or default variant exists
            UPDATE public.product_variants
            SET stock = stock + net_restore_qty
            WHERE product_id = v_prod.id
              AND (
                (sku IS NOT NULL AND sku ILIKE target_item.sku) 
                OR (barcode IS NOT NULL AND barcode = target_item.barcode) 
                OR name = 'Default'
              );

            -- Log canonical compensating inventory transaction
            INSERT INTO public.inventory_transactions (
              product_id,
              type,
              quantity,
              reference_type,
              reference_id,
              note,
              created_by
            ) VALUES (
              target_item.product_id,
              'adjustment'::public.inventory_tx_type,
              net_restore_qty,
              'offline_sale_void',
              _sale_id,
              'Compensating void reversal for POS sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
              uid
            );

            items_restored := items_restored + 1;
            total_units_restored := total_units_restored + net_restore_qty;
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 5. Revert customer purchase metrics safely
  IF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = GREATEST(0, total_purchases - 1),
        total_spend = GREATEST(0, total_spend - target_sale.total)
    WHERE id = target_sale.customer_id;
  END IF;

  -- 6. Transition sale to VOIDED status (PRESERVE HISTORICAL EVIDENCE — NEVER DELETE!)
  UPDATE public.offline_sales
  SET status = 'voided',
      is_voided = true,
      void_reason = v_clean_reason,
      voided_at = now(),
      voided_by = uid,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_number', target_sale.sale_number,
    'status', 'voided',
    'stock_restored', _restore_stock,
    'items_restored_count', items_restored,
    'units_restored_count', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' successfully voided. Audit trail preserved.'
  );
END; $$;

-- 3. Compatibility layer: forward admin_delete_offline_sale safely to admin_void_offline_sale
CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.admin_void_offline_sale(
    _sale_id,
    'Voided via administrative deletion request',
    true
  );
END; $$;

-- 4. Maintain admin_void_offline_sale overload with defaults
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid) TO authenticated, anon, service_role;

-- 5. Restrict direct physical DELETE on completed sales via RLS
DROP POLICY IF EXISTS "allow_delete_offline_sales" ON public.offline_sales;
CREATE POLICY "allow_delete_only_draft_offline_sales" ON public.offline_sales
  FOR DELETE
  USING (status = 'draft');
