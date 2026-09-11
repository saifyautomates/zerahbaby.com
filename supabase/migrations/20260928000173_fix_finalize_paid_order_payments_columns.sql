-- =============================================================================
-- Migration: 20260928000173_fix_finalize_paid_order_payments_columns.sql
-- Description:
-- Fix public.payments insertion columns in finalize_paid_order:
-- Use provider, payment_id, order_reference, method, and metadata.
-- =============================================================================

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
  product_rec record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_details jsonb;
  v_user_id uuid;
  v_buying_price numeric;
BEGIN
  -- 1. Idempotency Check
  SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
  FROM public.orders
  WHERE razorpay_payment_id = _razorpay_payment_id
     OR (razorpay_order_id = _razorpay_order_id AND payment_status = 'paid')
  LIMIT 1;

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

  -- 2. Fetch and Lock Checkout Session
  IF _session_id IS NOT NULL AND trim(_session_id) != '' THEN
    SELECT * INTO session_rec
    FROM public.checkout_sessions
    WHERE session_id = _session_id OR id::text = _session_id
    FOR UPDATE;
  END IF;

  IF session_rec.id IS NULL THEN
    SELECT * INTO attempt_rec
    FROM public.payment_attempts
    WHERE razorpay_order_id = _razorpay_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF attempt_rec.id IS NOT NULL THEN
      IF attempt_rec.checkout_session_id IS NOT NULL THEN
        SELECT * INTO session_rec
        FROM public.checkout_sessions
        WHERE id = attempt_rec.checkout_session_id
        FOR UPDATE;
      END IF;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for order finalization (order_id: %, session_id: %).', _razorpay_order_id, _session_id;
  END IF;

  -- 3. Verify Payment Amount if provided
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF ABS((session_rec.total * 100) - _verified_amount) > 100 THEN
      RAISE EXCEPTION 'Payment amount mismatch: session ₹% vs paid ₹%', session_rec.total, (_verified_amount / 100.0);
    END IF;
  END IF;

  -- 4. Inventory Lock & Verification for all items
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty IS NULL OR item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Variant not found: %', item_rec.variant_id;
      END IF;

      IF variant_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          item_rec.product_name, COALESCE(variant_rec.name, ''), variant_rec.stock, item_rec.qty;
      END IF;
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT * INTO product_rec
      FROM public.products
      WHERE id = item_rec.product_id
      FOR UPDATE;

      IF product_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', item_rec.product_id;
      END IF;

      IF product_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          item_rec.product_name, product_rec.stock, item_rec.qty;
      END IF;
    END IF;
  END LOOP;

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Canonical Order
  INSERT INTO public.orders (
    id,
    user_id,
    invoice_no,
    order_number,
    subtotal,
    shipping,
    shipping_fee,
    discount,
    total,
    coupon_code,
    status,
    payment_method,
    payment_status,
    full_name,
    email,
    phone,
    alt_phone,
    address,
    address_line2,
    landmark,
    city,
    state,
    pincode,
    notes,
    idempotency_key,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  ) VALUES (
    new_order_id,
    v_user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'processing'::public.order_status,
    'razorpay',
    'paid'::public.payment_status,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'alt_phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'address_line2', ''),
    COALESCE(v_cust_details->>'landmark', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    COALESCE(v_cust_details->>'notes', ''),
    session_rec.idempotency_key,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'processing', 'Payment verified and order placed successfully', v_user_id);

  -- 7. Insert Order Items & Deduct Stock Atomically
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    variant_sku text,
    variant_barcode text,
    variant_color text,
    variant_size text,
    price numeric,
    mrp numeric,
    qty int,
    image_url text
  ) LOOP
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_slug,
      qty,
      price,
      subtotal,
      sku_snapshot,
      color,
      size,
      barcode_snapshot,
      image_url_snapshot,
      image_url,
      product_name_snapshot,
      name,
      buying_price
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      COALESCE(item_rec.product_slug, ''),
      item_rec.qty,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      item_rec.product_name,
      COALESCE(v_buying_price, 0)
    );

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_rec.variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock
      WHERE id = item_rec.variant_id;

      IF item_rec.product_id IS NOT NULL THEN
        UPDATE public.products
        SET stock = GREATEST(0::bigint, stock - item_rec.qty)
        WHERE id = item_rec.product_id;
      END IF;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        created_by
      ) VALUES (
        item_rec.product_id,
        item_rec.variant_id,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.products SET stock = v_new_stock WHERE id = item_rec.product_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        created_by
      ) VALUES (
        item_rec.product_id,
        NULL,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 8. Mark checkout session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      order_id = new_order_id,
      updated_at = now()
  WHERE id = session_rec.id;

  -- 9. Record payment in public.payments table
  INSERT INTO public.payments (
    order_id,
    user_id,
    provider,
    payment_id,
    order_reference,
    amount,
    currency,
    status,
    method,
    metadata
  ) VALUES (
    new_order_id,
    v_user_id,
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    session_rec.total,
    'INR',
    'paid'::public.payment_status,
    'online',
    jsonb_build_object(
      'signature', _razorpay_signature,
      'session_id', session_rec.session_id,
      'checkout_session_uuid', session_rec.id
    )
  );

  -- 10. Record coupon usage
  IF session_rec.coupon_code IS NOT NULL AND session_rec.coupon_code != '' THEN
    DECLARE
      v_cpn record;
    BEGIN
      SELECT * INTO v_cpn FROM public.coupons WHERE UPPER(code) = UPPER(session_rec.coupon_code) LIMIT 1;
      IF v_cpn.id IS NOT NULL THEN
        UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_cpn.id;
        INSERT INTO public.coupon_usage (coupon_id, user_id, order_id, phone, email, discount_amount, created_at)
        VALUES (
          v_cpn.id,
          v_user_id,
          new_order_id,
          v_cust_details->>'phone',
          v_cust_details->>'email',
          session_rec.discount,
          now()
        );
      END IF;
    END;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
