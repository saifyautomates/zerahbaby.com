-- ==============================================================================
-- Migration: 20261108000001_allow_phone_admin_and_sync_profile_phone.sql
-- Description:
-- 1. Sync live profile phone numbers to active user device sessions so that
--    updating phone in profile instantly reflects in admin session overview.
-- 2. Allow phone numbers as administrators in admin_allowlist, grant_admin_by_email,
--    revoke_admin_by_email, list_admins, and sync_admin_from_allowlist so that
--    admins can invite mobile numbers and users can log in via OTP with admin privileges.
-- ==============================================================================

-- 1. Backfill and synchronize existing user_active_sessions with live profile phone numbers
UPDATE public.user_active_sessions s
SET user_phone = COALESCE(NULLIF(p.phone, ''), NULLIF(u.phone, ''), s.user_phone)
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE s.user_id = u.id
  AND (p.phone IS NOT NULL AND p.phone <> '');

-- 2. Update list_user_device_sessions to always return live phone from profiles
CREATE OR REPLACE FUNCTION public.list_user_device_sessions(
  _target_role text DEFAULT NULL,
  _target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  user_phone text,
  user_role text,
  device_id text,
  device_name text,
  device_type text,
  browser text,
  os text,
  ip_address text,
  city text,
  region text,
  country text,
  is_revoked boolean,
  last_active_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  RETURN QUERY
  SELECT 
    s.id,
    s.user_id,
    s.user_email,
    COALESCE(NULLIF(p.phone, ''), NULLIF(s.user_phone, ''), u.phone, '') AS user_phone,
    s.user_role,
    s.device_id,
    s.device_name,
    s.device_type,
    s.browser,
    s.os,
    s.ip_address,
    s.city,
    s.region,
    s.country,
    s.is_revoked,
    s.last_active_at,
    s.created_at
  FROM public.user_active_sessions s
  LEFT JOIN public.profiles p ON p.id = s.user_id
  LEFT JOIN auth.users u ON u.id = s.user_id
  WHERE 
    (_target_role IS NULL OR s.user_role = _target_role)
    AND (_target_user_id IS NULL OR s.user_id = _target_user_id)
  ORDER BY s.last_active_at DESC;
END;
$$;

-- 3. Update register_device_session to resolve live phone from profiles first
CREATE OR REPLACE FUNCTION public.register_device_session(
  _device_id text,
  _device_name text,
  _device_type text DEFAULT 'mobile',
  _browser text DEFAULT NULL,
  _os text DEFAULT NULL,
  _ip_address text DEFAULT NULL,
  _city text DEFAULT NULL,
  _region text DEFAULT NULL,
  _country text DEFAULT 'India',
  _auth_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_profile_phone text;
  v_role text := 'customer';
  v_session_id uuid;
  v_is_revoked boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Determine user email, phone, and role
  SELECT email, phone INTO v_email, v_phone FROM auth.users WHERE id = v_uid;
  SELECT phone INTO v_profile_phone FROM public.profiles WHERE id = v_uid;
  v_phone := COALESCE(NULLIF(v_profile_phone, ''), NULLIF(v_phone, ''));
  
  IF public.is_admin() OR public.has_role(v_uid, 'admin') THEN
    v_role := 'admin';
  END IF;

  -- Upsert active session
  INSERT INTO public.user_active_sessions (
    user_id,
    user_email,
    user_phone,
    user_role,
    device_id,
    device_name,
    device_type,
    browser,
    os,
    ip_address,
    city,
    region,
    country,
    auth_session_id,
    is_revoked,
    revoked_at,
    revoked_by,
    last_active_at,
    updated_at
  )
  VALUES (
    v_uid,
    COALESCE(v_email, ''),
    COALESCE(v_phone, ''),
    v_role,
    _device_id,
    _device_name,
    _device_type,
    _browser,
    _os,
    _ip_address,
    _city,
    _region,
    COALESCE(_country, 'India'),
    _auth_session_id,
    false,
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    user_email = EXCLUDED.user_email,
    user_phone = EXCLUDED.user_phone,
    user_role = EXCLUDED.user_role,
    device_name = EXCLUDED.device_name,
    device_type = EXCLUDED.device_type,
    browser = COALESCE(EXCLUDED.browser, public.user_active_sessions.browser),
    os = COALESCE(EXCLUDED.os, public.user_active_sessions.os),
    ip_address = COALESCE(EXCLUDED.ip_address, public.user_active_sessions.ip_address),
    city = COALESCE(EXCLUDED.city, public.user_active_sessions.city),
    region = COALESCE(EXCLUDED.region, public.user_active_sessions.region),
    country = COALESCE(EXCLUDED.country, public.user_active_sessions.country),
    auth_session_id = COALESCE(EXCLUDED.auth_session_id, public.user_active_sessions.auth_session_id),
    is_revoked = false,
    revoked_at = NULL,
    revoked_by = NULL,
    last_active_at = now(),
    updated_at = now()
  RETURNING id, is_revoked INTO v_session_id, v_is_revoked;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'is_revoked', v_is_revoked
  );
END;
$$;

-- 4. Enable grant_admin_by_email to accept email or phone number
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(_email text)
RETURNS text 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE 
  target uuid;
  caller_email text;
  caller_phone_digits text := '';
  uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_phone boolean := false;
  v_clean_val text;
  v_digits text;
  v_ten_digits text := '';
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email & phone
  SELECT lower(trim(u.email)), right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) 
  INTO caller_email, caller_phone_digits FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)), right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) 
    INTO caller_email, caller_phone_digits FROM public.profiles p WHERE p.id = uid;
  END IF;

  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
         OR (caller_phone_digits <> '' AND right(regexp_replace(al.email, '\D', '', 'g'), 10) = caller_phone_digits)
    )
  );

  IF NOT v_is_admin THEN 
    RAISE EXCEPTION 'Only admins can grant admin access'; 
  END IF;

  -- Protect jackxparrowww@gmail.com from being added/modified by others
  IF lower(trim(_email)) = 'jackxparrowww@gmail.com' AND (caller_email IS NULL OR caller_email <> 'jackxparrowww@gmail.com') THEN
    RAISE EXCEPTION 'Cannot add this administrator.';
  END IF;

  -- Detect if input is phone or email
  IF position('@' in _email) > 0 THEN
    v_is_phone := false;
    v_clean_val := lower(trim(_email));
  ELSE
    v_is_phone := true;
    v_digits := regexp_replace(_email, '\D', '', 'g');
    IF length(v_digits) < 10 THEN
      RAISE EXCEPTION 'Please provide a valid 10-digit mobile number or email address.';
    END IF;
    v_ten_digits := right(v_digits, 10);
    v_clean_val := '+91' || v_ten_digits;
  END IF;

  -- Insert into admin_allowlist
  INSERT INTO public.admin_allowlist (email, added_by) 
  VALUES (v_clean_val, uid) 
  ON CONFLICT (email) DO NOTHING;

  -- Also insert normalized 10-digit format if phone to guarantee collision-free lookup
  IF v_is_phone AND v_clean_val <> v_ten_digits THEN
    INSERT INTO public.admin_allowlist (email, added_by) 
    VALUES (v_ten_digits, uid) 
    ON CONFLICT (email) DO NOTHING;
  END IF;

  -- Check if user already exists
  IF v_is_phone THEN
    SELECT usr.id INTO target FROM auth.users usr 
    WHERE right(regexp_replace(coalesce(usr.phone, ''), '\D', '', 'g'), 10) = v_ten_digits;
    
    IF target IS NULL THEN 
      SELECT prf.id INTO target FROM public.profiles prf 
      WHERE right(regexp_replace(coalesce(prf.phone, ''), '\D', '', 'g'), 10) = v_ten_digits;
    END IF;
  ELSE
    SELECT usr.id INTO target FROM auth.users usr WHERE lower(trim(usr.email)) = v_clean_val;
    IF target IS NULL THEN 
      SELECT prf.id INTO target FROM public.profiles prf WHERE lower(trim(prf.email)) = v_clean_val;
    END IF;
  END IF;

  IF target IS NULL THEN 
    RETURN 'invited'; 
  END IF;

  INSERT INTO public.user_roles (user_id, role) 
  VALUES (target, 'admin') 
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles SET is_admin = true WHERE id = target;

  RETURN 'active';
