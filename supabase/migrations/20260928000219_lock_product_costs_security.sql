-- Migration: 20260928000219_lock_product_costs_security.sql
-- Description: SECURITY HARDENING — Revoke all public/anonymous access to wholesale buying prices (product_costs).
-- Enforces admin-only access using public.has_role(auth.uid(), 'admin').

-- 1. Drop any permissive policies
DROP POLICY IF EXISTS "admin_manage_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "allow read product costs" ON public.product_costs;
DROP POLICY IF EXISTS "allow all on product costs" ON public.product_costs;
DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;

-- 2. Revoke all privileges from anon
REVOKE ALL ON public.product_costs FROM anon;

-- 3. Ensure Row Level Security is strictly enabled
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- 4. Grant table operations to authenticated users and full operations to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

-- 5. Create strict admin-only RLS policy
CREATE POLICY "admins manage product costs" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
