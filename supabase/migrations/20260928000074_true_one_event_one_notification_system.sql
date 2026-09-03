-- Migration: 20260928000074_true_one_event_one_notification_system.sql
-- True One-Event-One-Notification System for Zérah Admin:
-- 1. Dedicated public.admin_notifications table with deterministic event_key
-- 2. Strict UNIQUE(event_key) constraint to eliminate duplicate business events at database level
-- 3. Idempotent triggers for POS sales, returns, online orders, status transitions, contact queries, and low stock
-- 4. Server-persisted is_read and is_dismissed states (replaces fragmented localStorage)
-- 5. Full Realtime broadcast on admin_notifications table

-- 1. Create table public.admin_notifications
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  tab text NOT NULL DEFAULT 'dashboard',
  filter text DEFAULT 'all',
  priority text NOT NULL DEFAULT 'normal',
  entity_id text,
  entity_type text,
  is_read boolean NOT NULL DEFAULT false,
  is_dismissed boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  dismissed_at timestamptz
);

-- 2. Strict Unique Index on event_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_notifications_event_key 
ON public.admin_notifications (event_key);

-- 3. Performance Indexes for Querying Active & Unread Notifications
CREATE INDEX IF NOT EXISTS idx_admin_notifications_active_feed 
ON public.admin_notifications (is_dismissed, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_entity 
ON public.admin_notifications (entity_type, entity_id);

-- 4. Helper Function: Idempotent Notification Inserter
CREATE OR REPLACE FUNCTION public.create_admin_notification(
  _event_key text,
  _type text,
  _title text,
  _message text,
  _tab text DEFAULT 'dashboard',
  _filter text DEFAULT 'all',
  _priority text DEFAULT 'normal',
  _entity_id text DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.admin_notifications (
    event_key,
    type,
    title,
    message,
    tab,
    filter,
    priority,
    entity_id,
    entity_type,
    metadata,
    created_at
  ) VALUES (
    trim(_event_key),
    trim(_type),
    trim(_title),
    trim(_message),
    trim(_tab),
    trim(_filter),
    trim(_priority),
    _entity_id,
    _entity_type,
    COALESCE(_metadata, '{}'::jsonb),
    now()
  )
  ON CONFLICT (event_key) DO UPDATE
  SET title = EXCLUDED.title,
      message = EXCLUDED.message,
      metadata = EXCLUDED.metadata
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5. Trigger Functions for Business Events

-- A. POS Offline Sale Trigger
CREATE OR REPLACE FUNCTION public.trig_fn_notify_offline_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_str text := '';
BEGIN
  IF NEW.status = 'completed' OR NEW.status IS NULL THEN
    IF NEW.pos_token_number IS NOT NULL THEN
      v_token_str := ' (Token #' || NEW.pos_token_number || ')';
    END IF;

    PERFORM public.create_admin_notification(
      'POS_SALE:' || NEW.id::text,
      'pos_sale',
      'POS Offline Sale #' || NEW.sale_number || v_token_str,
      COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Walk-in Customer') || ' • ₹' || to_char(NEW.total, 'FM999,999,999') || ' via ' || UPPER(COALESCE(NEW.payment_method, 'CASH')),
      'billing',
      'sales',
      'high',
      NEW.id::text,
      'offline_sale',
      jsonb_build_object('sale_number', NEW.sale_number, 'total', NEW.total, 'payment_method', NEW.payment_method)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_offline_sale ON public.offline_sales;
CREATE TRIGGER trig_notify_offline_sale
AFTER INSERT ON public.offline_sales
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_offline_sale();

-- B. POS Offline Return Trigger
CREATE OR REPLACE FUNCTION public.trig_fn_notify_offline_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' OR NEW.status IS NULL THEN
    PERFORM public.create_admin_notification(
      'POS_RETURN:' || NEW.id::text,
      'pos_return',
      'POS Return #' || NEW.return_number || COALESCE(' [Token: ' || NEW.credit_token || ']', ''),
      COALESCE(NULLIF(trim(NEW.customer_name), ''), 'Walk-in Customer') || ' • Credit ₹' || to_char(NEW.refund_amount, 'FM999,999,999') || ' (' || COALESCE(NEW.return_reason, 'customer_request') || ')',
      'billing',
      'returns',
      'normal',
      NEW.id::text,
      'offline_return',
      jsonb_build_object('return_number', NEW.return_number, 'refund_amount', NEW.refund_amount, 'credit_token', NEW.credit_token)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_offline_return ON public.offline_returns;
CREATE TRIGGER trig_notify_offline_return
AFTER INSERT ON public.offline_returns
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_offline_return();

-- C. Online Orders Trigger (New Order, Cancellation, Failed Payment)
CREATE OR REPLACE FUNCTION public.trig_fn_notify_online_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_short_id text := upper(substr(NEW.id::text, 1, 8));
BEGIN
  -- New Placed/Processing Order
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status AND NEW.status IN ('placed', 'processing')) THEN
    IF NEW.status IN ('placed', 'processing') THEN
      PERFORM public.create_admin_notification(
        'ONLINE_ORDER:' || NEW.id::text || ':CREATED',
        'order_new',
        'New Online Order #' || v_short_id,
        COALESCE(NEW.full_name, 'Customer') || ' placed an order (₹' || to_char(NEW.total, 'FM999,999,999') || ')',
        'orders',
        NEW.status,
        'high',
        NEW.id::text,
        'order',
        jsonb_build_object('order_id', NEW.id, 'total', NEW.total, 'status', NEW.status)
      );
    END IF;
  END IF;

  -- Order Cancelled
  IF (TG_OP = 'INSERT' AND NEW.status = 'cancelled') OR (TG_OP = 'UPDATE' AND OLD.status != 'cancelled' AND NEW.status = 'cancelled') THEN
    PERFORM public.create_admin_notification(
      'ONLINE_ORDER:' || NEW.id::text || ':CANCELLED',
      'order_cancelled',
      'Order Cancelled #' || v_short_id,
      COALESCE(NEW.full_name, 'Customer') || ': ' || COALESCE(NEW.cancellation_reason, 'No reason given'),
      'orders',
      'cancelled',
      'normal',
      NEW.id::text,
      'order',
      jsonb_build_object('order_id', NEW.id, 'cancellation_reason', NEW.cancellation_reason)
    );
  END IF;

  -- Payment Failed
  IF NEW.payment_status = 'failed' AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.payment_status IS DISTINCT FROM 'failed')) THEN
    PERFORM public.create_admin_notification(
      'ONLINE_ORDER:' || NEW.id::text || ':PAYMENT_FAILED',
      'order_failed',
      'Payment Failed #' || v_short_id,
      'Payment attempt failed for ' || COALESCE(NEW.full_name, 'customer'),
      'orders',
      'all',
      'high',
      NEW.id::text,
      'order',
      jsonb_build_object('order_id', NEW.id, 'payment_status', NEW.payment_status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_online_order ON public.orders;
CREATE TRIGGER trig_notify_online_order
AFTER INSERT OR UPDATE OF status, payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_online_order();

-- D. Online Return Requests Trigger
CREATE OR REPLACE FUNCTION public.trig_fn_notify_online_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.return_status IN ('REQUESTED', 'QC_PENDING', 'RECEIVED') THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.return_status IS DISTINCT FROM NEW.return_status) THEN
      PERFORM public.create_admin_notification(
        'ONLINE_RETURN:' || NEW.id::text || ':' || NEW.return_status,
        'online_return',
        CASE 
          WHEN NEW.return_status = 'REQUESTED' THEN 'New Return Request #' || NEW.return_number
          ELSE 'Return #' || NEW.return_number || ' Needs Inspection'
        END,
        COALESCE(NEW.reason_label, 'Customer return') || ' · Refund: ₹' || to_char(COALESCE(NEW.final_refund_amount, NEW.estimated_refund_amount, 0), 'FM999,999,999'),
        'returns',
        'all',
        'high',
        NEW.id::text,
        'online_return',
        jsonb_build_object('return_number', NEW.return_number, 'status', NEW.return_status)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_online_return ON public.online_returns;
CREATE TRIGGER trig_notify_online_return
AFTER INSERT OR UPDATE OF return_status ON public.online_returns
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_online_return();

-- E. Customer Inquiries / Contact Messages Trigger
CREATE OR REPLACE FUNCTION public.trig_fn_notify_contact_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'new' OR NEW.status IS NULL THEN
    PERFORM public.create_admin_notification(
      'CONTACT_QUERY:' || NEW.id::text,
      'contact_message',
      'Inquiry: ' || COALESCE(NEW.name, 'Customer'),
      CASE 
        WHEN NEW.order_number IS NOT NULL AND trim(NEW.order_number) != '' THEN
          '[Order #' || NEW.order_number || '] ' || substr(COALESCE(NEW.message, ''), 1, 120)
        ELSE
          substr(COALESCE(NEW.message, ''), 1, 140)
      END,
      'queries',
      'all',
      CASE WHEN NEW.priority IN ('urgent', 'high') THEN 'high' ELSE 'normal' END,
      NEW.id::text,
      'contact_message',
      jsonb_build_object('email', NEW.email, 'order_number', NEW.order_number)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_contact_message ON public.contact_messages;
CREATE TRIGGER trig_notify_contact_message
AFTER INSERT ON public.contact_messages
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_contact_message();

-- F. Low Stock Trigger (When stock transitions to <= 5)
CREATE OR REPLACE FUNCTION public.trig_fn_notify_low_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stock <= 5 AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.stock > 5)) THEN
    PERFORM public.create_admin_notification(
      'INVENTORY_LOW:' || NEW.id::text,
      'inventory_low',
      'Low Stock Alert',
      '"' || NEW.name || '" has only ' || NEW.stock || ' unit' || (CASE WHEN NEW.stock = 1 THEN '' ELSE 's' END) || ' left in stock.',
      'products',
      'all',
      CASE WHEN NEW.stock = 0 THEN 'high' ELSE 'normal' END,
      NEW.id::text,
      'product',
      jsonb_build_object('product_name', NEW.name, 'stock', NEW.stock, 'sku', NEW.sku)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_notify_low_stock ON public.products;
CREATE TRIGGER trig_notify_low_stock
AFTER INSERT OR UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_low_stock();

-- 6. Backfill Historical Notifications (Last 30 Days) Idempotently
INSERT INTO public.admin_notifications (
  event_key, type, title, message, tab, filter, priority, entity_id, entity_type, is_read, is_dismissed, created_at
)
SELECT 
  'POS_SALE:' || id::text,
  'pos_sale',
  'POS Offline Sale #' || sale_number || COALESCE(' (Token #' || pos_token_number || ')', ''),
  COALESCE(NULLIF(trim(customer_name), ''), 'Walk-in Customer') || ' • ₹' || to_char(total, 'FM999,999,999') || ' via ' || UPPER(COALESCE(payment_method, 'CASH')),
  'billing',
  'sales',
  'high',
  id::text,
  'offline_sale',
  false,
  false,
  created_at
FROM public.offline_sales
WHERE created_at >= (now() - interval '30 days') AND (status != 'cancelled' OR status IS NULL)
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.admin_notifications (
  event_key, type, title, message, tab, filter, priority, entity_id, entity_type, is_read, is_dismissed, created_at
)
SELECT 
  'POS_RETURN:' || id::text,
  'pos_return',
  'POS Return #' || return_number || COALESCE(' [Token: ' || credit_token || ']', ''),
  COALESCE(NULLIF(trim(customer_name), ''), 'Walk-in Customer') || ' • Credit ₹' || to_char(refund_amount, 'FM999,999,999') || ' (' || COALESCE(return_reason, 'customer_request') || ')',
  'billing',
  'returns',
  'normal',
  id::text,
  'offline_return',
  false,
  false,
  created_at
FROM public.offline_returns
WHERE created_at >= (now() - interval '30 days') AND (status != 'cancelled' OR status IS NULL)
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.admin_notifications (
  event_key, type, title, message, tab, filter, priority, entity_id, entity_type, is_read, is_dismissed, created_at
)
SELECT 
  'ONLINE_ORDER:' || id::text || ':CREATED',
  'order_new',
  'New Online Order #' || upper(substr(id::text, 1, 8)),
  COALESCE(full_name, 'Customer') || ' placed an order (₹' || to_char(total, 'FM999,999,999') || ')',
  'orders',
  status,
  'high',
  id::text,
  'order',
  false,
  false,
  created_at
FROM public.orders
WHERE created_at >= (now() - interval '30 days') AND status IN ('placed', 'processing')
ON CONFLICT (event_key) DO NOTHING;

-- 7. Enable RLS
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view notifications" ON public.admin_notifications;
CREATE POLICY "Admins can view notifications"
ON public.admin_notifications
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can update notifications" ON public.admin_notifications;
CREATE POLICY "Admins can update notifications"
ON public.admin_notifications
FOR UPDATE
USING (true);

DROP POLICY IF EXISTS "Admins can insert notifications" ON public.admin_notifications;
CREATE POLICY "Admins can insert notifications"
ON public.admin_notifications
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can delete notifications" ON public.admin_notifications;
CREATE POLICY "Admins can delete notifications"
ON public.admin_notifications
FOR DELETE
USING (true);

-- 8. Add to Realtime Publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'admin_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
