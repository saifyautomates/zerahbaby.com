-- Migration: 20260928000323_fix_order_and_sale_buying_price_and_return_cogs.sql
-- Description: Ensure buying price is permanently captured on order_items and offline_sale_items
--              by joining products and product_costs, fix RLS permissions on product_costs,
--              and backfill product costs so re-ordering after a return maintains full My Cost accuracy.

-- 1. Ensure product_costs SELECT permission and policy
GRANT SELECT ON public.product_costs TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "allow_read_product_costs_for_all" ON public.product_costs;
CREATE POLICY "allow_read_product_costs_for_all" ON public.product_costs
  FOR SELECT TO anon, authenticated, service_role USING (true);

-- 2. Backfill products buying_price and cost_price from product_costs
UPDATE public.products p
SET buying_price = COALESCE(NULLIF(pc.buying_price, 0), NULLIF(pc.cost_price, 0), p.buying_price, 0),
    cost_price = COALESCE(NULLIF(pc.cost_price, 0), NULLIF(pc.buying_price, 0), p.cost_price, 0)
FROM public.product_costs pc
WHERE pc.product_id = p.id
  AND (p.buying_price IS NULL OR p.buying_price = 0)
  AND (pc.buying_price > 0 OR pc.cost_price > 0);

-- Specifically ensure product 'saify' has buying_price = 0.1
UPDATE public.products
SET buying_price = 0.1, cost_price = 0.1
WHERE slug = 'saify' OR name ILIKE '%saify%';

INSERT INTO public.product_costs (product_id, buying_price, cost_price)
SELECT id, 0.1, 0.1
FROM public.products
WHERE slug = 'saify' OR name ILIKE '%saify%'
ON CONFLICT (product_id) DO UPDATE
SET buying_price = 0.1, cost_price = 0.1;

-- 3. Backfill order_items and offline_sale_items for 'saify' and any items missing buying_price
UPDATE public.order_items oi
SET buying_price = 0.1
FROM public.products p
WHERE (oi.product_id = p.id OR oi.product_slug = p.slug OR oi.product_name ILIKE '%saify%')
  AND (p.slug = 'saify' OR p.name ILIKE '%saify%')
  AND (oi.buying_price IS NULL OR oi.buying_price = 0);

UPDATE public.offline_sale_items osi
SET cost_price = 0.1, buying_price = 0.1
FROM public.products p
WHERE (osi.product_id = p.id OR osi.product_slug = p.slug OR osi.name ILIKE '%saify%')
  AND (p.slug = 'saify' OR p.name ILIKE '%saify%')
  AND (osi.cost_price IS NULL OR osi.cost_price = 0 OR osi.buying_price IS NULL OR osi.buying_price = 0);

-- Backfill all other order_items from products table where buying_price is 0
UPDATE public.order_items oi
SET buying_price = COALESCE(NULLIF(p.buying_price, 0), NULLIF(p.cost_price, 0), oi.buying_price, 0)
FROM public.products p
WHERE (oi.product_id = p.id OR oi.product_slug = p.slug)
  AND (oi.buying_price IS NULL OR oi.buying_price = 0)
  AND (p.buying_price > 0 OR p.cost_price > 0);

UPDATE public.offline_sale_items osi
SET cost_price = COALESCE(NULLIF(p.cost_price, 0), NULLIF(p.buying_price, 0), osi.cost_price, 0),
    buying_price = COALESCE(NULLIF(p.buying_price, 0), NULLIF(p.cost_price, 0), osi.buying_price, 0)
FROM public.products p
WHERE (osi.product_id = p.id OR osi.product_slug = p.slug)
  AND (osi.cost_price IS NULL OR osi.cost_price = 0)
  AND (p.buying_price > 0 OR p.cost_price > 0);

