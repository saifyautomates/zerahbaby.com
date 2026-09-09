-- Fix app_role enum and add has_role text overload
-- Migration: 20260928000137_fix_app_role_pos_user_and_has_role_overload.sql
-- Description: Adds 'pos_user', 'pos', 'manager', 'owner' to app_role enum and provides
-- a resilient text overload for public.has_role(uuid, text) to prevent casting errors in POS RPCs.

DO $$
BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pos_user';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pos';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Overload has_role with text parameter so string comparisons never fail on enum cast
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND (role::text = _role OR role::text = lower(_role))
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO authenticated, service_role, anon;
