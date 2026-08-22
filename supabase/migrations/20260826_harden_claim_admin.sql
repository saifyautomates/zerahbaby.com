-- ============================================================
-- SECURITY FIX: Harden claim_admin and sync_admin_from_allowlist
-- ============================================================
-- 
-- ISSUE 1: claim_admin() allows any authenticated user to become 
-- admin if no admin exists — intended as first-boot only, but
-- can be called by any user who signs up before the owner.
--
-- FIX: Restrict claim_admin() so it only succeeds if the calling
-- user's email is on the admin_allowlist. This prevents race-condition
-- privilege escalation where a random user signs up before the owner.
--
-- ISSUE 2: sync_admin_from_allowlist() also grants admin to any
-- user if the user_roles table has no admins, without checking
-- the allowlist. Same race condition issue.
--
-- FIX: In the "no admin exists" branch, also verify the calling
-- user is on the admin_allowlist before granting.

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  uid uuid := auth.uid();
  mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  -- Only grant if no admin exists yet
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN false; END IF;
  -- SECURITY: Only allow if the user's email is on the admin allowlist
  SELECT email INTO mail FROM auth.users WHERE id = uid;
  IF mail IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT email INTO mail FROM auth.users WHERE id = uid;

  -- SECURITY FIX: In the "no admin exists" branch, only grant admin
  -- if the user's email is on the allowlist (prevents first-user privilege escalation)
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;

  RETURN false;
END; $$;
