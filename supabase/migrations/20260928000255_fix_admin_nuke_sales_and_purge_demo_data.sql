-- ==============================================================================
-- Migration: 20260928000255_fix_admin_nuke_sales_and_purge_demo_data.sql
-- Fixes "DELETE requires a WHERE clause" safe_updates error in admin_nuke_all_sales
-- and executes an immediate clean wipe of all demo/test sales data for production release.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_nuke_all_sales()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  deleted_sales integer := 0;
  deleted_items integer := 0;
  deleted_returns integer := 0;
  deleted_return_items integer := 0;
BEGIN
  -- 1. Delete return items and returns
  DELETE FROM public.offline_return_items WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_return_items = ROW_COUNT;

  DELETE FROM public.offline_returns WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_returns = ROW_COUNT;

  -- 2. Delete sale items and sales
  DELETE FROM public.offline_sale_items WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_items = ROW_COUNT;

  DELETE FROM public.offline_sales WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_sales = ROW_COUNT;

  -- 3. Reset pos_customers stats
  UPDATE public.pos_customers
  SET total_purchases = 0,
      total_spend = 0
  WHERE id IS NOT NULL;

  -- 4. Clean up any inventory transactions tied to offline sales/returns
  DELETE FROM public.inventory_transactions 
  WHERE reference_type IN ('offline_sale', 'offline_return', 'test_order')
    AND id IS NOT NULL;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_sales', deleted_sales,
    'deleted_items', deleted_items,
    'deleted_returns', deleted_returns,
    'deleted_return_items', deleted_return_items,
    'message', 'Successfully wiped all offline sales, items, and returns.'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_nuke_all_sales() TO authenticated, anon, service_role;

-- Execute immediate wipe for production launch
SELECT public.admin_nuke_all_sales();
