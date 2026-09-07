-- =============================================================================
-- Migration: 20260928000129_fix_generate_invoice_no_in_finalize_and_cod.sql
-- 1. Create generate_invoice_no() compatibility wrapper around generate_invoice_number()
-- 2. Update finalize_paid_order and place_cod_order to call generate_invoice_number() directly
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: INVOICE GENERATOR COMPATIBILITY WRAPPER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_invoice_no()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.generate_invoice_number();
$$;

GRANT EXECUTE ON FUNCTION public.generate_invoice_no() TO anon, authenticated, service_role, postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: UPDATE finalize_paid_order
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_prev_stock int;
  v_new_stock int;
  v_cust_details jsonb;
  v_user_id uuid;
BEGIN
  -- 1. Idempotency Check: if order already exists for this payment_id or razorpay_order_id
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
    WHERE session_id = _session_id
    FOR UPDATE;
  END IF;

  -- Fallback: lookup session via payment_attempt
  IF session_rec.id IS NULL THEN
    SELECT * INTO attempt_rec
    FROM public.payment_attempts
    WHERE razorpay_order_id = _razorpay_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF attempt_rec.session_id IS NOT NULL THEN
      SELECT * INTO session_rec
      FROM public.checkout_sessions
      WHERE session_id = attempt_rec.session_id
      FOR UPDATE;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for order finalization.';
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
    order_number,
    invoice_no,
    user_id,
    full_name,
    email,
    phone,
    shipping_address,
    city,
    state,
    pincode,
    subtotal,
    shipping_fee,
    discount,
    total,
    payment_method,
    payment_status,
    status,
    coupon_code,
    notes,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    paid_at,
    created_at,
    updated_at
  ) VALUES (
    new_order_id,
    new_order_number,
    new_invoice,
    v_user_id,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    'razorpay',
    'paid',
    'processing',
    session_rec.coupon_code,
    COALESCE(v_cust_details->>'notes', ''),
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
    now(),
    now(),
    now()
  );

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
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      variant_info,
      sku,
      barcode,
      price,
      mrp,
      qty,
      image_url,
      created_at
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      item_rec.product_name,
      COALESCE(item_rec.product_slug, ''),
      TRIM(BOTH ' ' FROM CONCAT(COALESCE(item_rec.variant_color, ''), ' ', COALESCE(item_rec.variant_size, ''))),
      COALESCE(item_rec.variant_sku, ''),
      COALESCE(item_rec.variant_barcode, ''),
      item_rec.price,
      COALESCE(item_rec.mrp, item_rec.price),
      item_rec.qty,
      item_rec.image_url,
      now()
    );

    IF item_rec.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock - item_rec.qty
      WHERE id = item_rec.variant_id;
    END IF;

    IF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = item_rec.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_rec.product_id,
          item_rec.variant_id,
          'sale'::public.inventory_tx_type,
          -item_rec.qty,
          'order',
          new_order_id,
          'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
          v_user_id
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Mark checkout session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      converted_order_id = new_order_id,
      converted_at = now(),
      updated_at = now()
  WHERE id = session_rec.id;

  -- 9. Update payment attempt status to completed
  UPDATE public.payment_attempts
  SET status = 'completed',
      razorpay_payment_id = _razorpay_payment_id,
      razorpay_signature = _razorpay_signature,
      completed_at = now()
  WHERE razorpay_order_id = _razorpay_order_id;

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

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO anon, authenticated, service_role, postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: UPDATE place_cod_order
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_cod_order(
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  ps_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock int;
  v_new_stock int;
  v_cust_details jsonb;
  v_user_id uuid;
BEGIN
  -- 1. Fetch Payment Settings and verify COD is active
  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.cod_enabled = false THEN
    RAISE EXCEPTION 'Cash on Delivery is currently disabled.';
  END IF;

  -- 2. Fetch and Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found.';
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
    FROM public.orders
    WHERE id = session_rec.converted_order_id;

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

  IF session_rec.payment_method != 'cod' THEN
    RAISE EXCEPTION 'Checkout session is not configured for Cash on Delivery.';
  END IF;

  -- 3. Verify min/max COD constraints
  IF ps_rec.cod_min_order_value > 0 AND session_rec.subtotal < ps_rec.cod_min_order_value THEN
    RAISE EXCEPTION 'Minimum order value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
  END IF;

  IF ps_rec.cod_max_order_value > 0 AND session_rec.subtotal > ps_rec.cod_max_order_value THEN
    RAISE EXCEPTION 'Maximum order value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
  END IF;

  -- 4. Inventory Lock & Verification for all items
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    qty int
  ) LOOP
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

  -- 6. Insert Canonical COD Order
  INSERT INTO public.orders (
    id,
    order_number,
    invoice_no,
    user_id,
    full_name,
    email,
    phone,
    shipping_address,
    city,
    state,
    pincode,
    subtotal,
    shipping_fee,
    discount,
    total,
    payment_method,
    payment_status,
    status,
    coupon_code,
    notes,
    created_at,
    updated_at
  ) VALUES (
    new_order_id,
    new_order_number,
    new_invoice,
    v_user_id,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    'cod',
    'pending',
    'processing',
    session_rec.coupon_code,
    COALESCE(v_cust_details->>'notes', ''),
    now(),
    now()
  );

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
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      variant_info,
      sku,
      barcode,
      price,
      mrp,
      qty,
      image_url,
      created_at
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      item_rec.product_name,
      COALESCE(item_rec.product_slug, ''),
      TRIM(BOTH ' ' FROM CONCAT(COALESCE(item_rec.variant_color, ''), ' ', COALESCE(item_rec.variant_size, ''))),
      COALESCE(item_rec.variant_sku, ''),
      COALESCE(item_rec.variant_barcode, ''),
      item_rec.price,
      COALESCE(item_rec.mrp, item_rec.price),
      item_rec.qty,
      item_rec.image_url,
      now()
    );

    IF item_rec.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock - item_rec.qty
      WHERE id = item_rec.variant_id;
    END IF;

    IF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = item_rec.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_rec.product_id,
          item_rec.variant_id,
          'sale'::public.inventory_tx_type,
          -item_rec.qty,
          'order',
          new_order_id,
          'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
          v_user_id
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Mark checkout session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      converted_order_id = new_order_id,
      converted_at = now(),
      updated_at = now()
  WHERE id = session_rec.id;

  -- 9. Record coupon usage
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
    'payment_status', 'pending',
    'status', 'processing',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_cod_order(text) TO anon, authenticated, service_role;