-- 4. Recreate place_order with joined cost lookup and slug persistence
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

    v_clean_var_id := NULL;
    IF item.variant_id IS NOT NULL AND trim(item.variant_id) != '' THEN
      BEGIN
        v_clean_var_id := trim(item.variant_id)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_clean_var_id := NULL;
      END;
    END IF;

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

    IF variant.variant_id IS NULL AND variant.p_id IS NOT NULL THEN
      SELECT id INTO variant.variant_id
      FROM public.product_variants
      WHERE product_id = variant.p_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= v_item_qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    IF variant.price IS NULL THEN
      RAISE EXCEPTION 'Product variant not found or inactive: %', COALESCE(item.variant_id, item.product_slug, item.product_id, 'Unknown');
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * v_item_qty);
  END LOOP;

  -- 4. Calculate Delivery Fee
  BEGIN
    SELECT value INTO v_raw_val FROM public.app_settings WHERE key = 'free_delivery_threshold' LIMIT 1;
    IF v_raw_val IS NOT NULL AND trim(v_raw_val) != '' THEN
      fd_threshold := v_raw_val::numeric;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    fd_threshold := 999;
  END;

  BEGIN
    SELECT value INTO v_raw_val FROM public.app_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
    IF v_raw_val IS NOT NULL AND trim(v_raw_val) != '' THEN
      is_fd_enabled := (v_raw_val = 'true' OR v_raw_val = '1');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    is_fd_enabled := true;
  END;

  BEGIN
    SELECT value INTO v_raw_val FROM public.app_settings WHERE key = 'standard_shipping_fee' LIMIT 1;
    IF v_raw_val IS NOT NULL AND trim(v_raw_val) != '' THEN
      std_shipping := v_raw_val::numeric;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    std_shipping := 65;
  END;

  BEGIN
    SELECT value INTO v_delivery_fees_raw FROM public.app_settings WHERE key = 'product_delivery_fees' LIMIT 1;
    IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
      v_delivery_fees := v_delivery_fees_raw::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_delivery_fees := NULL;
  END;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_fee := NULL;

    IF item.product_id IS NOT NULL AND v_delivery_fees ? item.product_id THEN
      v_item_fee := (v_delivery_fees->>item.product_id)::numeric;
    ELSIF item.product_slug IS NOT NULL AND v_delivery_fees ? item.product_slug THEN
      v_item_fee := (v_delivery_fees->>item.product_slug)::numeric;
    END IF;

    IF v_item_fee IS NULL THEN
      SELECT delivery_fee INTO v_item_fee
      FROM public.products
      WHERE (item.product_id IS NOT NULL AND id::text = item.product_id)
         OR (item.product_slug IS NOT NULL AND (slug = item.product_slug OR id::text = item.product_slug))
      LIMIT 1;
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

  IF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSIF v_custom_shipping IS NOT NULL THEN
    shipping := v_custom_shipping;
  ELSIF is_fd_enabled AND computed_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  -- 5. Coupon Evaluation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE code = upper(trim(_coupon_code))
      AND is_active = true
      AND (valid_until IS NULL OR valid_until > now())
      AND (valid_from IS NULL OR valid_from <= now())
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      IF coupon_record.min_order_amount IS NULL OR computed_subtotal >= coupon_record.min_order_amount THEN
        IF coupon_record.type = 'percentage' THEN
          computed_discount := (computed_subtotal * coupon_record.value) / 100;
          IF coupon_record.max_discount IS NOT NULL AND coupon_record.max_discount > 0 THEN
            computed_discount := LEAST(computed_discount, coupon_record.max_discount);
          END IF;
        ELSE
          computed_discount := coupon_record.value;
        END IF;
        computed_discount := LEAST(computed_discount, computed_subtotal);
      END IF;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);
  computed_total := net_subtotal + shipping;

  -- 6. Generate IDs
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || floor(1000 + random() * 9000)::text;
  new_invoice := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::text;

  IF lower(_payment_method) = 'cod' THEN
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 7. Insert Canonical Order
  INSERT INTO public.orders (
    user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    subtotal, discount, shipping, total,
    status, payment_status, payment_method, coupon_code, notes,
    idempotency_key, order_number, invoice_no, created_at, updated_at
  ) VALUES (
    uid, _full_name, COALESCE(_email, ''), _phone, _alt_phone,
    _address, _address_line2, _landmark, _city, _state, _pincode,
    computed_subtotal, computed_discount, shipping, computed_total,
    'placed', v_initial_payment_status, _payment_method, _coupon_code,
    COALESCE(_notes, ''), NULLIF(trim(_idempotency_key), ''),
    new_order_number, new_invoice, now(), now()
  ) RETURNING id INTO new_order_id;

  -- 8. Insert Order Items & Deduct Inventory (WITH BUYING PRICE SNAPSHOT)
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := NULL;
    IF item.variant_id IS NOT NULL AND trim(item.variant_id) != '' THEN
      BEGIN
        v_clean_var_id := trim(item.variant_id)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_clean_var_id := NULL;
      END;
    END IF;

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

    IF variant.variant_id IS NULL AND variant.p_id IS NOT NULL THEN
      SELECT id INTO variant.variant_id
      FROM public.product_variants
      WHERE product_id = variant.p_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= v_item_qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    item_image := COALESCE(variant.variant_image, '');
    IF item_image = '' THEN
      SELECT COALESCE(public_url, '') INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND is_primary = true
      LIMIT 1;
    END IF;

    -- Query buying price by joining products and product_costs
    SELECT COALESCE(pc.buying_price, pc.cost_price, p.buying_price, p.cost_price, 0) INTO v_item_buying_price
    FROM public.products p
    LEFT JOIN public.product_costs pc ON pc.product_id = p.id
    WHERE p.id = variant.p_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, title, product_name, quantity, price,
      product_sku, product_barcode, color, size, variant_name, image_url,
      buying_price, unit_cost, product_slug, slug, created_at
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id,
      variant.product_name || CASE WHEN variant.variant_name != 'Default' THEN ' - ' || variant.variant_name ELSE '' END,
      variant.product_name, v_item_qty, variant.price,
      variant.variant_sku, variant.variant_barcode, variant.variant_color, variant.variant_size,
      variant.variant_name, item_image,
      COALESCE(v_item_buying_price, 0), COALESCE(v_item_buying_price, 0),
      COALESCE(variant.product_slug, ''), COALESCE(variant.product_slug, ''), now()
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

      -- Authoritative parent product stock sync
      UPDATE public.products
      SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = variant.p_id),
          updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
      ) VALUES (
        variant.p_id, variant.variant_id, -v_item_qty,
        'order'::public.inventory_tx_type, 'order'::public.inventory_tx_type,
        new_order_id, 'Order #' || new_order_number, uid, now()
      );
    ELSIF variant.p_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = variant.p_id
      FOR UPDATE;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.products
      SET stock = v_new_stock, updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
      ) VALUES (
        variant.p_id, NULL, -v_item_qty,
        'order'::public.inventory_tx_type, 'order'::public.inventory_tx_type,
        new_order_id, 'Order #' || new_order_number, uid, now()
      );
    END IF;
  END LOOP;

  -- 9. Increment Coupon Usage
  IF coupon_record.id IS NOT NULL THEN
    UPDATE public.coupons
    SET used_count = COALESCE(used_count, 0) + 1, updated_at = now()
    WHERE id = coupon_record.id;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) TO authenticated, anon, service_role;

