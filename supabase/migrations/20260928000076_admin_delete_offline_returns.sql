-- Migration: 20260928000076_admin_delete_offline_returns.sql
-- Administrative Hard Deletion and Bulk Deletion of Offline Return Records

CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_returns(
  _return_ids uuid[],
  _revert_stock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_deleted_count integer := 0;
  v_ret_rec record;
  v_item_rec record;
  v_prod record;
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
      RAISE EXCEPTION 'Only administrators can delete POS return records';
    END IF;
  END IF;

  IF _return_ids IS NULL OR array_length(_return_ids, 1) IS NULL OR array_length(_return_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'No return IDs provided for deletion.'
    );
  END IF;

  -- 2. Optional Inventory Reversal (if stock restock needs to be undone)
  IF _revert_stock = true THEN
    FOR v_item_rec IN
      SELECT 
        ri.product_id,
        ri.variant_id,
        ri.product_slug,
        ri.qty,
        ri.name,
        ri.sku,
        ri.barcode,
        r.return_number
      FROM public.offline_return_items ri
      JOIN public.offline_returns r ON r.id = ri.return_id
      WHERE ri.return_id = ANY(_return_ids)
    LOOP
      IF v_item_rec.qty > 0 AND v_item_rec.product_id IS NOT NULL THEN
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = v_item_rec.product_id
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          v_prev_stock := v_prod.stock;
          v_new_stock := GREATEST(0, v_prev_stock - v_item_rec.qty);

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_prod.id;

          IF v_item_rec.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = GREATEST(0, stock - v_item_rec.qty),
                updated_at = now()
            WHERE id = v_item_rec.variant_id;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 3. Clean up associated notifications
  DELETE FROM public.admin_notifications
  WHERE event_key = ANY(SELECT 'POS_RETURN:' || unnest(_return_ids)::text)
     OR (entity_type = 'offline_return' AND entity_id = ANY(SELECT unnest(_return_ids)::text));

  -- 4. Clean up store credit ledger references
  UPDATE public.store_credit_ledger
  SET source_return_id = NULL
  WHERE source_return_id = ANY(_return_ids);

  -- 5. Delete from offline_return_items
  DELETE FROM public.offline_return_items
  WHERE return_id = ANY(_return_ids);

  -- 6. Delete from offline_returns
  DELETE FROM public.offline_returns
  WHERE id = ANY(_return_ids);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'message', 'Successfully deleted ' || v_deleted_count || ' return record(s).'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
