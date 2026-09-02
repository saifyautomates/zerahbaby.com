-- Migration: 20260928000030_root_cause_financial_and_inventory_reconciliation.sql
-- Description: Comprehensive Root-Cause Financial & Inventory Reconciliation
--   1. Adds buying_price snapshot to order_items and offline_sale_items
--   2. Adds idempotency_key to offline_returns with UNIQUE indexes on offline_sales & offline_returns
--   3. Adds variant_id to offline_return_items and ensures atomic variant restocking in returns
--   4. Updates place_offline_sale, place_order, and process_offline_return canonical RPCs
--   5. Backfills historical buying_price for existing line items from product_costs

-- ── 1. Schema Extensions ───────────────────────────────────────────
ALTER TABLE public.order_items 
  ADD COLUMN IF NOT EXISTS buying_price numeric NOT NULL DEFAULT 0;

ALTER TABLE public.offline_sale_items 
  ADD COLUMN IF NOT EXISTS buying_price numeric NOT NULL DEFAULT 0;

ALTER TABLE public.offline_returns 
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.offline_return_items 
  ADD COLUMN IF NOT EXISTS variant_id uuid;

-- ── 2. Unique Idempotency Indexes ─────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_sales_idempotency_key 
  ON public.offline_sales(idempotency_key) 
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_returns_idempotency_key 
  ON public.offline_returns(idempotency_key) 
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

-- ── 3. Backfill Historical Buying Prices ───────────────────────────
UPDATE public.order_items oi
SET buying_price = COALESCE(pc.buying_price, 0)
FROM public.product_costs pc
WHERE oi.product_id = pc.product_id
  AND (oi.buying_price IS NULL OR oi.buying_price = 0);

UPDATE public.offline_sale_items osi
SET buying_price = COALESCE(pc.buying_price, 0)
FROM public.product_costs pc
WHERE osi.product_id = pc.product_id
  AND (osi.buying_price IS NULL OR osi.buying_price = 0);

-- Backfill idempotency_key on offline_returns from notes
UPDATE public.offline_returns
SET idempotency_key = substring(notes from '\[idem:([^\]]+)\]')
WHERE (idempotency_key IS NULL OR idempotency_key = '')
  AND notes LIKE '%[idem:%';

