-- ==============================================================================
-- Migration: 20261023000001_fix_admin_hard_delete_offline_sales_double_restock.sql
-- Description:
-- 1. Fix admin_hard_delete_offline_sales:
--    - Prevent already-returned items from being restocked a second time when deleting a sale.
--      Uses net_restore_qty = GREATEST(0, qty - COALESCE(quantity_returned, returned_quantity, 0)).
--    - Fix double-restock bug by updating variant stock as the single authoritative source of truth
--      and synchronizing products.stock atomically (preventing trigger cascading duplication).
-- 2. Reconcile 'king' product stock back to its authentic 1 unit.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_sales(
  _sale_ids uuid[],
  _restore_stock boolean DEFAULT false
)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp 
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale record;
  v_item record;
  v_target_variant_id uuid;
  v_deleted_count int := 0;
  v_units_restored int := 0;
  v_items_restored int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_net_restore_qty int;
BEGIN
  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted_count', 0,
      'message', 'No sales provided for deletion'
    );
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    SELECT * INTO v_sale
    FROM public.offline_sales
    WHERE id = v_sale_id
    FOR UPDATE;

    IF v_sale.id IS NOT NULL THEN
      -- Optional stock restoration if sale was active (not already voided)
      IF _restore_stock = true AND v_sale.status NOT IN ('voided', 'cancelled') AND COALESCE(v_sale.is_voided, false) = false THEN
        FOR v_item IN
          SELECT product_id, variant_id, qty, sku, barcode, name,
                 COALESCE(quantity_returned, returned_quantity, 0) AS returned_qty
          FROM public.offline_sale_items
          WHERE sale_id = v_sale_id AND product_id IS NOT NULL
        LOOP
          -- CRITICAL FIX 1: Only restore units that have NOT already been returned!
          -- If item was returned previously via process_offline_return, returned_qty > 0.
          v_net_restore_qty := GREATEST(0, COALESCE(v_item.qty, 1) - COALESCE(v_item.returned_qty, 0));

          IF v_net_restore_qty <= 0 THEN
            CONTINUE; -- Already restocked by the return flow; skip to avoid duplicate restock!
          END IF;

          -- Resolve target variant ID
          v_target_variant_id := v_item.variant_id;
          IF v_target_variant_id IS NULL AND v_item.product_id IS NOT NULL THEN
            SELECT id INTO v_target_variant_id
            FROM public.product_variants
            WHERE product_id = v_item.product_id
              AND (
                (v_item.sku IS NOT NULL AND sku ILIKE v_item.sku)
                OR (v_item.barcode IS NOT NULL AND barcode = v_item.barcode)
                OR name = 'Default'
              )
            ORDER BY (stock >= v_net_restore_qty) DESC, stock DESC
            LIMIT 1;

            IF v_target_variant_id IS NULL THEN
              SELECT id INTO v_target_variant_id
              FROM public.product_variants
              WHERE product_id = v_item.product_id
                AND (is_active IS NULL OR is_active = true)
              ORDER BY stock DESC
              LIMIT 1;
            END IF;
          END IF;

          -- CRITICAL FIX 2: Single-Source of Truth Inventory Update
          -- Do NOT manually increment products AND product_variants independently.
          IF v_target_variant_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.product_variants
            WHERE id = v_target_variant_id
            FOR UPDATE;

            IF v_prev_stock IS NOT NULL THEN
              v_new_stock := v_prev_stock + v_net_restore_qty;

              UPDATE public.product_variants
              SET stock = v_new_stock,
                  updated_at = now()
              WHERE id = v_target_variant_id;

              -- Atomically synchronize parent product to sum of variants
              UPDATE public.products
              SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_item.product_id),
                  updated_at = now()
              WHERE id = v_item.product_id;

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
                v_target_variant_id,
                'adjustment'::public.inventory_tx_type,
                'adjustment'::public.inventory_tx_type,
                v_net_restore_qty,
                v_prev_stock,
                v_new_stock,
                'offline_sale_delete',
                v_sale_id,
                'Stock restoration from deleted POS sale #' || v_sale.sale_number,
                'Stock restoration from deleted POS sale #' || v_sale.sale_number,
                uid
              );

              v_items_restored := v_items_restored + 1;
              v_units_restored := v_units_restored + v_net_restore_qty;
            END IF;
          ELSIF v_item.product_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.products
            WHERE id = v_item.product_id
            FOR UPDATE;

            IF v_prev_stock IS NOT NULL THEN
              v_new_stock := v_prev_stock + v_net_restore_qty;

              UPDATE public.products
              SET stock = v_new_stock,
                  updated_at = now()
              WHERE id = v_item.product_id;

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
                NULL,
                'adjustment'::public.inventory_tx_type,
                'adjustment'::public.inventory_tx_type,
                v_net_restore_qty,
                v_prev_stock,
                v_new_stock,
                'offline_sale_delete',
                v_sale_id,
                'Stock restoration from deleted POS sale #' || v_sale.sale_number,
                'Stock restoration from deleted POS sale #' || v_sale.sale_number,
                uid
              );

              v_items_restored := v_items_restored + 1;
              v_units_restored := v_units_restored + v_net_restore_qty;
            END IF;
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

      -- Unlink any return items referencing these sale items before deleting sale items
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_return_items') THEN
        UPDATE public.offline_return_items
        SET original_sale_item_id = NULL
        WHERE original_sale_item_id IN (
          SELECT id FROM public.offline_sale_items WHERE sale_id = v_sale_id
        );
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

-- Reconcile 'king' product stock back to its authentic 1 unit
UPDATE public.product_variants
SET stock = 1, updated_at = now()
WHERE id = 'f1a030c9-3160-4bb3-a6f3-366b468e7e58';

UPDATE public.products
SET stock = 1, updated_at = now()
WHERE id = 'efe67f07-f370-4a94-b797-eebab76e48b5';

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
