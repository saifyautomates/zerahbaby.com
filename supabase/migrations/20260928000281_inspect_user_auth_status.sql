CREATE OR REPLACE FUNCTION public.inspect_user_auth_status(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_res jsonb;
  v_ten text := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 10);
BEGIN
  SELECT jsonb_build_object(
    'profiles', (
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone))
      FROM public.profiles p
      WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = v_ten
    ),
    'auth_users_by_phone', (
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'phone', u.phone, 'email', u.email, 'phone_confirmed_at', u.phone_confirmed_at, 'has_password', u.encrypted_password IS NOT NULL))
      FROM auth.users u
      WHERE right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) = v_ten
    ),
    'auth_users_by_profile_id', (
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'phone', u.phone, 'email', u.email, 'phone_confirmed_at', u.phone_confirmed_at, 'has_password', u.encrypted_password IS NOT NULL))
      FROM auth.users u
      WHERE u.id IN (
        SELECT p.id FROM public.profiles p WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = v_ten
      )
    ),
    'auth_otps', (
      SELECT jsonb_agg(jsonb_build_object('phone', o.phone, 'attempts', o.attempts, 'expires_at', o.expires_at, 'created_at', o.created_at))
      FROM public.auth_otps o
      WHERE right(regexp_replace(COALESCE(o.phone, ''), '\D', '', 'g'), 10) = v_ten
    )
  ) INTO v_res;
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inspect_user_auth_status(text) TO anon, authenticated, service_role;
