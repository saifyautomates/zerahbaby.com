-- ==============================================================================
-- Migration: Color-Wise Product Variants and Color-Specific Gallery
-- Description: Adds color, size, barcode, image_url to product_variants;
--              adds color to product_images;
--              adds color, size, barcode snapshots to order_items & offline_sale_items;
--              updates lookup_barcode, place_order, place_offline_sale, sync_offline_sales.
-- ==============================================================================

-- 1. Schema Extensions for product_images
ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS color text;
CREATE INDEX IF NOT EXISTS idx_product_images_prod_color ON public.product_images(product_id, color);

-- 2. Schema Extensions for product_variants
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS mrp_override numeric;

CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants(barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON public.product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_color_size ON public.product_variants(product_id, color, size);

-- 3. Schema Extensions for order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS barcode_snapshot text;

-- 4. Schema Extensions for offline_sale_items
ALTER TABLE public.offline_sale_items ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.offline_sale_items ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.offline_sale_items ADD COLUMN IF NOT EXISTS barcode text;

-- 5. Update lookup_barcode RPC
CREATE OR REPLACE FUNCTION public.lookup_barcode(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  match_record record;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- 1. Try finding by variant barcode or variant SKU first (Exact variant match)
  SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
         v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
         v.stock AS variant_stock, v.price_override, v.mrp_override,
         p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
         p.barcode AS product_barcode, p.is_active, p.age_group, p.description
  INTO match_record
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE (v.barcode = trim(_code) OR v.sku = trim(_code))
  LIMIT 1;

  -- 2. If not found, try parent barcode or parent SKU, and return the first active variant
  IF match_record.variant_id IS NULL THEN
    SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
           v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
           v.stock AS variant_stock, v.price_override, v.mrp_override,
           p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
           p.barcode AS product_barcode, p.is_active, p.age_group, p.description
    INTO match_record
    FROM public.products p
    JOIN public.product_variants v ON v.product_id = p.id
    WHERE (p.barcode = trim(_code) OR p.sku = trim(_code))
    ORDER BY (v.name = 'Default') DESC, v.created_at ASC
    LIMIT 1;
  END IF;

  IF match_record.variant_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Product/Variant not found');
  END IF;

  IF NOT match_record.is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'archived', true,
      'error', 'Product is archived / unavailable for new sale',
      'product_id', match_record.product_id,
      'variant_id', match_record.variant_id,
      'name', match_record.product_name,
      'sku', COALESCE(match_record.variant_sku, match_record.product_barcode),
      'barcode', COALESCE(match_record.variant_barcode, match_record.product_barcode)
    );
  END IF;

  -- Fallback image from product_images if variant image is null
  IF match_record.variant_image IS NULL THEN
    SELECT public_url INTO match_record.variant_image
    FROM public.product_images
    WHERE product_id = match_record.product_id
      AND (match_record.variant_color IS NULL OR color = match_record.variant_color OR color IS NULL)
    ORDER BY is_primary DESC, sort_order ASC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'product_id', match_record.product_id,
    'variant_id', match_record.variant_id,
    'slug', match_record.slug,
    'name', match_record.product_name || CASE 
      WHEN match_record.variant_color IS NOT NULL AND match_record.variant_size IS NOT NULL 
        THEN ' (' || match_record.variant_color || ' / ' || match_record.variant_size || ')'
      WHEN match_record.variant_name != 'Default' AND match_record.variant_name IS NOT NULL
        THEN ' - ' || match_record.variant_name 
      ELSE '' 
    END,
    'brand', match_record.brand,
    'category', match_record.category,
    'color', match_record.variant_color,
    'size', match_record.variant_size,
    'price', COALESCE(match_record.price_override, match_record.price),
    'mrp', COALESCE(match_record.mrp_override, match_record.mrp),
    'stock', match_record.variant_stock,
    'sku', COALESCE(match_record.variant_sku, match_record.product_barcode),
    'barcode', COALESCE(match_record.variant_barcode, match_record.product_barcode),
    'image_url', match_record.variant_image,
    'age_group', match_record.age_group,
    'description', match_record.description
  );
END;
$$;

