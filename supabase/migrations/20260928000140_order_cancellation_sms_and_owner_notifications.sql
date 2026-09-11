-- =============================================================================
-- Migration: 20260928000140_order_cancellation_sms_and_owner_notifications.sql
-- Description:
-- 1. Ensure trigger_transactional_sms passes notify_owner: true on order cancellation
--    and order creation so store owner/admin receives SMS alerts.
-- 2. Preserve customer full_name cleanly in transactional payloads.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_transactional_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
    'notify_owner', true,
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
