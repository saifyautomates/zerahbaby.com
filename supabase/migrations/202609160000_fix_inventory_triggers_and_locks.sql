-- ============================================================
-- FULL-STACK AUDIT: PERMANENT FIX FOR INVENTORY BUGS
-- Drop fragile triggers and replace with atomic row-locking
-- ============================================================

-- 1. Drop the potentially failing triggers so we do explicit updates
DROP TRIGGER IF EXISTS order_items_deduct_stock ON public.order_items;
DROP TRIGGER IF EXISTS offline_sale_items_deduct_stock ON public.offline_sale_items;

DO $$ 
DECLARE
  r record;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_name
    FROM pg_proc 
    WHERE proname IN ('place_order', 'place_offline_sale', 'cancel_customer_order', 'sync_offline_sales') 
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_name || ' CASCADE';
  END LOOP;
END $$;

-- 2. Update place_order to use FOR UPDATE and explicit stock management
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

  -- Validate and compute subtotal from actual DB prices, with ROW LOCKING
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int) LOOP
    SELECT 
      p.id, 
      p.slug, 
      p.price, 
      p.stock, 
      p.name, 
      p.sales_channel
    INTO prod
    FROM public.products p
    WHERE p.slug = item.product_slug AND p.is_active = true
    FOR UPDATE;
    
    IF prod.id IS NULL THEN
      RAISE EXCEPTION 'Product % not found or inactive', item.product_slug;
    END IF;

    -- STRICT BACKEND CHECK FOR OFFLINE ONLY PRODUCTS
    IF prod.sales_channel = 'OFFLINE_ONLY' THEN
      RAISE EXCEPTION 'Product % is only available for offline purchase', prod.name;
    END IF;
    
    IF prod.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %', prod.name, prod.stock, item.qty;
    END IF;

    IF item.qty <= 0 OR item.qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for %: %', prod.name, item.qty;
    END IF;
    
    computed_subtotal := computed_subtotal + (prod.price * item.qty);

    -- ========================================================
    -- EXPLICIT STOCK DEDUCTION INSIDE THE VALIDATION LOOP
    -- ========================================================
    UPDATE public.products 
    SET stock = stock - item.qty
    WHERE id = prod.id;

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
    order_id, product_slug, product_id, name, image_url, price, qty, subtotal
  )
  SELECT 
    new_order_id,
    x.product_slug,
    p.id,
    p.name,
    pi.public_url,
    p.price,
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

  -- ========================================================
  -- EXPLICIT INVENTORY TRANSACTION LOGGING
  -- ========================================================
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int) LOOP
    INSERT INTO public.inventory_transactions (product_id, type, quantity, reference_type, reference_id, note, created_by)
    SELECT p.id, 'sale', -item.qty, 'order', new_order_id, 'Auto-deducted on order placement', uid
    FROM public.products p WHERE p.slug = item.product_slug;
  END LOOP;

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


