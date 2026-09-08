-- =============================================================================
-- CRITICAL FIX: create_checkout_session must read shipping settings from
-- site_settings table, NOT use hardcoded constants.
-- 
-- ROOT CAUSE OF ₹99 MISMATCH:
--   The previous create_checkout_session had:
--     free_shipping_threshold := 999;
--     std_shipping := 99;
--   But the frontend cart reads site_settings which may have different values
--   (e.g., free_delivery_enabled = true, threshold = 699, shipping = 0 etc.)
--   This caused the checkout UI to show ₹699 (FREE shipping) but
--   Razorpay to charge ₹798 (₹699 + ₹99 hardcoded shipping).
--
-- FIX: Read all shipping settings from site_settings, with safe fallbacks.
--      The authoritative total stored in checkout_sessions.total is what
--      create-razorpay-order edge function uses. So this IS the root fix.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_checkout_session(text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) CASCADE;

CREATE OR REPLACE FUNCTION public.create_checkout_session(
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
  uid uuid := auth.uid();
  item record;
  variant record;
  coupon_record record;
  existing_session record;
  v_session_id text;
  v_clean_idem text;
  v_clean_coupon text;
  v_clean_payment_method text;
  v_clean_variant_id uuid;
  computed_subtotal numeric := 0;
  computed_mrp_total numeric := 0;
  computed_discount numeric := 0;
  shipping numeric := 0;
  cod_fee numeric := 0;
  computed_total numeric := 0;
  net_subtotal numeric := 0;

  -- Shipping config from site_settings (authoritative source, same as frontend)
  free_shipping_threshold numeric := 999;  -- safe fallback
  std_shipping numeric := 99;              -- safe fallback
  free_delivery_enabled boolean := true;   -- safe fallback

  v_raw_val text;
  ps_rec record;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
  item_image text;
  user_usages int := 0;
BEGIN
  -- 1. Validate Customer Details
  IF _full_name IS NULL OR trim(_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF _phone IS NULL OR trim(_phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required.';
  END IF;
  IF _address IS NULL OR trim(_address) = '' THEN
    RAISE EXCEPTION 'Shipping address is required.';
  END IF;
  IF _pincode IS NULL OR trim(_pincode) = '' THEN
    RAISE EXCEPTION 'Pincode is required.';
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO existing_session
    FROM public.checkout_sessions
    WHERE idempotency_key = v_clean_idem
      AND status IN ('active', 'payment_pending', 'payment_cancelled', 'payment_failed')
      AND expires_at > now()
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

  -- 3. Validate Items & Compute Authoritative Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Checkout must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    variant := NULL;
    v_clean_variant_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_variant_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
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
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
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

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
    computed_mrp_total := computed_mrp_total + (variant.mrp * item.qty);

    item_obj := jsonb_build_object(
      'variant_id', variant.variant_id,
      'product_id', variant.p_id,
      'product_slug', variant.product_slug,
      'product_name', variant.product_name,
      'variant_sku', variant.variant_sku,
      'variant_barcode', variant.variant_barcode,
      'variant_color', variant.variant_color,
      'variant_size', variant.variant_size,
      'price', variant.price,
      'mrp', variant.mrp,
      'qty', item.qty,
      'line_subtotal', (variant.price * item.qty),
      'image_url', item_image
    );

    validated_items := validated_items || jsonb_build_array(item_obj);
  END LOOP;

  -- 4. Dynamic Coupon Evaluation & Per-User Usage Limit Enforcement
  v_clean_coupon := NULLIF(trim(COALESCE(_coupon_code, '')), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(v_clean_coupon)
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      -- Validate temporal and threshold conditions
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        -- ENFORCE PER-USER USAGE LIMIT
        IF COALESCE(coupon_record.per_user_limit, 1) > 0 THEN
          SELECT count(*) INTO user_usages
          FROM public.coupon_usage cu
          WHERE cu.coupon_id = coupon_record.id
            AND (
              (uid IS NOT NULL AND cu.user_id = uid)
              OR (cu.phone = _phone)
              OR (_email IS NOT NULL AND _email != '' AND cu.email = _email)
            );

          IF user_usages >= COALESCE(coupon_record.per_user_limit, 1) THEN
            v_clean_coupon := NULL;
            computed_discount := 0;
          END IF;
        END IF;

        IF v_clean_coupon IS NOT NULL THEN
          IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
            computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
            IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
              computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
            END IF;
          ELSE
            computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
          END IF;
        END IF;
      ELSE
        v_clean_coupon := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      v_clean_coupon := NULL;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Read Shipping Settings from site_settings (AUTHORITATIVE — same as frontend)
  --    This eliminates the mismatch between frontend cart and server total.
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_charge' LIMIT 1;
  IF v_raw_val IS NULL THEN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee' LIMIT 1;
  END IF;
  IF v_raw_val IS NULL THEN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_fee' LIMIT 1;
  END IF;
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^\d+(\.\d+)?$' THEN
    std_shipping := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold' LIMIT 1;
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^\d+(\.\d+)?$' THEN
    free_shipping_threshold := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
  IF v_raw_val IS NULL THEN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'is_free_delivery_enabled' LIMIT 1;
  END IF;
  IF v_raw_val IS NOT NULL THEN
    free_delivery_enabled := lower(v_raw_val) NOT IN ('false', '0', 'no', 'off');
  END IF;

  -- 5b. Calculate Shipping Fee using site_settings values
  IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  -- 6. Calculate Cash on Delivery Fee
  v_clean_payment_method := lower(COALESCE(NULLIF(trim(_payment_method), ''), 'online'));
  IF v_clean_payment_method = 'cod' THEN
    SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
    IF ps_rec.cod_enabled = false THEN
      RAISE EXCEPTION 'Cash on Delivery is currently unavailable.';
    END IF;

    IF ps_rec.cod_min_order_value > 0 AND net_subtotal < ps_rec.cod_min_order_value THEN
      RAISE EXCEPTION 'Minimum order value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
    END IF;

    IF ps_rec.cod_max_order_value > 0 AND net_subtotal > ps_rec.cod_max_order_value THEN
      RAISE EXCEPTION 'Maximum order value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
    END IF;

    cod_fee := COALESCE(ps_rec.cod_fee, 0);
  ELSE
    cod_fee := 0;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.checkout_sessions (
    session_id, user_id, items, customer_details, subtotal, shipping_fee, cod_fee,
    discount, total, currency, payment_method, coupon_code, idempotency_key,
    status, expires_at
  ) VALUES (
    v_session_id,
    uid,
    validated_items,
    jsonb_build_object(
      'full_name', _full_name,
      'email', _email,
      'phone', _phone,
      'alt_phone', _alt_phone,
      'address', _address,
      'address_line2', _address_line2,
      'landmark', _landmark,
      'city', _city,
      'state', _state,
      'pincode', _pincode,
      'notes', _notes
    ),
    computed_subtotal,
    shipping,
    cod_fee,
    computed_discount,
    computed_total,
    'INR',
    v_clean_payment_method,
    v_clean_coupon,
    v_clean_idem,
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
    'expires_at', now() + interval '30 minutes',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_session(text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) TO anon, authenticated, service_role;
