REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_admin_from_allowlist() FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_admins() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;