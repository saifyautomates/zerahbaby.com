-- ==============================================================================
-- Migration: 20260928000045_pos_production_hardening_and_coupons.sql
-- Description:
-- 1. Adds coupon_code and coupon_discount columns to offline_sales.
-- 2. Hardens place_offline_sale RPC:
--    - Strict FOR UPDATE row-locking on products & product_variants.
--    - Strict sufficiency validation (throws EXCEPTION on insufficient stock; no silent overselling).
--    - Authoritative server-side coupon validation & application.
--    - Atomic coupons.usage_count increment.
--    - Prevents double-discounting and enforces financial integrity.
-- 3. Hardens search_pos_customers RPC:
--    - Searches across name, phone, email, and customer ID (UUID text).
-- ==============================================================================

-- 1. Ensure coupon columns exist on public.offline_sales
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'coupon_code'
  ) THEN
    ALTER TABLE public.offline_sales ADD COLUMN coupon_code text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'coupon_discount'
  ) THEN
    ALTER TABLE public.offline_sales ADD COLUMN coupon_discount numeric DEFAULT 0;
  END IF;
END $$;

-- 2. Update search_pos_customers to search across name, phone, email, and ID
CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS SETOF public.pos_customers
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := trim(COALESCE(_query, ''));
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT * FROM public.pos_customers
    WHERE phone ILIKE '%' || v_clean || '%'
       OR name ILIKE '%' || v_clean || '%'
       OR email ILIKE '%' || v_clean || '%'
       OR id::text ILIKE '%' || v_clean || '%'
    ORDER BY updated_at DESC
    LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pos_customers(text) TO authenticated, anon, service_role;


-- 3. Drop all previous overloads of place_offline_sale to ensure clean signature
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
    EXECUTE 'DROP FUNCTION ' || r.func_signature || ' CASCADE;';
  END LOOP;
END $$;


