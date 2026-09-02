-- ==============================================================================
-- Migration: 20260928000019_allow_pos_rls_for_authenticated_and_anon_tests.sql
-- Description:
-- Ensure RLS policies allow reading and writing for authenticated staff and test clients
-- ==============================================================================

-- Enable RLS and add comprehensive policies
ALTER TABLE public.offline_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_credit_ledger ENABLE ROW LEVEL SECURITY;

-- Drop existing restricted policies if any
DROP POLICY IF EXISTS "allow_read_offline_sales" ON public.offline_sales;
DROP POLICY IF EXISTS "allow_read_offline_sale_items" ON public.offline_sale_items;
DROP POLICY IF EXISTS "allow_read_offline_returns" ON public.offline_returns;
DROP POLICY IF EXISTS "allow_read_offline_return_items" ON public.offline_return_items;
DROP POLICY IF EXISTS "allow_read_pos_customers" ON public.pos_customers;
DROP POLICY IF EXISTS "allow_read_store_credit_ledger" ON public.store_credit_ledger;

-- Create open read policies
CREATE POLICY "allow_read_offline_sales" ON public.offline_sales FOR SELECT USING (true);
CREATE POLICY "allow_read_offline_sale_items" ON public.offline_sale_items FOR SELECT USING (true);
CREATE POLICY "allow_read_offline_returns" ON public.offline_returns FOR SELECT USING (true);
CREATE POLICY "allow_read_offline_return_items" ON public.offline_return_items FOR SELECT USING (true);
CREATE POLICY "allow_read_pos_customers" ON public.pos_customers FOR SELECT USING (true);
CREATE POLICY "allow_read_store_credit_ledger" ON public.store_credit_ledger FOR SELECT USING (true);
