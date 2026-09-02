-- ==============================================================================
-- Migration: 20260928000017_handle_created_by_in_sales_and_returns.sql
-- Description:
-- Make created_by nullable in offline_sales and inventory_transactions if needed,
-- and fallback gracefully to admin user or null in place_offline_sale and process_offline_return.
-- ==============================================================================

ALTER TABLE public.offline_sales ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.inventory_transactions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.offline_returns ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.store_credit_ledger ALTER COLUMN created_by DROP NOT NULL;
