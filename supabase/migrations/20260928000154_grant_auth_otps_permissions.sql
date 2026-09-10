-- Migration: 20260928000154_grant_auth_otps_permissions.sql
-- Description: Grant table permissions on auth_otps to service_role and postgres, reload schema cache

GRANT ALL ON TABLE public.auth_otps TO postgres;
GRANT ALL ON TABLE public.auth_otps TO service_role;

-- Revoke public access so only backend Edge Functions with service_role can access OTP hashes
REVOKE ALL ON TABLE public.auth_otps FROM anon;
REVOKE ALL ON TABLE public.auth_otps FROM authenticated;

NOTIFY pgrst, 'reload schema';
