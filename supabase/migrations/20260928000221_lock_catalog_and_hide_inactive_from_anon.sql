-- Migration: 20260928000221_lock_catalog_and_hide_inactive_from_anon.sql
-- Description: SECURITY & INTEGRITY FIX — Restrict public/anon to active catalog items only (is_active = true)
-- and revoke all mutation privileges on products and product_variants from anon.

-- 1. Revoke mutation privileges from anon
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.product_variants FROM anon;

-- 2. Ensure RLS is active
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- 3. Clean up overly permissive or colliding policies on products
DROP POLICY IF EXISTS "admin_manage_products" ON public.products;
DROP POLICY IF EXISTS "allow_all_products_admin" ON public.products;
DROP POLICY IF EXISTS "active products public read" ON public.products;
DROP POLICY IF EXISTS "active products anon read" ON public.products;
DROP POLICY IF EXISTS "active products auth read" ON public.products;
DROP POLICY IF EXISTS "admins manage products" ON public.products;

-- 4. Create correct policies on products
CREATE POLICY "active products anon read" ON public.products
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "active products auth read" ON public.products
  FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins manage products" ON public.products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Clean up overly permissive policies on product_variants
DROP POLICY IF EXISTS "admin_manage_product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "public read product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "product variants public read" ON public.product_variants;
DROP POLICY IF EXISTS "active product variants anon read" ON public.product_variants;
DROP POLICY IF EXISTS "active product variants auth read" ON public.product_variants;
DROP POLICY IF EXISTS "admins manage product_variants" ON public.product_variants;
DROP POLICY IF EXISTS "admins manage product variants" ON public.product_variants;

-- 6. Create correct policies on product_variants
CREATE POLICY "active product variants anon read" ON public.product_variants
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "active product variants auth read" ON public.product_variants
  FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins manage product variants" ON public.product_variants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

NOTIFY pgrst, 'reload schema';