-- 3. Update place_offline_sale to do explicit stock management
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _payment_method text,
  _notes text,
  _discount numeric,
  _discount_type text,
  _discount_value numeric,
  _customer_id uuid,
  _items jsonb,
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
  item record;
  prod record;
  item_count int := 0;
  new_sale_id uuid;
  new_sale_number text;
  final_notes text;
  new_token_number int;
  new_token_date date;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required for offline sales';
  END IF;

  -- Check for existing idempotency key
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, sale_number, pos_token_number, pos_token_date 
    INTO new_sale_id, new_sale_number, new_token_number, new_token_date
    FROM public.offline_sales 
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;

    IF new_sale_id IS NOT NULL THEN
      -- Already placed, just return the existing record
      RETURN jsonb_build_object(
        'sale_id', new_sale_id,
        'sale_number', new_sale_number,
        'pos_token_number', new_token_number,
        'pos_token_date', new_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Validate and compute subtotal from actual DB prices with row locking
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, name text, sku text, qty int, custom_price numeric)
  LOOP
    IF item.product_slug IS NOT NULL AND item.product_slug LIKE 'custom-%' THEN
      -- Custom item (no DB product)
      IF item.custom_price IS NULL OR item.custom_price <= 0 THEN
        RAISE EXCEPTION 'Custom items must have a positive price';
      END IF;
      IF item.qty IS NULL OR item.qty <= 0 OR item.qty > 1000 THEN
        RAISE EXCEPTION 'Invalid quantity for custom item';
      END IF;
      computed_subtotal := computed_subtotal + (item.custom_price * item.qty);
    ELSE
      -- DB product — lock row to prevent race conditions
      IF item.product_id IS NOT NULL THEN
        SELECT id, slug, price, mrp, stock, name, sku, barcode, is_active
        INTO prod
        FROM public.products
        WHERE id = item.product_id
        FOR UPDATE;
      ELSE
        SELECT id, slug, price, mrp, stock, name, sku, barcode, is_active
        INTO prod
        FROM public.products
        WHERE slug = item.product_slug
        FOR UPDATE;
      END IF;

      IF prod.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', COALESCE(item.product_id::text, item.product_slug);
      END IF;

      IF NOT prod.is_active THEN
        RAISE EXCEPTION 'Product "%" is archived and cannot be sold', prod.name;
      END IF;

      IF item.qty IS NULL OR item.qty <= 0 OR item.qty > 1000 THEN
        RAISE EXCEPTION 'Invalid quantity for %: %', prod.name, item.qty;
      END IF;

      IF prod.stock < item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', prod.name, prod.stock, item.qty;
      END IF;

      computed_subtotal := computed_subtotal + (prod.price * item.qty);

      -- ========================================================
      -- EXPLICIT STOCK DEDUCTION INSIDE THE VALIDATION LOOP
      -- ========================================================
      UPDATE public.products 
      SET stock = stock - item.qty
      WHERE id = prod.id;

    END IF;
  END LOOP;

  IF computed_subtotal <= 0 THEN
    RAISE EXCEPTION 'Order total must be greater than zero';
  END IF;

  -- Compute discount
  IF _discount_type = 'percentage' THEN
    IF _discount_value < 0 OR _discount_value > 100 THEN
      RAISE EXCEPTION 'Percentage discount must be between 0 and 100';
    END IF;
    computed_discount := ROUND(computed_subtotal * _discount_value / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    IF _discount_value < 0 THEN
      RAISE EXCEPTION 'Discount cannot be negative';
    END IF;
    computed_discount := LEAST(_discount_value, computed_subtotal);
  ELSE
    computed_discount := 0;
  END IF;

  -- Also accept legacy _discount param if _discount_type is 'none'
  IF _discount_type = 'none' AND _discount > 0 THEN
    computed_discount := LEAST(_discount, computed_subtotal);
  END IF;

  -- Compute final total (no tax/GST)
  computed_total := GREATEST(0, computed_subtotal - computed_discount);

  -- Generate sequential sale number
  new_sale_number := public.generate_pos_sale_number();

  -- ===================== TOKEN GENERATION ==================
  new_token_date := public.current_ist_date();
  INSERT INTO public.pos_daily_token_seq (token_date, last_token)
  VALUES (new_token_date, 1)
  ON CONFLICT (token_date) DO UPDATE
    SET last_token = pos_daily_token_seq.last_token + 1
  RETURNING last_token INTO new_token_number;
  -- =========================================================

  -- Build notes with idempotency key
  final_notes := COALESCE(_notes, '');
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    final_notes := final_notes || ' [idem:' || _idempotency_key || ']';
  END IF;

  -- Insert the sale with the assigned token
  INSERT INTO public.offline_sales (
    sale_number, customer_name, customer_phone, customer_email,
    payment_method, notes, subtotal, discount, total,
    discount_type, discount_value, customer_id, created_by,
    pos_token_number, pos_token_date
  ) VALUES (
    new_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(_customer_phone, ''),
    COALESCE(_customer_email, ''),
    COALESCE(_payment_method, 'cash'),
    final_notes,
    computed_subtotal,
    computed_discount,
    computed_total,
    COALESCE(_discount_type, 'none'),
    COALESCE(_discount_value, 0),
    _customer_id,
    uid,
    new_token_number,
    new_token_date
  )
  RETURNING id INTO new_sale_id;

  -- Insert sale items with snapshots
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, name text, sku text, qty int, custom_price numeric)
  LOOP
    IF item.product_slug IS NOT NULL AND item.product_slug LIKE 'custom-%' THEN
      INSERT INTO public.offline_sale_items (
        sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
        variant_info, mrp_snapshot, barcode_snapshot
      ) VALUES (
        new_sale_id, NULL, item.product_slug,
        COALESCE(item.name, 'Custom Item'), 'CUSTOM',
        item.custom_price, item.qty, (item.custom_price * item.qty),
        '', item.custom_price, ''
      );
    ELSE
      IF item.product_id IS NOT NULL THEN
        SELECT id, slug, price, mrp, stock, name, sku, barcode
        INTO prod
        FROM public.products WHERE id = item.product_id;
      ELSE
        SELECT id, slug, price, mrp, stock, name, sku, barcode
        INTO prod
        FROM public.products WHERE slug = item.product_slug;
      END IF;

      INSERT INTO public.offline_sale_items (
        sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
        variant_info, mrp_snapshot, barcode_snapshot
      ) VALUES (
        new_sale_id, prod.id, prod.slug, prod.name,
        COALESCE(prod.sku, ''), prod.price, item.qty, (prod.price * item.qty),
        '', COALESCE(prod.mrp, prod.price), COALESCE(prod.barcode, '')
      );

      -- ========================================================
      -- EXPLICIT INVENTORY TRANSACTION LOGGING
      -- ========================================================
      INSERT INTO public.inventory_transactions (product_id, type, quantity, reference_type, reference_id, note, created_by)
      VALUES (
        prod.id, 
        'offline_sale', 
        -item.qty, 
        'offline_sale', 
        new_sale_id, 
        'Auto-deducted on POS sale',
        uid
      );
    END IF;
  END LOOP;

  -- Update POS customer stats if customer_id provided
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + computed_total
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', item_count,
    'pos_token_number', new_token_number,
    'pos_token_date', new_token_date
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text) TO authenticated, service_role;
