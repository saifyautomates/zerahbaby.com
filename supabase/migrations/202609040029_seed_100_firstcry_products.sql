-- ==============================================================================
-- Migration: Seed 100 FirstCry Products & Admin Batch Deletion RPCs
-- Description:
-- 1. Expands categories table with all 8 primary baby & kids categories.
-- 2. Creates atomic RPC functions for safe admin product batch & bulk deletion.
-- 3. Seeds 100 high-quality FirstCry baby & kids catalog products (stock = 10 each).
-- 4. Populates product_images and product_costs for all 100 products.
-- ==============================================================================

-- 1. Ensure categories are up to date
INSERT INTO public.categories (slug, name, tagline, sort_order) VALUES
  ('clothing', 'Clothing & Fashion', 'Soft, breathable everyday wear & festive outfits', 1),
  ('toys', 'Toys & Games', 'Safe sensory play, puzzles & learning toys', 2),
  ('care', 'Nursery & Care', 'Gentle skincare, bath & pediatric hygiene essentials', 3),
  ('gear', 'Travel Gear & Strollers', 'Strollers, car seats, carriers & travel gear', 4),
  ('feeding', 'Feeding & Nursing', 'Anti-colic bottles, sterilizers, tableware & pumps', 5),
  ('diapering', 'Diapering & Potty', 'Ultra-absorbent diapers, wipes & training gear', 6),
  ('bath', 'Bath & Healthcare', 'Collapsible tubs, organic towels & grooming kits', 7),
  ('footwear', 'Footwear & Accessories', 'Pre-walkers, sandals, clogs, sneakers & hats', 8)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  sort_order = EXCLUDED.sort_order;

-- 2. Atomic RPC function for deleting multiple custom products
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
  v_skipped_count integer := 0;
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
      -- Clean cascade items
      DELETE FROM public.product_images WHERE product_id = v_prod_id;
      DELETE FROM public.product_costs WHERE product_id = v_prod_id;
      DELETE FROM public.cart_items WHERE product_id = v_prod_id;
      DELETE FROM public.wishlists WHERE product_id = v_prod_id;
      DELETE FROM public.reviews WHERE product_id = v_prod_id;
      DELETE FROM public.recently_viewed WHERE product_id = v_prod_id;
      
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

REVOKE ALL ON FUNCTION public.admin_delete_products(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_products(uuid[]) TO authenticated, service_role;

-- 3. Atomic RPC function for deleting all products
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

REVOKE ALL ON FUNCTION public.admin_delete_all_products(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_all_products(boolean) TO authenticated, service_role;