-- 6. Update place_order RPC with full Color + Size Snapshot Support
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
    coupon_result := public.calculate_coupon_discount(_coupon_code, computed_subtotal);
    IF (coupon_result->>'valid')::boolean = true THEN
      computed_discount := (coupon_result->>'discount_amount')::numeric;
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
    id, user_id, invoice_number, order_number, subtotal, shipping_fee, discount_amount, total_amount, coupon_code, status, payment_method, payment_status,
    shipping_name, shipping_phone, alt_phone, shipping_address, address_line2, landmark, shipping_city, shipping_state, shipping_pincode, notes
  ) VALUES (
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, computed_discount, computed_total, _coupon_code, 'placed', _payment_method, 
    CASE WHEN _payment_method = 'cod' THEN 'pending' ELSE 'processing' END,
    _full_name, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode, _notes
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
      order_id, product_slug, variant_id, qty, subtotal, sku_snapshot,
      price_at_time, color, size, barcode_snapshot, image_url_snapshot,
      product_name_snapshot, name
    ) VALUES (
      new_order_id, variant.product_slug, variant.variant_id, item.qty, (variant.price * item.qty),
      variant.variant_sku, variant.price, variant.variant_color, variant.variant_size,
      variant.variant_barcode, item_image, variant.product_name, variant.product_name
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
    'total_amount', computed_total
  );
END;
$$;

-- 7. Update place_offline_sale RPC with full Color + Size Snapshot Support
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _items jsonb,
  _payment_method text,
  _customer_id uuid DEFAULT NULL,
  _customer_name text DEFAULT NULL,
  _customer_phone text DEFAULT NULL,
  _customer_email text DEFAULT NULL,
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _discount numeric DEFAULT 0,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_sale_id uuid;
  new_sale_number text;
  sale_subtotal numeric := 0;
  final_discount_amount numeric := 0;
  final_total numeric := 0;
  item record;
  variant record;
  existing_sale record;
