-- Migration to fix the admin_delete_products RPC which was referencing a non-existent table (recently_viewed)

CREATE OR REPLACE FUNCTION public.admin_delete_products(_product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_deleted_count integer := 0;
  v_archived_count integer := 0;
  v_prod_id uuid;
  v_has_transactions boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.has_role(v_caller_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized. Only admins can delete products.';
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0, 'archived', 0);
  END IF;

  FOREACH v_prod_id IN ARRAY _product_ids LOOP
    -- Check if product has historical transactions
    SELECT (
      EXISTS (SELECT 1 FROM public.order_items WHERE product_id = v_prod_id) OR
      EXISTS (SELECT 1 FROM public.offline_sale_items WHERE product_id = v_prod_id)
    ) INTO v_has_transactions;

    IF v_has_transactions THEN
      -- Archive to preserve audit history
      UPDATE public.products SET is_active = false, updated_at = now() WHERE id = v_prod_id;
      v_archived_count := v_archived_count + 1;
    ELSE
      -- Clean cascade items that might not have ON DELETE CASCADE or to be explicit
      DELETE FROM public.product_images WHERE product_id = v_prod_id;
      DELETE FROM public.product_costs WHERE product_id = v_prod_id;
      DELETE FROM public.cart_items WHERE product_id = v_prod_id;
      DELETE FROM public.wishlists WHERE product_id = v_prod_id;
      DELETE FROM public.reviews WHERE product_id = v_prod_id;
      
      -- recently_viewed was removed because it is a client-side only concept and the table does not exist in the schema.
      
      -- Delete product
      DELETE FROM public.products WHERE id = v_prod_id;
      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_deleted_count,
    'archived', v_archived_count
  );
END;
$$;
