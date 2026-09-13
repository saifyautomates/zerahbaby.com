-- ==============================================================================
-- Migration: 20260928000210_harden_returns_refunds_and_cancel_triggers.sql
-- Description:
-- 1. admin_record_online_refund: Atomically synchronizes the parent orders row
--    (payment_status = 'refunded', status = 'returned', razorpay_refund_id, refund_amount)
--    and inserts an audit entry into order_status_history.
-- 2. restore_stock_on_cancel: Restrict automatic blanket restock trigger to
--    status = 'cancelled' and payment_status = 'failed'. Eliminate 'returned'
--    from automatic blanket restock to prevent double restocks and preserve itemized QC.
-- 3. request_online_return: Eliminate guest order hijacking by hardening ownership checks
--    against ternary SQL NULL evaluation.
-- ==============================================================================

-- 1. HARDEN admin_record_online_refund
CREATE OR REPLACE FUNCTION public.admin_record_online_refund(
  _return_id uuid,
  _refund_amount numeric,
  _refund_method text DEFAULT 'razorpay',
  _gateway_refund_id text DEFAULT NULL,
  _notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_order record;
  v_is_authorized boolean := false;
  v_effective_notes text;
  v_final_amount numeric;
BEGIN
  v_uid := auth.uid();

  -- Check if caller is service_role (e.g. from Edge Functions)
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
       public.is_admin() THEN
      v_is_authorized := true;
    END IF;
  ELSE
    -- Direct internal execution
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can record refunds';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  v_final_amount := COALESCE(_refund_amount, v_return.final_refund_amount, 0);
  v_effective_notes := COALESCE(NULLIF(trim(_notes), ''), 'Online refund processed');

  -- 1. Update online_returns table
  UPDATE public.online_returns
  SET refund_status = 'PROCESSED',
      return_status = 'COMPLETED',
      final_refund_amount = v_final_amount,
      razorpay_refund_id = COALESCE(_gateway_refund_id, razorpay_refund_id),
      razorpay_refund_status = 'PROCESSED',
      refund_completed_at = now(),
      admin_note = CASE WHEN _notes != '' THEN COALESCE(admin_note || ' | ', '') || _notes ELSE admin_note END,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = _return_id;

  -- 2. Atomically synchronize parent orders row
  IF v_return.order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_return.order_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.orders
      SET payment_status = 'refunded'::public.payment_status,
          status = CASE 
            WHEN status IN ('cancelled'::public.order_status, 'returned'::public.order_status) THEN status
            ELSE 'returned'::public.order_status
          END,
          razorpay_refund_id = COALESCE(_gateway_refund_id, razorpay_refund_id),
          razorpay_refund_status = 'PROCESSED',
          refund_amount = COALESCE(v_final_amount, refund_amount, total),
          refund_completed_at = now(),
          refund_notes = v_effective_notes,
          updated_at = now()
      WHERE id = v_return.order_id;

      -- Insert order status history entry
      INSERT INTO public.order_status_history (
        order_id,
        old_status,
        new_status,
        note,
        changed_by
      ) VALUES (
        v_return.order_id,
        v_order.status::text,
        CASE 
          WHEN v_order.status IN ('cancelled'::public.order_status, 'returned'::public.order_status) THEN v_order.status::text
          ELSE 'returned'
        END,
        'Online return refund confirmed: ₹' || v_final_amount || ' via ' || _refund_method || ' (Refund ID: ' || COALESCE(_gateway_refund_id, 'N/A') || ')',
        v_uid
      );
    END IF;
  END IF;

  -- 3. Insert online return audit event
  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    _return_id,
    'REFUND_PROCESSED',
    v_return.refund_status,
    'PROCESSED',
    'Refund completed: ₹' || v_final_amount || ' via ' || _refund_method,
    v_uid,
    CASE WHEN v_uid IS NULL THEN 'system' ELSE 'admin' END,
    jsonb_build_object(
      'refund_id', _gateway_refund_id,
      'amount', v_final_amount,
      'method', _refund_method,
      'order_id', v_return.order_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'order_id', v_return.order_id,
    'refund_status', 'PROCESSED',
    'return_status', 'COMPLETED',
    'refund_amount', v_final_amount,
    'gateway_refund_id', _gateway_refund_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_online_refund(uuid, numeric, text, text, text) TO authenticated, service_role, anon;

-- 2. HARDEN restore_stock_on_cancel TRIGGER FUNCTION
-- Eliminates blanket restock on 'returned' status. Returns go through QC where individual items are restocked.
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire when order transitions to cancelled (or payment failed).
  -- DO NOT fire on 'returned' — returned items are inspected & restocked individually by admin_process_return_qc or process_offline_return!
  IF (NEW.status = 'cancelled'::public.order_status
      AND OLD.status IS DISTINCT FROM 'cancelled'::public.order_status)
     OR
     (NEW.payment_status = 'failed'::public.payment_status
      AND OLD.payment_status IS DISTINCT FROM 'failed'::public.payment_status)
  THEN
    PERFORM public.restore_stock_for_order(
      NEW.id,
      'Stock restored due to order cancellation (status: ' || NEW.status::text || ', payment: ' || NEW.payment_status::text || ')',
      'order'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_restore_stock_trigger ON public.orders;
CREATE TRIGGER orders_restore_stock_trigger
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.restore_stock_on_cancel();

-- 3. HARDEN request_online_return (PREVENT GUEST ORDER HIJACKING)
CREATE OR REPLACE FUNCTION public.request_online_return(
  _order_id uuid,
  _items jsonb,
  _reason_category text,
  _reason_label text,
  _customer_note text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_order record;
  v_calc jsonb;
  v_return_id uuid;
  v_return_number text;
  v_existing_return record;
  v_item record;
  v_calc_item jsonb;
  v_is_admin boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to initiate return';
  END IF;

  -- Determine admin status
  IF public.has_role(v_uid, 'admin') OR
     public.has_role(v_uid, 'owner') OR
     public.has_role(v_uid, 'manager') OR
     public.has_role(v_uid, 'staff') OR
     EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
     EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
     public.is_admin() THEN
    v_is_admin := true;
  END IF;

  -- 1. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_return
    FROM public.online_returns
    WHERE idempotency_key = trim(_idempotency_key);

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'status', v_existing_return.return_status,
        'final_refund_amount', v_existing_return.final_refund_amount,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Lock Order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Strict ownership check: prevent guest order hijacking via NULL != v_uid ternary logic
  IF (v_order.user_id IS NULL OR v_order.user_id != v_uid) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: You can only return orders placed by your authenticated account';
  END IF;

  -- 3. Calculate refund and validate constraints
  v_calc := public.calculate_online_return_refund(_order_id, _items, _reason_category);

  IF (v_calc->>'success')::boolean != true THEN
    RAISE EXCEPTION '%', (v_calc->>'error');
  END IF;

  IF (v_calc->>'is_eligible')::boolean != true THEN
    RAISE EXCEPTION '%', COALESCE(v_calc->>'ineligible_reason', 'Order is not eligible for return');
  END IF;

  -- 4. Create online_returns record
  v_return_id := gen_random_uuid();
  v_return_number := public.generate_online_return_number();

  INSERT INTO public.online_returns (
    id,
    return_number,
    order_id,
    user_id,
    return_status,
    refund_status,
    reason_category,
    reason_label,
    customer_note,
    return_shipping_fee,
    eligible_refund_amount,
    final_refund_amount,
    currency,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    v_return_id,
    v_return_number,
    _order_id,
    v_uid,
    'REQUESTED',
    'PENDING',
    _reason_category,
    _reason_label,
    COALESCE(_customer_note, ''),
    (v_calc->>'return_shipping_fee')::numeric,
    (v_calc->>'eligible_refund_amount')::numeric,
    (v_calc->>'final_refund_amount')::numeric,
    'INR',
    _idempotency_key,
    now(),
    now()
  );

  -- 5. Insert line items
  FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calc->'items') LOOP
    INSERT INTO public.online_return_items (
      return_id,
      order_item_id,
      product_id,
      variant_id,
      product_name_snapshot,
      sku_snapshot,
      color,
      size,
      image_url_snapshot,
      quantity_requested,
      unit_price_snapshot,
      allocated_discount,
      refund_amount_per_item,
      total_line_refund,
      qc_status,
      created_at,
      updated_at
    ) VALUES (
      v_return_id,
      (v_calc_item->>'order_item_id')::uuid,
      (v_calc_item->>'product_id')::uuid,
      CASE WHEN (v_calc_item->>'variant_id') IS NOT NULL AND (v_calc_item->>'variant_id') != '' 
           THEN (v_calc_item->>'variant_id')::uuid ELSE NULL END,
      (v_calc_item->>'product_name'),
      COALESCE(v_calc_item->>'sku', ''),
      v_calc_item->>'color',
      v_calc_item->>'size',
      v_calc_item->>'image_url',
      (v_calc_item->>'qty_requested')::integer,
      (v_calc_item->>'original_unit_price')::numeric,
      (v_calc_item->>'allocated_discount')::numeric,
      ((v_calc_item->>'item_refund_amount')::numeric / GREATEST(1, (v_calc_item->>'qty_requested')::integer)),
      (v_calc_item->>'item_refund_amount')::numeric,
      'PENDING',
      now(),
      now()
    );
  END LOOP;

  -- 6. Insert audit event
  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    v_return_id,
    'RETURN_REQUESTED',
    'NONE',
    'REQUESTED',
    'Customer submitted online return request for ' || (v_calc->'items'->0->>'product_name'),
    v_uid,
    CASE WHEN v_is_admin THEN 'admin' ELSE 'customer' END,
    jsonb_build_object(
      'order_id', _order_id,
      'reason_category', _reason_category,
      'reason_label', _reason_label,
      'final_refund_amount', (v_calc->>'final_refund_amount')::numeric
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'status', 'REQUESTED',
    'final_refund_amount', (v_calc->>'final_refund_amount')::numeric,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_online_return(uuid, jsonb, text, text, text, text) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
