-- ============================================================
-- Migration: Customer Order Cancellation Feature
-- ============================================================

-- 1. Add cancellation metadata fields to orders table if not present
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS cancellation_reason text,
ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);

-- 2. Create atomic customer order cancellation RPC
CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  -- Pessimistically lock the order record to avoid race conditions with concurrent admin updates
  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ensure authenticated user owns this order (or is an admin)
  IF ord.user_id != uid AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  -- Validate lifecycle state:
  -- Block if already shipped or in post-shipment state
  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'This order has already been shipped and can no longer be cancelled.';
  END IF;

  -- Block if already cancelled
  IF ord.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order has already been cancelled.';
  END IF;

  -- Only allow pre-shipment statuses
  IF ord.status NOT IN ('placed', 'pending', 'confirmed', 'processing', 'packed') THEN
    RAISE EXCEPTION 'Order with status "%" cannot be cancelled.', ord.status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Customer cancelled before shipment');

  -- Update order atomically
  -- This will automatically trigger:
  -- 1) orders_restore_stock_trigger -> restores product stocks idempotently
  -- 2) orders_log_status -> inserts row into order_status_history with changed_by = uid
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancellation_reason = final_reason,
    cancelled_at = now(),
    cancelled_by = uid
  WHERE id = order_id;

  -- Return result payload
  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'status', 'cancelled',
    'payment_status', ord.payment_status,
    'cancelled_at', now(),
    'reason', final_reason
  );
END;
$$;

-- 3. Grant execution permissions
GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated;
