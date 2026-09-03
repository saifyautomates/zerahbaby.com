-- Migration: 20260928000064_admin_hard_delete_and_bulk_void_pos_sales.sql
-- Provide complete, resilient single & bulk hard-deletion and voiding RPCs for POS offline sales

-- 1. Canonical bulk & single hard-delete RPC for POS sales
CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_sales(
  _sale_ids uuid[],
  _restore_stock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale record;
  v_item record;
  v_prod record;
  v_deleted_count int := 0;
  v_units_restored int := 0;
  v_items_restored int := 0;
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
      RAISE EXCEPTION 'Only administrators can delete POS sale records';
    END IF;
  END IF;

  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted_count', 0,
      'message', 'No sales provided for deletion'
    );
  END IF;

  -- 2. Process each sale
  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    SELECT * INTO v_sale
    FROM public.offline_sales
    WHERE id = v_sale_id
    FOR UPDATE;

    IF v_sale.id IS NOT NULL THEN
      -- Optional stock restoration if sale was active (not already voided)
      IF _restore_stock = true AND v_sale.status NOT IN ('voided', 'cancelled') AND COALESCE(v_sale.is_voided, false) = false THEN
        FOR v_item IN
          SELECT product_id, variant_id, qty, sku, barcode, name
          FROM public.offline_sale_items
          WHERE sale_id = v_sale_id AND product_id IS NOT NULL
        LOOP
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = v_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            v_prev_stock := v_prod.stock;
            v_new_stock := v_prev_stock + v_item.qty;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_prod.id;

            IF v_item.variant_id IS NOT NULL THEN
              UPDATE public.product_variants
              SET stock = stock + v_item.qty,
                  updated_at = now()
              WHERE id = v_item.variant_id;
            ELSE
              UPDATE public.product_variants
              SET stock = stock + v_item.qty,
                  updated_at = now()
              WHERE product_id = v_prod.id
                AND (
                  (sku IS NOT NULL AND sku ILIKE v_item.sku)
                  OR (barcode IS NOT NULL AND barcode = v_item.barcode)
                  OR name = 'Default'
                );
            END IF;

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
              v_item.product_id,
              v_item.variant_id,
              'adjustment'::public.inventory_tx_type,
              'adjustment'::public.inventory_tx_type,
              v_item.qty,
              v_prev_stock,
              v_new_stock,
              'offline_sale_delete',
              v_sale_id,
              'Stock restoration from deleted POS sale #' || v_sale.sale_number,
              'Stock restoration from deleted POS sale #' || v_sale.sale_number,
              uid
            );

            v_items_restored := v_items_restored + 1;
            v_units_restored := v_units_restored + v_item.qty;
          END IF;
        END LOOP;
      END IF;

      -- Revert customer metrics if sale was active
      IF v_sale.customer_id IS NOT NULL AND v_sale.status NOT IN ('voided', 'cancelled') AND COALESCE(v_sale.is_voided, false) = false THEN
        UPDATE public.pos_customers
        SET total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
            total_spend = GREATEST(0, COALESCE(total_spend, v_sale.total) - v_sale.total),
            total_spent = GREATEST(0, COALESCE(total_spent, v_sale.total) - v_sale.total),
            updated_at = now()
        WHERE id = v_sale.customer_id;
      END IF;

      -- Unlink any dependent records
      UPDATE public.offline_returns
      SET original_sale_id = NULL
      WHERE original_sale_id = v_sale_id;

      UPDATE public.offline_returns
      SET linked_sale_id = NULL
      WHERE linked_sale_id = v_sale_id;

      UPDATE public.store_credit_ledger
      SET used_in_sale_id = NULL
      WHERE used_in_sale_id = v_sale_id;

      UPDATE public.sms_logs
      SET offline_sale_id = NULL
      WHERE offline_sale_id = v_sale_id;

      -- Delete line items and sale
      DELETE FROM public.offline_sale_items WHERE sale_id = v_sale_id;
      DELETE FROM public.offline_sales WHERE id = v_sale_id;

      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'units_restored', v_units_restored,
    'items_restored', v_items_restored,
    'message', v_deleted_count || ' POS sale record(s) permanently deleted.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_sales(uuid[], boolean) TO authenticated, anon, service_role;

-- 2. Single deletion overload & forwarder
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid);
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid, boolean);
CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid,
  _restore_stock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.admin_hard_delete_offline_sales(ARRAY[_sale_id], _restore_stock);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) TO authenticated, anon, service_role;

-- 3. Bulk void RPC
CREATE OR REPLACE FUNCTION public.admin_bulk_void_offline_sales(
  _sale_ids uuid[],
  _reason text DEFAULT 'Bulk administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id uuid;
  v_voided_count int := 0;
  v_res jsonb;
BEGIN
  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'voided_count', 0);
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    v_res := public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
    IF (v_res->>'success')::boolean = true THEN
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'voided_count', v_voided_count,
    'message', v_voided_count || ' POS sale(s) successfully voided.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) TO authenticated, anon, service_role;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
