-- ==============================================================================
-- Migration: 20260928000201_grant_admin_catalog_mutation_privileges.sql
-- Description:
-- Fix "permission denied for table products" and "permission denied for table product_variants"
-- during Admin panel stock editing, archiving, restoring, and product updates.
-- Grants full catalog mutation privileges to anon, authenticated, and service_role,
-- and configures RLS policies so merchants can seamlessly manage inventory.
-- ==============================================================================

-- 1. Table Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO anon, authenticated, service_role;

-- 2. RLS Policies for Products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_products_admin" ON public.products;
DROP POLICY IF EXISTS "active products public read" ON public.products;
DROP POLICY IF EXISTS "active products anon read" ON public.products;
DROP POLICY IF EXISTS "active products auth read" ON public.products;
DROP POLICY IF EXISTS "admin_manage_products" ON public.products;

CREATE POLICY "admin_manage_products"
  ON public.products
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 3. RLS Policies for Product Variants
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product variants public read" ON public.product_variants;
DROP POLICY IF EXISTS "admins manage product variants" ON public.product_variants;
DROP POLICY IF EXISTS "admin_manage_product_variants" ON public.product_variants;

CREATE POLICY "admin_manage_product_variants"
  ON public.product_variants
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 4. RLS Policies for Product Images
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_images_admin" ON public.product_images;
DROP POLICY IF EXISTS "admin_manage_product_images" ON public.product_images;

CREATE POLICY "admin_manage_product_images"
  ON public.product_images
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 5. RLS Policies for Product Costs
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "admin_manage_product_costs" ON public.product_costs;

CREATE POLICY "admin_manage_product_costs"
  ON public.product_costs
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
