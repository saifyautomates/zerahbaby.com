-- ==============================================================================
-- Migration: 20260928000213_global_shipping_65_and_per_product_delivery_sync.sql
-- Description:
-- 1. Sets global standard delivery fee to 65 in site_settings.
-- 2. Synchronizes existing product_delivery_fees entries (updating old 79 defaults to 65 while keeping 0 Free intact).
-- 3. Updates canonical place_order and create_checkout_session RPCs to:
--    a) Read standard_shipping_charge from public.site_settings (fallback 65).
--    b) Honor per-product delivery fees stored in site_settings.product_delivery_fees.
-- ==============================================================================

-- 1. Update site_settings global shipping keys to 65
INSERT INTO public.site_settings (key, value)
VALUES ('standard_shipping_charge', '65')
ON CONFLICT (key) DO UPDATE SET value = '65';

INSERT INTO public.site_settings (key, value)
VALUES ('shipping_fee', '65')
ON CONFLICT (key) DO UPDATE SET value = '65';

-- Update existing product_delivery_fees JSON map: migrate 79 -> 65
UPDATE public.site_settings
SET value = replace(value, ':79', ':65')
WHERE key = 'product_delivery_fees'
  AND value LIKE '%:79%';

-- Update page_shipping_delivery policy text to reflect ₹65
UPDATE public.site_settings
SET value = replace(value, '₹79', '₹65')
WHERE key = 'page_shipping_delivery'
  AND value LIKE '%₹79%';

-- 2. Canonical place_order RPC with ₹65 standard shipping and per-product delivery fee support
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
  std_shipping numeric := 65;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_raw_val text;
  v_delivery_fees_raw text;
  v_delivery_fees jsonb;
  v_custom_shipping numeric := NULL;
  v_item_fee numeric;
  v_has_explicit_fee boolean := false;
  v_all_items_free boolean := true;
  new_order_id uuid;
  new_order_number text;
  new_invoice text;
  existing_order record;
  v_initial_payment_status public.payment_status := 'pending'::public.payment_status;
  v_clean_idem text;
  v_item_buying_price numeric;
  item_image text;
  v_prev_stock int;
  v_new_stock int;
  v_clean_var_id uuid;
  v_item_qty int;
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    v_clean_idem := trim(_idempotency_key);
    SELECT id, invoice_no, order_number, total, payment_status, status
    INTO existing_order
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

  -- 3. Validate Items & Compute Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

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
      END IF;
    END IF;
  END IF;

  -- 5. Shipping Policy Calculation (Synchronized with site_settings and product_delivery_fees)
  BEGIN
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
      fd_threshold := trim(v_raw_val)::numeric;
    ELSE
      fd_threshold := 999;
    END IF;

    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
    IF v_raw_val IS NOT NULL THEN
      is_fd_enabled := lower(trim(v_raw_val)) NOT IN ('false', '0', 'no', 'off');
    ELSE
      is_fd_enabled := true;
    END IF;

    -- Evaluate per-product custom delivery fees
    SELECT value INTO v_delivery_fees_raw FROM public.site_settings WHERE key = 'product_delivery_fees' LIMIT 1;
    IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
      v_delivery_fees := v_delivery_fees_raw::jsonb;

      FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
        v_item_fee := NULL;
        IF item.product_id IS NOT NULL AND v_delivery_fees ? item.product_id THEN
          v_item_fee := (v_delivery_fees->>item.product_id)::numeric;
        ELSIF item.product_slug IS NOT NULL AND v_delivery_fees ? item.product_slug THEN
          v_item_fee := (v_delivery_fees->>item.product_slug)::numeric;
        ELSE
          IF item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            SELECT p.id::text, p.slug INTO variant
            FROM public.product_variants pv
            JOIN public.products p ON p.id = pv.product_id
            WHERE pv.id = item.variant_id::uuid
            LIMIT 1;
            IF variant.id IS NOT NULL AND v_delivery_fees ? variant.id THEN
              v_item_fee := (v_delivery_fees->>variant.id)::numeric;
            ELSIF variant.slug IS NOT NULL AND v_delivery_fees ? variant.slug THEN
              v_item_fee := (v_delivery_fees->>variant.slug)::numeric;
            END IF;
          END IF;
        END IF;

        IF v_item_fee IS NOT NULL THEN
          v_has_explicit_fee := true;
          IF v_item_fee > 0 THEN
            v_all_items_free := false;
            v_custom_shipping := GREATEST(COALESCE(v_custom_shipping, 0), v_item_fee);
          END IF;
        ELSE
          v_all_items_free := false;
        END IF;
      END LOOP;

      IF v_has_explicit_fee THEN
        IF v_all_items_free THEN
          v_custom_shipping := 0;
        ELSIF v_custom_shipping IS NULL THEN
          v_custom_shipping := std_shipping;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    std_shipping := 65;
    fd_threshold := 999;
    is_fd_enabled := true;
    v_custom_shipping := NULL;
  END;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);
  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := COALESCE(v_custom_shipping, std_shipping);
  END IF;

  computed_total := net_subtotal + shipping;

  -- 6. Generate Sequential Identifiers
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_invoice := 'INV-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  IF lower(COALESCE(_payment_method, 'online')) = 'cod' THEN
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 7. Insert Canonical Master Order
  INSERT INTO public.orders (
    user_id, full_name, email, phone, address, city, state, pincode,
    payment_method, payment_status, status, subtotal, discount, shipping, total,
    invoice_no, order_number, idempotency_key, coupon_code, notes,
    alt_phone, address_line2, landmark, created_at, updated_at
  ) VALUES (
    uid, _full_name, _email, _phone, _address, _city, _state, _pincode,
    COALESCE(NULLIF(trim(_payment_method), ''), 'online'),
    v_initial_payment_status,
    'placed'::public.order_status,
    computed_subtotal, computed_discount, shipping, computed_total,
    new_invoice, new_order_number, v_clean_idem, _coupon_code,
    COALESCE(_notes, ''),
    COALESCE(_alt_phone, ''),
    COALESCE(_address_line2, ''),
    COALESCE(_landmark, ''),
    now(), now()
  ) RETURNING id INTO new_order_id;

  -- 8. Insert Order Items & Single-Source Atomic Inventory Deduction
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

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

    item_image := COALESCE(variant.variant_image, '');
    IF item_image = '' THEN
      SELECT COALESCE(public_url, '') INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND is_primary = true
      LIMIT 1;
    END IF;

    SELECT COALESCE(buying_price, 0) INTO v_item_buying_price
    FROM public.product_costs
    WHERE product_id = variant.p_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, title, product_name, quantity, price,
      product_sku, product_barcode, color, size, variant_name, image_url,
      buying_price, unit_cost, created_at
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id,
      variant.product_name || CASE WHEN variant.variant_name != 'Default' THEN ' - ' || variant.variant_name ELSE '' END,
      variant.product_name, v_item_qty, variant.price,
      variant.variant_sku, variant.variant_barcode, variant.variant_color, variant.variant_size,
      variant.variant_name, item_image,
      COALESCE(v_item_buying_price, 0), COALESCE(v_item_buying_price, 0), now()
    );

    IF variant.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = variant.variant_id
      FOR UPDATE;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.product_variants
      SET stock = v_new_stock, updated_at = now()
      WHERE id = variant.variant_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, change_qty, prev_stock, new_stock, type, notes
      ) VALUES (
        variant.p_id, variant.variant_id, -v_item_qty, v_prev_stock, v_new_stock,
        'order_placed', 'Online order ' || new_order_number
      );
    ELSE
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = variant.p_id
      FOR UPDATE;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.products
      SET stock = v_new_stock, updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, change_qty, prev_stock, new_stock, type, notes
      ) VALUES (
        variant.p_id, NULL, -v_item_qty, v_prev_stock, v_new_stock,
        'order_placed', 'Online order ' || new_order_number
      );
    END IF;
  END LOOP;

  -- 9. Record Coupon Usage
  IF coupon_record.id IS NOT NULL AND computed_discount > 0 THEN
    UPDATE public.coupons
    SET used_count = COALESCE(used_count, 0) + 1, updated_at = now()
    WHERE id = coupon_record.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'shipping', shipping,
    'discount', computed_discount,
    'payment_status', v_initial_payment_status,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;