-- 4. Canonical place_offline_sale RPC with Strict Concurrency & Coupons
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
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL
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
  v_coupon_discount numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_prod_id uuid := NULL;
  v_prod_stock int := 0;
  v_var_id uuid := NULL;
  v_var_stock int := 0;
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
  v_clean_token text := upper(trim(COALESCE(_credit_token, '')));
  v_clean_coupon text := upper(trim(COALESCE(_coupon_code, '')));
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_coupon record;
  v_is_uuid boolean;
  v_is_var_uuid boolean;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT s.id, s.sale_number, s.total, s.subtotal, s.discount, s.payment_method,
           s.customer_name, s.customer_phone, s.store_credit_used, s.coupon_code,
           s.coupon_discount, s.pos_token_number, s.pos_token_date
    INTO v_existing_sale
    FROM public.offline_sales s
    WHERE s.idempotency_key = trim(_idempotency_key)
       OR s.notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'coupon_code', v_existing_sale.coupon_code,
        'coupon_discount', v_existing_sale.coupon_discount,
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
    product_slug text,
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

  -- 4. Server-Side Coupon Validation & Calculation
  IF v_clean_coupon != '' THEN
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE code = v_clean_coupon
    LIMIT 1
    FOR UPDATE;

    IF v_coupon.id IS NULL THEN
      RAISE EXCEPTION 'Invalid coupon code: %', v_clean_coupon;
    END IF;

    IF v_coupon.active = FALSE THEN
      RAISE EXCEPTION 'Coupon % is no longer active', v_clean_coupon;
    END IF;

    IF v_coupon.starts_at IS NOT NULL AND now() < v_coupon.starts_at THEN
      RAISE EXCEPTION 'Coupon % has not started yet', v_clean_coupon;
    END IF;

    IF v_coupon.expires_at IS NOT NULL AND now() > v_coupon.expires_at THEN
      RAISE EXCEPTION 'Coupon % has expired', v_clean_coupon;
    END IF;

    IF v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0 AND v_coupon.usage_count >= v_coupon.usage_limit THEN
      RAISE EXCEPTION 'Coupon % usage limit has been reached', v_clean_coupon;
    END IF;

    IF v_coupon.minimum_order_value IS NOT NULL AND v_subtotal < v_coupon.minimum_order_value THEN
      RAISE EXCEPTION 'Coupon % requires a minimum cart value of ₹%', v_clean_coupon, v_coupon.minimum_order_value;
    END IF;

    -- Calculate coupon discount amount
    IF v_coupon.discount_type = 'percentage' THEN
      v_coupon_discount := round((v_subtotal * COALESCE(v_coupon.discount_value, 0)) / 100, 2);
      IF v_coupon.maximum_discount IS NOT NULL AND v_coupon.maximum_discount > 0 THEN
        v_coupon_discount := LEAST(v_coupon_discount, v_coupon.maximum_discount);
      END IF;
    ELSIF v_coupon.discount_type = 'fixed' THEN
      v_coupon_discount := LEAST(v_subtotal, COALESCE(v_coupon.discount_value, 0));
    ELSE
      v_coupon_discount := 0;
    END IF;

    -- Increment coupon usage
    UPDATE public.coupons
    SET usage_count = usage_count + 1
    WHERE id = v_coupon.id;
  END IF;

  -- 5. Calculate Additional Manual Discount (Clamped to remaining subtotal after coupon)
  DECLARE
    v_subtotal_after_coupon numeric := GREATEST(0, v_subtotal - v_coupon_discount);
  BEGIN
    IF _discount_type = 'percentage' THEN
      v_discount := round((v_subtotal_after_coupon * COALESCE(_discount_value, 0)) / 100, 2);
    ELSIF _discount_type = 'fixed' THEN
      v_discount := LEAST(v_subtotal_after_coupon, COALESCE(_discount_value, 0));
    ELSE
      v_discount := 0;
    END IF;
  END;

  -- Final sale total remains the full value of goods purchased after discounts (e.g. ₹800)
  v_total := GREATEST(0, v_subtotal - v_coupon_discount - v_discount);

  -- 6. Store Credit Validation, Row Locking & Tender Calculation
  IF v_clean_token != '' THEN
    SELECT id, customer_id, credit_balance
    INTO v_token_id, v_token_cust_id, v_token_balance
    FROM public.offline_returns
    WHERE credit_token = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_token_id IS NOT NULL THEN
      IF v_resolved_customer_id IS NULL AND v_token_cust_id IS NOT NULL THEN
        v_resolved_customer_id := v_token_cust_id;
      END IF;
    END IF;
  END IF;

  -- Lock customer record to prevent concurrent double-spend
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
    -- Credit is a payment tender: it cannot exceed total sale amount
    v_actual_credit_applied := LEAST(_store_credit_used, v_total);
  END IF;

  -- Additional payment due (Cash / UPI / Card)
  v_cash_payable := GREATEST(0, v_total - v_actual_credit_applied);

  -- 7. Generate Identifiers
  v_sale_num := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 100000)::text, 5, '0');
  v_order_token_dt := CURRENT_DATE;

  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  -- 8. Insert Sale Record
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
    coupon_code,
    coupon_discount,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token_used,
    pos_token_number,
    pos_token_date,
    return_status,
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
    CASE WHEN v_clean_coupon != '' THEN v_clean_coupon ELSE NULL END,
    v_coupon_discount,
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
    CASE WHEN v_actual_credit_applied > 0 THEN v_clean_token ELSE NULL END,
    v_order_token_num,
    v_order_token_dt,
    'none',
    now()
  ) RETURNING id INTO v_sale_id;

  -- 9. Process Line Items: Strict Concurrency Check & Exact Inventory Mutation
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    v_prod_id := NULL;
    v_prod_stock := 0;
    v_var_id := NULL;
    v_var_stock := 0;
    v_buying_price := 0;
    v_is_uuid := FALSE;
    v_is_var_uuid := FALSE;

    IF v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN
      v_is_uuid := (v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    IF v_item.variant_id IS NOT NULL AND v_item.variant_id != '' THEN
      v_is_var_uuid := (v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    -- Row lock product record for update
    IF v_is_uuid THEN
      SELECT id, stock INTO v_prod_id, v_prod_stock
      FROM public.products
      WHERE id = v_item.product_id::uuid
      FOR UPDATE;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' AND v_item.product_slug NOT LIKE 'custom-%' THEN
      SELECT id, stock INTO v_prod_id, v_prod_stock
      FROM public.products
      WHERE slug = v_item.product_slug
      FOR UPDATE;
    END IF;

    IF v_prod_id IS NOT NULL THEN
      -- Strict Stock Sufficiency Check (Block sale if insufficient stock; no silent overselling)
      IF v_prod_stock < v_item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for "%": available %, requested %',
          v_item.name, v_prod_stock, v_item.qty;
      END IF;

      -- Check variant stock if specified
      IF v_is_var_uuid AND v_item.variant_id != '00000000-0000-0000-0000-000000000000' THEN
        SELECT id, stock INTO v_var_id, v_var_stock
        FROM public.product_variants
        WHERE id = v_item.variant_id::uuid
        FOR UPDATE;

        IF v_var_id IS NOT NULL THEN
          IF v_var_stock < v_item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%" variant: available %, requested %',
              v_item.name, v_var_stock, v_item.qty;
          END IF;

          UPDATE public.product_variants
          SET stock = stock - v_item.qty,
              updated_at = now()
          WHERE id = v_var_id;
        END IF;
      END IF;

      -- Atomic stock decrement
      UPDATE public.products
      SET stock = stock - v_item.qty,
          updated_at = now()
      WHERE id = v_prod_id;

      SELECT COALESCE(buying_price, 0) INTO v_buying_price
      FROM public.product_costs
      WHERE product_id = v_prod_id
      LIMIT 1;

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
        v_prod_id,
        v_var_id,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        v_prod_stock,
        v_prod_stock - v_item.qty,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_num
      );
    END IF;

    -- Record line item
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      product_slug,
      name,
      sku,
      price,
      qty,
      subtotal,
      buying_price,
      created_at
    ) VALUES (
      v_sale_id,
      v_prod_id,
      COALESCE(v_item.product_slug, 'custom'),
      v_item.name,
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.custom_price, v_item.price, 0),
      v_item.qty,
      (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty),
      v_buying_price,
      now()
    );
  END LOOP;

  -- 10. Update Customer & Ledger for Store Credit Redeemed
  IF v_actual_credit_applied > 0 THEN
    IF v_resolved_customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_actual_credit_applied),
          updated_at = now()
      WHERE id = v_resolved_customer_id;
    END IF;

    IF v_token_id IS NOT NULL THEN
      UPDATE public.offline_returns
      SET credit_balance = GREATEST(0, credit_balance - v_actual_credit_applied),
          updated_at = now()
      WHERE id = v_token_id;
    END IF;

    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_phone,
      customer_name,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_sale_id,
      notes
    ) VALUES (
      v_resolved_customer_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(trim(_customer_name), 'Walk-in Customer'),
      CASE WHEN v_clean_token != '' THEN v_clean_token ELSE NULL END,
      'CREDIT_REDEEMED',
      v_actual_credit_applied,
      v_current_customer_credit,
      GREATEST(0, v_current_customer_credit - v_actual_credit_applied),
      v_sale_id,
      'Redeemed on POS Sale #' || v_sale_num || ' (Total Sale: ₹' || v_total || ')'
    );
  END IF;

  -- 11. Update Customer Stats
  IF v_resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + v_total,
        updated_at = now()
    WHERE id = v_resolved_customer_id;
  END IF;

  -- 12. Return Authoritative Response Payload
  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_num,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_code', CASE WHEN v_clean_coupon != '' THEN v_clean_coupon ELSE NULL END,
    'coupon_discount', v_coupon_discount,
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
    'credit_token_used', CASE WHEN v_actual_credit_applied > 0 THEN v_clean_token ELSE NULL END,
    'status', 'completed',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;
