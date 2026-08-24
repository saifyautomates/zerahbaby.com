-- ============================================================
-- ZERAH BABY — FIX CHECKOUT CART RACE CONDITION
-- ============================================================

-- Update place_order to delete the user's cart items upon successful placement

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
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  shipping numeric := 0;
  computed_total numeric := 0;
  item record;
  prod record;
  coupon_result jsonb;
  order_id uuid;
  invoice text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate and compute subtotal from actual DB prices
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int) LOOP
    SELECT id, slug, price, stock, name, image_url INTO prod
    FROM public.products
    WHERE slug = item.product_slug AND is_active = true;
    
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
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Validate coupon server-side if provided
  IF _coupon_code IS NOT NULL AND _coupon_code <> '' THEN
    coupon_result := public.validate_coupon(_coupon_code, uid, computed_subtotal);
    IF (coupon_result->>'valid')::boolean THEN
      computed_discount := (coupon_result->>'discount')::numeric;
    END IF;
    -- Silently ignore invalid coupons rather than blocking the order
  END IF;

  -- Compute shipping: free above 999
  IF computed_subtotal >= 999 THEN
    shipping := 0;
  ELSE
    shipping := 79;
  END IF;

  -- Compute final total
  computed_total := GREATEST(0, computed_subtotal + shipping - computed_discount);

  -- Insert the order with server-verified values
  INSERT INTO public.orders (
    user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    payment_method, notes, subtotal, shipping, discount,
    coupon_code, total, status
  ) VALUES (
    uid, _full_name, _email, _phone, _alt_phone,
    _address, _address_line2, _landmark, _city, _state, _pincode,
    _payment_method, _notes, computed_subtotal, shipping, computed_discount,
    _coupon_code, computed_total, 'pending'
  )
  RETURNING id, invoice_no INTO order_id, invoice;

  -- Insert order items with server-verified prices
  INSERT INTO public.order_items (order_id, product_slug, product_id, name, image_url, price, qty)
  SELECT 
    order_id,
    x.product_slug,
    p.id,
    p.name,
    p.image_url,
    p.price,
    x.qty
  FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int)
  JOIN public.products p ON p.slug = x.product_slug;

  -- Record coupon usage if applied
  IF _coupon_code IS NOT NULL AND computed_discount > 0 AND coupon_result IS NOT NULL THEN
    INSERT INTO public.coupon_usage (coupon_id, user_id, order_id)
    VALUES ((coupon_result->>'coupon_id')::uuid, uid, order_id)
    ON CONFLICT DO NOTHING;

    -- Increment coupon usage count
    UPDATE public.coupons SET usage_count = usage_count + 1
    WHERE id = (coupon_result->>'coupon_id')::uuid;
  END IF;

  -- Clear the user's cart items safely now that the order is successfully created.
  DELETE FROM public.cart_items 
  WHERE cart_id IN (SELECT id FROM public.carts WHERE user_id = uid);

  -- Stock deduction happens automatically via order_items_deduct_stock trigger

  RETURN jsonb_build_object(
    'order_id', order_id,
    'invoice_no', invoice,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'shipping', shipping,
    'discount', computed_discount
  );
END; $$;
