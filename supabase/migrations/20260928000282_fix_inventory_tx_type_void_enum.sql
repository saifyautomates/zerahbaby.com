-- ==============================================================================
-- Migration: 20260928000282_fix_inventory_tx_type_void_enum.sql
-- Description: Add 'void' to inventory_tx_type enum and use resilient adjustment type in admin_void_offline_sale
-- ==============================================================================

-- 1. Safely add 'void' value to inventory_tx_type enum
ALTER TYPE public.inventory_tx_type ADD VALUE IF NOT EXISTS 'void';

-- 2. Authoritative, Resilient admin_void_offline_sale RPC
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');
  v_prev_stock int;
  v_new_stock int;
  net_restore_qty int;
BEGIN
  -- 1. Strict Authorization Check
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR public.has_role(uid, 'pos_user')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'owner')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff', 'pos_user'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR COALESCE(is_staff, false) = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  END IF;

  -- 2. Row lock target sale and verify existence
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found with id: %', _sale_id;
  END IF;

  IF target_sale.notes ILIKE '[VOIDED]%' THEN
    RAISE EXCEPTION 'Sale #% has already been voided', target_sale.sale_number;
  END IF;

  -- 3. Stock restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        IF target_item.variant_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = target_item.variant_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.variant_id;

          INSERT INTO public.inventory_transactions (
            product_id,
            variant_id,
            type,
            transaction_type,
            quantity,
            previous_quantity,
            new_quantity,
            reference_type,
            reference_id,
            note,
            notes,
            created_by
          ) VALUES (
            target_item.product_id,
            target_item.variant_id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        ELSIF target_item.product_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.products WHERE id = target_item.product_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.product_id;

          INSERT INTO public.inventory_transactions (
            product_id,
            variant_id,
            type,
            transaction_type,
            quantity,
            previous_quantity,
            new_quantity,
            reference_type,
            reference_id,
            note,
            notes,
            created_by
          ) VALUES (
            target_item.product_id,
            NULL,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        END IF;

        items_restored := items_restored + 1;
        total_units_restored := total_units_restored + net_restore_qty;
      END IF;
    END LOOP;
  END IF;

  -- 4. Mark sale as VOIDED
  UPDATE public.offline_sales
  SET notes = '[VOIDED] ' || v_clean_reason || CASE WHEN trim(COALESCE(notes, '')) != '' THEN ' | Original Notes: ' || notes ELSE '' END,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'voided_by', uid,
    'stock_restored', _restore_stock,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' voided successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;
