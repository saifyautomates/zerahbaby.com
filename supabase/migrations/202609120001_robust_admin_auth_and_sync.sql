-- =====================================================================
-- Migration: 202609120001_robust_admin_auth_and_sync.sql
-- Description: Robust atomic admin role checking and auto-sync from allowlist
-- =====================================================================

-- 1. Ensure admin allowlist table exists with seed data
CREATE TABLE IF NOT EXISTS public.admin_allowlist (
  email text PRIMARY KEY,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_allowlist TO authenticated;
GRANT ALL ON public.admin_allowlist TO service_role;
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read allowlist" ON public.admin_allowlist;
CREATE POLICY "admins read allowlist" ON public.admin_allowlist 
  FOR SELECT TO authenticated 
  USING (public.has_role(auth.uid(), 'admin'));

-- Ensure canonical admin accounts are present in allowlist
INSERT INTO public.admin_allowlist (email) VALUES
  ('jackxparrowww@gmail.com'),
  ('hello@zerahkids.com')
ON CONFLICT (email) DO NOTHING;

-- 2. Enhanced sync_admin_from_allowlist function that checks auth.users, auth.jwt(), and profiles
CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE 
  uid uuid := auth.uid();
  user_email text;
  jwt_email text;
  profile_email text;
  matched boolean := false;
BEGIN
  IF uid IS NULL THEN 
    RETURN false; 
  END IF;

  -- If user already has admin role in user_roles, return true immediately
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'admin') THEN
    RETURN true;
  END IF;

  -- 1. Check email from auth.users
  SELECT lower(trim(email)) INTO user_email FROM auth.users WHERE id = uid;
  
  -- 2. Check email from JWT claim
  BEGIN
    jwt_email := lower(trim(auth.jwt() ->> 'email'));
  EXCEPTION WHEN OTHERS THEN
    jwt_email := NULL;
  END;

  -- 3. Check email from profiles table
  SELECT lower(trim(email)) INTO profile_email FROM public.profiles WHERE id = uid;

  -- Check if any of these emails match the admin_allowlist
  IF (user_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = user_email))
     OR (jwt_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = jwt_email))
     OR (profile_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = profile_email))
  THEN
    INSERT INTO public.user_roles (user_id, role) 
    VALUES (uid, 'admin') 
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN true;
  END IF;

  -- First-boot fallback: if no admin exists anywhere in the system and user is on allowlist
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    IF (user_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = user_email)) THEN
      INSERT INTO public.user_roles (user_id, role) 
      VALUES (uid, 'admin') 
      ON CONFLICT (user_id, role) DO NOTHING;
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END; 
$$;

GRANT EXECUTE ON FUNCTION public.sync_admin_from_allowlist() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_admin_from_allowlist() FROM anon;

-- 3. Atomic check_is_admin function: single-call authoritative check + sync
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

  -- Fast path: already granted
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'admin') THEN
    RETURN true;
  END IF;

  -- Slow path: attempt allowlist sync
  RETURN public.sync_admin_from_allowlist();
END; 
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM anon;
