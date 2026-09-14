-- ==============================================================================
-- Migration: 20260928000228_fix_list_admins_ambiguous_email_column.sql
-- Description:
-- Fix column reference "email" is ambiguous error in list_admins() RPC by
-- qualifying table aliases on auth.users and public.profiles.
-- Also harmonize admin authorization and table qualifications across
-- grant_admin_by_email and revoke_admin_by_email.
-- ==============================================================================

-- 1. Recreate list_admins() with strict table column qualifications
CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE (email text, status text, created_at timestamptz)
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller_email text;
  uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email securely with explicit table column qualifications
  SELECT lower(trim(u.email)) INTO caller_email FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)) INTO caller_email FROM public.profiles p WHERE p.id = uid;
  END IF;

  -- Admin check matching full system pattern
  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
    )
  );

  IF NOT v_is_admin THEN 
    RAISE EXCEPTION 'Only admins can list admins'; 
  END IF;

  RETURN QUERY
  SELECT a.email AS email,
         CASE WHEN EXISTS (
           SELECT 1 FROM auth.users usr 
           JOIN public.user_roles r ON r.user_id = usr.id AND r.role = 'admin'
           WHERE lower(trim(usr.email)) = lower(trim(a.email))
         ) THEN 'active' ELSE 'invited' END AS status,
         a.created_at AS created_at
  FROM public.admin_allowlist a
  WHERE lower(trim(a.email)) <> 'jackxparrowww@gmail.com'
     OR (caller_email IS NOT NULL AND caller_email = 'jackxparrowww@gmail.com')
  ORDER BY a.created_at;
END; 
$$;

-- 2. Protect superadmin and fix column qualifications in revoke_admin_by_email
CREATE OR REPLACE FUNCTION public.revoke_admin_by_email(_email text)
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE 
  target uuid;
  caller_email text;
  uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email
  SELECT lower(trim(u.email)) INTO caller_email FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)) INTO caller_email FROM public.profiles p WHERE p.id = uid;
  END IF;

  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
    )
  );

  IF NOT v_is_admin THEN 
    RAISE EXCEPTION 'Only admins can revoke admin'; 
  END IF;

  -- Protect jackxparrowww@gmail.com from being revoked by any other admin
  IF lower(trim(_email)) = 'jackxparrowww@gmail.com' AND (caller_email IS NULL OR caller_email <> 'jackxparrowww@gmail.com') THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify primary superadmin account';
  END IF;

  DELETE FROM public.admin_allowlist al WHERE lower(trim(al.email)) = lower(trim(_email));
  SELECT usr.id INTO target FROM auth.users usr WHERE lower(trim(usr.email)) = lower(trim(_email));
  IF target IS NOT NULL AND target <> uid THEN
    DELETE FROM public.user_roles WHERE user_id = target AND role = 'admin';
  END IF;
  RETURN true;
END; 
$$;

-- 3. Protect superadmin and fix column qualifications in grant_admin_by_email
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(_email text)
RETURNS text 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE 
  target uuid;
  caller_email text;
  uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email
  SELECT lower(trim(u.email)) INTO caller_email FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)) INTO caller_email FROM public.profiles p WHERE p.id = uid;
  END IF;

  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
    )
  );

  IF NOT v_is_admin THEN 
    RAISE EXCEPTION 'Only admins can grant admin access'; 
  END IF;

  -- Protect jackxparrowww@gmail.com from being added/modified by others
  IF lower(trim(_email)) = 'jackxparrowww@gmail.com' AND (caller_email IS NULL OR caller_email <> 'jackxparrowww@gmail.com') THEN
    RAISE EXCEPTION 'Cannot add this administrator.';
  END IF;

  INSERT INTO public.admin_allowlist (email, added_by) 
  VALUES (lower(trim(_email)), uid) 
  ON CONFLICT (email) DO NOTHING;

  SELECT usr.id INTO target FROM auth.users usr WHERE lower(trim(usr.email)) = lower(trim(_email));
  IF target IS NULL THEN 
    SELECT prf.id INTO target FROM public.profiles prf WHERE lower(trim(prf.email)) = lower(trim(_email));
  END IF;

  IF target IS NULL THEN 
    RETURN 'invited'; 
  END IF;

  INSERT INTO public.user_roles (user_id, role) 
  VALUES (target, 'admin') 
  ON CONFLICT DO NOTHING;

  RETURN 'active';
END; 
$$;

-- 4. Update RLS policy on admin_allowlist table with table-qualified references
DROP POLICY IF EXISTS "admins read allowlist" ON public.admin_allowlist;
CREATE POLICY "admins read allowlist" ON public.admin_allowlist 
  FOR SELECT TO authenticated 
  USING (
    (
      public.has_role(auth.uid(), 'admin')
      OR public.is_admin()
      OR public.is_staff_or_admin()
      OR (SELECT public.check_is_admin())
    )
    AND (
      lower(trim(admin_allowlist.email)) <> 'jackxparrowww@gmail.com'
      OR lower(trim(auth.jwt() ->> 'email')) = 'jackxparrowww@gmail.com'
      OR EXISTS (SELECT 1 FROM auth.users usr WHERE usr.id = auth.uid() AND lower(trim(usr.email)) = 'jackxparrowww@gmail.com')
      OR EXISTS (SELECT 1 FROM public.profiles prf WHERE prf.id = auth.uid() AND lower(trim(prf.email)) = 'jackxparrowww@gmail.com')
    )
  );

GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_admins() FROM anon;

GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM anon;

GRANT EXECUTE ON FUNCTION public.revoke_admin_by_email(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_by_email(text) FROM anon;