-- 5. Recreate place_offline_sale with joined cost lookup and persistence
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _created_by uuid DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _coupon_code text DEFAULT NULL,
  _cash_tendered numeric DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := COALESCE(_created_by, auth.uid());
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_qty int;
  item_price numeric;
  item_mrp numeric;
  item_cost numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_voucher_avail numeric := 0;
  v_effective_payment_method text;
  v_sale_number text;
  v_token_number int;
  v_sale_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(_customer_phone, '[^0-9]', '', 'g');
  v_coupon_record record;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method, customer_name, customer_id INTO v_sale_id, v_sale_number, v_gross_total, v_subtotal, v_discount, v_effective_payment_method, _customer_name, v_cust_id
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_sale_id,
        'sale_number', v_sale_number,
        'total', v_gross_total,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'payment_method', v_effective_payment_method,
        'customer_name', _customer_name,
        'customer_id', v_cust_id,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Authorization
  IF current_user != 'service_role' AND COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    IF uid IS NULL THEN
      RAISE EXCEPTION 'Authentication required for POS sales';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (is_admin = true OR is_super_admin = true OR is_staff = true)
      ) OR
      public.is_admin()
    ) THEN
      RAISE EXCEPTION 'Only authorized administrators or staff may record offline sales';
    END IF;
  END IF;

  -- 3. Items validation
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item.';
  END IF;

  -- 4. Calculate Subtotal
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;
    item_price := COALESCE((elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;

  -- 5. Bill-level discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'flat' AND _discount_value > 0 THEN
    v_discount := LEAST(v_subtotal, _discount_value);
  ELSE
    v_discount := 0;
  END IF;

  -- 6. Coupon discount
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE code = UPPER(TRIM(_coupon_code))
      AND is_active = true
      AND (valid_until IS NULL OR valid_until > now())
      AND (valid_from IS NULL OR valid_from <= now())
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF v_coupon_record.min_order_amount IS NULL OR v_subtotal >= v_coupon_record.min_order_amount THEN
        IF v_coupon_record.type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_record.value) / 100, 2);
          IF v_coupon_record.max_discount IS NOT NULL AND v_coupon_record.max_discount > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_record.max_discount);
          END IF;
        ELSE
          v_coupon_discount := v_coupon_record.value;
        END IF;
      END IF;
    END IF;
  END IF;

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Store Credit / Exchange Voucher
  IF _store_credit_used > 0 OR (v_clean_token != '' AND v_clean_token IS NOT NULL) THEN
    IF v_clean_token != '' AND v_clean_token IS NOT NULL THEN
      SELECT COALESCE(remaining_balance, original_amount, 0) INTO v_voucher_avail
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token AND status = 'active'
      FOR UPDATE;

      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(current_balance, original_amount, 0) INTO v_voucher_avail
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND is_active = true
        FOR UPDATE;
      END IF;

      IF v_voucher_avail IS NOT NULL AND v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(COALESCE(_store_credit_used, v_voucher_avail), v_voucher_avail, v_gross_total);
        v_voucher_token := v_clean_token;

        UPDATE public.pos_exchange_vouchers
        SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
            status = CASE WHEN remaining_balance - v_voucher_used <= 0 THEN 'redeemed' ELSE 'active' END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;

        UPDATE public.store_credit_vouchers
        SET current_balance = GREATEST(0, current_balance - v_voucher_used),
            is_active = (current_balance - v_voucher_used > 0),
            redeemed_at = CASE WHEN current_balance - v_voucher_used <= 0 THEN now() ELSE redeemed_at END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;
      END IF;
    ELSIF v_cust_id IS NOT NULL AND _store_credit_used > 0 THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);
    END IF;

    IF v_cust_id IS NOT NULL AND v_voucher_used > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
          store_credit = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 9. Generate Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 10. Customer Upsert / Link
  IF v_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, total_spent, total_visits, store_credit, last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        1,
        0,
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = total_spent + v_gross_total,
          total_visits = total_visits + 1,
          last_visit = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = total_spent + v_gross_total,
        total_visits = total_visits + 1,
        last_visit = now()
    WHERE id = v_cust_id;
  END IF;

  -- 11. Daily Token Number
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 INTO v_token_number
  FROM public.offline_sales
  WHERE created_at >= date_trunc('day', now());

  -- 12. Insert offline_sale
  INSERT INTO public.offline_sales (
    sale_number,
    pos_token_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    subtotal,
    discount,
    discount_type,
    discount_value,
    coupon_code,
    coupon_discount,
    store_credit_used,
    credit_token_used,
    total,
    notes,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_token_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    v_effective_payment_method,
    v_subtotal,
    v_discount,
    _discount_type,
    _discount_value,
    _coupon_code,
    v_coupon_discount,
    v_voucher_used,
    v_voucher_token,
    v_gross_total,
    COALESCE(_notes, ''),
    NULLIF(trim(_idempotency_key), ''),
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 13. Insert Items & Deduct Stock with Variant Fallback Resolution & Buying Price Snapshot
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_price);
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    -- Look up cost price safely from joined products & product_costs
    BEGIN
      SELECT COALESCE(pc.buying_price, pc.cost_price, p.buying_price, p.cost_price, 0) INTO item_cost
      FROM public.products p
      LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = item_product_id
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      item_cost := 0;
    END;

    IF item_cost IS NULL OR item_cost = 0 THEN
      item_cost := COALESCE((elem->>'cost_price')::numeric, (elem->>'buying_price')::numeric, (elem->>'buyingPrice')::numeric, 0);
    END IF;

    -- Fallback: resolve variant if missing but product has variants
    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, variant_id, product_slug, name, product_name,
      variant_info, sku, barcode, price, unit_selling_price, mrp,
      cost_price, buying_price, qty, quantity, total, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp,
      COALESCE(item_cost, 0), COALESCE(item_cost, 0), item_qty, item_qty, (item_price * item_qty), now()
    );

    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_qty);
        UPDATE public.product_variants SET stock = v_new_stock, updated_at = now() WHERE id = item_variant_id;

        -- Authoritative parent product stock sync
        IF item_product_id IS NOT NULL THEN
          UPDATE public.products
          SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = item_product_id),
              updated_at = now()
          WHERE id = item_product_id;
        END IF;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, item_variant_id, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      -- Decrement parent product stock ONLY if product truly has no variants
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products SET stock = GREATEST(0, v_prev_stock - item_qty), updated_at = now() WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, NULL, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    END IF;
  END LOOP;

  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'token_number', v_token_number,
    'total', v_gross_total,
    'payable_total', v_payable_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'customer_id', v_cust_id,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text
) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
