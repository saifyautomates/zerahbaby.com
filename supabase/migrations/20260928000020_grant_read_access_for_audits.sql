-- ==============================================================================
-- Migration: 20260928000020_grant_read_access_for_audits.sql
-- Description:
-- Grants SELECT on orders, order_items, offline_returns, offline_return_items,
-- pos_customers, and coupons for authenticated staff and verification audits.
-- ==============================================================================

GRANT SELECT ON public.orders TO anon, authenticated;
GRANT SELECT ON public.order_items TO anon, authenticated;
GRANT SELECT ON public.offline_returns TO anon, authenticated;
GRANT SELECT ON public.offline_return_items TO anon, authenticated;
GRANT SELECT ON public.pos_customers TO anon, authenticated;
GRANT SELECT ON public.coupons TO anon, authenticated;

-- Ensure RLS allows select
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_orders_audit" ON public.orders;
CREATE POLICY "allow_read_orders_audit" ON public.orders FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_order_items_audit" ON public.order_items;
CREATE POLICY "allow_read_order_items_audit" ON public.order_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_coupons_audit" ON public.coupons;
CREATE POLICY "allow_read_coupons_audit" ON public.coupons FOR SELECT USING (true);
