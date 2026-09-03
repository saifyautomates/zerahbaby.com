-- =============================================================================
-- Migration: 20260928000079_fix_notification_trigger_enum_cast.sql
-- 
-- ROOT CAUSE:
--   trig_fn_notify_online_order was passing NEW.status (order_status ENUM)
--   and NEW.payment_status (payment_status ENUM) directly as the _filter TEXT
--   parameter of create_admin_notification. PostgreSQL cannot implicitly cast
--   enums to text in function argument resolution, so it fails to match the
--   signature → "function does not exist" at every online order INSERT.
--
-- PERMANENT FIX:
--   Recreate trig_fn_notify_online_order with explicit ::text casts on all
--   enum-typed columns. Also harden all other notification trigger functions
--   to cast any enum fields to text defensively, so this class of bug never
--   resurfaces even if column types change in future migrations.
-- =============================================================================

-- -----------------------------------------------------------------------
-- C. Online Orders Trigger (Fixed: explicit ::text casts on all enums)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_fn_notify_online_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_short_id text := upper(substr(NEW.id::text, 1, 8));
  v_status   text := NEW.status::text;
BEGIN
  -- New Placed/Processing Order (INSERT only — avoid double-fire on UPDATE that touches
  -- non-status columns by checking the status didn't already exist in the notification table)
  IF TG_OP = 'INSERT' AND v_status IN ('placed', 'processing') THEN
    PERFORM public.create_admin_notification(
      'ONLINE_ORDER:' || NEW.id::text || ':CREATED',
      'order_new',
      'New Online Order #' || v_short_id,
      COALESCE(NEW.full_name, 'Customer') || ' placed an order (₹' || to_char(NEW.total, 'FM999,999,999') || ')',
      'orders',
      v_status,                           -- explicit text — was enum, caused the crash
      'high',
      NEW.id::text,
      'order',
      jsonb_build_object('order_id', NEW.id, 'total', NEW.total, 'status', v_status)
    );
  END IF;

  -- Status transition to placed/processing on UPDATE
  IF TG_OP = 'UPDATE'
     AND OLD.status::text IS DISTINCT FROM v_status
     AND v_status IN ('placed', 'processing') THEN
    PERFORM public.create_admin_notification(
      'ONLINE_ORDER:' || NEW.id::text || ':' || upper(v_status),
      'order_new',
      'Online Order #' || v_short_id || ' — ' || initcap(v_status),
      COALESCE(NEW.full_name, 'Customer') || ' order is now ' || v_status || ' (₹' || to_char(NEW.total, 'FM999,999,999') || ')',
      'orders',
      v_status,
      'normal',
      NEW.id::text,
      'order',
      jsonb_build_object('order_id', NEW.id, 'total', NEW.total, 'status', v_status)
    );
  END IF;

  -- Order Cancelled
  IF (TG_OP = 'INSERT' AND v_status = 'cancelled')
     OR (TG_OP = 'UPDATE' AND OLD.status::text IS DISTINCT FROM 'cancelled' AND v_status = 'cancelled') THEN
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
  IF NEW.payment_status::text = 'failed'
     AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.payment_status::text IS DISTINCT FROM 'failed')) THEN
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
      jsonb_build_object('order_id', NEW.id, 'payment_status', NEW.payment_status::text)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (DROP + CREATE to ensure clean state)
DROP TRIGGER IF EXISTS trig_notify_online_order ON public.orders;
CREATE TRIGGER trig_notify_online_order
AFTER INSERT OR UPDATE OF status, payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.trig_fn_notify_online_order();


-- -----------------------------------------------------------------------
-- A. POS Offline Sale Trigger — defensive hardening (no enum issue, but
--    explicit text comparisons prevent future breakage if type changes)
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_fn_notify_offline_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token_str text := '';
BEGIN
  IF NEW.status::text = 'completed' OR NEW.status IS NULL THEN
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


-- -----------------------------------------------------------------------
-- B. POS Offline Return Trigger — defensive hardening
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_fn_notify_offline_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status::text = 'completed' OR NEW.status IS NULL THEN
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


-- -----------------------------------------------------------------------
-- D. Online Returns Trigger — defensive hardening
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_fn_notify_online_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.return_status IN ('REQUESTED', 'QC_PENDING', 'RECEIVED') THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.return_status IS DISTINCT FROM NEW.return_status) THEN
      PERFORM public.create_admin_notification(
        'ONLINE_RETURN:' || NEW.id::text || ':' || NEW.return_status::text,
        'online_return',
        CASE
          WHEN NEW.return_status::text = 'REQUESTED' THEN 'New Return Request #' || NEW.return_number
          ELSE 'Return #' || NEW.return_number || ' Needs Inspection'
        END,
        COALESCE(NEW.reason_label, 'Customer return') || ' · Refund: ₹' || to_char(COALESCE(NEW.final_refund_amount, NEW.estimated_refund_amount, 0), 'FM999,999,999'),
        'returns',
        'all',
        'high',
        NEW.id::text,
        'online_return',
        jsonb_build_object('return_number', NEW.return_number, 'status', NEW.return_status::text)
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


-- -----------------------------------------------------------------------
-- E. Contact Messages Trigger — defensive hardening
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trig_fn_notify_contact_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status::text = 'new' OR NEW.status IS NULL THEN
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
      CASE WHEN NEW.priority::text IN ('urgent', 'high') THEN 'high' ELSE 'normal' END,
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


-- -----------------------------------------------------------------------
-- F. Low Stock Trigger — defensive hardening
-- -----------------------------------------------------------------------
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


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
