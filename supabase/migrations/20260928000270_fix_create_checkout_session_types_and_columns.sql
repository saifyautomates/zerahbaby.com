-- Migration: 20260928000270_fix_create_checkout_session_types_and_columns.sql
-- Description: Fix record type operator crash and align payment_settings column names in create_checkout_session

CREATE OR REPLACE FUNCTION public.create_checkout_session(
  _items jsonb,
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _coupon_code text DEFAULT NULL,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL,
  _payment_method text DEFAULT 'online',
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
  item_elem jsonb;
  variant record;
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  net_subtotal numeric := 0;
  std_shipping numeric := 65;
  free_shipping_threshold numeric := 999;
  free_delivery_enabled boolean := true;
  coupon_record record;
  v_voucher record;
  v_session_id text;
  existing_session record;
  ps_rec record;
  cod_fee numeric := 0;
  v_raw_val text;
  v_delivery_fees_raw text;
  v_delivery_fees jsonb;
  v_custom_shipping numeric := NULL;
  v_item_fee numeric;
  v_has_explicit_fee boolean := false;
  v_all_items_free boolean := true;
  v_clean_payment_method text;
  v_clean_coupon text := NULL;
  v_clean_var_id uuid;
  v_item_qty int;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT *
    INTO existing_session
    FROM public.checkout_sessions
    WHERE idempotency_key = trim(_idempotency_key)
      AND expires_at > now()
      AND status IN ('active', 'pending', 'payment_pending', 'payment_cancelled', 'payment_failed')
    LIMIT 1;

    IF existing_session.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'session_id', existing_session.session_id,
        'subtotal', existing_session.subtotal,
        'shipping_fee', existing_session.shipping_fee,
        'cod_fee', existing_session.cod_fee,
        'discount', existing_session.discount,
        'total', existing_session.total,
        'currency', existing_session.currency,
        'payment_method', existing_session.payment_method,
        'status', existing_session.status,
        'expires_at', existing_session.expires_at,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate Items & Compute Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Checkout items cannot be empty.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := COALESCE(item.qty, item.quantity, 0);
    IF v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

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
      SELECT pv.id AS variant_id,
             COALESCE(pv.price_override, p.price) AS price,
             COALESCE(pv.mrp_override, p.mrp) AS mrp,
             pv.sku AS variant_sku,
             pv.barcode AS variant_barcode,
             pv.color AS variant_color,
             pv.size AS variant_size,
             pv.name AS variant_name,
             pv.image_url AS variant_image,
             pv.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT NULL::uuid AS variant_id,
             p.price,
             p.mrp,
             p.sku AS variant_sku,
             p.barcode AS variant_barcode,
             NULL::text AS variant_color,
             NULL::text AS variant_size,
             'Default' AS variant_name,
             (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS variant_image,
             p.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND p.id::text = item.product_id)
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product item not found in catalog.';
    END IF;

    IF variant.stock < v_item_qty THEN
      RAISE EXCEPTION 'Item "%" is out of stock or requested quantity exceeds available inventory.', variant.product_name;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * v_item_qty);

    item_obj := jsonb_build_object(
      'product_id', variant.p_id,
      'variant_id', variant.variant_id,
      'product_name', variant.product_name,
      'product_slug', variant.product_slug,
      'variant_sku', variant.variant_sku,
      'variant_barcode', variant.variant_barcode,
      'variant_color', variant.variant_color,
      'variant_size', variant.variant_size,
      'price', variant.price,
      'mrp', variant.mrp,
      'qty', v_item_qty,
      'line_subtotal', (variant.price * v_item_qty),
      'image_url', variant.variant_image
    );

    validated_items := validated_items || jsonb_build_array(item_obj);
  END LOOP;

  -- 4. Dynamic Coupon OR Store Credit Voucher Evaluation
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
        v_clean_coupon := coupon_record.code;
      ELSE
        v_clean_coupon := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      -- Check if it's a Store Credit or Exchange Voucher
      SELECT 
        id, customer_id, customer_phone,
        refund_amount, credit_used,
        GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
        expires_at, credit_token_status
      INTO v_voucher
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(_coupon_code))
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_voucher.id IS NULL THEN
        SELECT 
          id, customer_id, customer_phone,
          original_amount AS refund_amount, 0 AS credit_used,
          remaining_balance, expires_at, status AS credit_token_status
        INTO v_voucher
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = UPPER(TRIM(_coupon_code))
        LIMIT 1;
      END IF;

      IF v_voucher.id IS NULL THEN
        SELECT 
          id, customer_id, customer_phone,
          initial_amount AS refund_amount, 0 AS credit_used,
          current_balance AS remaining_balance, expires_at, 'ACTIVE' AS credit_token_status
        INTO v_voucher
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = UPPER(TRIM(_coupon_code))
        LIMIT 1;
      END IF;

      IF v_voucher.id IS NOT NULL THEN
        IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
          RAISE EXCEPTION 'Voucher % has expired.', UPPER(TRIM(_coupon_code));
        END IF;

        IF v_voucher.remaining_balance <= 0 OR v_voucher.credit_token_status IN ('CONSUMED', 'redeemed') THEN
          RAISE EXCEPTION 'Voucher % has already been fully redeemed.', UPPER(TRIM(_coupon_code));
        END IF;

        -- Strictly verify customer ownership
        IF NOT public.verify_voucher_customer_ownership(
          v_voucher.customer_id,
          v_voucher.customer_phone,
          uid,
          _phone
        ) THEN
          RAISE EXCEPTION 'This voucher is not available for this customer.';
        END IF;

        computed_discount := LEAST(v_voucher.remaining_balance, computed_subtotal);
        v_clean_coupon := UPPER(TRIM(_coupon_code));
      ELSE
        v_clean_coupon := NULL;
      END IF;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Read Shipping Settings from site_settings (Synchronized)
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_charge' LIMIT 1;
  IF v_raw_val IS NULL THEN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee' LIMIT 1;
  END IF;
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := trim(v_raw_val)::numeric;
  ELSE
    std_shipping := 65;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold' LIMIT 1;
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    free_shipping_threshold := trim(v_raw_val)::numeric;
  ELSE
    free_shipping_threshold := 999;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
  IF v_raw_val IS NOT NULL THEN
    free_delivery_enabled := (lower(trim(v_raw_val)) = 'true');
  ELSE
    free_delivery_enabled := true;
  END IF;

  -- 6. Check per-product custom delivery fee overrides
  SELECT value INTO v_delivery_fees_raw FROM public.site_settings WHERE key = 'product_delivery_fees' LIMIT 1;
  IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
    BEGIN
      v_delivery_fees := v_delivery_fees_raw::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_delivery_fees := '{}'::jsonb;
    END;
  ELSE
    v_delivery_fees := '{}'::jsonb;
  END IF;

  FOR item_elem IN SELECT value FROM jsonb_array_elements(validated_items) LOOP
    v_item_fee := NULL;
    IF v_delivery_fees ? (item_elem->>'product_id') THEN
      v_item_fee := (v_delivery_fees->>(item_elem->>'product_id'))::numeric;
    ELSIF v_delivery_fees ? (item_elem->>'product_slug') THEN
      v_item_fee := (v_delivery_fees->>(item_elem->>'product_slug'))::numeric;
    END IF;

    IF v_item_fee IS NOT NULL THEN
      v_has_explicit_fee := true;
      IF v_item_fee > 0 THEN
        v_all_items_free := false;
        IF v_custom_shipping IS NULL OR v_item_fee > v_custom_shipping THEN
          v_custom_shipping := v_item_fee;
        END IF;
      END IF;
    ELSE
      v_all_items_free := false;
    END IF;
  END LOOP;

  IF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSIF v_custom_shipping IS NOT NULL THEN
    shipping := v_custom_shipping;
  ELSE
    IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
      shipping := 0;
    ELSE
      shipping := std_shipping;
    END IF;
  END IF;

  -- 7. Payment method validation
  v_clean_payment_method := lower(COALESCE(NULLIF(trim(_payment_method), ''), 'online'));
  IF v_clean_payment_method NOT IN ('online', 'cod') THEN
    v_clean_payment_method := 'online';
  END IF;

  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.id IS NOT NULL THEN
    IF v_clean_payment_method = 'cod' THEN
      IF NOT ps_rec.cod_enabled THEN
        RAISE EXCEPTION 'Cash on Delivery is currently disabled by store management.';
      END IF;
      IF ps_rec.cod_min_order_value IS NOT NULL AND ps_rec.cod_min_order_value > 0 AND net_subtotal < ps_rec.cod_min_order_value THEN
        RAISE EXCEPTION 'Minimum order amount for COD is ₹%', ps_rec.cod_min_order_value;
      END IF;
      IF ps_rec.cod_max_order_value IS NOT NULL AND ps_rec.cod_max_order_value > 0 AND net_subtotal > ps_rec.cod_max_order_value THEN
        RAISE EXCEPTION 'Maximum order amount for COD is ₹%', ps_rec.cod_max_order_value;
      END IF;
      cod_fee := COALESCE(ps_rec.cod_fee, 0);
    END IF;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.checkout_sessions (
    session_id,
    user_id,
    idempotency_key,
    items,
    customer_details,
    subtotal,
    shipping_fee,
    cod_fee,
    discount,
    total,
    coupon_code,
    payment_method,
    status,
    expires_at
  ) VALUES (
    v_session_id,
    uid,
    _idempotency_key,
    validated_items,
    jsonb_build_object(
      'full_name', trim(_full_name),
      'email', trim(_email),
      'phone', trim(_phone),
      'alt_phone', trim(COALESCE(_alt_phone, '')),
      'address', trim(_address),
      'address_line2', trim(COALESCE(_address_line2, '')),
      'landmark', trim(COALESCE(_landmark, '')),
      'city', trim(_city),
      'state', trim(_state),
      'pincode', trim(_pincode),
      'notes', trim(COALESCE(_notes, ''))
    ),
    computed_subtotal,
    shipping,
    cod_fee,
    computed_discount,
    computed_total,
    v_clean_coupon,
    v_clean_payment_method,
    'active',
    now() + interval '30 minutes'
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'subtotal', computed_subtotal,
    'shipping_fee', shipping,
    'cod_fee', cod_fee,
    'discount', computed_discount,
    'total', computed_total,
    'currency', 'INR',
    'payment_method', v_clean_payment_method,
    'status', 'active',
    'expires_at', (now() + interval '30 minutes')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_session(
  jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated, anon, service_role;
