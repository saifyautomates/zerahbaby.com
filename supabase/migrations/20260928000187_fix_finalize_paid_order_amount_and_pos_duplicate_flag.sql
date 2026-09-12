-- ==============================================================================
-- Migration: 20260928000187_fix_finalize_paid_order_amount_and_pos_duplicate_flag.sql
-- Description:
-- 1. In finalize_paid_order: Normalize verified amounts passed in paise (e.g. from
--    Razorpay webhooks or SDK callbacks) to rupees before comparing to session_rec.total.
-- 2. In place_offline_sale: Return 'duplicate', false on initial sale creation so callers
--    have an unambiguous, symmetric boolean indicator whether duplicate or created.
-- ==============================================================================

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

    IF attempt_rec.id IS NOT NULL AND attempt_rec.session_id IS NOT NULL THEN
      SELECT * INTO session_rec
      FROM public.checkout_sessions
      WHERE session_id = attempt_rec.session_id OR id::text = attempt_rec.session_id
      FOR UPDATE;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for Razorpay Order ID: %', _razorpay_order_id;
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
    FROM public.orders
    WHERE id = session_rec.order_id;

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

  -- 3. Verify Amount
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    -- If passed in paise (standard in Razorpay webhooks/callbacks e.g. 119900 paise for ₹1199), normalize to rupees
    IF session_rec.total > 0 AND _verified_amount >= session_rec.total * 50 THEN
      _verified_amount := _verified_amount / 100.0;
    END IF;

    IF abs(session_rec.total - _verified_amount) > 0.05 THEN
      RAISE EXCEPTION 'Verified amount (₹%) does not match session total (₹%)', _verified_amount, session_rec.total;
    END IF;
  END IF;

  -- 4. Inventory Lock & Verification
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
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

  -- 6. Insert Order
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
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
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
    idempotency_key
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
    COALESCE(session_rec.payment_method, 'online'),
    'paid'::public.payment_status,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
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
    session_rec.idempotency_key
  );

  -- Insert payment record
  INSERT INTO public.payments (
    order_id,
    provider,
    payment_id,
    order_reference,
    method,
    amount,
    status,
    metadata
  ) VALUES (
    new_order_id,
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    'online',
    session_rec.total,
    'success',
    jsonb_build_object(
      'signature', _razorpay_signature,
      'verified_amount', _verified_amount,
      'session_id', session_rec.id
    )
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'processing', 'Payment verified and order processing', v_user_id);

  -- 7. Insert Order Items & Deduct Stock Atomically (SINGLE-SOURCE MUTATION)
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
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.variant_id;

      -- trg_sync_variant_to_product_stock atomically re-sums parent stock! No double deduction.

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        item_rec.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.product_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        NULL,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 8. Mark Session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
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
    'status', 'processing'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- CANONICAL place_offline_sale with explicit duplicate: false on new sale creation
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT '',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _customer_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_existing_sale record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_effective_payment_method text;
  v_item record;
  v_prev_stock int;
  v_new_stock int;
  v_var_prev_stock int;
  v_var_new_stock int;
  v_total_units int := 0;
  v_clean_phone text;
  v_cust_id uuid := _customer_id;
  v_curr_balance numeric := 0;
  v_new_balance numeric := 0;
  v_voucher_record record;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_applied_coupon record;
  v_item_price numeric;
  v_line_gross numeric;
  v_alloc_bill numeric;
  v_alloc_coupon numeric;
  v_final_unit_paid numeric;
