-- Migration: 20261010150100_lock_product_costs_admin_staff_only.sql
-- Description: Strictly lock public.product_costs to authenticated admin/staff roles.
-- Revokes all public and anon table access to protect wholesale buying prices.

-- 1. Ensure Row Level Security is active and forced
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costs FORCE ROW LEVEL SECURITY;

-- 2. Revoke ALL table permissions from anon and public roles
REVOKE ALL ON public.product_costs FROM anon;
REVOKE ALL ON public.product_costs FROM public;

-- 3. Drop all existing policies on product_costs to ensure clean slate
DROP POLICY IF EXISTS "allow read product costs" ON public.product_costs;
DROP POLICY IF EXISTS "allow all on product costs" ON public.product_costs;
DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "admin_manage_product_costs" ON public.product_costs;
DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;
DROP POLICY IF EXISTS "staff_and_admin_manage_product_costs" ON public.product_costs;

-- 4. Grant table privileges strictly to authenticated users and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

-- 5. Create strict RLS policy: Only authenticated admin, staff, manager, owner, or pos_user
CREATE POLICY "staff_and_admin_manage_product_costs" ON public.product_costs
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'staff') 
    OR public.has_role(auth.uid(), 'manager') 
    OR public.has_role(auth.uid(), 'pos_user') 
    OR public.has_role(auth.uid(), 'owner') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'staff') 
    OR public.has_role(auth.uid(), 'manager') 
    OR public.has_role(auth.uid(), 'pos_user') 
    OR public.has_role(auth.uid(), 'owner') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- 6. Reload schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
