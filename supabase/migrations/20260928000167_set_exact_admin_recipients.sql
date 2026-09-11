-- =====================================================================
-- Migration: 20260928000167_set_exact_admin_recipients.sql
-- Description: Set canonical admin notification email (hello@zerahkids.com)
--              and admin notification phone numbers (9667571712, 9057074777).
-- =====================================================================

INSERT INTO public.site_settings (key, value)
VALUES
  ('owner_notification_email', 'hello@zerahkids.com'),
  ('owner_notification_phone', '9667571712, 9057074777'),
  ('contact_email', 'hello@zerahkids.com'),
  ('contact_phone', '9667571712, 9057074777')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

NOTIFY pgrst, 'reload schema';
