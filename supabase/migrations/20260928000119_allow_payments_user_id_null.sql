-- ==============================================================================
-- Migration: 20260928000119_allow_payments_user_id_null.sql
-- Description:
-- 1. Allow public.payments.user_id to be NULL for guest checkouts.
-- 2. Update finalize_paid_order to insert session_rec.user_id directly.
-- ==============================================================================

-- 1. Allow payments.user_id to be nullable for guest checkout
ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;

-- 2. Update finalize_paid_order with nullable user_id
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text,
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _razorpay_signature text,
  _verified_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  attempt_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  v_buying_price numeric := 0;
  v_prev_stock int;
  v_new_stock int;
  cust jsonb;
BEGIN
  -- 1. Fetch & Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
     OR id IN (SELECT checkout_session_id FROM public.payment_attempts WHERE razorpay_order_id = _razorpay_order_id)
  LIMIT 1
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for order reference: %', _razorpay_order_id;
  END IF;

  -- 2. Idempotency Check: Order already finalized
  IF session_rec.status = 'converted' AND session_rec.order_id IS NOT NULL THEN
    SELECT * INTO existing_order FROM public.orders WHERE id = session_rec.order_id;
    IF existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', existing_order.id,
        'order_number', existing_order.order_number,
        'invoice_no', existing_order.invoice_no,
        'total', existing_order.total,
        'payment_status', existing_order.payment_status,
        'status', existing_order.status,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Check if order with this razorpay_order_id already exists
  SELECT * INTO existing_order FROM public.orders WHERE razorpay_order_id = _razorpay_order_id LIMIT 1;
  IF existing_order.id IS NOT NULL THEN
    UPDATE public.checkout_sessions
    SET status = 'converted', order_id = existing_order.id, updated_at = now()
    WHERE id = session_rec.id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  -- 3. Verify Amount Match (in paise)
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF abs(ROUND(session_rec.total * 100) - _verified_amount) > 1 THEN
      RAISE EXCEPTION 'Payment amount mismatch: Expected ₹%, received ₹%', session_rec.total, (_verified_amount / 100);
    END IF;
  END IF;

  cust := session_rec.customer_details;

  -- 4. Atomic Stock Validation & Deduction FOR UPDATE
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, qty int, price numeric, mrp numeric, product_name text
  ) LOOP
    SELECT v.id, v.stock AS v_stock, p.stock AS p_stock, p.id AS p_id, p.name AS p_name
    INTO variant_rec
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item_rec.variant_id
    FOR UPDATE OF v, p;

    IF variant_rec.id IS NULL THEN
      RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
    END IF;

    IF variant_rec.v_stock < item_rec.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (Available: %, Requested: %)', variant_rec.p_name, variant_rec.v_stock, item_rec.qty;
    END IF;
  END LOOP;

  -- 5. Create Order Record
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping, discount, total,
    coupon_code, status, payment_method, payment_status, full_name, email, phone,
    alt_phone, address, address_line2, landmark, city, state, pincode, notes,
    idempotency_key, razorpay_order_id, razorpay_payment_id, razorpay_signature
  ) VALUES (
    new_order_id,
    session_rec.user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'processing'::public.order_status,
    'razorpay',
    'paid'::public.payment_status,
    COALESCE(cust->>'full_name', ''),
    COALESCE(cust->>'email', ''),
    COALESCE(cust->>'phone', ''),
    COALESCE(cust->>'alt_phone', ''),
    COALESCE(cust->>'address', ''),
    COALESCE(cust->>'address_line2', ''),
    COALESCE(cust->>'landmark', ''),
    COALESCE(cust->>'city', ''),
    COALESCE(cust->>'state', ''),
    COALESCE(cust->>'pincode', ''),
    COALESCE(cust->>'notes', ''),
    session_rec.idempotency_key,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'processing', 'Payment verified and order placed successfully', session_rec.user_id);

  -- 6. Insert Order Items & Deduct Inventory Exactly Once
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, product_slug text, product_name text, variant_sku text,
    variant_barcode text, variant_color text, variant_size text, price numeric, mrp numeric,
    qty int, line_subtotal numeric, image_url text
  ) LOOP
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, item_rec.product_id, item_rec.variant_id, item_rec.product_slug, item_rec.qty,
      item_rec.price, item_rec.line_subtotal, item_rec.variant_sku, item_rec.variant_color,
      item_rec.variant_size, item_rec.variant_barcode, item_rec.image_url, item_rec.image_url,
      item_rec.product_name, item_rec.product_name, COALESCE(v_buying_price, 0)
    );

    SELECT p.stock INTO v_prev_stock FROM public.products p WHERE id = item_rec.product_id;
    v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);

    UPDATE public.product_variants
    SET stock = GREATEST(0, stock - item_rec.qty)
    WHERE id = item_rec.variant_id;

    UPDATE public.products
    SET stock = v_new_stock
    WHERE id = item_rec.product_id;

    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      item_rec.product_id, item_rec.variant_id, 'sale'::public.inventory_tx_type, -item_rec.qty,
      v_prev_stock, v_new_stock, 'order', new_order_id, 'Order ' || new_order_number, session_rec.user_id
    );
  END LOOP;

  -- 7. Record into public.payments (user_id is nullable for guest checkouts)
  INSERT INTO public.payments (
    order_id, user_id, provider, payment_id, order_reference, amount, currency, status, method
  ) VALUES (
    new_order_id,
    session_rec.user_id,
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    session_rec.total,
    'INR',
    'paid'::public.payment_status,
    'online'
  );

  -- 8. Increment Coupon Usage if applicable
  IF session_rec.coupon_code IS NOT NULL AND trim(session_rec.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = used_count + 1
    WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));

    IF session_rec.user_id IS NOT NULL THEN
      INSERT INTO public.coupon_usage (coupon_id, user_id, order_id)
      SELECT id, session_rec.user_id, new_order_id
      FROM public.coupons
      WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));
    END IF;
  END IF;

  -- 9. Update Payment Attempt & Checkout Session Status
  UPDATE public.payment_attempts
  SET
    status = 'captured',
    razorpay_payment_id = _razorpay_payment_id,
    razorpay_signature = _razorpay_signature,
    verified_at = now(),
    updated_at = now()
  WHERE razorpay_order_id = _razorpay_order_id;

  UPDATE public.checkout_sessions
  SET
    status = 'converted',
    order_id = new_order_id,
    updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'paid',
    'status', 'processing',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_paid_order TO anon, authenticated, service_role;
