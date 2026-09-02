-- Migration: 20260928000031_grant_product_costs_anon.sql
-- Description: Allow public read of product_costs for reporting and cost resolution
GRANT SELECT ON public.product_costs TO anon, authenticated;

DROP POLICY IF EXISTS "allow read product costs" ON public.product_costs;
CREATE POLICY "allow read product costs" ON public.product_costs 
  FOR SELECT TO public 
  USING (true);
