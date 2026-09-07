-- ==============================================================================
-- Migration: 20260928000126_audit_bug_fixes.sql
-- Description:
-- 1. Fix validate_coupon: Clamp fixed discount coupons to min(discount_value, order_total)
-- 2. Fix cancel_abandoned_order: Restore stock for standalone products without variants
--    and record accurate variant quantities in inventory_transactions.
-- 3. Fix create_checkout_session: Accept variant_id as text, handle empty string gracefully,
--    and add direct fallback to products table for standalone products without variants.
-- 4. Fix place_order: Record variant's stock instead of parent product stock in
--    inventory_transactions for variant lines.
-- 5. Fix place_offline_sale: Record variant's stock instead of parent product stock in
--    inventory_transactions for variant lines.
-- ==============================================================================

-- 1. validate_coupon: Clamp fixed discount
CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _user_id uuid, _order_total numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  user_uses integer;
  discount numeric := 0;
  clean_code text;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon code is required');
  END IF;

  clean_code := upper(trim(_code));

  SELECT * INTO c FROM public.coupons WHERE upper(code) = clean_code AND COALESCE(is_active, active, true) = true;
  IF NOT FOUND THEN 
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid coupon code'); 
  END IF;

  IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN 
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon not yet active'); 
  ELSIF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon not yet active');
  END IF;

  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN 
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon has expired'); 
  ELSIF c.expires_at IS NOT NULL AND now() > c.expires_at THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon has expired');
  END IF;

  IF COALESCE(c.max_uses, c.usage_limit, 0) > 0 AND COALESCE(c.used_count, c.usage_count, 0) >= COALESCE(c.max_uses, c.usage_limit) THEN 
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon usage limit reached'); 
  END IF;

  IF _order_total < COALESCE(c.min_order_amount, c.minimum_order_value, 0) THEN 
    RETURN jsonb_build_object('valid', false, 'error', 'Minimum order value is ₹' || COALESCE(c.min_order_amount, c.minimum_order_value, 0)); 
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT count(*) INTO user_uses FROM public.coupon_usage WHERE coupon_id = c.id AND user_id = _user_id;
    IF c.per_user_limit > 0 AND user_uses >= c.per_user_limit THEN 
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this coupon'); 
    END IF;
  END IF;

  -- Safe type check for percentage discount & clamp fixed discount
  IF lower(c.discount_type::text) IN ('percentage', 'percent') THEN
    discount := ROUND((_order_total * c.discount_value) / 100, 0);
    IF COALESCE(c.max_discount_amount, c.maximum_discount, 0) > 0 AND discount > COALESCE(c.max_discount_amount, c.maximum_discount) THEN 
      discount := COALESCE(c.max_discount_amount, c.maximum_discount); 
    END IF;
  ELSE
    discount := LEAST(c.discount_value, GREATEST(0, _order_total));
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', c.code,
    'coupon_id', c.id,
    'discount_type', c.discount_type::text,
    'discount_value', c.discount_value,
    'discount', discount,
    'minimum_order_value', COALESCE(c.min_order_amount, c.minimum_order_value, 0),
    'maximum_discount', COALESCE(c.max_discount_amount, c.maximum_discount, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon TO anon, authenticated, service_role;

-- 2. cancel_abandoned_order: Support products without variants
CREATE OR REPLACE FUNCTION public.cancel_abandoned_order(order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  item record;
  variant record;
  prod_record record;
BEGIN
  -- Fetch the order
  SELECT * INTO ord FROM public.orders WHERE id = order_id;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ensure ownership if authenticated
  IF uid IS NOT NULL AND ord.user_id IS NOT NULL AND ord.user_id != uid THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  -- Only allow if it's placed/pending and online payment
  IF ord.status NOT IN ('placed', 'pending') OR ord.payment_method != 'online' THEN
    RAISE EXCEPTION 'Order cannot be cancelled. Status: %, Payment: %', ord.status, ord.payment_method;
  END IF;

  -- If payment was already completed, do not allow abandoned cancellation
  IF ord.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Cannot cancel order with completed payment';
  END IF;

  -- 1. Atomically restore stock for all items
  FOR item IN SELECT * FROM public.order_items WHERE public.order_items.order_id = cancel_abandoned_order.order_id LOOP
    variant := NULL;
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id
      FOR UPDATE OF v, p;

      IF variant.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + item.qty
        WHERE id = variant.variant_id;

        UPDATE public.products
        SET stock = stock + item.qty
        WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'adjustment'::public.inventory_tx_type, item.qty, variant.v_stock, variant.v_stock + item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
        );
      END IF;
    ELSE
      -- Try matching variant by slug or id
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1
      FOR UPDATE OF v, p;

      IF variant.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + item.qty
        WHERE id = variant.variant_id;

        UPDATE public.products
        SET stock = stock + item.qty
        WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'adjustment'::public.inventory_tx_type, item.qty, variant.v_stock, variant.v_stock + item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
        );
      ELSE
        -- Standalone product without variants
        SELECT p.id AS p_id, p.stock AS p_stock
        INTO prod_record
        FROM public.products p
        WHERE p.id = item.product_id OR p.slug = item.product_slug OR p.id::text = item.product_slug
        LIMIT 1
        FOR UPDATE OF p;

        IF prod_record.p_id IS NOT NULL THEN
          UPDATE public.products
          SET stock = stock + item.qty
          WHERE id = prod_record.p_id;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            prod_record.p_id, NULL, 'adjustment'::public.inventory_tx_type, item.qty, prod_record.p_stock, prod_record.p_stock + item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Restore coupon use count if applied
  IF ord.coupon_code IS NOT NULL AND trim(ord.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = GREATEST(0, used_count - 1)
    WHERE UPPER(code) = UPPER(trim(ord.coupon_code));
  END IF;

  -- 3. Update status to cancelled
  UPDATE public.orders
  SET
    status = 'cancelled',
    payment_status = 'failed',
    cancellation_reason = 'Payment abandoned or window closed',
    cancelled_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (order_id, 'cancelled', 'Order cancelled due to abandoned payment window', uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid) TO authenticated, anon;

-- 3. create_checkout_session: Safe item parsing & standalone product fallback
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
  uid uuid;
  item record;
  variant record;
  computed_subtotal numeric := 0;
  computed_mrp_total numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  cod_fee numeric := 0;
  net_subtotal numeric := 0;
  std_shipping numeric := 79;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_clean_idem text;
  v_session_id text;
  v_clean_payment_method text;
  existing_session record;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
  item_image text;
  ps_rec record;
  v_clean_variant_id uuid;
  v_raw_val text;
BEGIN
  -- 1. Authenticate or Resolve Anonymous User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
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

    -- If not found by variant_id, try matching variant by product_slug or product_id
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

    -- If still no variant, check if product exists directly in products table (standalone)
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

  -- 4. Dynamic Coupon Evaluation
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
      ELSE
        _coupon_code := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      _coupon_code := NULL;
    END IF;
  END IF;

  -- 5. Shipping Policy Calculation
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

  -- 6. Payment Method & COD Fee Enforcement
  v_clean_payment_method := lower(trim(COALESCE(_payment_method, 'online')));
  IF v_clean_payment_method = 'cod' THEN
    SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
    IF ps_rec.id IS NOT NULL AND ps_rec.cod_enabled = false THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled.';
    END IF;
    IF ps_rec.id IS NOT NULL AND ps_rec.cod_min_order_value > 0 AND computed_subtotal < ps_rec.cod_min_order_value THEN
      RAISE EXCEPTION 'Order subtotal is below the minimum required for COD (₹%).', ps_rec.cod_min_order_value;
    END IF;
    IF ps_rec.id IS NOT NULL AND ps_rec.cod_max_order_value > 0 AND computed_subtotal > ps_rec.cod_max_order_value THEN
      RAISE EXCEPTION 'Order subtotal exceeds the maximum allowed for COD (₹%).', ps_rec.cod_max_order_value;
    END IF;
    cod_fee := COALESCE(ps_rec.cod_fee, 0);
  ELSE
    v_clean_payment_method := 'online';
    cod_fee := 0;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || to_char(now(), 'YYYYMMDD') || '_' || encode(gen_random_bytes(12), 'hex');

  -- 7. Persist Validated Session
  INSERT INTO public.checkout_sessions (
    session_id, user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    items, subtotal, discount, shipping_fee, cod_fee, total,
    currency, coupon_code, payment_method, notes, idempotency_key,
    status, expires_at
  ) VALUES (
    v_session_id, uid, trim(_full_name), trim(_email), trim(_phone), NULLIF(trim(_alt_phone), ''),
    trim(_address), NULLIF(trim(_address_line2), ''), NULLIF(trim(_landmark), ''), trim(_city), trim(_state), trim(_pincode),
    validated_items, computed_subtotal, computed_discount, shipping, cod_fee, computed_total,
    'INR', _coupon_code, v_clean_payment_method, NULLIF(trim(_notes), ''), v_clean_idem,
    'active', now() + interval '30 minutes'
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
    'expires_at', (now() + interval '30 minutes'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_session TO anon, authenticated, service_role;

-- 4. place_order: Record variant's individual stock in inventory_transactions
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

    variant := NULL;
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
    variant := NULL;
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

-- 5. place_offline_sale: Accurate variant stock in inventory_transactions
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
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_order_token_num int;
  v_order_token_dt date;
  v_existing_sale record;
  v_item record;
  v_subtotal numeric := 0;
  v_bill_only_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_total_discount numeric := 0;
  v_total numeric := 0;
  v_item_price numeric := 0;
  v_prod_id uuid;
  v_prod_stock int;
  v_prod_name text;
  v_prod_sku text;
  v_prod_barcode text;
  v_prod_mrp numeric;
  v_var_id uuid;
  v_var_stock int;
  v_buying_price numeric := 0;
  v_is_uuid boolean;
  v_is_var_uuid boolean;
  v_credit_rec record;
  v_credit_to_use numeric := 0;
  v_voucher_avail numeric := 0;
  v_new_voucher_used numeric := 0;
  v_new_voucher_balance numeric := 0;
  v_coupon_rec record;
  v_clean_coupon text;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_total_variant_stock int;
  v_item_mrp numeric;
  v_line_gross numeric;
  v_alloc_bill numeric;
  v_alloc_coupon numeric;
  v_final_unit_paid numeric;
  v_item_qty int;
BEGIN
  -- 1. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method, customer_name, customer_phone, pos_token_number
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
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_phone', v_existing_sale.customer_phone,
        'pos_token_number', v_existing_sale.pos_token_number,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot place sale with empty items';
  END IF;

  -- 3. Calculate Subtotal
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_subtotal := v_subtotal + (v_item_price * COALESCE(v_item.qty, 1));
  END LOOP;

  -- 4. Calculate Bill-Level Discount
  IF _discount_type = 'percentage' OR _discount_type = 'percent' THEN
    v_bill_only_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' OR _discount_type = 'flat' THEN
    v_bill_only_discount := LEAST(COALESCE(_discount_value, 0), v_subtotal);
  ELSE
    v_bill_only_discount := 0;
  END IF;

  -- 5. Calculate Coupon Discount
  v_clean_coupon := NULLIF(trim(upper(COALESCE(_coupon_code, ''))), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO v_coupon_rec
    FROM public.coupons
    WHERE upper(code) = v_clean_coupon AND is_active = true
    FOR UPDATE;

    IF v_coupon_rec.id IS NOT NULL THEN
      IF (v_coupon_rec.valid_from IS NULL OR now() >= v_coupon_rec.valid_from) AND
         (v_coupon_rec.valid_until IS NULL OR now() <= v_coupon_rec.valid_until) AND
         (v_coupon_rec.usage_limit IS NULL OR v_coupon_rec.usage_limit = 0 OR v_coupon_rec.used_count < v_coupon_rec.usage_limit) AND
         (v_coupon_rec.min_order_amount IS NULL OR v_subtotal >= v_coupon_rec.min_order_amount) THEN

        IF v_coupon_rec.discount_type = 'percent' OR v_coupon_rec.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_rec.discount_value) / 100, 2);
          IF v_coupon_rec.max_discount_amount IS NOT NULL AND v_coupon_rec.max_discount_amount > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_rec.max_discount_amount);
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_coupon_rec.discount_value, v_subtotal);
        END IF;

        UPDATE public.coupons
        SET used_count = used_count + 1
        WHERE id = v_coupon_rec.id;
      END IF;
    END IF;
  END IF;

  v_total_discount := v_bill_only_discount + v_coupon_discount;
  v_total := GREATEST(0, v_subtotal - v_total_discount);

  -- 6. Store Credit / Voucher Settlement
  v_credit_to_use := 0;
  IF v_clean_token != '' THEN
    SELECT * INTO v_credit_rec
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
    FOR UPDATE;

    IF v_credit_rec.id IS NOT NULL THEN
      IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
        UPDATE public.offline_returns SET credit_token_status = 'EXPIRED', updated_at = now() WHERE id = v_credit_rec.id;
        RAISE EXCEPTION 'Voucher % has expired on % and cannot be redeemed', v_clean_token, to_char(v_credit_rec.expires_at, 'DD Mon YYYY');
      END IF;

      IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
        RAISE EXCEPTION 'Voucher % has already been fully redeemed', v_clean_token;
      END IF;

      v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));
      v_credit_to_use := LEAST(COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail), v_voucher_avail, v_total);

      IF v_credit_to_use > 0 THEN
        v_new_voucher_used := COALESCE(v_credit_rec.credit_used, 0) + v_credit_to_use;
        v_new_voucher_balance := GREATEST(0, v_credit_rec.refund_amount - v_new_voucher_used);

        UPDATE public.offline_returns
        SET credit_used = v_new_voucher_used,
            credit_balance = v_new_voucher_balance,
            credit_token_status = CASE WHEN v_new_voucher_balance <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
            updated_at = now()
        WHERE id = v_credit_rec.id;
      END IF;
    END IF;

  ELSIF _customer_id IS NOT NULL AND COALESCE(_store_credit_used, 0) > 0 THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
    FROM public.pos_customers
    WHERE id = _customer_id
    FOR UPDATE;

    v_credit_to_use := LEAST(COALESCE(_store_credit_used, 0), COALESCE(v_voucher_avail, 0), v_total);
    IF v_credit_to_use > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_credit_to_use),
          store_credit = GREATEST(0, store_credit_balance - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 7. Generate Daily Token & Sale Number
  v_order_token_dt := CURRENT_DATE;
  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  v_sale_number := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(v_order_token_num::text, 5, '0');

  -- 8. Insert Offline Sale Record
  INSERT INTO public.offline_sales (
    sale_number, customer_name, customer_phone, customer_email, payment_method, notes,
    discount_type, discount_value, customer_id, idempotency_key, store_credit_used,
    credit_token, credit_token_used, coupon_code, coupon_discount, subtotal, discount,
    total, status, pos_token_number, pos_token_date, created_by, created_at
  ) VALUES (
    v_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_payment_method), ''), 'cash'),
    COALESCE(trim(_notes), ''),
    COALESCE(NULLIF(trim(_discount_type), ''), 'none'),
    COALESCE(_discount_value, 0),
    _customer_id,
    _idempotency_key,
    v_credit_to_use,
    v_clean_token,
    v_clean_token,
    v_clean_coupon,
    v_coupon_discount,
    v_subtotal,
    v_total_discount,
    v_total,
    'completed',
    v_order_token_num,
    v_order_token_dt,
    uid,
    now()
  )
  RETURNING id INTO v_sale_id;

  -- 9. Insert Single Redemption Ledger Entry
  IF v_credit_to_use > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id, customer_name, customer_phone, credit_token, type, amount,
      balance_before, balance_after, source_return_id, used_in_sale_id, notes,
      created_by, created_at
    ) VALUES (
      COALESCE(_customer_id, v_credit_rec.customer_id),
      COALESCE(NULLIF(trim(_customer_name), ''), v_credit_rec.customer_name, 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), v_credit_rec.customer_phone, ''),
      v_clean_token,
      'CREDIT_REDEEMED',
      v_credit_to_use,
      v_voucher_avail,
      GREATEST(0, v_voucher_avail - v_credit_to_use),
      v_credit_rec.id,
      v_sale_id,
      'Voucher ' || v_clean_token || ' redeemed in POS Sale #' || v_sale_number,
      uid,
      now()
    );

    IF _customer_id IS NOT NULL AND v_clean_token != '' THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_credit_to_use),
          store_credit = GREATEST(0, store_credit_balance - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 10. Insert Line Items with Historical Pricing Snapshots & Deduct Inventory
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    mrp numeric,
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_is_uuid := v_item.product_id IS NOT NULL AND v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    v_is_var_uuid := v_item.variant_id IS NOT NULL AND v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    v_prod_id := NULL;
    v_prod_stock := NULL;
    v_prod_name := v_item.name;
    v_prod_sku := v_item.sku;
    v_prod_barcode := NULL;
    v_prod_mrp := COALESCE(v_item.mrp, 0);
    v_var_id := NULL;
    v_var_stock := NULL;
    v_buying_price := 0;

    IF v_is_uuid THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(p.mrp, 0), COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_prod_mrp, v_buying_price
      FROM public.products p
      LEFT JOIN public.product_costs c ON c.product_id = p.id
      WHERE p.id = v_item.product_id::uuid
      FOR UPDATE OF p;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(p.mrp, 0), COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_prod_mrp, v_buying_price
      FROM public.products p
      LEFT JOIN public.product_costs c ON c.product_id = p.id
      WHERE p.slug = v_item.product_slug
      LIMIT 1
      FOR UPDATE OF p;
    END IF;

    IF v_is_var_uuid THEN
      SELECT id, stock, name, sku, barcode
      INTO v_var_id, v_var_stock, v_prod_name, v_prod_sku, v_prod_barcode
      FROM public.product_variants
      WHERE id = v_item.variant_id::uuid
      FOR UPDATE;
    END IF;

    v_item_qty  := COALESCE(v_item.qty, 1);
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_item_mrp   := COALESCE(v_prod_mrp, v_item.mrp, v_item_price, 0);

    v_line_gross := v_item_price * v_item_qty;

    v_alloc_bill := CASE
      WHEN v_subtotal > 0 THEN ROUND((v_line_gross / v_subtotal) * v_bill_only_discount / v_item_qty, 4)
      ELSE 0
    END;

    v_alloc_coupon := CASE
      WHEN v_subtotal > 0 THEN ROUND((v_line_gross / v_subtotal) * v_coupon_discount / v_item_qty, 4)
      ELSE 0
    END;

    v_final_unit_paid := GREATEST(0, ROUND(v_item_price - v_alloc_bill - v_alloc_coupon, 2));

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, variant_id, product_slug, name, sku, barcode, qty, price,
      subtotal, buying_price, unit_mrp, unit_selling_price, line_gross_amount,
      product_discount_amount, allocated_bill_discount, allocated_coupon_discount,
      final_unit_paid_price, quantity_sold, quantity_returned, created_at
    ) VALUES (
      v_sale_id, v_prod_id, v_var_id, COALESCE(NULLIF(v_item.product_slug, ''), 'custom-item'),
      COALESCE(v_prod_name, v_item.name, 'Custom Item'), COALESCE(v_prod_sku, v_item.sku, ''),
      COALESCE(v_prod_barcode, ''), v_item_qty, v_item_price, v_item_price * v_item_qty,
      v_buying_price, v_item_mrp, v_item_price, v_line_gross, 0, v_alloc_bill,
      v_alloc_coupon, v_final_unit_paid, v_item_qty, 0, now()
    );

    -- Inventory Deduction & Accurate Variant Tracking
    IF v_prod_id IS NOT NULL THEN
      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - v_item_qty),
            updated_at = now()
        WHERE id = v_var_id;

        SELECT COALESCE(SUM(stock), 0) INTO v_total_variant_stock
        FROM public.product_variants
        WHERE product_id = v_prod_id;

        UPDATE public.products
        SET stock = v_total_variant_stock,
            updated_at = now()
        WHERE id = v_prod_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, transaction_type, quantity,
          previous_quantity, new_quantity, reference_type, reference_id,
          note, notes, created_by
        ) VALUES (
          v_prod_id, v_var_id, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          -v_item_qty, COALESCE(v_var_stock, 0), GREATEST(0, COALESCE(v_var_stock, 0) - v_item_qty),
          'offline_sale', v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
          uid
        );
      ELSE
        UPDATE public.products
        SET stock = GREATEST(0, stock - v_item_qty),
            updated_at = now()
        WHERE id = v_prod_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, transaction_type, quantity,
          previous_quantity, new_quantity, reference_type, reference_id,
          note, notes, created_by
        ) VALUES (
          v_prod_id, NULL, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          -v_item_qty, COALESCE(v_prod_stock, 0), GREATEST(0, COALESCE(v_prod_stock, 0) - v_item_qty),
          'offline_sale', v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 11. Update Customer Aggregate Metrics
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spend = COALESCE(total_spend, 0) + v_total,
        last_visit_date = now(),
        updated_at = now()
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_total_discount,
    'store_credit_used', v_credit_to_use,
    'payable_after_credit', GREATEST(0, v_total - v_credit_to_use),
    'credit_token_used', v_clean_token,
    'payment_method', _payment_method,
    'customer_name', _customer_name,
    'customer_phone', _customer_phone,
    'pos_token_number', v_order_token_num,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;
