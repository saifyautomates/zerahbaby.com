-- Fix admin_delete_products and admin_delete_all_products RPCs
-- 1. Fixes erroneous "wishlists" reference (column product_id does not exist) by targeting "wishlist_items"
-- 2. Explicitly cleans up product_relations
-- 3. Preserves transaction integrity for products with sales history by setting is_active = false
-- 4. Correctly grants execute permissions to authenticated admins

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
      -- Archive to preserve audit history and foreign keys
      UPDATE public.products SET is_active = false, updated_at = now() WHERE id = v_prod_id;
      v_archived_count := v_archived_count + 1;
    ELSE
      -- Clean cascade items safely
      DELETE FROM public.product_images WHERE product_id = v_prod_id;
      DELETE FROM public.product_costs WHERE product_id = v_prod_id;
      DELETE FROM public.cart_items WHERE product_id = v_prod_id;
      DELETE FROM public.wishlist_items WHERE product_id = v_prod_id;
      DELETE FROM public.reviews WHERE product_id = v_prod_id;
      DELETE FROM public.product_relations WHERE product_1_id = v_prod_id OR product_2_id = v_prod_id;
      
      -- Physically delete product
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

CREATE OR REPLACE FUNCTION public.admin_delete_all_products(_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_all_ids uuid[];
  v_res jsonb;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL OR NOT public.has_role(v_caller_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized. Only admins can delete all products.';
  END IF;

  SELECT array_agg(id) INTO v_all_ids FROM public.products;

  IF v_all_ids IS NULL OR array_length(v_all_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0, 'archived', 0);
  END IF;

  v_res := public.admin_delete_products(v_all_ids);
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_products(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_products(uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_delete_all_products(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_all_products(boolean) TO authenticated, service_role;
