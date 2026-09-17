-- ============================================================
-- ZÉRAH BABY & KIDS — MANDATORY SALE NOTIFICATIONS SYSTEM
-- Migration: 20260928000263_mandatory_sale_notifications_system.sql
-- ============================================================

-- 1. Ensure offline_sales has customer notification status tracking columns
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS customer_notification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_offline_sales_customer_notification
  ON public.offline_sales (customer_notification_status);

-- 2. Create canonical sale_notification_events ledger table
CREATE TABLE IF NOT EXISTS public.sale_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_type text NOT NULL CHECK (sale_type IN ('online', 'offline')),
  sale_id text NOT NULL,
  sale_number text,
  customer_name text,
  customer_phone text,
  customer_email text,
  total_amount numeric NOT NULL DEFAULT 0,
  payment_method text,
  source text NOT NULL DEFAULT 'online',
  
  -- 4 Mandatory Notification Channels with independent delivery state
  customer_sms_status text NOT NULL DEFAULT 'PENDING'
    CHECK (customer_sms_status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'RETRYING')),
  customer_sms_error text,
  customer_sms_id text,

  admin_sms_status text NOT NULL DEFAULT 'PENDING'
    CHECK (admin_sms_status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'RETRYING')),
  admin_sms_error text,
  admin_sms_id text,

  admin_email_status text NOT NULL DEFAULT 'PENDING'
    CHECK (admin_email_status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'RETRYING')),
  admin_email_error text,
  admin_email_id text,

  customer_email_status text NOT NULL DEFAULT 'PENDING'
    CHECK (customer_email_status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'RETRYING')),
  customer_email_error text,
  customer_email_id text,

  -- Idempotency key guarantee (1 sale = 1 logical notification event)
  idempotency_key text UNIQUE NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance and lookup
CREATE INDEX IF NOT EXISTS idx_sale_notification_events_sale
  ON public.sale_notification_events (sale_type, sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_notification_events_created
  ON public.sale_notification_events (created_at DESC);

-- Enable RLS
ALTER TABLE public.sale_notification_events ENABLE ROW LEVEL SECURITY;

-- Admins and staff can view and manage notification events
DROP POLICY IF EXISTS "Admins can view and manage sale notification events" ON public.sale_notification_events;
CREATE POLICY "Admins can view and manage sale notification events"
  ON public.sale_notification_events
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'owner') OR
    public.has_role(auth.uid(), 'staff') OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'owner') OR
    public.has_role(auth.uid(), 'staff') OR
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Service role full access
GRANT ALL ON public.sale_notification_events TO service_role;
GRANT SELECT ON public.sale_notification_events TO authenticated;

-- 3. Canonical RPC to fetch or inspect sale notification events
CREATE OR REPLACE FUNCTION public.get_sale_notification_status(
  _sale_type text,
  _sale_id text
)
RETURNS TABLE (
  id uuid,
  sale_type text,
  sale_id text,
  sale_number text,
  customer_name text,
  customer_phone text,
  customer_email text,
  total_amount numeric,
  payment_method text,
  source text,
  customer_sms_status text,
  customer_sms_error text,
  admin_sms_status text,
  admin_sms_error text,
  admin_email_status text,
  admin_email_error text,
  customer_email_status text,
  customer_email_error text,
  idempotency_key text,
  attempts int,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.sale_type,
    e.sale_id,
    e.sale_number,
    e.customer_name,
    e.customer_phone,
    e.customer_email,
    e.total_amount,
    e.payment_method,
    e.source,
    e.customer_sms_status,
    e.customer_sms_error,
    e.admin_sms_status,
    e.admin_sms_error,
    e.admin_email_status,
    e.admin_email_error,
    e.customer_email_status,
    e.customer_email_error,
    e.idempotency_key,
    e.attempts,
    e.last_attempt_at,
    e.completed_at,
    e.created_at
  FROM public.sale_notification_events e
  WHERE e.sale_type = _sale_type AND e.sale_id = _sale_id
  ORDER BY e.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_notification_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sale_notification_status(text, text) TO service_role;
