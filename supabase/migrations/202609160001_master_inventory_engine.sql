-- ============================================================
-- MASTER INVENTORY ENGINE
-- Implements variants, offline sync queue, and authoritative atomic stock
-- ============================================================

-- 1. App Settings Table for global toggles (COD, Open Box)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

-- Insert defaults
INSERT INTO public.app_settings (key, value, description)
VALUES 
  ('enable_cod', 'true'::jsonb, 'Enable Cash on Delivery'),
  ('enable_open_box', 'false'::jsonb, 'Enable Open Box Delivery')
ON CONFLICT (key) DO NOTHING;

-- 2. Add product_variants table (in case it was dropped by mistake) and conflict flag
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  stock int NOT NULL DEFAULT 0,
  price_override numeric,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  conflict_reconciliation_needed boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);

-- Adding RLS policies for product_variants just in case
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "product variants public read" ON public.product_variants FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admins manage product variants" ON public.product_variants FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Data Migration: Ensure every product has at least one variant (Default)
-- We need a default variant so we can use variant_id safely
INSERT INTO public.product_variants (product_id, name, sku, stock, price_override)
SELECT id, 'Default', sku, stock, price
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id
);

-- 4. Ensure foreign keys for variant_id are strict (or will be)
-- cart_items, order_items, inventory_transactions have variant_id
-- We'll try to map them for existing data
UPDATE public.cart_items c
SET variant_id = v.id
FROM public.product_variants v
WHERE c.product_id = v.product_id AND c.variant_id IS NULL AND v.name = 'Default';

UPDATE public.order_items o
SET variant_id = v.id
FROM public.products p
JOIN public.product_variants v ON p.id = v.product_id
WHERE o.product_slug = p.slug AND o.variant_id IS NULL AND v.name = 'Default';

UPDATE public.inventory_transactions t
SET variant_id = v.id
FROM public.product_variants v
WHERE t.product_id = v.product_id AND t.variant_id IS NULL AND v.name = 'Default';

-- Now let's drop the restore_stock trigger (since we'll do it explicitly in the RPCs)
DROP TRIGGER IF EXISTS orders_restore_stock_trigger ON public.orders;

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

-- 5. Rewrite place_order to use variant_id
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
  _items jsonb DEFAULT '[]'::jsonb -- Now expects { variant_id: uuid, qty: int }
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

  -- Verify COD is enabled if they chose COD
  IF _payment_method = 'cod' THEN
    IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'enable_cod' AND value = 'true'::jsonb) THEN
      RAISE EXCEPTION 'Cash on Delivery is currently disabled by the administrator.';
    END IF;
  END IF;

  -- Pre-fetch shipping settings (safe to assume standard defaults if missing)
  SELECT value INTO _fd_enabled FROM public.site_settings WHERE key = 'free_delivery_enabled';
  IF _fd_enabled IS NOT NULL THEN is_fd_enabled := (_fd_enabled = 'true'); END IF;
  
  SELECT value INTO _fd_threshold FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF _fd_threshold IS NOT NULL THEN fd_threshold := _fd_threshold::numeric; END IF;
  
  SELECT value INTO _fd_charge FROM public.site_settings WHERE key = 'standard_shipping_charge';
  IF _fd_charge IS NOT NULL THEN std_shipping := _fd_charge::numeric; END IF;

  -- Initialize order ID
  new_order_id := gen_random_uuid();

  -- First Pass: Calculate subtotal and lock variants
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    
    -- Lock variant row and get its parent product data
    SELECT v.id AS variant_id, v.product_id, v.stock, COALESCE(v.price_override, p.price) AS price, v.name AS variant_name, v.sku AS variant_sku, p.name AS product_name, p.slug AS product_slug, p.sales_channel, p.is_active, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v; -- STRICT LOCK ON VARIANT

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
      RAISE EXCEPTION 'Insufficient stock for % - % (Requested: %, Available: %)', variant.product_name, variant.variant_name, item.qty, variant.stock;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  -- Apply Coupon
  IF _coupon_code IS NOT NULL AND _coupon_code != '' THEN
    coupon_result := public.calculate_coupon_discount(_coupon_code, computed_subtotal);
    IF (coupon_result->>'valid')::boolean = true THEN
      computed_discount := (coupon_result->>'discount_amount')::numeric;
    END IF;
  END IF;

  eligible_subtotal := computed_subtotal - computed_discount;

  -- Shipping Logic
  IF is_fd_enabled AND eligible_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := eligible_subtotal + shipping;

  -- Generate Numbers
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  -- Insert Order
  INSERT INTO public.orders (
    id, user_id, invoice_number, order_number, subtotal, shipping_fee, discount_amount, total_amount, coupon_code, status, payment_method, payment_status,
    shipping_name, shipping_phone, alt_phone, shipping_address, address_line2, landmark, shipping_city, shipping_state, shipping_pincode, notes
  ) VALUES (
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, computed_discount, computed_total, _coupon_code, 'placed', _payment_method, 
    CASE WHEN _payment_method = 'cod' THEN 'pending' ELSE 'processing' END,
    _full_name, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode, _notes
  );

  -- Log initial status
  INSERT INTO public.order_status_history (order_id, status, notes, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully', uid);

  -- Insert Items and Deduct Stock Atomically
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku, p.slug AS product_slug, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id;

    -- Insert Order Item
    INSERT INTO public.order_items (
      order_id, product_slug, variant_id, qty, subtotal, sku_snapshot, price_at_time
    ) VALUES (
      new_order_id, variant.product_slug, variant.variant_id, item.qty, (variant.price * item.qty), variant.variant_sku, variant.price
    );

    -- Deduct Variant Stock
    UPDATE public.product_variants
    SET stock = stock - item.qty
    WHERE id = variant.variant_id;

    -- Update Parent Stock Cache (optional but good for backwards compatibility if needed)
    UPDATE public.products
    SET stock = stock - item.qty
    WHERE id = variant.p_id;

    -- Log transaction
    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale', -item.qty, 'order', new_order_id, 'Stock deducted for online order', uid
    );
  END LOOP;

  -- Clear user cart since it succeeded
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