BEGIN
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total_amount INTO existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key);
    
    IF existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'sale_id', existing_sale.id,
        'sale_number', existing_sale.sale_number,
        'total_amount', existing_sale.total_amount,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  new_sale_id := gen_random_uuid();
  new_sale_number := public.generate_sale_number();

  INSERT INTO public.offline_sales (
    id, sale_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
    payment_method, payment_status, status, subtotal, discount_type, discount_value,
    discount_amount, total_amount, notes, idempotency_key
  ) VALUES (
    new_sale_id, new_sale_number, uid, _customer_id, _customer_name, _customer_phone, _customer_email,
    _payment_method, 'paid', 'completed', 0, _discount_type, _discount_value,
    0, 0, _notes, _idempotency_key
  );

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int, custom_price numeric) LOOP
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color,
             v.size AS variant_size, p.slug AS product_slug, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id FOR UPDATE OF v;

      IF variant.variant_id IS NOT NULL THEN
        IF variant.stock < item.qty THEN
          UPDATE public.product_variants SET conflict_reconciliation_needed = true WHERE id = variant.variant_id;
        END IF;

        sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);

        INSERT INTO public.offline_sale_items (
          sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot,
          color, size, barcode
        ) VALUES (
          new_sale_id, variant.product_slug, variant.variant_id, item.qty,
          COALESCE(item.custom_price, variant.price),
          (COALESCE(item.custom_price, variant.price) * item.qty),
          variant.variant_sku, variant.variant_color, variant.variant_size, variant.variant_barcode
        );

        UPDATE public.product_variants SET stock = stock - item.qty WHERE id = variant.variant_id;
        UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', new_sale_id, 'Offline POS sale', uid
        );
      ELSE
        sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
        INSERT INTO public.offline_sale_items (
          sale_id, product_slug, qty, unit_price, subtotal
        ) VALUES (
          new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
        );
      END IF;
    ELSE
      sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
      INSERT INTO public.offline_sale_items (
        sale_id, product_slug, qty, unit_price, subtotal
      ) VALUES (
        new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
      );
    END IF;
  END LOOP;

  IF _discount_type = 'percentage' THEN
    final_discount_amount := round((sale_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    final_discount_amount := _discount_value;
  ELSE
    final_discount_amount := 0;
  END IF;

  IF final_discount_amount > sale_subtotal THEN
    final_discount_amount := sale_subtotal;
  END IF;

  final_total := sale_subtotal - final_discount_amount;

  UPDATE public.offline_sales
  SET subtotal = sale_subtotal, discount_amount = final_discount_amount, total_amount = final_total
  WHERE id = new_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'total_amount', final_total
  );
END;
$$;

-- 8. Update sync_offline_sales RPC
CREATE OR REPLACE FUNCTION public.sync_offline_sales(_sales jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  sale record;
  item record;
  variant record;
  res jsonb := '[]'::jsonb;
  v_sale_id uuid;
  v_subtotal numeric;
  v_discount numeric;
  v_total numeric;
BEGIN
  FOR sale IN SELECT * FROM jsonb_to_recordset(_sales) AS x(
    temp_id text, sale_number text, customer_id uuid, customer_name text,
    customer_phone text, customer_email text, payment_method text,
    discount_type text, discount_value numeric, discount_amount numeric,
    notes text, idempotency_key text, items jsonb, created_at timestamptz
  ) LOOP
    SELECT id INTO v_sale_id FROM public.offline_sales WHERE idempotency_key = sale.idempotency_key;
    
    IF v_sale_id IS NULL THEN
      v_sale_id := gen_random_uuid();
      v_subtotal := 0;

      INSERT INTO public.offline_sales (
        id, sale_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
        payment_method, payment_status, status, subtotal, discount_type, discount_value,
        discount_amount, total_amount, notes, idempotency_key, created_at
      ) VALUES (
        v_sale_id, COALESCE(sale.sale_number, public.generate_sale_number()), uid, sale.customer_id,
        sale.customer_name, sale.customer_phone, sale.customer_email, sale.payment_method,
        'paid', 'completed', 0, sale.discount_type, sale.discount_value,
        sale.discount_amount, 0, sale.notes, sale.idempotency_key, COALESCE(sale.created_at, now())
      );

      FOR item IN SELECT * FROM jsonb_to_recordset(sale.items) AS y(
        variant_id uuid, product_slug text, qty int, custom_price numeric
      ) LOOP
        IF item.variant_id IS NOT NULL THEN
          SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price,
                 v.sku AS variant_sku, v.color AS variant_color, v.size AS variant_size,
                 v.barcode AS variant_barcode, p.slug AS product_slug, p.id AS p_id
          INTO variant
          FROM public.product_variants v
          JOIN public.products p ON p.id = v.product_id
          WHERE v.id = item.variant_id FOR UPDATE OF v;

          IF variant.variant_id IS NOT NULL THEN
            IF variant.stock < item.qty THEN
              UPDATE public.product_variants SET conflict_reconciliation_needed = true WHERE id = variant.variant_id;
            END IF;

            v_subtotal := v_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);

            INSERT INTO public.offline_sale_items (
              sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot,
              color, size, barcode
            ) VALUES (
              v_sale_id, variant.product_slug, variant.variant_id, item.qty,
              COALESCE(item.custom_price, variant.price),
              (COALESCE(item.custom_price, variant.price) * item.qty),
              variant.variant_sku, variant.variant_color, variant.variant_size, variant.variant_barcode
            );

            UPDATE public.product_variants SET stock = stock - item.qty WHERE id = variant.variant_id;
            UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

            INSERT INTO public.inventory_transactions (
              product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
            ) VALUES (
              variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', v_sale_id, 'Offline POS sync', uid
            );
          ELSE
            v_subtotal := v_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
            INSERT INTO public.offline_sale_items (
              sale_id, product_slug, qty, unit_price, subtotal
            ) VALUES (
              v_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
            );
          END IF;
        ELSE
          v_subtotal := v_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
          INSERT INTO public.offline_sale_items (
            sale_id, product_slug, qty, unit_price, subtotal
          ) VALUES (
            v_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
          );
        END IF;
      END LOOP;

      v_discount := COALESCE(sale.discount_amount, 0);
      IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
      v_total := v_subtotal - v_discount;

      UPDATE public.offline_sales
      SET subtotal = v_subtotal, discount_amount = v_discount, total_amount = v_total
      WHERE id = v_sale_id;
    END IF;

    res := res || jsonb_build_object('temp_id', sale.temp_id, 'server_id', v_sale_id);
  END LOOP;

  RETURN res;
END;
$$;
