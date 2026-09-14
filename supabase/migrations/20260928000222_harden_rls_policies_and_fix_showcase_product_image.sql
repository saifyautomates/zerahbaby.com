-- ==============================================================================
-- Migration: 20260928000222_harden_rls_policies_and_fix_showcase_product_image.sql
-- Description:
-- 1. Security Lockdown: Revoke anonymous access and drop overly permissive 
--    'dashboard_read_*' policies on:
--      - offline_sales
--      - offline_sale_items
--      - offline_returns
--      - offline_return_items
--      - orders
--      - order_items
--      - admin_notifications
--      - product_costs
-- 2. Restore strict RLS policies for authenticated administrators and order owners
-- 3. Fix broken Unsplash image URL (404 / ORB blocked) for product:
--    'zerah-natural-baby-massage-oil-almond-200ml'
-- ==============================================================================

-- 1. Drop overly permissive dashboard_read_* policies introduced in 20260928000200
DROP POLICY IF EXISTS "dashboard_read_orders" ON public.orders;
DROP POLICY IF EXISTS "dashboard_read_order_items" ON public.order_items;
DROP POLICY IF EXISTS "dashboard_read_offline_sales" ON public.offline_sales;
DROP POLICY IF EXISTS "dashboard_read_offline_sale_items" ON public.offline_sale_items;
DROP POLICY IF EXISTS "dashboard_read_offline_returns" ON public.offline_returns;
DROP POLICY IF EXISTS "dashboard_read_offline_return_items" ON public.offline_return_items;
DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "dashboard_read_admin_notifications" ON public.admin_notifications;

-- 2. Revoke anonymous read access
REVOKE SELECT ON public.offline_sales FROM anon;
REVOKE SELECT ON public.offline_sale_items FROM anon;
REVOKE SELECT ON public.offline_returns FROM anon;
REVOKE SELECT ON public.offline_return_items FROM anon;
REVOKE SELECT ON public.orders FROM anon;
REVOKE SELECT ON public.order_items FROM anon;
REVOKE SELECT ON public.admin_notifications FROM anon;
REVOKE SELECT ON public.product_costs FROM anon;

-- Ensure authenticated & service_role have proper table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sale_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_return_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT SELECT, INSERT ON public.order_items TO authenticated;

GRANT ALL ON public.offline_sales TO service_role;
GRANT ALL ON public.offline_sale_items TO service_role;
GRANT ALL ON public.offline_returns TO service_role;
GRANT ALL ON public.offline_return_items TO service_role;
GRANT ALL ON public.admin_notifications TO service_role;
GRANT ALL ON public.product_costs TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.order_items TO service_role;

-- 3. Ensure Row Level Security is enabled
ALTER TABLE public.offline_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- 4. Re-establish authenticated admin policies for offline sales & returns
DROP POLICY IF EXISTS "admins manage offline sales" ON public.offline_sales;
CREATE POLICY "admins manage offline sales"
  ON public.offline_sales FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS "admins manage offline sale items" ON public.offline_sale_items;
CREATE POLICY "admins manage offline sale items"
  ON public.offline_sale_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS "admins manage offline returns" ON public.offline_returns;
CREATE POLICY "admins manage offline returns"
  ON public.offline_returns FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS "admins manage offline return items" ON public.offline_return_items;
CREATE POLICY "admins manage offline return items"
  ON public.offline_return_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS "admins manage admin notifications" ON public.admin_notifications;
CREATE POLICY "admins manage admin notifications"
  ON public.admin_notifications FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;
CREATE POLICY "admins manage product costs"
  ON public.product_costs FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin() OR public.is_staff_or_admin());

-- 5. Re-establish authenticated customer & admin policies for online orders
DROP POLICY IF EXISTS "customer and admin read orders" ON public.orders;
CREATE POLICY "customer and admin read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL AND (
        (NULLIF(auth.jwt()->>'phone', '') IS NOT NULL AND (
          phone = auth.jwt()->>'phone'
          OR phone = replace(auth.jwt()->>'phone', '+91', '')
          OR phone = right(auth.jwt()->>'phone', 10)
        ))
        OR (NULLIF(auth.jwt()->>'email', '') IS NOT NULL AND lower(email) = lower(auth.jwt()->>'email'))
      )
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_admin()
    OR public.is_staff_or_admin()
  );

DROP POLICY IF EXISTS "customer and admin read order items" ON public.order_items;
CREATE POLICY "customer and admin read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR (
            o.user_id IS NULL AND (
              (NULLIF(auth.jwt()->>'phone', '') IS NOT NULL AND (
                o.phone = auth.jwt()->>'phone'
                OR o.phone = replace(auth.jwt()->>'phone', '+91', '')
                OR o.phone = right(auth.jwt()->>'phone', 10)
              ))
              OR (NULLIF(auth.jwt()->>'email', '') IS NOT NULL AND lower(o.email) = lower(auth.jwt()->>'email'))
            )
          )
          OR public.has_role(auth.uid(), 'admin')
          OR public.is_admin()
          OR public.is_staff_or_admin()
        )
    )
  );

-- 6. Fix broken Unsplash image URL for 'zerah-natural-baby-massage-oil-almond-200ml'
UPDATE public.product_images
SET public_url = 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80'
WHERE product_id IN (
  SELECT id FROM public.products WHERE slug = 'zerah-natural-baby-massage-oil-almond-200ml'
)
AND (public_url LIKE '%1608248597359%' OR is_primary = true);
