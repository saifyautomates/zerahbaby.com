-- =============================================================================
-- Migration: 20260928000128_fix_place_order_variant_unassigned_and_finalize_paid_order.sql
-- 1. Fix 'record variant is not assigned yet' in place_order by pre-initializing variant record
-- 2. Restore full return schema & permissions in finalize_paid_order for end-to-end payment lifecycle
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: FIX place_order VARIANT RECORD INITIALIZATION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_order(
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _items jsonb,
  _payment_method text DEFAULT 'online',
  _coupon_code text DEFAULT NULL,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL,
  _alt_phone text DEFAULT '',
  _address_line2 text DEFAULT '',
  _landmark text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid;
  item record;
  variant record;
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  net_subtotal numeric := 0;
  std_shipping numeric := 79;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_raw_val text;
  new_order_id uuid;
  new_order_number text;
  new_invoice text;
  existing_order record;
  v_initial_payment_status text := 'pending';
  v_clean_idem text;
  v_item_buying_price numeric;
  item_image text;
  v_prev_stock int;
  v_new_stock int;
  v_clean_var_id uuid;
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT id, order_number, invoice_no, total, payment_status, status
    INTO existing_order
    FROM public.orders
    WHERE idempotency_key = v_clean_idem
    LIMIT 1;

    IF existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', existing_order.id,
        'invoice_no', existing_order.invoice_no,
        'order_number', existing_order.order_number,
        'total', existing_order.total,
        'payment_status', existing_order.payment_status,
        'status', existing_order.status,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate Items & Compute Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    -- Pre-initialize variant with defined column types to prevent 'record variant is not assigned yet'
    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_var_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT NULL::uuid AS variant_id, p.price AS price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL AS variant_color, NULL AS variant_size,
             p.name AS variant_name, NULL AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product not found for item: %', COALESCE(item.variant_id, item.product_slug, item.product_id, 'unknown');
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  -- 4. Coupon Calculation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
          computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
          IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
            computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
          END IF;
        ELSE
          computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
        END IF;

        UPDATE public.coupons
        SET used_count = used_count + 1
        WHERE id = coupon_record.id;
      ELSE
        _coupon_code := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      _coupon_code := NULL;
    END IF;
  END IF;

  -- 5. Shipping Calculation
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    fd_threshold := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee';
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled';
  IF v_raw_val IS NOT NULL THEN
    is_fd_enabled := (v_raw_val = 'true');
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);
  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := net_subtotal + shipping;

  -- 6. Insert Order
  new_order_id := gen_random_uuid();
  new_order_number := 'ZK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(new_order_id::text, 1, 6));
  new_invoice := 'INV-' || to_char(now(), 'YYMM') || '-' || upper(substring(new_order_id::text, 1, 5));

  INSERT INTO public.orders (
    id, order_number, invoice_no, user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    subtotal, discount, shipping, total, payment_method, payment_status,
    status, notes, coupon_code, idempotency_key
  ) VALUES (
    new_order_id, new_order_number, new_invoice, uid, trim(_full_name), trim(_email), trim(_phone), NULLIF(trim(_alt_phone), ''),
    trim(_address), NULLIF(trim(_address_line2), ''), NULLIF(trim(_landmark), ''), trim(_city), trim(_state), trim(_pincode),
    computed_subtotal, computed_discount, shipping, computed_total, lower(trim(_payment_method)), v_initial_payment_status,
    'placed', NULLIF(trim(_notes), ''), _coupon_code, v_clean_idem
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed via online checkout', uid);

  -- 7. Insert Items & Decrement Inventory
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_var_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT NULL::uuid AS variant_id, p.price AS price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL AS variant_color, NULL AS variant_size,
             p.name AS variant_name, NULL AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    SELECT buying_price INTO v_item_buying_price
    FROM public.product_costs
    WHERE product_id = variant.p_id
    LIMIT 1;

    item_image := variant.variant_image;
    IF item_image IS NULL AND variant.variant_color IS NOT NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND color = variant.variant_color
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;
    IF item_image IS NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, item.qty, variant.price, (variant.price * item.qty), variant.variant_sku,
      variant.variant_color, variant.variant_size, variant.variant_barcode, item_image, item_image, variant.product_name, variant.product_name, COALESCE(v_item_buying_price, 0)
    );

    IF variant.variant_id IS NOT NULL THEN
      v_prev_stock := variant.stock;
      v_new_stock := GREATEST(0, variant.stock - item.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock
      WHERE id = variant.variant_id;

      UPDATE public.products
      SET stock = GREATEST(0, stock - item.qty)
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number, uid
      );
    ELSE
      v_prev_stock := variant.p_stock;
      v_new_stock := GREATEST(0, variant.p_stock - item.qty);

      UPDATE public.products
      SET stock = v_new_stock
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
      ) VALUES (
        variant.p_id, NULL, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number, uid
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'total', computed_total,
    'payment_status', v_initial_payment_status,
    'status', 'placed',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: FINALIZE PAID ORDER ATOMIC STATE MACHINE & RETURN OBJECT
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.finalize_paid_order(text, text, text, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.finalize_paid_order CASCADE;

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
  new_invoice := public.generate_invoice_no();
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
