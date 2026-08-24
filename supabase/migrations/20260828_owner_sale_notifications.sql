-- ============================================================
-- OWNER SALE NOTIFICATION EMAIL SYSTEM MIGRATION
-- ============================================================

-- 1. Add notification status columns to orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS owner_notification_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;

-- 2. Add notification status columns to offline_sales
ALTER TABLE public.offline_sales
ADD COLUMN IF NOT EXISTS owner_notification_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;

-- 3. Create owner notification event log table
CREATE TABLE IF NOT EXISTS public.owner_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL, -- 'offline_sale' | 'online_order' | 'test'
  reference_id text, -- sale_id or order_id
  reference_number text, -- sale_number or order invoice/number
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  total numeric,
  provider text DEFAULT 'resend',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookup and idempotency checking
CREATE INDEX IF NOT EXISTS idx_owner_notification_logs_ref
ON public.owner_notification_logs (event_type, reference_id);

-- 4. Enable RLS
ALTER TABLE public.owner_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view and manage notification logs"
ON public.owner_notification_logs
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Service role access
GRANT ALL ON public.owner_notification_logs TO service_role;

-- 5. Seed default site settings for notifications
INSERT INTO public.site_settings (key, value)
VALUES
  ('owner_notification_email', 'hello@zerahkids.com'),
  ('owner_notify_offline_sales', 'true'),
  ('owner_notify_online_sales', 'true')
ON CONFLICT (key) DO NOTHING;
