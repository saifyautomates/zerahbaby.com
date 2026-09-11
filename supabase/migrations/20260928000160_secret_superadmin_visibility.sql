-- =====================================================================
-- Migration: 20260928000160_secret_superadmin_visibility.sql
-- Description: Ensure jackxparrowww@gmail.com is strictly secret and invisible
--              to any other admin in list_admins RPC and admin_allowlist table.
-- =====================================================================

-- 1. Recreate list_admins() RPC with superadmin confidentiality
CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE (email text, status text, created_at timestamptz)
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE
  caller_email text;
  uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(uid, 'admin') THEN 
    RAISE EXCEPTION 'Only admins can list admins'; 
  END IF;

  -- Resolve caller email securely
  SELECT lower(trim(email)) INTO caller_email FROM auth.users WHERE id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(email)) INTO caller_email FROM public.profiles WHERE id = uid;
  END IF;

  RETURN QUERY
  SELECT a.email,
         CASE WHEN EXISTS (
           SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'
           WHERE lower(trim(u.email)) = lower(trim(a.email))
         ) THEN 'active' ELSE 'invited' END AS status,
         a.created_at
  FROM public.admin_allowlist a
  WHERE lower(trim(a.email)) <> 'jackxparrowww@gmail.com'
     OR (caller_email IS NOT NULL AND caller_email = 'jackxparrowww@gmail.com')
  ORDER BY a.created_at;
END; 
$$;

GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.list_admins() FROM anon;

-- 2. Protect superadmin from revocation by any other admin
CREATE OR REPLACE FUNCTION public.revoke_admin_by_email(_email text)
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public 
AS $$
DECLARE 
  target uuid;
  caller_email text;
  uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(uid, 'admin') THEN 
    RAISE EXCEPTION 'Only admins can revoke admin'; 
  END IF;

  SELECT lower(trim(email)) INTO caller_email FROM auth.users WHERE id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(email)) INTO caller_email FROM public.profiles WHERE id = uid;
  END IF;

  -- Protect jackxparrowww@gmail.com from being revoked by any other admin
  IF lower(trim(_email)) = 'jackxparrowww@gmail.com' AND (caller_email IS NULL OR caller_email <> 'jackxparrowww@gmail.com') THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify primary superadmin account';
  END IF;

  DELETE FROM public.admin_allowlist WHERE lower(trim(email)) = lower(trim(_email));
  SELECT id INTO target FROM auth.users WHERE lower(trim(email)) = lower(trim(_email));
  IF target IS NOT NULL AND target <> uid THEN
    DELETE FROM public.user_roles WHERE user_id = target AND role = 'admin';
  END IF;
  RETURN true;
END; 
$$;

GRANT EXECUTE ON FUNCTION public.revoke_admin_by_email(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_by_email(text) FROM anon;

-- 3. Update RLS policy on admin_allowlist table
DROP POLICY IF EXISTS "admins read allowlist" ON public.admin_allowlist;
CREATE POLICY "admins read allowlist" ON public.admin_allowlist 
  FOR SELECT TO authenticated 
  USING (
    public.has_role(auth.uid(), 'admin')
    AND (
      lower(trim(email)) <> 'jackxparrowww@gmail.com'
      OR lower(trim(auth.jwt() ->> 'email')) = 'jackxparrowww@gmail.com'
      OR EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(trim(email)) = 'jackxparrowww@gmail.com')
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND lower(trim(email)) = 'jackxparrowww@gmail.com')
    )
  );
