-- ==============================================================================
-- Migration: 20260928000124_atomic_order_refund_records.sql
-- Description:
-- Provides canonical atomic PostgreSQL RPCs for recording Razorpay refunds:
-- 1. record_order_refund_success: Atomically updates order, payment attempt,
--    and status history upon confirmed gateway refund.
-- 2. record_order_refund_failure: Atomically records failed gateway attempt
--    without altering payment_status.
-- ==============================================================================

-- 1. Success Record RPC
CREATE OR REPLACE FUNCTION public.record_order_refund_success(
  _order_id uuid,
  _refund_id text,
  _refund_status text,
  _refund_amount numeric,
  _notes text DEFAULT '',
  _admin_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  -- 1. Lock the order row to prevent race conditions
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order not found'
    );
  END IF;

  -- 2. Idempotency guard: If already refunded with the exact same refund ID
  IF v_order.razorpay_refund_id = _refund_id AND v_order.payment_status = 'refunded'::public.payment_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_recorded', true,
      'order_id', _order_id,
      'refund_id', _refund_id
    );
  END IF;

  -- 3. Update orders table atomically
  UPDATE public.orders
  SET
    razorpay_refund_id = _refund_id,
    razorpay_refund_status = COALESCE(NULLIF(trim(_refund_status), ''), 'processed'),
    payment_status = 'refunded'::public.payment_status,
    refund_amount = COALESCE(_refund_amount, v_order.refund_amount, v_order.total),
    refund_completed_at = now(),
    refund_notes = COALESCE(NULLIF(trim(_notes), ''), v_order.refund_notes, 'Gateway refund completed')
  WHERE id = _order_id;

  -- 4. Update associated payment_attempts if present
  IF v_order.razorpay_payment_id IS NOT NULL THEN
    UPDATE public.payment_attempts
    SET
      status = 'refunded',
      updated_at = now()
    WHERE razorpay_payment_id = v_order.razorpay_payment_id;
  END IF;

  -- 5. Insert status history audit trail
  INSERT INTO public.order_status_history (
    order_id,
    new_status,
    note,
    changed_by
  ) VALUES (
    _order_id,
    v_order.status,
    'Razorpay refund of ₹' || COALESCE(_refund_amount, v_order.total)::text || ' confirmed (Refund ID: ' || _refund_id || ')',
    _admin_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'refund_id', _refund_id,
    'refund_amount', COALESCE(_refund_amount, v_order.total),
    'status', COALESCE(NULLIF(trim(_refund_status), ''), 'processed')
  );
END;
$$;

-- 2. Failure Record RPC
CREATE OR REPLACE FUNCTION public.record_order_refund_failure(
  _order_id uuid,
  _failure_reason text,
  _admin_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order not found'
    );
  END IF;

  -- Update order with failed status while leaving payment_status as-is (e.g. 'paid')
  UPDATE public.orders
  SET
    razorpay_refund_status = 'FAILED',
    refund_notes = 'Gateway refund failed: ' || COALESCE(_failure_reason, 'Unknown gateway rejection')
  WHERE id = _order_id;

  -- Insert history record
  INSERT INTO public.order_status_history (
    order_id,
    new_status,
    note,
    changed_by
  ) VALUES (
    _order_id,
    v_order.status,
    'Gateway refund attempt failed: ' || COALESCE(_failure_reason, 'Rejected by gateway'),
    _admin_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'recorded', true
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.record_order_refund_success(uuid, text, text, numeric, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_order_refund_failure(uuid, text, uuid) TO authenticated, service_role;