-- ── 4. Canonical place_offline_sale RPC ────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'place_offline_sale'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT '',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _customer_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_num text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_prod record;
  v_buying_price numeric := 0;
  v_order_token_num int;
  v_order_token_dt date;
  v_resolved_customer_id uuid := _customer_id;
  v_current_customer_credit numeric := 0;
  v_actual_credit_applied numeric := 0;
  v_existing_sale record;
  v_cash_payable numeric := 0;
  v_token_id uuid := NULL;
  v_token_cust_id uuid := NULL;
  v_token_balance numeric := 0;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT s.id, s.sale_number, s.total, s.subtotal, s.discount, s.payment_method,
           s.customer_name, s.customer_phone, s.store_credit_used, s.pos_token_number, s.pos_token_date
    INTO v_existing_sale
    FROM public.offline_sales s
    WHERE s.idempotency_key = _idempotency_key
       OR s.notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'discount_type', _discount_type,
        'discount_value', _discount_value,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_phone', v_existing_sale.customer_phone,
        'items_count', jsonb_array_length(_items),
        'store_credit_used', v_existing_sale.store_credit_used,
        'cash_payable', GREATEST(0, v_existing_sale.total - COALESCE(v_existing_sale.store_credit_used, 0)),
        'pos_token_number', v_existing_sale.pos_token_number,
        'pos_token_date', v_existing_sale.pos_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items Payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale cannot be completed without items';
  END IF;

  -- 3. Calculate Subtotal Strictly Server-Side
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    IF v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: % for %', v_item.qty, v_item.name;
    END IF;
    v_subtotal := v_subtotal + (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty);
  END LOOP;

  -- 4. Calculate Discount
  IF _discount_type = 'percentage' THEN
    v_discount := round((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal, COALESCE(_discount_value, 0));
  ELSE
    v_discount := 0;
  END IF;
  v_total := GREATEST(0, v_subtotal - v_discount);

  -- 5. Store Credit Validation & Resolution
  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
    SELECT id, customer_id, balance_after
    INTO v_token_id, v_token_cust_id, v_token_balance
    FROM public.store_credit_ledger
    WHERE credit_token = upper(trim(_credit_token))
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_token_id IS NOT NULL THEN
      IF v_resolved_customer_id IS NULL AND v_token_cust_id IS NOT NULL THEN
        v_resolved_customer_id := v_token_cust_id;
      END IF;
    END IF;
  END IF;

  IF v_resolved_customer_id IS NOT NULL THEN
    SELECT store_credit_balance INTO v_current_customer_credit
    FROM public.pos_customers
    WHERE id = v_resolved_customer_id
    FOR UPDATE;
    v_current_customer_credit := COALESCE(v_current_customer_credit, 0);
  ELSIF v_token_id IS NOT NULL THEN
    v_current_customer_credit := COALESCE(v_token_balance, 0);
  ELSE
    v_current_customer_credit := 0;
  END IF;

  IF _store_credit_used > 0 THEN
    IF _store_credit_used > v_current_customer_credit THEN
      RAISE EXCEPTION 'Requested store credit (₹%) exceeds available balance (₹%)',
        _store_credit_used, v_current_customer_credit;
    END IF;
    v_actual_credit_applied := LEAST(_store_credit_used, v_total);
  END IF;

  v_cash_payable := GREATEST(0, v_total - v_actual_credit_applied);

  -- 6. Generate Identifiers
  v_sale_num := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 100000)::text, 5, '0');
  v_order_token_dt := CURRENT_DATE;

  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  -- 7. Insert Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    subtotal,
    discount,
    discount_type,
    discount_value,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token_used,
    pos_token_number,
    pos_token_date,
    created_at
  ) VALUES (
    v_sale_num,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_resolved_customer_id,
    v_subtotal,
    v_discount,
    _discount_type,
    _discount_value,
    v_total,
    _payment_method,
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
        COALESCE(_notes, '') || ' [idem:' || _idempotency_key || ']'
      ELSE
        _notes
    END,
    _idempotency_key,
    v_actual_credit_applied,
    CASE WHEN v_actual_credit_applied > 0 THEN upper(trim(COALESCE(_credit_token, ''))) ELSE NULL END,
    v_order_token_num,
    v_order_token_dt,
    now()
  ) RETURNING id INTO v_sale_id;

  -- 8. Process Line Items, Deduct Inventory & Capture Historical Buying Price
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    v_buying_price := 0;

    -- Look up product & lock for atomic inventory deduction
    IF v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN
      SELECT id, stock INTO v_prod
      FROM public.products
      WHERE id = v_item.product_id::uuid
      FOR UPDATE;

      IF v_prod.id IS NOT NULL THEN
        UPDATE public.products
        SET stock = GREATEST(0, stock - v_item.qty),
            updated_at = now()
        WHERE id = v_prod.id;

        -- Capture historical buying price snapshot
        SELECT COALESCE(buying_price, 0) INTO v_buying_price
        FROM public.product_costs
        WHERE product_id = v_prod.id
        LIMIT 1;

        -- If variant specified, deduct variant stock as well
        IF v_item.variant_id IS NOT NULL AND v_item.variant_id != '' THEN
          UPDATE public.product_variants
          SET stock = GREATEST(0, stock - v_item.qty),
              updated_at = now()
          WHERE id = v_item.variant_id::uuid;
        END IF;

        -- Log to inventory transactions ledger
        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          note
        ) VALUES (
          v_prod.id,
          CASE WHEN v_item.variant_id IS NOT NULL AND v_item.variant_id != '' THEN v_item.variant_id::uuid ELSE NULL END,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          v_prod.stock,
          GREATEST(0, v_prod.stock - v_item.qty),
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_num
        );
      END IF;
    END IF;

    -- Insert sale line item with historical buying_price snapshot
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      product_slug,
      name,
      sku,
      qty,
      price,
      subtotal,
      buying_price
    ) VALUES (
      v_sale_id,
      CASE WHEN v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN v_item.product_id::uuid ELSE NULL END,
      COALESCE(v_item.product_slug, ''),
      v_item.name,
      COALESCE(v_item.sku, ''),
      v_item.qty,
      COALESCE(v_item.custom_price, v_item.price, 0),
      (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty),
      COALESCE(v_buying_price, 0)
    );
  END LOOP;

  -- 9. Deduct Store Credit & Log to Ledger
  IF v_actual_credit_applied > 0 THEN
    IF v_resolved_customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_actual_credit_applied),
          updated_at = now()
      WHERE id = v_resolved_customer_id;
    END IF;

    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      sale_id,
      credit_token,
      notes
    ) VALUES (
      v_resolved_customer_id,
      _customer_name,
      _customer_phone,
      'redemption',
      v_actual_credit_applied,
      v_current_customer_credit,
      GREATEST(0, v_current_customer_credit - v_actual_credit_applied),
      v_sale_id,
      upper(trim(COALESCE(_credit_token, ''))),
      'Applied to POS Sale #' || v_sale_num
    );
  END IF;

  -- 10. Update Customer Profile Metrics
  IF v_resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spent = COALESCE(total_spent, 0) + v_total,
        total_spend = COALESCE(total_spend, 0) + v_total,
        total_visits = COALESCE(total_visits, 0) + 1,
        last_visit = now(),
        updated_at = now()
    WHERE id = v_resolved_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_num,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'items_count', jsonb_array_length(_items),
    'store_credit_used', v_actual_credit_applied,
    'cash_payable', v_cash_payable,
    'pos_token_number', v_order_token_num,
    'pos_token_date', v_order_token_dt,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, anon, service_role;

