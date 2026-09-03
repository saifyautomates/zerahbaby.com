-- ==============================================================================
-- Migration: 20260928000094_fix_place_order_shipping_settings.sql
-- Description:
-- Dynamic synchronization between site_settings and canonical place_order RPC.
-- Reads standard_shipping_charge, free_delivery_threshold, and free_delivery_enabled
-- as plain text strings from site_settings, eliminating broken jsonb extraction
-- and ensuring admin dashboard changes immediately dictate server-side totals.
-- ==============================================================================

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
  v_initial_payment_status public.payment_status;
  existing_order record;
  v_clean_idem text := NULL;
  v_prev_stock int;
  v_new_stock int;
  item_image text;
  v_item_buying_price numeric := 0;
  v_raw_val text;
BEGIN
  uid := auth.uid();

  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    v_clean_idem := trim(_idempotency_key);
  END IF;

  -- 1. Idempotency Check
  IF v_clean_idem IS NOT NULL THEN
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

  -- 2. Validate Items
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order items cannot be empty';
  END IF;

  -- 3. Calculate Subtotal from Database Prices
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int) LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;

    -- Lookup variant by ID if provided
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id, COALESCE(v.price_override, p.price) AS price, v.stock, p.name, p.is_active
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id;
    ELSIF item.product_slug IS NOT NULL THEN
      -- Lookup default variant by product slug/id
      SELECT v.id, COALESCE(v.price_override, p.price) AS price, v.stock, p.name, p.is_active
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1;
    ELSE
      RAISE EXCEPTION 'Invalid order item: missing variant_id or product_slug';
    END IF;

    IF NOT FOUND OR variant.id IS NULL THEN
      RAISE EXCEPTION 'Product variant % not found', COALESCE(item.variant_id::text, item.product_slug, 'unknown');
    END IF;

    IF variant.is_active = false THEN
      RAISE EXCEPTION 'Product % is no longer available', variant.name;
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.name, variant.stock, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  -- 4. Dynamic Coupon Evaluation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR used_count < max_uses);

    IF FOUND THEN
      IF coupon_record.min_order_amount IS NULL OR computed_subtotal >= coupon_record.min_order_amount THEN
        IF coupon_record.discount_type = 'percentage' THEN
          computed_discount := (computed_subtotal * coupon_record.discount_value) / 100.0;
        ELSIF coupon_record.discount_type = 'fixed' THEN
          computed_discount := coupon_record.discount_value;
        END IF;

        IF coupon_record.max_discount_amount IS NOT NULL THEN
          computed_discount := LEAST(computed_discount, coupon_record.max_discount_amount);
        END IF;

        computed_discount := LEAST(computed_discount, computed_subtotal);

        UPDATE public.coupons
        SET used_count = used_count + 1
        WHERE id = coupon_record.id;
      END IF;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Authoritative Shipping & Free Delivery Evaluation from site_settings
  -- Standard shipping charge
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_charge';
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := trim(v_raw_val)::numeric;
  ELSE
    std_shipping := 79;
  END IF;

  -- Free delivery threshold
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    fd_threshold := trim(v_raw_val)::numeric;
  ELSE
    fd_threshold := 999;
  END IF;

  -- Free delivery enabled
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled';
  IF v_raw_val IS NOT NULL THEN
    is_fd_enabled := (lower(trim(v_raw_val)) = 'true');
  ELSE
    is_fd_enabled := true;
  END IF;

  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := GREATEST(0, net_subtotal + shipping);

  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  IF _payment_method = 'paid' OR _payment_method = 'online_paid' THEN
    v_initial_payment_status := 'paid'::public.payment_status;
  ELSE
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 6. Insert Order Record
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
      order_id, product_id, variant_id, product_slug, qty, quantity, price, price_at_time, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, item.qty, item.qty, variant.price, variant.price, (variant.price * item.qty), variant.variant_sku,
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

    -- Complete inventory ledger recording
    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity,
      reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, -item.qty,
      v_prev_stock, v_new_stock,
      'order', new_order_id, 'Online Order ' || new_invoice, uid
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'subtotal', computed_subtotal,
    'shipping', shipping,
    'discount', computed_discount,
    'total', computed_total,
    'status', 'placed',
    'payment_status', v_initial_payment_status
  );
END;
$$;
