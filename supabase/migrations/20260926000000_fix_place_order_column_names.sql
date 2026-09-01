-- Fix place_order RPC with exact matching table column names for public.orders and public.order_items

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
  _items jsonb DEFAULT '[]'::jsonb
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
  shipping numeric := 0;
  eligible_subtotal numeric := 0;
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  IF _payment_method = 'cod' THEN
    IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'enable_cod' AND value = 'true'::jsonb) THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled by the administrator.';
    END IF;
  END IF;

  SELECT value INTO _fd_enabled FROM public.site_settings WHERE key = 'free_delivery_enabled';
  IF _fd_enabled IS NOT NULL THEN is_fd_enabled := (_fd_enabled = 'true'); END IF;
  
  SELECT value INTO _fd_threshold FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF _fd_threshold IS NOT NULL THEN fd_threshold := _fd_threshold::numeric; END IF;
  
  SELECT value INTO _fd_charge FROM public.site_settings WHERE key = 'standard_shipping_charge';
  IF _fd_charge IS NOT NULL THEN std_shipping := _fd_charge::numeric; END IF;

  new_order_id := gen_random_uuid();

  -- First Pass: Validate and calculate subtotal
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, v.product_id, v.stock, COALESCE(v.price_override, p.price) AS price,
           v.name AS variant_name, v.color AS variant_color, v.size AS variant_size,
           v.sku AS variant_sku, v.barcode AS variant_barcode, v.image_url AS variant_image,
           p.name AS product_name, p.slug AS product_slug, p.sales_channel, p.is_active, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v;

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Variant % not found', item.variant_id;
    END IF;

    IF NOT variant.is_active THEN
      RAISE EXCEPTION 'Product % is not active', variant.product_name;
    END IF;

    IF variant.sales_channel = 'OFFLINE_ONLY' THEN
      RAISE EXCEPTION 'Product % is only available for offline purchase', variant.product_name;
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (Requested: %, Available: %)', variant.product_name, item.qty, variant.stock;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  IF _coupon_code IS NOT NULL AND _coupon_code != '' THEN
    coupon_result := public.validate_coupon(_coupon_code, uid, computed_subtotal);
    IF (coupon_result->>'valid')::boolean = true THEN
      computed_discount := (coupon_result->>'discount')::numeric;
    END IF;
  END IF;

  eligible_subtotal := computed_subtotal - computed_discount;

  IF is_fd_enabled AND eligible_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := eligible_subtotal + shipping;

  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping_fee, shipping, discount, total, coupon_code, status, payment_method, payment_status,
    full_name, email, phone, alt_phone, address, address_line2, landmark, city, state, pincode, notes
  ) VALUES (
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, shipping, computed_discount, computed_total, _coupon_code, 'placed', _payment_method, 
    CASE WHEN _payment_method = 'cod' THEN 'pending' ELSE 'processing' END,
    _full_name, _email, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode, _notes
  );

  INSERT INTO public.order_status_history (order_id, status, notes, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully', uid);

  -- Insert Items & Deduct Stock
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
           v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
           v.name AS variant_name, v.image_url AS variant_image, p.slug AS product_slug,
           p.name AS product_name, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id;

    -- Pick color image if available
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

    UPDATE public.product_variants
    SET stock = stock - item.qty
    WHERE id = variant.variant_id;

    UPDATE public.products
    SET stock = stock - item.qty
    WHERE id = variant.p_id;

    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale', -item.qty, 'order', new_order_id, 'Stock deducted for online order', uid
    );
  END LOOP;

  DELETE FROM public.cart_items 
  WHERE cart_id = (SELECT id FROM public.carts WHERE user_id = uid);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_number', new_invoice,
    'order_number', new_order_number,
    'total_amount', computed_total
  );
END;
$$;