-- ── 5. Canonical place_order RPC ──────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'place_order'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_order(
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _payment_method text,
  _items jsonb,
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
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;

    SELECT v.id, COALESCE(v.price_override, p.price) AS price, v.stock, p.name, p.is_active
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product variant % not found', item.variant_id;
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

  -- 5. Free Delivery Evaluation
  SELECT COALESCE((value::jsonb->>'threshold')::numeric, 999) INTO fd_threshold
  FROM public.site_settings WHERE key = 'free_delivery_threshold';

  SELECT COALESCE((value::jsonb->>'is_enabled')::boolean, true) INTO is_fd_enabled
  FROM public.site_settings WHERE key = 'free_delivery_threshold';

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

  -- 7. Insert Items, Deduct Stock & Capture Historical Buying Price Snapshot
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

  -- 8. Clean up user's cart in database
  DELETE FROM public.cart_items WHERE user_id = uid;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'shipping', shipping,
    'total', computed_total,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- ── 6. Canonical process_offline_return RPC ────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'process_offline_return'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _customer_id uuid,
  _refund_method text,
  _return_reason text,
  _notes text,
  _original_sale_number text,
  _items jsonb,
  _idempotency_key text DEFAULT NULL,
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_return record;
  uid uuid;
  user_role text;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  computed_total_refund numeric := 0;
  item record;
  prod record;
  resolved_customer_id uuid := _customer_id;
  current_customer_credit numeric := 0;
  new_customer_credit numeric := 0;
  orig_item_qty integer;
  already_ret_qty integer;
  rem_returnable integer;
  v_variant_id uuid := NULL;
BEGIN
  -- 1. Authentication & Authorization Verification
  uid := auth.uid();
  IF uid IS NOT NULL THEN
    SELECT role INTO user_role FROM public.user_roles WHERE user_id = uid LIMIT 1;
    IF user_role IS NULL OR user_role NOT IN ('admin', 'staff', 'manager', 'owner') THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true) THEN
        RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
      END IF;
    END IF;
  END IF;

  -- 2. Idempotency Check (prevent duplicate return submissions)
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, return_number, refund_amount, credit_token
    INTO existing_return
    FROM public.offline_returns
    WHERE idempotency_key = _idempotency_key
       OR notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;

    IF existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', existing_return.id,
        'return_number', existing_return.return_number,
        'refund_amount', existing_return.refund_amount,
        'credit_token', existing_return.credit_token,
        'customer_name', _customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with no items specified';
  END IF;

  -- 4. Calculate total refund strictly server-side & validate returnable bounds
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(
      product_id text, 
      variant_id text,
      product_slug text, 
      qty int, 
      refund_price numeric, 
      name text, 
      sku text, 
      barcode text, 
      variant_info text, 
      mrp numeric,
      original_sale_item_id text
    )
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item %', item.qty, item.name;
    END IF;
    IF item.refund_price IS NULL OR item.refund_price < 0 THEN
      RAISE EXCEPTION 'Invalid refund price % for item %', item.refund_price, item.name;
    END IF;

    -- Strict partial return validation against original sale item
    IF item.original_sale_item_id IS NOT NULL AND item.original_sale_item_id != '' THEN
      SELECT qty INTO orig_item_qty
      FROM public.offline_sale_items
      WHERE id = item.original_sale_item_id::uuid;

      IF orig_item_qty IS NOT NULL THEN
        SELECT COALESCE(SUM(qty), 0) INTO already_ret_qty
        FROM public.offline_return_items
        WHERE original_sale_item_id = item.original_sale_item_id::uuid;

        rem_returnable := orig_item_qty - already_ret_qty;
        IF item.qty > rem_returnable THEN
          RAISE EXCEPTION 'Cannot return % units of %; only % units remain returnable on invoice item',
            item.qty, COALESCE(item.name, 'Product'), GREATEST(0, rem_returnable);
        END IF;
      END IF;
    END IF;

    computed_total_refund := computed_total_refund + (item.refund_price * item.qty);
  END LOOP;

  -- 5. Resolve or create customer account if phone provided
  IF resolved_customer_id IS NULL AND _customer_phone IS NOT NULL AND trim(_customer_phone) != '' THEN
    SELECT id INTO resolved_customer_id
    FROM public.pos_customers
    WHERE phone = trim(_customer_phone)
    LIMIT 1;

    IF resolved_customer_id IS NULL AND _customer_name IS NOT NULL AND trim(_customer_name) != '' THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        store_credit_balance,
        total_spend,
        total_spent,
        total_purchases,
        total_visits
      ) VALUES (
        trim(_customer_name),
        trim(_customer_phone),
        COALESCE(trim(_customer_email), ''),
        0,
        0,
        0,
        0,
        0
      ) RETURNING id INTO resolved_customer_id;
    END IF;
  END IF;

  -- 6. Generate return identifier & snappy 1 Letter + 3 Digits Store Credit Code (e.g. A123, P258)
  new_return_number := public.generate_pos_return_number();
  new_credit_token := public.generate_store_credit_code();

  -- 7. Insert into public.offline_returns
  INSERT INTO public.offline_returns (
    return_number,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    refund_amount,
    refund_method,
    refund_status,
    return_reason,
    notes,
    status,
    created_by,
    credit_token,
    original_sale_id,
    idempotency_key
  ) VALUES (
    new_return_number,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    resolved_customer_id,
    computed_total_refund,
    'exchange_credit',
    'completed',
    COALESCE(_return_reason, 'Store Credit / Exchange'),
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
        COALESCE(_notes, '') || ' [idem:' || _idempotency_key || '] [voucher:' || new_credit_token || ']'
      ELSE
        COALESCE(_notes, '') || ' [voucher:' || new_credit_token || ']'
    END,
    'completed',
    uid,
    new_credit_token,
    _original_sale_id,
    _idempotency_key
  ) RETURNING id INTO new_return_id;

  -- 8. Process items: lock products, increase inventory (both product AND variant), and log transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(
      product_id text, 
      variant_id text,
      product_slug text, 
      qty int, 
      refund_price numeric, 
      name text, 
      sku text, 
      barcode text, 
      variant_info text, 
      mrp numeric,
      original_sale_item_id text
    )
  LOOP
    v_variant_id := NULL;
    IF item.variant_id IS NOT NULL AND item.variant_id != '' THEN
      v_variant_id := item.variant_id::uuid;
    END IF;

    IF item.product_id IS NOT NULL AND item.product_id != '' AND item.product_id != 'walk-in-return' THEN
      SELECT id, stock INTO prod
      FROM public.products
      WHERE id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        -- Atomic stock increase on parent product
        UPDATE public.products
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = prod.id;

        -- Atomic stock increase on variant if present
        IF v_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item.qty,
              updated_at = now()
          WHERE id = v_variant_id;
        END IF;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          note,
          created_by
        ) VALUES (
          prod.id,
          v_variant_id,
          'return'::public.inventory_tx_type,
          item.qty,
          prod.stock,
          prod.stock + item.qty,
          'pos_return',
          new_return_id,
          'POS Return restock #' || new_return_number || ' (' || COALESCE(item.name, 'Product') || ')',
          uid
        );
      END IF;
    END IF;

    -- Insert return line item with variant_id
    INSERT INTO public.offline_return_items (
      return_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      qty,
      unit_mrp,
      mrp_snapshot,
      refund_price,
      original_sale_item_id
    ) VALUES (
      new_return_id,
      CASE WHEN item.product_id = 'walk-in-return' THEN NULL ELSE item.product_id::uuid END,
      v_variant_id,
      COALESCE(item.product_slug, ''),
      COALESCE(item.name, 'Returned Product'),
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      COALESCE(item.variant_info, ''),
      item.qty,
      COALESCE(item.mrp, item.refund_price, 0),
      COALESCE(item.mrp, item.refund_price, 0),
      item.refund_price,
      CASE 
        WHEN item.original_sale_item_id IS NOT NULL AND item.original_sale_item_id != '' 
        THEN item.original_sale_item_id::uuid 
        ELSE NULL 
      END
    );
  END LOOP;

  -- 9. Credit customer ledger & account balance atomically
  IF resolved_customer_id IS NOT NULL THEN
    SELECT store_credit_balance INTO current_customer_credit
    FROM public.pos_customers
    WHERE id = resolved_customer_id
    FOR UPDATE;

    current_customer_credit := COALESCE(current_customer_credit, 0);
    new_customer_credit := current_customer_credit + computed_total_refund;

    UPDATE public.pos_customers
    SET store_credit_balance = new_customer_credit,
        updated_at = now()
    WHERE id = resolved_customer_id;
  ELSE
    current_customer_credit := 0;
    new_customer_credit := computed_total_refund;
  END IF;

  INSERT INTO public.store_credit_ledger (
    customer_id,
    customer_name,
    customer_phone,
    type,
    amount,
    balance_before,
    balance_after,
    return_id,
    credit_token,
    notes
  ) VALUES (
    resolved_customer_id,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    'issuance',
    computed_total_refund,
    current_customer_credit,
    new_customer_credit,
    new_return_id,
    new_credit_token,
    'Exchange Store Credit for Return #' || new_return_number
  );

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'new_balance', new_customer_credit,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, anon, service_role;
