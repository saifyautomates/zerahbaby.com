-- Migration: 20260928000237_allow_admin_and_staff_view_product_costs.sql
-- Description: Allow all administrators, staff, managers, and POS users to view product_costs
-- so POS live profit and cost calculations work reliably for authenticated store operators.

-- 1. Ensure RLS is enabled on product_costs
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- 2. Drop overly restrictive policy that only checked user_roles.role = 'admin'
DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;
DROP POLICY IF EXISTS "allow read product costs" ON public.product_costs;
DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;

-- 3. Create comprehensive admin & staff policy matching all other admin tables
CREATE POLICY "admins manage product costs" ON public.product_costs
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
