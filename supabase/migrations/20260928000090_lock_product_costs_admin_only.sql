-- Migration: 20260928000090_lock_product_costs_admin_only.sql
-- Description: SECURITY FIX — Revoke anonymous/public access to product_costs.
-- The original 202608220011_secure_buying_price.sql correctly restricted this table
-- to admin-only via has_role(). Later migrations (20260928000031, 20260928000033)
-- incorrectly granted anon access. This migration restores the secure state.
-- Server-side SECURITY DEFINER RPCs (place_offline_sale, place_order, etc.) that
-- JOIN product_costs continue to work because they execute as service_role.

-- 1. Drop all permissive open policies
DROP POLICY IF EXISTS "allow read product costs" ON public.product_costs;
DROP POLICY IF EXISTS "allow all on product costs" ON public.product_costs;
DROP POLICY IF EXISTS "authenticated users view product costs" ON public.product_costs;

-- 2. Revoke all grants from anon
REVOKE ALL ON public.product_costs FROM anon;

-- 3. Ensure RLS is enabled
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- 4. Grant only to authenticated (admin will be filtered by RLS) and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

-- 5. Drop any existing admin policy to avoid conflict, then create canonical admin-only policy
DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;
CREATE POLICY "admins manage product costs" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
