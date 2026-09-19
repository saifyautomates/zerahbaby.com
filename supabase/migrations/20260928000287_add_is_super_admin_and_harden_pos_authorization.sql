-- Migration: 20260928000287_add_is_super_admin_and_harden_pos_authorization.sql
-- Description: Add is_super_admin and is_staff to public.profiles and harden authorization helpers

-- 1. Ensure is_super_admin and is_staff exist on public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_staff boolean DEFAULT false;

-- 2. Ensure permissions on columns
GRANT SELECT(id, email, full_name, role, is_admin, is_staff, is_super_admin) ON public.profiles TO authenticated, anon;

-- 3. Enhance is_admin() function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    COALESCE(public.has_role(auth.uid(), 'admin'), false)
    OR COALESCE(public.has_role(auth.uid(), 'owner'), false)
    OR COALESCE(public.has_role(auth.uid(), 'super_admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (COALESCE(is_admin, false) = true OR COALESCE(is_super_admin, false) = true)
    )
    OR EXISTS (
      SELECT 1 FROM auth.users u
      JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
      WHERE u.id = auth.uid()
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

-- 4. Enhance is_staff_or_admin() function
CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() 
        AND role::text IN ('admin', 'staff', 'manager', 'owner', 'super_admin', 'pos_user')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (COALESCE(is_admin, false) = true OR COALESCE(is_super_admin, false) = true OR COALESCE(is_staff, false) = true)
    )
    OR COALESCE(public.has_role(auth.uid(), 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM auth.users u
      JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
      WHERE u.id = auth.uid()
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, anon, service_role;

-- 5. Enhance check_is_admin() function
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE 
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN 
    RETURN false; 
  END IF;

  IF public.is_admin() THEN
    RETURN true;
  END IF;

  RETURN COALESCE(public.sync_admin_from_allowlist(), false);
END; 
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated, service_role;