-- 3. Synchronize create_checkout_session RPC
DROP FUNCTION IF EXISTS public.create_checkout_session(text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_checkout_session(jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text) CASCADE;

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
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

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
        v_clean_coupon := coupon_record.code;
      ELSE
        v_clean_coupon := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      v_clean_coupon := NULL;
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
    free_delivery_enabled := lower(trim(v_raw_val)) NOT IN ('false', '0', 'no', 'off');
  ELSE
    free_delivery_enabled := true;
  END IF;

  -- Evaluate per-product custom delivery fees
  SELECT value INTO v_delivery_fees_raw FROM public.site_settings WHERE key = 'product_delivery_fees' LIMIT 1;
  IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
    BEGIN
      v_delivery_fees := v_delivery_fees_raw::jsonb;

      FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
        v_item_fee := NULL;
        IF item.product_id IS NOT NULL AND v_delivery_fees ? item.product_id THEN
          v_item_fee := (v_delivery_fees->>item.product_id)::numeric;
        ELSIF item.product_slug IS NOT NULL AND v_delivery_fees ? item.product_slug THEN
          v_item_fee := (v_delivery_fees->>item.product_slug)::numeric;
        ELSE
          IF item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            SELECT p.id::text, p.slug INTO variant
            FROM public.product_variants pv
            JOIN public.products p ON p.id = pv.product_id
            WHERE pv.id = item.variant_id::uuid
            LIMIT 1;
            IF variant.id IS NOT NULL AND v_delivery_fees ? variant.id THEN
              v_item_fee := (v_delivery_fees->>variant.id)::numeric;
            ELSIF variant.slug IS NOT NULL AND v_delivery_fees ? variant.slug THEN
              v_item_fee := (v_delivery_fees->>variant.slug)::numeric;
            END IF;
          END IF;
        END IF;

        IF v_item_fee IS NOT NULL THEN
          v_has_explicit_fee := true;
          IF v_item_fee > 0 THEN
            v_all_items_free := false;
            v_custom_shipping := GREATEST(COALESCE(v_custom_shipping, 0), v_item_fee);
          END IF;
        ELSE
          v_all_items_free := false;
        END IF;
      END LOOP;

      IF v_has_explicit_fee THEN
        IF v_all_items_free THEN
          v_custom_shipping := 0;
        ELSIF v_custom_shipping IS NULL THEN
          v_custom_shipping := std_shipping;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_custom_shipping := NULL;
    END;
  END IF;

  IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
    shipping := 0;
  ELSE
    shipping := COALESCE(v_custom_shipping, std_shipping);
  END IF;

  -- 6. COD Evaluation
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
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  -- 7. Insert checkout session
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
    NULLIF(trim(_idempotency_key), ''),
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

GRANT EXECUTE ON FUNCTION public.create_checkout_session(
  jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;