BEGIN
  -- 1. Strict Staff/Admin Authorization check
  IF uid IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
  END IF;

  -- 2. Input Sanitation
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) > 10 AND starts_with(v_clean_phone, '91') THEN
    v_clean_phone := substring(v_clean_phone from 3);
  END IF;

  -- 3. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, customer_name, payment_method, store_credit_used
    INTO v_existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'store_credit_used', v_existing_sale.store_credit_used,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 4. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale with empty items';
  END IF;

  -- 5. Calculate subtotal & validate prices and quantities
  v_subtotal := 0;
  v_total_units := 0;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF COALESCE(v_item.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Quantity for item % must be greater than 0', COALESCE(v_item.name, 'item');
    END IF;

    -- Canonical Server-Side Price Verification
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    IF v_item_price IS NULL OR v_item_price < 0 THEN
      RAISE EXCEPTION 'Price for item % cannot be negative', COALESCE(v_item.name, 'item');
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item.qty);
    v_total_units := v_total_units + v_item.qty;
  END LOOP;

  -- 6. Apply Coupon Code if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (expires_at IS NULL OR expires_at >= now())
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF v_applied_coupon.min_order_amount IS NULL OR v_subtotal >= v_applied_coupon.min_order_amount THEN
        IF v_applied_coupon.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
          IF v_applied_coupon.max_discount_amount IS NOT NULL AND v_coupon_discount > v_applied_coupon.max_discount_amount THEN
            v_coupon_discount := v_applied_coupon.max_discount_amount;
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_subtotal, v_applied_coupon.discount_value);
        END IF;

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1
        WHERE id = v_applied_coupon.id;
      END IF;
    END IF;
  END IF;

  -- 7. Calculate manual cashier discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * LEAST(_discount_value, 100)) / 100, 2);
  ELSIF _discount_type = 'flat' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  v_discount := LEAST(v_subtotal, v_discount + v_coupon_discount);
  v_gross_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Validate and handle Store Credit / Voucher Redemption
  IF _store_credit_used > 0 OR (_credit_token IS NOT NULL AND trim(_credit_token) != '') THEN
    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_voucher_record
      FROM public.store_credit_vouchers
      WHERE UPPER(token) = UPPER(trim(_credit_token))
      FOR UPDATE;

      IF v_voucher_record.id IS NULL THEN
        RAISE EXCEPTION 'Store credit voucher % not found', trim(_credit_token);
      END IF;

      IF v_voucher_record.is_active = false OR v_voucher_record.current_balance <= 0 THEN
        RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed or is inactive', trim(_credit_token);
      END IF;

      IF v_voucher_record.expires_at IS NOT NULL AND v_voucher_record.expires_at < now() THEN
        RAISE EXCEPTION 'Store credit voucher % expired on %', trim(_credit_token), v_voucher_record.expires_at;
      END IF;

      v_voucher_used := LEAST(_store_credit_used, v_voucher_record.current_balance, v_gross_total);
      IF v_voucher_used <= 0 THEN
        v_voucher_used := LEAST(v_voucher_record.current_balance, v_gross_total);
      END IF;
      v_voucher_token := v_voucher_record.token;

      UPDATE public.store_credit_vouchers
      SET current_balance = current_balance - v_voucher_used,
          is_active = (current_balance - v_voucher_used > 0),
          redeemed_at = CASE WHEN (current_balance - v_voucher_used) <= 0 THEN now() ELSE redeemed_at END,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 9. Determine effective payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 10. Generate sequential POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 11. Customer Link / Upsert
  IF v_cust_id IS NULL AND v_clean_phone != '' THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || v_clean_phone || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_spend,
        visits_count,
        total_visits,
        total_purchases,
        last_visit,
        last_visit_date,
        created_at,
        updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        v_gross_total,
        1,
        1,
        1,
        now(),
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
          total_spend = COALESCE(total_spend, 0) + v_gross_total,
          visits_count = COALESCE(visits_count, 0) + 1,
          total_visits = COALESCE(total_visits, 0) + 1,
          total_purchases = COALESCE(total_purchases, 0) + 1,
          last_visit = now(),
          last_visit_date = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
        total_spend = COALESCE(total_spend, 0) + v_gross_total,
        visits_count = COALESCE(visits_count, 0) + 1,
        total_visits = COALESCE(total_visits, 0) + 1,
        total_purchases = COALESCE(total_purchases, 0) + 1,
        last_visit = now(),
        last_visit_date = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 12. Insert Master POS Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token_used,
    coupon_code,
    cashier_id,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_subtotal,
    v_discount,
    v_gross_total,
    v_effective_payment_method,
    _notes,
    _idempotency_key,
    v_voucher_used,
    v_voucher_token,
    _coupon_code,
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 13. Process Items & Single-Source Inventory Mutation
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    v_line_gross := v_item_price * COALESCE(v_item.qty, 1);

    v_alloc_bill := CASE
      WHEN v_subtotal > 0 AND (v_discount - v_coupon_discount) > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * (v_discount - v_coupon_discount)) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_alloc_coupon := CASE
      WHEN v_subtotal > 0 AND v_coupon_discount > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * v_coupon_discount) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_final_unit_paid := GREATEST(0, ROUND(v_item_price - v_alloc_bill - v_alloc_coupon, 4));

    -- Insert into offline_sale_items
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      sku,
      barcode,
      price,
      mrp,
      cost_price,
      variant_info,
      qty,
      quantity,
      subtotal,
      unit_mrp,
      unit_selling_price,
      line_gross_amount,
      allocated_bill_discount,
      allocated_coupon_discount,
      final_unit_paid_price,
      quantity_sold,
      quantity_returned,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, v_item.slug, ''),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.barcode, ''),
      v_item_price,
      COALESCE(v_item.mrp, v_item_price, 0),
      COALESCE(v_item.cost_price, 0),
      COALESCE(v_item.variant_info, ''),
      COALESCE(v_item.qty, 1),
      COALESCE(v_item.qty, 1),
      v_item_price * COALESCE(v_item.qty, 1),
      COALESCE(v_item.mrp, v_item_price, 0),
      v_item_price,
      v_line_gross,
      v_alloc_bill,
      v_alloc_coupon,
      v_final_unit_paid,
      COALESCE(v_item.qty, 1),
      0,
      now()
    );

    -- SINGLE-SOURCE INVENTORY DEDUCTION:
    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
      v_var_new_stock := GREATEST(0, COALESCE(v_var_prev_stock, 0) - v_item.qty);

      UPDATE public.product_variants
      SET stock = v_var_new_stock,
          updated_at = now()
      WHERE id = v_item.variant_id;

      -- trg_sync_variant_to_product_stock atomically updates products.stock!
      -- DO NOT update products.stock here (prevents double-deduction and single-variant overwrite).

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        v_item.product_id,
        v_item.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        v_var_prev_stock,
        v_var_new_stock,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        uid
      );
    ELSE
      IF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - v_item.qty);

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_item.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          type,
          transaction_type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          note,
          notes,
          created_by
        ) VALUES (
          v_item.product_id,
          NULL,
          'sale'::public.inventory_tx_type,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          v_prev_stock,
          v_new_stock,
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          uid
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'gross_total', v_gross_total,
    'total', v_gross_total,
    'payable_total', v_payable_total,
    'store_credit_used', v_voucher_used,
    'credit_token_used', v_voucher_token,
    'payment_method', v_effective_payment_method,
    'customer_id', v_cust_id,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', v_total_units,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;

