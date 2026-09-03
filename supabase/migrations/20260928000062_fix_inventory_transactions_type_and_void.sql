-- Migration: 20260928000062_fix_inventory_transactions_type_and_void.sql
-- Fix inventory_transactions type column nullability and synchronize with transaction_type

-- 1. Automatic synchronization trigger on inventory_transactions
CREATE OR REPLACE FUNCTION public.sync_inventory_transaction_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sync type and transaction_type
  IF NEW.type IS NULL AND NEW.transaction_type IS NOT NULL THEN
    NEW.type := NEW.transaction_type;
  ELSIF NEW.transaction_type IS NULL AND NEW.type IS NOT NULL THEN
    NEW.transaction_type := NEW.type;
  ELSIF NEW.type IS NULL AND NEW.transaction_type IS NULL THEN
    NEW.type := 'adjustment'::public.inventory_tx_type;
    NEW.transaction_type := 'adjustment'::public.inventory_tx_type;
  END IF;

  -- Sync note and notes
  IF NEW.note IS NULL AND NEW.notes IS NOT NULL THEN
    NEW.note := NEW.notes;
  ELSIF NEW.notes IS NULL AND NEW.note IS NOT NULL THEN
    NEW.notes := NEW.note;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_inventory_transaction_columns ON public.inventory_transactions;
CREATE TRIGGER trg_sync_inventory_transaction_columns
  BEFORE INSERT OR UPDATE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_transaction_columns();

-- 2. Redefine admin_void_offline_sale with explicit type, note, notes
DROP FUNCTION IF EXISTS public.admin_void_offline_sale(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.admin_void_offline_sale CASCADE;

CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _void_reason text DEFAULT 'Administrative void',
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
  v_clean_reason text := COALESCE(NULLIF(trim(_void_reason), ''), 'Administrative void');
  v_prev_stock int;
  v_new_stock int;
BEGIN
  -- 1. Authorization check
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') 
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
    THEN
      RAISE EXCEPTION 'Only administrators can void completed POS sales';
    END IF;
  END IF;

  -- 2. Row lock target sale
  SELECT * INTO target_sale
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

  -- 3. Idempotency & Status Check
  IF target_sale.status IN ('voided', 'cancelled') OR target_sale.is_voided = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_voided', true,
      'sale_number', target_sale.sale_number,
      'message', 'Sale #' || target_sale.sale_number || ' has already been voided.'
    );
  END IF;

  -- 4. Compensating Inventory Restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT 
        si.id as item_id,
        si.product_id, 
        si.variant_id,
        si.product_slug, 
        si.qty, 
        si.name, 
        si.sku, 
        si.barcode,
        COALESCE(SUM(ri.qty), 0) as already_returned_qty
      FROM public.offline_sale_items si
      LEFT JOIN public.offline_return_items ri ON ri.original_sale_item_id = si.id
      WHERE si.sale_id = _sale_id
      GROUP BY si.id, si.product_id, si.variant_id, si.product_slug, si.qty, si.name, si.sku, si.barcode
    LOOP
      DECLARE
        net_restore_qty integer := GREATEST(0, target_item.qty - target_item.already_returned_qty);
      BEGIN
        IF net_restore_qty > 0 AND target_item.product_id IS NOT NULL THEN
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = target_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            v_prev_stock := v_prod.stock;
            v_new_stock := v_prev_stock + net_restore_qty;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_prod.id;

            -- Restore variant stock if present
            IF target_item.variant_id IS NOT NULL THEN
              UPDATE public.product_variants
              SET stock = stock + net_restore_qty,
                  updated_at = now()
              WHERE id = target_item.variant_id;
            ELSE
              UPDATE public.product_variants
              SET stock = stock + net_restore_qty,
                  updated_at = now()
              WHERE product_id = v_prod.id
                AND (
                  (sku IS NOT NULL AND sku ILIKE target_item.sku) 
                  OR (barcode IS NOT NULL AND barcode = target_item.barcode) 
                  OR name = 'Default'
                );
            END IF;

            -- Log compensating transaction with both type and transaction_type populated
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
              'Compensating void reversal for POS sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
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
    SET total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
        total_spend = GREATEST(0, COALESCE(total_spend, target_sale.total) - target_sale.total),
        total_spent = GREATEST(0, COALESCE(total_spent, target_sale.total) - target_sale.total),
        updated_at = now()
    WHERE id = target_sale.customer_id;
  END IF;

  -- 6. Mark sale as voided
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
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'status', 'voided',
    'stock_restored', _restore_stock,
    'items_restored_count', items_restored,
    'units_restored_count', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' successfully voided. Audit trail preserved.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, anon, service_role;

-- 3. Compatibility forwarder for admin_delete_offline_sale
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

GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid) TO authenticated, anon, service_role;
