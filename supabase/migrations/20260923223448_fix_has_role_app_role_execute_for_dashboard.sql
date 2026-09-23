-- Fix dashboard/admin RLS failures caused by the overloaded has_role(uuid, app_role)
-- function lacking EXECUTE for authenticated users.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
