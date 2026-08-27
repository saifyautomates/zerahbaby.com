-- ============================================================
-- ZÉRAH BABY & KIDS — COMPLETE PRODUCTION SALES SMS SYSTEM
-- Migration: 202609110001_complete_sales_sms_system.sql
-- ============================================================

-- 1. Ensure table public.sms_logs exists and has all required columns
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  offline_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL,
  phone text NOT NULL,
  message_type text NOT NULL,
  recipient_type text NOT NULL DEFAULT 'customer',
  status text NOT NULL DEFAULT 'SENT',
  provider_status text,
  error_details text,
  idempotency_key text,
  message_content text,
  template_id text,
  provider_message_id text,
  retry_count int NOT NULL DEFAULT 0,
  last_retried_at timestamptz,
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add any missing columns in case sms_logs existed from prior migrations
ALTER TABLE public.sms_logs
  ADD COLUMN IF NOT EXISTS offline_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_type text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS message_content text,
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retried_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz DEFAULT now();

-- 2. Idempotency Unique Index to prevent duplicate SMS for the same event and recipient
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_logs_idempotency_key 
  ON public.sms_logs(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON public.sms_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON public.sms_logs(phone);
CREATE INDEX IF NOT EXISTS idx_sms_logs_order_id ON public.sms_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_offline_sale_id ON public.sms_logs(offline_sale_id);

-- 3. CRITICAL TABLE PERMISSION FIX:
-- Grant table privileges to authenticated users so admin queries do NOT fail with 42501 permission denied
GRANT SELECT, INSERT, UPDATE ON public.sms_logs TO authenticated;
GRANT ALL ON public.sms_logs TO service_role;

-- 4. Row Level Security for sms_logs:
-- Only authenticated users with admin role can access and manage SMS logs
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage sms_logs" ON public.sms_logs;
CREATE POLICY "admins manage sms_logs" 
ON public.sms_logs 
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) 
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Seed default SMS notification configuration in site_settings
INSERT INTO public.site_settings (key, value)
VALUES
  ('owner_notification_phone', '9057074777'),
  ('owner_notify_sms', 'true'),
  ('customer_notify_sms', 'true')
ON CONFLICT (key) DO NOTHING;

-- 6. Trigger transactional SMS function (dual layer fallback)
CREATE OR REPLACE FUNCTION public.trigger_transactional_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url text;
  req_body jsonb;
  event_type text;
BEGIN
  edge_function_url := 'https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/msg91-transactional';
  
  -- Determine applicable business event
  IF TG_OP = 'INSERT' THEN
    -- Only trigger for COD orders on insert; online orders trigger upon payment verification
    IF NEW.payment_method = 'cod' THEN
      event_type := 'online_sale';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.payment_status IS DISTINCT FROM OLD.payment_status) THEN
    IF (NEW.payment_status = 'paid' OR NEW.status IN ('processing', 'confirmed')) AND (OLD.payment_status IS DISTINCT FROM 'paid' AND OLD.status NOT IN ('processing', 'confirmed')) THEN
      event_type := 'online_sale';
    ELSIF NEW.status = 'shipped' THEN
      event_type := 'order_shipped';
    ELSIF NEW.status = 'delivered' THEN
      event_type := 'order_delivered';
    ELSIF NEW.status = 'cancelled' THEN
      event_type := 'order_cancelled';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Only proceed if customer has a valid phone number
  IF NEW.phone IS NULL OR trim(NEW.phone) = '' THEN
    RETURN NEW;
  END IF;

  req_body := jsonb_build_object(
    'order_id', NEW.id,
    'event_type', event_type,
    'phone', NEW.phone,
    'name', COALESCE(NULLIF(trim(NEW.full_name), ''), 'Customer'),
    'total', NEW.total,
    'payment_method', NEW.payment_method,
    'idempotency_key', 'ord_' || NEW.id::text || '_' || event_type || '_' || NEW.phone || '_cust'
  );

  -- Safe HTTP POST via pg_net (ignoring failures so business transaction is NEVER rolled back)
  BEGIN
    PERFORM net.http_post(
      url := edge_function_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := req_body
    );
  EXCEPTION WHEN OTHERS THEN
    -- Silent catch: SMS failure must NEVER corrupt core transaction
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_transactional_sms_trigger ON public.orders;
CREATE TRIGGER order_transactional_sms_trigger
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_transactional_sms();

-- 7. Trigger offline POS transactional SMS function
CREATE OR REPLACE FUNCTION public.trigger_offline_transactional_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url text;
  req_body jsonb;
BEGIN
  edge_function_url := 'https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/msg91-transactional';
  
  IF NEW.customer_phone IS NULL OR trim(NEW.customer_phone) = '' THEN
    RETURN NEW;
  END IF;

  req_body := jsonb_build_object(
    'offline_sale_id', NEW.id,
    'event_type', 'offline_pos_sale',
    'phone', NEW.customer_phone,
    'name', COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Customer'),
    'total', NEW.total,
    'payment_method', NEW.payment_method,
    'sale_number', NEW.sale_number,
    'idempotency_key', 'off_' || NEW.id::text || '_offline_pos_sale_' || NEW.customer_phone || '_cust'
  );

  BEGIN
    PERFORM net.http_post(
      url := edge_function_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := req_body
    );
  EXCEPTION WHEN OTHERS THEN
    -- Silent catch
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offline_sale_transactional_sms_trigger ON public.offline_sales;
CREATE TRIGGER offline_sale_transactional_sms_trigger
  AFTER INSERT ON public.offline_sales
  FOR EACH ROW
  WHEN (NEW.customer_phone IS NOT NULL AND trim(NEW.customer_phone) != '')
  EXECUTE FUNCTION public.trigger_offline_transactional_sms();
