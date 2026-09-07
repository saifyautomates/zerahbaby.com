-- ==============================================================================
-- Migration: 20260928000117_allow_guest_order_user_id_null.sql
-- Description:
-- 1. Allow public.orders.user_id to be NULL for guest checkouts so foreign key
--    constraints are never violated when an anonymous buyer places an order.
-- 2. Update public.place_order RPC to leave uid as NULL instead of dummy 0000-uuid.
-- ==============================================================================

-- 1. Allow user_id in orders to be nullable for guest checkout
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;

-- 2. Update place_order with safe guest checkout uid handling
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
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  v_item_buying_price numeric := 0;
  v_initial_payment_status public.payment_status;
  item_image text;
  v_clean_idem text;
  v_raw_val text;
  v_prev_stock int;
  v_new_stock int;
  existing_order record;
BEGIN
  -- 1. Authenticate or Resolve Anonymous / Guest User
  uid := auth.uid();
  IF uid IS NULL THEN
    IF _email IS NOT NULL AND trim(_email) != '' THEN
      SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
    END IF;
    IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
      SELECT id INTO uid FROM public.profiles WHERE lower(email) = lower(trim(_email)) LIMIT 1;
    END IF;
    -- Note: If user does not exist in auth.users, keep uid as NULL for guest checkout
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO existing_order
    FROM public.orders
    WHERE idempotency_key = v_clean_idem
       OR notes LIKE '%[idem:' || v_clean_idem || ']%'
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

  -- 3. Validate Items & Compute Subtotal
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
             v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id;
    ELSE
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
             v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1;
    END IF;

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Product variant not found for item: %', COALESCE(item.variant_id::text, item.product_slug);
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  -- 4. Dynamic Coupon Evaluation with Type-Safe Comparison
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

        -- Safe check using ::text IN ('percent', 'percentage')
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

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Dynamic Free Delivery Evaluation
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF v_raw_val IS NOT NULL THEN
    fd_threshold := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'is_free_delivery_enabled';
  IF v_raw_val IS NOT NULL THEN
    is_fd_enabled := (v_raw_val = 'true');
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_fee';
  IF v_raw_val IS NOT NULL THEN
    std_shipping := v_raw_val::numeric;
  END IF;

  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := net_subtotal + shipping;

  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  IF _payment_method = 'paid' OR _payment_method = 'online_paid' THEN
    v_initial_payment_status := 'paid'::public.payment_status;
  ELSE
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 6. Insert Order Record (uid can be NULL for guest checkout)
  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping, discount, total, coupon_code, status, payment_method, payment_status,
    full_name, email, phone, alt_phone, address, address_line2, landmark, city, state, pincode, notes, idempotency_key
  ) VALUES (
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, computed_discount, computed_total, _coupon_code, 'placed'::public.order_status, COALESCE(_payment_method, 'online'), 
    v_initial_payment_status,
    _full_name, _email, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode,
    CASE WHEN v_clean_idem IS NOT NULL THEN COALESCE(_notes, '') || ' [idem:' || v_clean_idem || ']' ELSE _notes END,
    v_clean_idem
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully', uid);

  -- 7. Insert Items, Deduct Stock & Capture Historical Buying Price Snapshot
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int) LOOP
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
             v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS v_stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id
      FOR UPDATE OF v, p;
    ELSE
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
             v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS v_stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1
      FOR UPDATE OF v, p;
    END IF;

    -- Fetch historical buying price
    SELECT COALESCE(buying_price, 0) INTO v_item_buying_price
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

    v_prev_stock := variant.p_stock;
    v_new_stock := GREATEST(0, variant.p_stock - item.qty);

    -- Atomic decrement on variant
    UPDATE public.product_variants
    SET stock = GREATEST(0, stock - item.qty)
    WHERE id = variant.variant_id;

    -- Atomic decrement on parent product
    UPDATE public.products
    SET stock = v_new_stock
    WHERE id = variant.p_id;

    -- Log transaction
    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock, 'order', new_order_id,
      'Order ' || new_order_number, uid
    );
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
