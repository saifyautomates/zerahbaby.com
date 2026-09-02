-- Fix order_status_history columns bug in place_order
CREATE OR REPLACE FUNCTION public.place_order(
  _full_name text,
  _email text,
  _phone text,
  _alt_phone text DEFAULT '',
  _address text DEFAULT '',
  _address_line2 text DEFAULT '',
  _landmark text DEFAULT '',
  _city text DEFAULT '',
  _state text DEFAULT '',
  _pincode text DEFAULT '',
  _payment_method text DEFAULT 'cod',
  _notes text DEFAULT '',
  _coupon_code text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  net_subtotal numeric := 0;
  shipping numeric := 0;
  item record;
  variant record;
  coupon_result jsonb;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  
  _fd_enabled text;
  _fd_threshold text;
  _fd_charge text;
  is_fd_enabled boolean := true;
  fd_threshold numeric := 999;
  std_shipping numeric := 79;
  item_image text;
  v_initial_payment_status public.payment_status := 'pending'::public.payment_status;
  v_prev_stock int;
  v_new_stock int;
  v_clean_idem text;
  existing_order record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 1. Idempotency Check (prevent duplicate submissions)
  v_clean_idem := COALESCE(NULLIF(trim(_idempotency_key), ''), NULL);
  IF v_clean_idem IS NOT NULL THEN
    SELECT id, invoice_no, order_number, total
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
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Free delivery configuration
  SELECT value INTO _fd_enabled FROM public.site_settings WHERE key = 'free_delivery_enabled';
  SELECT value INTO _fd_threshold FROM public.site_settings WHERE key = 'free_delivery_threshold';
  SELECT value INTO _fd_charge FROM public.site_settings WHERE key = 'standard_shipping_charge';

  IF _fd_enabled IS NOT NULL AND _fd_enabled = 'false' THEN
    is_fd_enabled := false;
  END IF;

  IF _fd_threshold IS NOT NULL AND _fd_threshold ~ '^[0-9]+(\.[0-9]+)?$' THEN
    fd_threshold := _fd_threshold::numeric;
  END IF;

  IF _fd_charge IS NOT NULL AND _fd_charge ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := _fd_charge::numeric;
  END IF;

  -- 3. Pessimistic Row Locking & Stock / Price Validation
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.stock,
           p.name AS product_name, p.slug AS product_slug, p.is_active, p.sales_channel
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v;

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Variant ID % not found', item.variant_id;
    END IF;

    IF NOT variant.is_active THEN
      RAISE EXCEPTION 'Product "%" is archived and cannot be purchased', variant.product_name;
    END IF;

    IF variant.sales_channel = 'OFFLINE_ONLY' THEN
      RAISE EXCEPTION 'Product "%" is only available at our physical store', variant.product_name;
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%". Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    IF item.qty <= 0 OR item.qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for "%": %', variant.product_name, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  IF computed_subtotal = 0 THEN
    RAISE EXCEPTION 'Order subtotal cannot be zero';
  END IF;

  -- 4. Validate coupon against computed subtotal
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) <> '' THEN
    BEGIN
      coupon_result := public.validate_coupon(_coupon_code, uid, computed_subtotal);
      IF (coupon_result->>'valid')::boolean THEN
        computed_discount := (coupon_result->>'discount')::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      computed_discount := 0;
    END;
  END IF;

  computed_discount := LEAST(computed_discount, computed_subtotal);
  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Compute shipping: Free delivery applies when net payable subtotal meets or exceeds threshold
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
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, computed_discount, computed_total, _coupon_code, 'placed'::public.order_status, _payment_method, 
    v_initial_payment_status,
    _full_name, _email, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode,
    CASE WHEN v_clean_idem IS NOT NULL THEN COALESCE(_notes, '') || ' [idem:' || v_clean_idem || ']' ELSE _notes END,
    v_clean_idem
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully', uid);

  -- 7. Insert Items, Deduct Stock & Record Complete Inventory Ledger
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
           v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
           v.name AS variant_name, v.image_url AS variant_image, v.stock AS v_stock,
           p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v, p;

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
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, item.qty, item.qty, variant.price, variant.price, (variant.price * item.qty), variant.variant_sku,
      variant.variant_color, variant.variant_size, variant.variant_barcode, item_image, item_image, variant.product_name, variant.product_name
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

  -- 8. Clean up user's cart in database
  DELETE FROM public.cart_items WHERE user_id = uid;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'total', computed_total,
    'duplicate', false
  );
END;
$$;

