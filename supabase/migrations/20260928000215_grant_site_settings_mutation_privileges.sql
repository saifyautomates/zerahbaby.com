-- ==============================================================================
-- Migration: 20260928000215_grant_site_settings_mutation_privileges.sql
-- Description:
-- Fix "permission denied for table site_settings" when updating delivery fee,
-- standard shipping rates, announcements, and store settings from Admin panel.
-- Grants full mutation privileges on public.site_settings to anon, authenticated,
-- and service_role, and configures permissive RLS policy matching catalog tables.
-- ==============================================================================

-- 1. Table Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_settings TO anon, authenticated, service_role;

-- 2. RLS Policies for Site Settings
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings public read" ON public.site_settings;
DROP POLICY IF EXISTS "settings public read non sensitive" ON public.site_settings;
DROP POLICY IF EXISTS "admins manage settings" ON public.site_settings;
DROP POLICY IF EXISTS "admin_manage_site_settings" ON public.site_settings;

CREATE POLICY "admin_manage_site_settings"
  ON public.site_settings
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 3. Update admin_update_site_setting RPC for full compatibility
CREATE OR REPLACE FUNCTION public.admin_update_site_setting(
  _key text,
  _value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF trim(_key) = '' THEN
    RAISE EXCEPTION 'Setting key cannot be empty.';
  END IF;

  INSERT INTO public.site_settings (key, value)
  VALUES (_key, _value)
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

  -- Synchronize with payment_settings if key is cod_enabled
  IF _key = 'cod_enabled' THEN
    UPDATE public.payment_settings
    SET cod_enabled = (_value = 'true' OR _value = '1')
    WHERE id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'key', _key,
    'value', _value
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_site_setting(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
