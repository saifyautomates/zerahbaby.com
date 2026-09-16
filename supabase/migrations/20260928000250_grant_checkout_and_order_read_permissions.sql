-- Migration: 20260928000250_grant_checkout_and_order_read_permissions.sql
-- Description: Ensure anon and authenticated roles have SELECT privileges and appropriate RLS policies on checkout_sessions, payment_attempts, orders, and order_items.

GRANT SELECT ON public.checkout_sessions TO anon, authenticated, service_role;
GRANT SELECT ON public.payment_attempts TO anon, authenticated, service_role;
GRANT SELECT ON public.orders TO anon, authenticated, service_role;
GRANT SELECT ON public.order_items TO anon, authenticated, service_role;

-- Ensure RLS is enabled and allows select
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_checkout_sessions" ON public.checkout_sessions;
CREATE POLICY "allow_read_checkout_sessions" ON public.checkout_sessions FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_payment_attempts" ON public.payment_attempts;
CREATE POLICY "allow_read_payment_attempts" ON public.payment_attempts FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_orders" ON public.orders;
CREATE POLICY "allow_read_orders" ON public.orders FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_order_items" ON public.order_items;
CREATE POLICY "allow_read_order_items" ON public.order_items FOR SELECT TO anon, authenticated USING (true);