-- 6. Rewrite place_offline_sale to use variant_id
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _items jsonb, -- Expects { variant_id: uuid, qty: int, custom_price: numeric }
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
  new_receipt_number text;
  item record;
  variant record;
  computed_subtotal numeric := 0;
  computed_total numeric := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'pos') THEN
    RAISE EXCEPTION 'Unauthorized to place offline sale';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one item';
  END IF;

  -- Check idempotency
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO new_sale_id FROM public.offline_sales WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'sale_id', new_sale_id,
        'message', 'Sale already processed'
      );
    END IF;
  END IF;

  new_sale_id := gen_random_uuid();
  new_receipt_number := public.generate_pos_sale_number();

  -- First Pass: Calculate and lock
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int, custom_price numeric) LOOP
    SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price, p.name AS product_name, v.name AS variant_name, p.is_active, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v; -- STRICT LOCK

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Variant % not found', item.variant_id;
    END IF;

    -- Notice: POS CAN sell OFFLINE_ONLY products. No check needed.

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % - % (Requested: %, Available: %)', variant.product_name, variant.variant_name, item.qty, variant.stock;
    END IF;

    computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);
  END LOOP;

  computed_total := computed_subtotal - COALESCE(_discount, 0);
  IF computed_total < 0 THEN computed_total := 0; END IF;

  -- Insert Sale
  INSERT INTO public.offline_sales (
    id, receipt_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
    subtotal, discount_type, discount_value, discount_amount, total_amount, payment_method, notes, idempotency_key
  ) VALUES (
    new_sale_id, new_receipt_number, uid, _customer_id, _customer_name, _customer_phone, _customer_email,
    computed_subtotal, _discount_type, _discount_value, COALESCE(_discount, 0), computed_total, _payment_method, _notes, _idempotency_key
  );

  -- Insert Items and Deduct Stock
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int, custom_price numeric) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku, p.slug AS product_slug, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id;

    INSERT INTO public.offline_sale_items (
      sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot
    ) VALUES (
      new_sale_id, variant.product_slug, variant.variant_id, item.qty, COALESCE(item.custom_price, variant.price), (COALESCE(item.custom_price, variant.price) * item.qty), variant.variant_sku
    );

    UPDATE public.product_variants
    SET stock = stock - item.qty
    WHERE id = variant.variant_id;
    
    UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', new_sale_id, 'Stock deducted for POS sale', uid
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', new_sale_id,
    'receipt_number', new_receipt_number
  );
END;
$$;

