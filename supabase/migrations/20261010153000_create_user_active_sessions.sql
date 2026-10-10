-- Migration: 20261010153000_create_user_active_sessions.sql
-- Description: Track logged-in devices and geographical locations for customers and admins,
--              with remote device revocation and instant sign-out.

-- 1. Create public.user_active_sessions table
CREATE TABLE IF NOT EXISTS public.user_active_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  user_phone text,
  user_role text DEFAULT 'customer',
  device_id text NOT NULL,
  device_name text NOT NULL,
  device_type text DEFAULT 'mobile',
  browser text,
  os text,
  ip_address text,
  city text,
  region text,
  country text DEFAULT 'India',
  auth_session_id text,
  is_revoked boolean DEFAULT false,
  revoked_at timestamptz,
  revoked_by uuid,
  last_active_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint so each user has at most one record per physical device_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_active_sessions_user_device 
  ON public.user_active_sessions (user_id, device_id);

CREATE INDEX IF NOT EXISTS idx_user_active_sessions_user_id 
  ON public.user_active_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_active_sessions_device_id 
  ON public.user_active_sessions (device_id);

CREATE INDEX IF NOT EXISTS idx_user_active_sessions_role 
  ON public.user_active_sessions (user_role);

-- 2. Enable Row Level Security
ALTER TABLE public.user_active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_active_sessions FORCE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS "Users and admins can view active sessions" ON public.user_active_sessions;
CREATE POLICY "Users and admins can view active sessions"
  ON public.user_active_sessions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id 
    OR public.is_admin() 
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Users can upsert own active sessions" ON public.user_active_sessions;
CREATE POLICY "Users can upsert own active sessions"
  ON public.user_active_sessions
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id 
    OR public.is_admin() 
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    auth.uid() = user_id 
    OR public.is_admin() 
    OR public.has_role(auth.uid(), 'admin')
  );

-- 4. RPC: register_device_session
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
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_role text := 'customer';
  v_session_id uuid;
  v_is_revoked boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Determine user email, phone, and role
  SELECT email, phone INTO v_email, v_phone FROM auth.users WHERE id = v_uid;
  
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

-- 5. RPC: check_device_session_status
CREATE OR REPLACE FUNCTION public.check_device_session_status(_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('is_authenticated', false, 'is_revoked', true);
  END IF;

  SELECT id, is_revoked, last_active_at INTO v_row
  FROM public.user_active_sessions
  WHERE user_id = v_uid AND device_id = _device_id;

  IF NOT FOUND THEN
    -- If no session record exists, session is considered fresh
    RETURN jsonb_build_object('is_authenticated', true, 'is_revoked', false, 'exists', false);
  END IF;

  -- Heartbeat: update last_active_at if not revoked
  IF NOT v_row.is_revoked THEN
    UPDATE public.user_active_sessions
    SET last_active_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'is_authenticated', true,
    'is_revoked', v_row.is_revoked,
    'session_id', v_row.id
  );
END;
$$;

-- 6. RPC: list_user_device_sessions
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
SET search_path = public, auth
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
    s.user_phone,
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
  WHERE 
    (_target_role IS NULL OR s.user_role = _target_role)
    AND (_target_user_id IS NULL OR s.user_id = _target_user_id)
  ORDER BY s.last_active_at DESC;
END;
$$;

-- 7. RPC: revoke_device_session
CREATE OR REPLACE FUNCTION public.revoke_device_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_target_user_id uuid;
  v_target_device_id text;
  v_auth_session_id text;
BEGIN
  IF NOT (public.is_admin() OR public.has_role(v_caller, 'admin')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrator privileges required.');
  END IF;

  SELECT user_id, device_id, auth_session_id 
  INTO v_target_user_id, v_target_device_id, v_auth_session_id
  FROM public.user_active_sessions
  WHERE id = _session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found.');
  END IF;

  -- Mark session as revoked
  UPDATE public.user_active_sessions
  SET 
    is_revoked = true,
    revoked_at = now(),
    revoked_by = v_caller,
    updated_at = now()
  WHERE id = _session_id;

  -- Invalidate matching auth.sessions record in Supabase auth schema if present
  IF v_auth_session_id IS NOT NULL AND v_auth_session_id ~* '^[0-9a-f\-]{36}$' THEN
    BEGIN
      DELETE FROM auth.sessions WHERE id = v_auth_session_id::uuid;
    EXCEPTION WHEN OTHERS THEN
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', _session_id,
    'user_id', v_target_user_id,
    'device_id', v_target_device_id
  );
END;
$$;

-- 8. RPC: revoke_all_user_device_sessions
CREATE OR REPLACE FUNCTION public.revoke_all_user_device_sessions(_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NOT (public.is_admin() OR public.has_role(v_caller, 'admin')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrator privileges required.');
  END IF;

  -- Mark all sessions for target user as revoked
  UPDATE public.user_active_sessions
  SET 
    is_revoked = true,
    revoked_at = now(),
    revoked_by = v_caller,
    updated_at = now()
  WHERE user_id = _target_user_id;

  -- Invalidate all auth.sessions for target user in auth schema
  BEGIN
    DELETE FROM auth.sessions WHERE user_id = _target_user_id;
  EXCEPTION WHEN OTHERS THEN
  END;

  RETURN jsonb_build_object('success', true, 'user_id', _target_user_id);
END;
$$;

-- 9. Grant privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_active_sessions TO authenticated;
GRANT ALL ON public.user_active_sessions TO service_role;
GRANT EXECUTE ON FUNCTION public.register_device_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_device_session_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_device_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_device_session TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_user_device_sessions TO authenticated;

-- 10. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
