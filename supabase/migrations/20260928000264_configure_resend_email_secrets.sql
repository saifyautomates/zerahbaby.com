-- =====================================================================
-- Migration: 20260928000264_configure_resend_email_secrets.sql
-- Description: Configure sender email and admin notification recipients
--              for sales notifications (API key is stored dynamically).
-- =====================================================================

INSERT INTO public.site_settings (key, value)
VALUES
  ('resend_from_email', 'Zérah Baby & Kids <orders@zerahkids.com>'),
  ('owner_notification_email', 'hello@zerahkids.com'),
  ('owner_notification_phone', '9057074777'),
  ('owner_notify_online_sales', 'true'),
  ('owner_notify_offline_sales', 'true')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