END; 
$$;

-- 5. Enable revoke_admin_by_email to accept email or phone number
CREATE OR REPLACE FUNCTION public.revoke_admin_by_email(_email text)
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE 
  target uuid;
  caller_email text;
  caller_phone_digits text := '';
  uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_phone boolean := false;
  v_clean_val text;
  v_digits text;
  v_ten_digits text := '';
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email & phone
  SELECT lower(trim(u.email)), right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) 
  INTO caller_email, caller_phone_digits FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)), right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) 
    INTO caller_email, caller_phone_digits FROM public.profiles p WHERE p.id = uid;
  END IF;

  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
         OR (caller_phone_digits <> '' AND right(regexp_replace(al.email, '\D', '', 'g'), 10) = caller_phone_digits)
    )
  );

  IF NOT v_is_admin THEN 
    RAISE EXCEPTION 'Only admins can revoke admin'; 
  END IF;

  -- Protect jackxparrowww@gmail.com from being revoked by any other admin
  IF lower(trim(_email)) = 'jackxparrowww@gmail.com' AND (caller_email IS NULL OR caller_email <> 'jackxparrowww@gmail.com') THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify primary superadmin account';
  END IF;

  IF position('@' in _email) > 0 THEN
    v_clean_val := lower(trim(_email));
    DELETE FROM public.admin_allowlist al WHERE lower(trim(al.email)) = v_clean_val;
    SELECT usr.id INTO target FROM auth.users usr WHERE lower(trim(usr.email)) = v_clean_val;
    IF target IS NULL THEN
      SELECT prf.id INTO target FROM public.profiles prf WHERE lower(trim(prf.email)) = v_clean_val;
    END IF;
  ELSE
    v_digits := regexp_replace(_email, '\D', '', 'g');
    v_ten_digits := right(v_digits, 10);
    DELETE FROM public.admin_allowlist al 
    WHERE right(regexp_replace(al.email, '\D', '', 'g'), 10) = v_ten_digits;
    
    SELECT usr.id INTO target FROM auth.users usr 
    WHERE right(regexp_replace(coalesce(usr.phone, ''), '\D', '', 'g'), 10) = v_ten_digits;
    IF target IS NULL THEN
      SELECT prf.id INTO target FROM public.profiles prf 
      WHERE right(regexp_replace(coalesce(prf.phone, ''), '\D', '', 'g'), 10) = v_ten_digits;
    END IF;
  END IF;

  IF target IS NOT NULL AND target <> uid THEN
    DELETE FROM public.user_roles WHERE user_id = target AND role = 'admin';
    UPDATE public.profiles SET is_admin = false WHERE id = target;
  END IF;

  RETURN true;
