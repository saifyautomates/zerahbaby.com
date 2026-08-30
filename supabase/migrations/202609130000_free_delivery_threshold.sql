-- ============================================================
-- FREE DELIVERY THRESHOLD & DYNAMIC SHIPPING
-- ============================================================

-- 1. Initialize default settings if they do not exist
INSERT INTO public.site_settings (key, value)
VALUES 
  ('free_delivery_enabled', 'true'),
  ('free_delivery_threshold', '999'),
  ('standard_shipping_charge', '79'),
  ('free_delivery_message', 'Add ₹{amount} more for FREE DELIVERY 🎉')
ON CONFLICT (key) DO NOTHING;

-- 2. Update place_order to use dynamic shipping logic
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
  prod record;
  coupon_result jsonb;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  
  -- Settings variables
  _fd_enabled text;
  _fd_threshold text;
  _fd_charge text;
  is_fd_enabled boolean := true;
  fd_threshold numeric := 999;
  std_shipping numeric := 79;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Validate and compute subtotal from actual DB prices
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int) LOOP
    SELECT 
      p.id, 
      p.slug, 
      p.price, 
      p.stock, 
      p.name, 
      pi.public_url AS image_url 
    INTO prod
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT public_url 
      FROM public.product_images 
      WHERE product_id = p.id 
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC 
      LIMIT 1
    ) pi ON true
    WHERE p.slug = item.product_slug AND p.is_active = true
    LIMIT 1;
    
    IF prod.id IS NULL THEN
      RAISE EXCEPTION 'Product % not found or inactive', item.product_slug;
    END IF;
    
    IF prod.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %', prod.name, prod.stock, item.qty;
    END IF;

    IF item.qty <= 0 OR item.qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for %: %', prod.name, item.qty;
    END IF;
    
    computed_subtotal := computed_subtotal + (prod.price * item.qty);
  END LOOP;

  IF computed_subtotal = 0 THEN
    RAISE EXCEPTION 'Order subtotal cannot be zero';
  END IF;

  -- Validate coupon server-side if provided
  IF _coupon_code IS NOT NULL AND _coupon_code <> '' THEN
    BEGIN
      coupon_result := public.validate_coupon(_coupon_code, uid, computed_subtotal);
      IF (coupon_result->>'valid')::boolean THEN
        computed_discount := (coupon_result->>'discount')::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Silently ignore invalid coupon instead of blocking order
      computed_discount := 0;
    END;
  END IF;

  -- Compute eligible subtotal strictly after applicable discounts
  eligible_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- Fetch shipping settings
  SELECT value INTO _fd_enabled FROM public.site_settings WHERE key = 'free_delivery_enabled';
  SELECT value INTO _fd_threshold FROM public.site_settings WHERE key = 'free_delivery_threshold';
  SELECT value INTO _fd_charge FROM public.site_settings WHERE key = 'standard_shipping_charge';
  
  IF _fd_enabled IS NOT NULL THEN is_fd_enabled := _fd_enabled = 'true'; END IF;
  IF _fd_threshold IS NOT NULL THEN fd_threshold := _fd_threshold::numeric; END IF;
  IF _fd_charge IS NOT NULL THEN std_shipping := _fd_charge::numeric; END IF;

  -- Compute shipping: free for eligible_subtotal strictly greater than threshold
  IF is_fd_enabled AND eligible_subtotal > fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  -- Compute final total
  computed_total := GREATEST(0, eligible_subtotal + shipping);

  -- Insert the order with server-verified values
  INSERT INTO public.orders (
    user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    payment_method, notes, subtotal, shipping, discount,
    coupon_code, total, status
  ) VALUES (
    uid, _full_name, _email, _phone, COALESCE(_alt_phone, ''),
    _address, COALESCE(_address_line2, ''), COALESCE(_landmark, ''), 
    _city, _state, _pincode,
    COALESCE(_payment_method, 'cod'), COALESCE(_notes, ''), 
    computed_subtotal, shipping, computed_discount,
    _coupon_code, computed_total, 'pending'
  )
  RETURNING id, COALESCE(invoice_no, order_number, id::text), order_number INTO new_order_id, new_invoice, new_order_number;

  -- Insert order items with server-verified prices & primary images
  INSERT INTO public.order_items (
    order_id, product_slug, product_id, name, image_url, price, qty, quantity, subtotal
  )
  SELECT 
    new_order_id,
    x.product_slug,
    p.id,
    p.name,
    pi.public_url,
    p.price,
    x.qty,
    x.qty,
    (p.price * x.qty)
  FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int)
  JOIN public.products p ON p.slug = x.product_slug
  LEFT JOIN LATERAL (
    SELECT public_url 
    FROM public.product_images 
    WHERE product_id = p.id 
    ORDER BY is_primary DESC, sort_order ASC, created_at ASC 
    LIMIT 1
  ) pi ON true;

  -- Clean up user's cart in database
  BEGIN
    DELETE FROM public.cart_items 
    WHERE cart_id IN (SELECT id FROM public.carts WHERE user_id = uid);
  EXCEPTION WHEN OTHERS THEN
    -- Table or cart may not exist for this user; non-blocking
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order TO authenticated, anon, service_role;
