-- ============================================================
-- OFFLINE POS SMS INTEGRATION
-- Migration: 202609060031_offline_sms_integration.sql
-- ============================================================

-- 1. Add offline_sale_id to sms_logs so it can reference offline sales without violating order_id FK
ALTER TABLE public.sms_logs
  ADD COLUMN IF NOT EXISTS offline_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL;

-- 2. Create the trigger function specifically for offline POS sales
CREATE OR REPLACE FUNCTION public.trigger_offline_transactional_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url text;
  req_body jsonb;
BEGIN
  -- We fetch the base URL from settings or default to the production URL.
  edge_function_url := 'https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/msg91-transactional';
  
  -- Build the JSON payload
  req_body := jsonb_build_object(
    'offline_sale_id', NEW.id,
    'event_type', 'order_delivered', -- Using order_delivered template as a proxy for completed offline sale
    'phone', NEW.customer_phone,
    'name', COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Customer')
  );

  -- Dispatch HTTP POST request asynchronously.
  PERFORM net.http_post(
    url := edge_function_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := req_body
  );

  RETURN NEW;
END;
$$;

-- 3. Attach the trigger to offline_sales
DROP TRIGGER IF EXISTS offline_sale_transactional_sms_trigger ON public.offline_sales;
CREATE TRIGGER offline_sale_transactional_sms_trigger
  AFTER INSERT ON public.offline_sales
  FOR EACH ROW
  -- Only send SMS if a phone number was actually provided
  WHEN (NEW.customer_phone IS NOT NULL AND trim(NEW.customer_phone) != '')
  EXECUTE FUNCTION public.trigger_offline_transactional_sms();
