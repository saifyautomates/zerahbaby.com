-- Migration: 20260928000033_grant_product_costs_write.sql
-- Description: Allow anon and authenticated full management of product_costs for POS and tests
GRANT ALL ON public.product_costs TO anon, authenticated;
DROP POLICY IF EXISTS "allow all on product costs" ON public.product_costs;
CREATE POLICY "allow all on product costs" ON public.product_costs 
  FOR ALL TO public 
  USING (true)
  WITH CHECK (true);
