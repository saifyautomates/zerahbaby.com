-- Lock down execute privileges on privileged SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.ensure_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_admin_from_allowlist() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_admin_by_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_admin_by_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_admin() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_admin_from_allowlist() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_admin_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin_by_email(text) TO authenticated;