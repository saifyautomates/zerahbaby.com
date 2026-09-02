-- ==============================================================================
-- Migration: 20260928000039_allow_admin_nuke_offline_sales.sql
-- Enables clean deletion of test sales data via RLS policy and admin_nuke_all_sales RPC
-- ==============================================================================

-- Delete policies for sales and items
DROP POLICY IF EXISTS "allow_delete_offline_sales" ON public.offline_sales;
CREATE POLICY "allow_delete_offline_sales" ON public.offline_sales FOR DELETE USING (true);

DROP POLICY IF EXISTS "allow_delete_offline_sale_items" ON public.offline_sale_items;
CREATE POLICY "allow_delete_offline_sale_items" ON public.offline_sale_items FOR DELETE USING (true);

DROP POLICY IF EXISTS "allow_delete_offline_returns" ON public.offline_returns;
CREATE POLICY "allow_delete_offline_returns" ON public.offline_returns FOR DELETE USING (true);

DROP POLICY IF EXISTS "allow_delete_offline_return_items" ON public.offline_return_items;
CREATE POLICY "allow_delete_offline_return_items" ON public.offline_return_items FOR DELETE USING (true);

-- RPC to wipe all sales safely
CREATE OR REPLACE FUNCTION public.admin_nuke_all_sales()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  deleted_sales integer := 0;
  deleted_items integer := 0;
BEGIN
  DELETE FROM public.offline_sale_items;
  GET DIAGNOSTICS deleted_items = ROW_COUNT;

  DELETE FROM public.offline_sales;
  GET DIAGNOSTICS deleted_sales = ROW_COUNT;

  -- Reset customer total_purchases and total_spend
  UPDATE public.pos_customers
  SET total_purchases = 0,
      total_spend = 0;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_sales', deleted_sales,
    'deleted_items', deleted_items,
    'message', 'Successfully nuked all offline sales and items.'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_nuke_all_sales() TO authenticated, anon, service_role;
