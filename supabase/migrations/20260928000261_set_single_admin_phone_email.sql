-- =====================================================================
-- Migration: 20260928000261_set_single_admin_phone_email.sql
-- Description: Set strict single admin recipient phone (9057074777)
--              and admin email (hello@zerahkids.com) for all store notifications.
-- =====================================================================

INSERT INTO public.site_settings (key, value)
VALUES
  ('owner_notification_phone', '9057074777'),
  ('contact_phone', '9057074777'),
  ('owner_notification_email', 'hello@zerahkids.com'),
  ('contact_email', 'hello@zerahkids.com'),
  ('owner_notify_online_sales', 'true'),
  ('owner_notify_offline_sales', 'true')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
