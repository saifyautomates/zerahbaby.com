-- Migration: 20260928000211_targeted_auth_user_phone_lookup.sql
-- Description: Provide index on profiles(phone) and bounded targeted RPC to look up auth.users by phone for auth fallback without unbounded scans

CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);

CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_phone(p_phone text)
RETURNS TABLE (id uuid, phone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
DECLARE
  v_digits text;
  v_ten text;
BEGIN
  IF p_phone IS NULL OR trim(p_phone) = '' THEN
    RETURN;
  END IF;

  v_digits := regexp_replace(p_phone, '\D', '', 'g');
  IF length(v_digits) < 10 THEN
    RETURN;
  END IF;

  v_ten := right(v_digits, 10);

  RETURN QUERY
  SELECT u.id, u.phone
  FROM auth.users u
  WHERE u.phone = p_phone
     OR u.phone = '+' || p_phone
     OR u.phone = '+91' || v_ten
     OR u.phone = '91' || v_ten
     OR right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 10) = v_ten
  ORDER BY u.created_at DESC
  LIMIT 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_phone(text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_id_by_phone(text) FROM anon, authenticated;
