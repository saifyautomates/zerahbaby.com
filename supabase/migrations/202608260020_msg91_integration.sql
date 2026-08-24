-- ============================================================
-- ZERAH BABY — MSG91 INTEGRATION (TRANSACTIONAL SMS)
-- ============================================================

-- Ensure pg_net is enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  phone text NOT NULL,
  message_type text NOT NULL, -- e.g., 'order_placed', 'order_shipped'
  provider_status text,
  error_details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Admins can view sms logs
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage sms_logs" ON public.sms_logs;
CREATE POLICY "admins manage sms_logs" 
ON public.sms_logs 
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) 
WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT ALL ON public.sms_logs TO service_role;

-- Function to trigger transactional SMS via Edge Function
CREATE OR REPLACE FUNCTION public.trigger_transactional_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_function_url text;
  supabase_anon_key text;
  req_body jsonb;
  event_type text;
BEGIN
  -- We fetch the base URL from settings or default to the production URL.
  -- In a real setup, these should be in a vault or settings table, but for now we hardcode the host.
  edge_function_url := 'https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/msg91-transactional';
  
  -- Determine event type
  IF TG_OP = 'INSERT' THEN
    event_type := 'order_placed';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'shipped' THEN
      event_type := 'order_shipped';
    ELSIF NEW.status = 'delivered' THEN
      event_type := 'order_delivered';
    ELSIF NEW.status = 'cancelled' THEN
      event_type := 'order_cancelled';
    ELSE
      -- We don't trigger SMS for other status changes yet
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Build the JSON payload
  req_body := jsonb_build_object(
    'order_id', NEW.id,
    'event_type', event_type,
    'phone', NEW.phone,
    'name', NEW.full_name
  );

  -- Dispatch HTTP POST request asynchronously.
  -- We don't block the transaction. The Edge Function will handle the MSG91 API call and log success/failure.
  PERFORM net.http_post(
    url := edge_function_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := req_body
  );

  RETURN NEW;
END;
$$;

-- Create the trigger on the orders table
DROP TRIGGER IF EXISTS order_transactional_sms_trigger ON public.orders;
CREATE TRIGGER order_transactional_sms_trigger
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_transactional_sms();