END; 
$$;

-- 6. Update list_admins to display both email and phone admins cleanly
CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE (email text, status text, created_at timestamptz)
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller_email text;
  caller_phone_digits text := '';
  uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve caller email & phone
  SELECT lower(trim(u.email)), right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) 
  INTO caller_email, caller_phone_digits FROM auth.users u WHERE u.id = uid;
  IF caller_email IS NULL THEN
    BEGIN
      caller_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      caller_email := NULL;
    END;
  END IF;
  IF caller_email IS NULL THEN
    SELECT lower(trim(p.email)), right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) 
    INTO caller_email, caller_phone_digits FROM public.profiles p WHERE p.id = uid;
  END IF;

  v_is_admin := (
    public.has_role(uid, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist al
      WHERE lower(trim(al.email)) = lower(trim(coalesce(caller_email, '')))
         OR (caller_phone_digits <> '' AND right(regexp_replace(al.email, '\D', '', 'g'), 10) = caller_phone_digits)
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
              OR (
                position('@' in a.email) = 0
                AND right(regexp_replace(coalesce(usr.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
              )
         ) OR EXISTS (
           SELECT 1 FROM public.profiles prf 
           JOIN public.user_roles r ON r.user_id = prf.id AND r.role = 'admin'
           WHERE lower(trim(prf.email)) = lower(trim(a.email))
              OR (
                position('@' in a.email) = 0
                AND right(regexp_replace(coalesce(prf.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
              )
         ) THEN 'active' ELSE 'invited' END AS status,
         a.created_at AS created_at
  FROM public.admin_allowlist a
  WHERE (lower(trim(a.email)) <> 'jackxparrowww@gmail.com'
     OR (caller_email IS NOT NULL AND caller_email = 'jackxparrowww@gmail.com'))
    -- Do not duplicate 10-digit duplicate rows if +91 already exists
    AND NOT (
      position('@' in a.email) = 0 
      AND length(a.email) = 10 
      AND EXISTS (SELECT 1 FROM public.admin_allowlist a2 WHERE a2.email = '+91' || a.email)
    )
  ORDER BY a.created_at;
END; 
$$;

-- 7. Update sync_admin_from_allowlist to synchronize phone OTP logins with admin role
CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp 
AS $$
DECLARE 
  uid uuid := auth.uid();
  user_email text;
  jwt_email text;
  profile_email text;
  user_phone text;
  user_phone_digits text := '';
  profile_phone text;
  profile_phone_digits text := '';
BEGIN
  IF uid IS NULL THEN 
    RETURN false; 
  END IF;

  -- If user already has admin role in user_roles, return true immediately
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'admin') THEN
    RETURN true;
  END IF;

  -- 1. Check email & phone from auth.users
  SELECT lower(trim(email)), phone INTO user_email, user_phone FROM auth.users WHERE id = uid;
  IF user_phone IS NOT NULL THEN
    user_phone_digits := right(regexp_replace(user_phone, '\D', '', 'g'), 10);
  END IF;

  -- 2. Check email from JWT claim
  BEGIN
    jwt_email := lower(trim(auth.jwt() ->> 'email'));
  EXCEPTION WHEN OTHERS THEN
    jwt_email := NULL;
  END;

  -- 3. Check email & phone from profiles table
  SELECT lower(trim(email)), phone INTO profile_email, profile_phone FROM public.profiles WHERE id = uid;
  IF profile_phone IS NOT NULL THEN
    profile_phone_digits := right(regexp_replace(profile_phone, '\D', '', 'g'), 10);
  END IF;

  -- Check if any of these emails or phone numbers match the admin_allowlist
  IF (user_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = user_email))
     OR (jwt_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = jwt_email))
     OR (profile_email IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = profile_email))
     OR (user_phone_digits <> '' AND EXISTS (
          SELECT 1 FROM public.admin_allowlist 
          WHERE right(regexp_replace(email, '\D', '', 'g'), 10) = user_phone_digits
        ))
     OR (profile_phone_digits <> '' AND EXISTS (
          SELECT 1 FROM public.admin_allowlist 
          WHERE right(regexp_replace(email, '\D', '', 'g'), 10) = profile_phone_digits
        ))
  THEN
    INSERT INTO public.user_roles (user_id, role) 
    VALUES (uid, 'admin') 
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.profiles SET is_admin = true WHERE id = uid;
    RETURN true;
  END IF;

  RETURN false;
END; 
$$;

-- 8. Enhance is_admin() to support phone number allowlist matches
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
      JOIN public.admin_allowlist a ON (
        (u.email IS NOT NULL AND lower(trim(u.email)) = lower(trim(a.email)))
        OR (
          u.phone IS NOT NULL AND length(regexp_replace(a.email, '\D', '', 'g')) >= 10
          AND right(regexp_replace(u.phone, '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
        )
      )
      WHERE u.id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.admin_allowlist a ON (
        (p.email IS NOT NULL AND lower(trim(p.email)) = lower(trim(a.email)))
        OR (
          p.phone IS NOT NULL AND length(regexp_replace(a.email, '\D', '', 'g')) >= 10
          AND right(regexp_replace(p.phone, '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
        )
      )
      WHERE p.id = auth.uid()
    )
  );
$$;

-- 9. Enhance is_staff_or_admin() to support phone number allowlist matches
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
      JOIN public.admin_allowlist a ON (
        (u.email IS NOT NULL AND lower(trim(u.email)) = lower(trim(a.email)))
        OR (
          u.phone IS NOT NULL AND length(regexp_replace(a.email, '\D', '', 'g')) >= 10
          AND right(regexp_replace(u.phone, '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
        )
      )
      WHERE u.id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.admin_allowlist a ON (
        (p.email IS NOT NULL AND lower(trim(p.email)) = lower(trim(a.email)))
        OR (
          p.phone IS NOT NULL AND length(regexp_replace(a.email, '\D', '', 'g')) >= 10
          AND right(regexp_replace(p.phone, '\D', '', 'g'), 10) = right(regexp_replace(a.email, '\D', '', 'g'), 10)
        )
      )
      WHERE p.id = auth.uid()
    )
  );
$$;

-- Permissions grant
GRANT EXECUTE ON FUNCTION public.list_user_device_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_device_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_admin_by_email TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin_by_email TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admins TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_admin_from_allowlist TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin TO authenticated, anon, service_role;
