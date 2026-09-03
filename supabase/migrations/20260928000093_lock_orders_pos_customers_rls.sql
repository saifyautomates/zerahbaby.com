-- ==============================================================================
-- Migration: 20260928000093_lock_orders_pos_customers_rls.sql
-- Description:
-- Permanent lockdown of orders, order_items, pos_customers, offline_returns,
-- and coupons. Closes anonymous PII data exposure while preserving authenticated
-- customer self-access and admin management privileges.
-- ==============================================================================

-- 1. Revoke public / anonymous read access
REVOKE SELECT ON public.orders FROM anon;
REVOKE SELECT ON public.order_items FROM anon;
REVOKE SELECT ON public.pos_customers FROM anon;
REVOKE SELECT ON public.offline_returns FROM anon;
REVOKE SELECT ON public.offline_return_items FROM anon;

-- Keep authenticated and service_role grants
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_customers TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.order_items TO service_role;
GRANT ALL ON public.pos_customers TO service_role;
GRANT ALL ON public.offline_returns TO service_role;
GRANT ALL ON public.offline_return_items TO service_role;

-- 2. Drop insecure audit test policies
DROP POLICY IF EXISTS "allow_read_orders_audit" ON public.orders;
DROP POLICY IF EXISTS "allow_read_order_items_audit" ON public.order_items;
DROP POLICY IF EXISTS "allow_read_pos_customers" ON public.pos_customers;
DROP POLICY IF EXISTS "allow_read_coupons_audit" ON public.coupons;

-- 3. Strict RLS for public.orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own orders read" ON public.orders;
DROP POLICY IF EXISTS "admins read all orders" ON public.orders;
DROP POLICY IF EXISTS "customer and admin read orders" ON public.orders;

CREATE POLICY "customer and admin read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  );

-- 4. Strict RLS for public.order_items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own order items read" ON public.order_items;
DROP POLICY IF EXISTS "admins read all order items" ON public.order_items;
DROP POLICY IF EXISTS "customer and admin read order items" ON public.order_items;

CREATE POLICY "customer and admin read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- 5. Strict RLS for public.pos_customers (Admin only)
ALTER TABLE public.pos_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage pos customers" ON public.pos_customers;

CREATE POLICY "admins manage pos customers"
  ON public.pos_customers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Strict RLS for offline_returns & offline_return_items (Admin only)
ALTER TABLE public.offline_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage offline returns" ON public.offline_returns;

CREATE POLICY "admins manage offline returns"
  ON public.offline_returns FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.offline_return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage offline return items" ON public.offline_return_items;

CREATE POLICY "admins manage offline return items"
  ON public.offline_return_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Controlled RLS for public.coupons
-- Authenticated and anon can view active unexpired coupons for storefront validation
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read active coupons" ON public.coupons;

CREATE POLICY "public read active coupons"
  ON public.coupons FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true AND (expires_at IS NULL OR expires_at > now())
  );