-- 7. Rewrite cancel_customer_order to atomically restore stock explicitly
CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
  item record;
  variant record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF ord.user_id != uid AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'This order has already been shipped and can no longer be cancelled.';
  END IF;

  IF ord.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order has already been cancelled.';
  END IF;

  IF ord.status NOT IN ('placed', 'pending', 'confirmed', 'processing', 'packed') THEN
    RAISE EXCEPTION 'Order with status "%" cannot be cancelled.', ord.status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Customer cancelled before shipment');

  UPDATE public.orders
  SET
    status = 'cancelled',
    cancellation_reason = final_reason,
    cancelled_at = now(),
    cancelled_by = uid
  WHERE id = order_id;

  -- Restore stock explicitly
  FOR item IN SELECT * FROM public.order_items WHERE public.order_items.order_id = cancel_customer_order.order_id LOOP
    
    SELECT v.id AS variant_id, p.id AS p_id
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v;

    IF variant.variant_id IS NOT NULL THEN
      UPDATE public.product_variants SET stock = stock + item.qty WHERE id = variant.variant_id;
      UPDATE public.products SET stock = stock + item.qty WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'adjustment', item.qty, 'order', cancel_customer_order.order_id, 'Stock restored due to cancellation', uid
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'status', 'cancelled'
  );
END;
$$;

-- 8. sync_offline_sales
CREATE OR REPLACE FUNCTION public.sync_offline_sales(
  _sales jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  sale record;
  item record;
  variant record;
  sync_results jsonb := '[]'::jsonb;
  new_sale_id uuid;
  new_receipt_number text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'pos') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR sale IN SELECT * FROM jsonb_to_recordset(_sales) AS x(
    idempotency_key text, items jsonb, payment_method text, customer_id uuid, customer_name text, customer_phone text, customer_email text, discount_type text, discount_value numeric, discount numeric, notes text
  ) LOOP
    
    -- Check idempotency
    SELECT id INTO new_sale_id FROM public.offline_sales WHERE idempotency_key = sale.idempotency_key;
    IF FOUND THEN
      sync_results := sync_results || jsonb_build_object('idempotency_key', sale.idempotency_key, 'sale_id', new_sale_id, 'status', 'skipped_exists');
      CONTINUE;
    END IF;

    -- Process sale (ALLOW NEGATIVE STOCK FOR CONFLICTS)
    new_sale_id := gen_random_uuid();
    new_receipt_number := public.generate_pos_sale_number();

    INSERT INTO public.offline_sales (
      id, receipt_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
      subtotal, discount_type, discount_value, discount_amount, total_amount, payment_method, notes, idempotency_key
    ) VALUES (
      new_sale_id, new_receipt_number, uid, sale.customer_id, sale.customer_name, sale.customer_phone, sale.customer_email,
      0, sale.discount_type, sale.discount_value, COALESCE(sale.discount, 0), 0, sale.payment_method, sale.notes, sale.idempotency_key
    );

    DECLARE
      sale_subtotal numeric := 0;
    BEGIN
      FOR item IN SELECT * FROM jsonb_to_recordset(sale.items) AS x(variant_id uuid, qty int, custom_price numeric) LOOP
        SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku, p.slug AS product_slug, p.id AS p_id
        INTO variant
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = item.variant_id FOR UPDATE OF v;

        IF variant.variant_id IS NOT NULL THEN
          -- Check for conflict (negative stock)
          IF variant.stock < item.qty THEN
            UPDATE public.product_variants SET conflict_reconciliation_needed = true WHERE id = variant.variant_id;
          END IF;

          sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);

          INSERT INTO public.offline_sale_items (
            sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot
          ) VALUES (
            new_sale_id, variant.product_slug, variant.variant_id, item.qty, COALESCE(item.custom_price, variant.price), (COALESCE(item.custom_price, variant.price) * item.qty), variant.variant_sku
          );

          UPDATE public.product_variants SET stock = stock - item.qty WHERE id = variant.variant_id;
          UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', new_sale_id, 'Stock deducted for offline POS sync', uid
          );
        END IF;
      END LOOP;

      UPDATE public.offline_sales 
      SET subtotal = sale_subtotal, total_amount = GREATEST(0, sale_subtotal - COALESCE(sale.discount, 0))
      WHERE id = new_sale_id;
    END;

    sync_results := sync_results || jsonb_build_object('idempotency_key', sale.idempotency_key, 'sale_id', new_sale_id, 'status', 'synced');
  END LOOP;

  RETURN sync_results;
END;
$$;
