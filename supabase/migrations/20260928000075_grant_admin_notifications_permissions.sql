-- Migration: 20260928000075_grant_admin_notifications_permissions.sql
-- Grant table permissions for admin_notifications

GRANT ALL ON TABLE public.admin_notifications TO authenticated;
GRANT ALL ON TABLE public.admin_notifications TO anon;
GRANT ALL ON TABLE public.admin_notifications TO service_role;

NOTIFY pgrst, 'reload schema';
