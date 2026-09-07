-- ==============================================================================
-- Migration: 20260928000127_harden_all_security_and_financial_loopholes.sql
-- Description:
-- Permanent Architectural Hardening of 12 Audited Loopholes:
-- 1. POS Financial RPCs Authorization Lockdown:
--    - Revoke anon execution on place_offline_sale, process_offline_return,
--      admin_void_offline_sale, admin_delete_offline_sale,
--      admin_bulk_void_offline_sales, and admin_hard_delete_offline_returns.
--    - Require authenticated cashier/admin role verification.
--    - Guard against negative item pricing, zero/negative quantities, and negative discounts.
-- 2. High-Entropy Store Credit Voucher Generator (8 uppercase alphanumeric characters).
-- 3. Standalone Product Support in finalize_paid_order & place_cod_order (null variant_id).
-- 4. Lockdown of finalize_paid_order: Restrict execution strictly to service_role & postgres.
-- 5. Removal of hardcoded backdoor test key in update_payment_settings.
-- 6. Fix SQL three-valued null comparison flaw on cancel_customer_order, request_online_return,
--    and process_open_box_delivery (prevent guest order hijacking).
-- 7. Coupons Privacy & Per-User Usage Limit Enforcement:
--    - Add is_public column to coupons and update RLS to hide secret/VIP codes from public select.
--    - Enforce coupon_usage per_user_limit inside create_checkout_session.
-- 8. Mask store owner PII (phone/email) from public reads on site_settings.
-- ==============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: HIGH-ENTROPY STORE CREDIT VOUCHER GENERATOR
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.generate_unique_exchange_credit_token() CASCADE;

CREATE OR REPLACE FUNCTION public.generate_unique_exchange_credit_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  res text := '';
  i int;
  attempts int := 0;
BEGIN
  LOOP
    attempts := attempts + 1;
    res := '';
    FOR i IN 1..8 LOOP
      res := res || substr(chars, (floor(random() * 32) + 1)::int, 1);
    END LOOP;

    -- Ensure token is unique among active offline returns and store credit ledger
    IF NOT EXISTS (
      SELECT 1 FROM public.offline_returns
      WHERE UPPER(credit_token) = res
        AND (credit_token_status = 'ACTIVE' OR credit_token_status IS NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.store_credit_ledger
      WHERE UPPER(credit_token) = res
    ) THEN
      RETURN res;
    END IF;

    IF attempts > 100 THEN
      RETURN upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_unique_exchange_credit_token() FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_unique_exchange_credit_token() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: HARDEN process_offline_return (CLOSE ANONYMOUS CREDIT MINTING)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) CASCADE;
DROP FUNCTION IF EXISTS public.process_offline_return CASCADE;

CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_qty int;
  item_refund_price numeric;
  item_mrp numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  item_orig_sale_item_id uuid;
  computed_total_refund numeric := 0;
  v_prod record;
  v_variant record;
  v_orig_sale record;
  v_orig_item record;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
BEGIN
  -- 1. Strict Authorization Gate (Only authenticated staff / admin can process returns)
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin')
    AND NOT public.has_role(uid, 'pos_user')
    AND NOT public.has_role(uid, 'staff')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can process returns';
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, customer_name, original_sale_id, original_sale_number, expires_at
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token, _customer_name, v_clean_sale_id, v_orig_sale_number, v_expiry_date
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'credit_token', new_credit_token,
        'expires_at', v_expiry_date,
        'customer_name', _customer_name,
        'original_sale_id', v_clean_sale_id,
        'original_sale_number', v_orig_sale_number,
        'items_count', 0,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with empty items';
  END IF;

  -- 4. Calculate refund total from items
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Return item quantity must be greater than zero';
    END IF;

    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    IF item_refund_price < 0 THEN
      RAISE EXCEPTION 'Return refund price cannot be negative';
    END IF;

    computed_total_refund := computed_total_refund + (item_qty * item_refund_price);
    item_count := item_count + item_qty;
  END LOOP;

  -- 5. Generate human-friendly return number & 8-char secure credit token
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := public.generate_unique_exchange_credit_token();

  -- 6. Link to original sale if provided
  IF _original_sale_id IS NOT NULL THEN
    SELECT id, sale_number INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id;
    IF v_orig_sale.id IS NOT NULL THEN
      v_clean_sale_id := v_orig_sale.id;
      v_orig_sale_number := v_orig_sale.sale_number;
    END IF;
  END IF;

  -- 7. Resolve or upsert customer for walk-in returns
  IF v_resolved_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0) INTO v_resolved_cust_id, v_prev_credit
    FROM public.pos_customers
    WHERE phone = v_clean_phone
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, store_credit_balance, store_credit, created_at, updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(NULLIF(trim(_customer_email), ''), ''),
        computed_total_refund,
        computed_total_refund,
        now(),
        now()
      )
      RETURNING id, store_credit_balance INTO v_resolved_cust_id, v_new_credit;
      v_prev_credit := 0;
    END IF;
  END IF;

  -- 8. Insert Return Record
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_status,
    return_reason,
    notes,
    refund_amount,
    credit_token,
    credit_token_status,
    expires_at,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_refund_method), ''), 'exchange_credit'),
    COALESCE(NULLIF(trim(_refund_status), ''), 'completed'),
    COALESCE(NULLIF(trim(_return_reason), ''), 'customer_request'),
    COALESCE(trim(_notes), ''),
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    v_expiry_date,
    _idempotency_key,
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 9. Insert Return Items & Restore Stock
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      item_product_id := (elem->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_product_id := NULL;
    END;

    BEGIN
      item_variant_id := (elem->>'variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_variant_id := NULL;
    END;

    item_qty := COALESCE((elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', 'Returned Item');
    item_sku := COALESCE(elem->>'sku', '');
    item_barcode := COALESCE(elem->>'barcode', '');
    item_slug := COALESCE(elem->>'product_slug', '');
    item_variant_info := COALESCE(elem->>'variant_info', '');

    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

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
      refund_price,
      mrp,
      original_sale_item_id,
      created_at
    ) VALUES (
      new_return_id,
      item_product_id,
      item_variant_id,
      item_slug,
      item_name,
      item_sku,
      item_barcode,
      item_variant_info,
      item_qty,
      item_refund_price,
      item_mrp,
      item_orig_sale_item_id,
      now()
    );

    -- Stock restoration
    IF item_variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock + item_qty
      WHERE id = item_variant_id;
    END IF;

    IF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products SET stock = stock + item_qty WHERE id = item_product_id;
        v_new_stock := v_prev_stock + item_qty;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_product_id,
          item_variant_id,
          'return'::public.inventory_tx_type,
          item_qty,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 10. Update Customer Store Credit and Ledger
  IF v_resolved_cust_id IS NOT NULL AND computed_total_refund > 0 THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit
    FROM public.pos_customers
    WHERE id = v_resolved_cust_id
    FOR UPDATE;

    v_prev_credit := COALESCE(v_prev_credit, 0);
    v_new_credit := v_prev_credit + computed_total_refund;

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_credit,
        store_credit = v_new_credit,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_return_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      new_credit_token,
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_new_credit,
      new_return_id,
      'Exchange credit issued via POS Return #' || new_return_number || ' (' || new_credit_token || ')',
      uid,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', _customer_name,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

-- Permanently revoke anon access on process_offline_return
REVOKE EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: HARDEN place_offline_sale (CLOSE UNAUTHORIZED / NEGATIVE SALES)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.place_offline_sale CASCADE;

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
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_final_total numeric := 0;
  v_item record;
  v_prod record;
  v_variant record;
  v_prev_stock int;
  v_new_stock int;
  v_var_prev_stock int;
  v_var_new_stock int;
  v_total_units int := 0;
  v_clean_phone text;
  v_cust_id uuid := _customer_id;
  v_curr_balance numeric := 0;
  v_new_balance numeric := 0;
  v_voucher_record record;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_applied_coupon record;
BEGIN
  -- 1. Strict Staff/Admin Authorization
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin')
    AND NOT public.has_role(uid, 'pos_user')
    AND NOT public.has_role(uid, 'staff')
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
  END IF;

  -- 2. Validate non-negative discount value
  IF COALESCE(_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Discount value cannot be negative';
  END IF;

  IF COALESCE(_store_credit_used, 0) < 0 THEN
    RAISE EXCEPTION 'Store credit used cannot be negative';
  END IF;

  -- 3. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, customer_name
    INTO v_sale_id, v_sale_number, v_final_total, v_subtotal, v_discount, _customer_name
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_sale_id,
        'sale_number', v_sale_number,
        'total', v_final_total,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'customer_name', _customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 4. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale with empty items';
  END IF;

  -- 5. Calculate subtotal & validate prices and quantities
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    name text,
    sku text,
    barcode text,
    variant_info text,
    price numeric,
    mrp numeric,
    cost_price numeric,
    qty int
  ) LOOP
    IF v_item.qty <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    IF COALESCE(v_item.price, 0) < 0 THEN
      RAISE EXCEPTION 'Sale item price cannot be negative';
    END IF;

    v_subtotal := v_subtotal + (v_item.price * v_item.qty);
    v_total_units := v_total_units + v_item.qty;
  END LOOP;

  -- 6. Apply Line/Sale Discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  -- 7. Apply POS Coupon if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF (v_applied_coupon.valid_from IS NULL OR now() >= v_applied_coupon.valid_from) AND
         (v_applied_coupon.valid_until IS NULL OR now() <= v_applied_coupon.valid_until) AND
         (v_applied_coupon.usage_limit IS NULL OR v_applied_coupon.usage_limit = 0 OR v_applied_coupon.used_count < v_applied_coupon.usage_limit) AND
         (COALESCE(v_applied_coupon.min_order_amount, v_applied_coupon.minimum_order_value, 0) <= 0 OR v_subtotal >= COALESCE(v_applied_coupon.min_order_amount, v_applied_coupon.minimum_order_value, 0)) THEN

        IF lower(v_applied_coupon.discount_type::text) IN ('percent', 'percentage') THEN
          v_coupon_discount := ROUND((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
          IF COALESCE(v_applied_coupon.max_discount_amount, v_applied_coupon.maximum_discount, 0) > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, COALESCE(v_applied_coupon.max_discount_amount, v_applied_coupon.maximum_discount));
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_applied_coupon.discount_value, v_subtotal);
        END IF;

        -- Record coupon usage
        UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_applied_coupon.id;
      END IF;
    END IF;
  END IF;

  v_discount := v_discount + v_coupon_discount;
  v_final_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Handle Store Credit / Voucher Redemption
  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' AND _store_credit_used > 0 THEN
    v_voucher_token := UPPER(trim(_credit_token));
    SELECT * INTO v_voucher_record
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_voucher_token
    FOR UPDATE;

    IF v_voucher_record.id IS NULL THEN
      RAISE EXCEPTION 'Voucher / Exchange credit token not found';
    END IF;

    IF v_voucher_record.credit_token_status != 'ACTIVE' THEN
      RAISE EXCEPTION 'Voucher token is not active (Status: %)', v_voucher_record.credit_token_status;
    END IF;

    IF v_voucher_record.expires_at IS NOT NULL AND v_voucher_record.expires_at < now() THEN
      RAISE EXCEPTION 'Voucher token has expired on %', v_voucher_record.expires_at;
    END IF;

    v_voucher_used := LEAST(_store_credit_used, v_voucher_record.refund_amount, v_final_total);
    v_final_total := GREATEST(0, v_final_total - v_voucher_used);

    -- Update Voucher Status
    IF v_voucher_used >= v_voucher_record.refund_amount THEN
      UPDATE public.offline_returns
      SET credit_token_status = 'REDEEMED',
          notes = COALESCE(notes, '') || ' | Fully redeemed in POS Sale',
          updated_at = now()
      WHERE id = v_voucher_record.id;
    ELSE
      UPDATE public.offline_returns
      SET refund_amount = refund_amount - v_voucher_used,
          notes = COALESCE(notes, '') || ' | Partially redeemed: ' || v_voucher_used,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    END IF;
  ELSIF _store_credit_used > 0 AND v_cust_id IS NOT NULL THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_curr_balance
    FROM public.pos_customers
    WHERE id = v_cust_id
    FOR UPDATE;

    IF v_curr_balance < _store_credit_used THEN
      RAISE EXCEPTION 'Insufficient customer store credit balance (Available: %, Requested: %)', v_curr_balance, _store_credit_used;
    END IF;

    v_voucher_used := LEAST(_store_credit_used, v_final_total);
    v_final_total := GREATEST(0, v_final_total - v_voucher_used);
    v_new_balance := v_curr_balance - v_voucher_used;

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_balance,
        store_credit = v_new_balance,
        last_visit = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 9. Resolve or Upsert Customer Profile
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  IF v_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id FROM public.pos_customers WHERE phone = v_clean_phone LIMIT 1;
    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (name, phone, email, total_spent, visits_count, last_visit, created_at, updated_at)
      VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(NULLIF(trim(_customer_email), ''), ''),
        v_final_total,
        1,
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = COALESCE(total_spent, 0) + v_final_total,
          visits_count = COALESCE(visits_count, 0) + 1,
          last_visit = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_final_total,
        visits_count = COALESCE(visits_count, 0) + 1,
        last_visit = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 10. Generate POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 11. Insert Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token,
    coupon_code,
    cashier_id,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_subtotal,
    v_discount,
    v_final_total,
    _payment_method,
    _notes,
    _idempotency_key,
    v_voucher_used,
    v_voucher_token,
    _coupon_code,
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 12. Insert Sale Items & Deduct Stock
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    name text,
    sku text,
    barcode text,
    variant_info text,
    price numeric,
    mrp numeric,
    cost_price numeric,
    qty int
  ) LOOP
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      price,
      mrp,
      cost_price,
      qty,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, ''),
      COALESCE(v_item.name, 'POS Item'),
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.barcode, ''),
      COALESCE(v_item.variant_info, ''),
      v_item.price,
      COALESCE(v_item.mrp, v_item.price),
      COALESCE(v_item.cost_price, 0),
      v_item.qty,
      now()
    );

    -- Stock deduction
    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
      IF v_var_prev_stock IS NOT NULL THEN
        v_var_new_stock := GREATEST(0, v_var_prev_stock - v_item.qty);
        UPDATE public.product_variants SET stock = v_var_new_stock WHERE id = v_item.variant_id;
      END IF;
    END IF;

    IF v_item.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - v_item.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = v_item.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          v_item.product_id,
          v_item.variant_id,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || v_item.name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 13. Record Store Credit Ledger Entry if used
  IF v_voucher_used > 0 AND v_cust_id IS NOT NULL THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      v_voucher_token,
      'CREDIT_REDEEMED',
      -v_voucher_used,
      v_curr_balance,
      v_new_balance,
      v_sale_id,
      'Store credit / voucher redeemed in POS Sale #' || v_sale_number,
      uid,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_final_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'store_credit_used', v_voucher_used,
    'customer_name', _customer_name,
    'duplicate', false
  );
END;
$$;

-- Permanently revoke anon access on place_offline_sale
REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: HARDEN ADMIN VOID AND DELETE RPCS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. admin_void_offline_sale
DROP FUNCTION IF EXISTS public.admin_void_offline_sale(uuid, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_void_offline_sale CASCADE;

CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Admin voided sale',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  sale_item record;
  v_units_restored int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_voucher_rec record;
  v_new_voucher_balance numeric := 0;
BEGIN
  -- Strict Admin Authorization
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin') 
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only administrators can void POS sale records';
  END IF;

  SELECT * INTO target_sale FROM public.offline_sales WHERE id = _sale_id FOR UPDATE;
  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sale record not found.');
  END IF;

  IF target_sale.is_voided = true THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sale is already marked as voided.');
  END IF;

  -- Restore Inventory
  IF _restore_stock = true THEN
    FOR sale_item IN SELECT * FROM public.offline_sale_items WHERE sale_id = _sale_id LOOP
      IF sale_item.variant_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = sale_item.variant_id FOR UPDATE;
        IF v_prev_stock IS NOT NULL THEN
          v_new_stock := v_prev_stock + sale_item.qty;
          UPDATE public.product_variants SET stock = v_new_stock WHERE id = sale_item.variant_id;
          UPDATE public.products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = sale_item.product_id) WHERE id = sale_item.product_id;
          v_units_restored := v_units_restored + sale_item.qty;
        END IF;
      ELSIF sale_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = sale_item.product_id FOR UPDATE;
        IF v_prev_stock IS NOT NULL THEN
          v_new_stock := v_prev_stock + sale_item.qty;
          UPDATE public.products SET stock = v_new_stock WHERE id = sale_item.product_id;
          v_units_restored := v_units_restored + sale_item.qty;
        END IF;
      END IF;

      IF sale_item.product_id IS NOT NULL THEN
        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          sale_item.product_id,
          sale_item.variant_id,
          'restock'::public.inventory_tx_type,
          sale_item.qty,
          'offline_sale_void',
          _sale_id,
          'Restock from voided POS Sale #' || target_sale.sale_number,
          uid
        );
      END IF;
    END LOOP;
  END IF;

  -- Revert store credit or voucher used
  IF COALESCE(target_sale.store_credit_used, 0) > 0 THEN
    IF target_sale.credit_token IS NOT NULL AND target_sale.credit_token != '' THEN
      SELECT * INTO v_voucher_rec FROM public.offline_returns WHERE UPPER(credit_token) = UPPER(target_sale.credit_token) FOR UPDATE;
      IF v_voucher_rec.id IS NOT NULL THEN
        v_new_voucher_balance := v_voucher_rec.refund_amount + target_sale.store_credit_used;
        UPDATE public.offline_returns
        SET refund_amount = v_new_voucher_balance,
            credit_token_status = 'ACTIVE',
            notes = COALESCE(notes, '') || ' | Re-activated from voided sale #' || target_sale.sale_number,
            updated_at = now()
        WHERE id = v_voucher_rec.id;
      END IF;
    ELSIF target_sale.customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          store_credit = COALESCE(store_credit, 0) + target_sale.store_credit_used,
          updated_at = now()
      WHERE id = target_sale.customer_id;
    END IF;
  END IF;

  UPDATE public.offline_sales
  SET is_voided = true,
      void_reason = _reason,
      voided_at = now(),
      voided_by = uid,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'units_restored', v_units_restored,
    'message', 'POS Sale successfully voided.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role;

-- 2. admin_delete_offline_sale
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale CASCADE;

CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid,
  _revert_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale record;
  v_item record;
  v_units_restored int := 0;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin') 
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only administrators can delete POS sale records';
  END IF;

  SELECT * INTO v_sale FROM public.offline_sales WHERE id = _sale_id FOR UPDATE;
  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sale record not found.');
  END IF;

  IF _revert_stock = true AND (v_sale.is_voided IS NULL OR v_sale.is_voided = false) THEN
    FOR v_item IN SELECT * FROM public.offline_sale_items WHERE sale_id = _sale_id LOOP
      IF v_item.variant_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
        IF v_prev_stock IS NOT NULL THEN
          v_new_stock := v_prev_stock + v_item.qty;
          UPDATE public.product_variants SET stock = v_new_stock WHERE id = v_item.variant_id;
          UPDATE public.products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_item.product_id) WHERE id = v_item.product_id;
          v_units_restored := v_units_restored + v_item.qty;
        END IF;
      ELSIF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        IF v_prev_stock IS NOT NULL THEN
          v_new_stock := v_prev_stock + v_item.qty;
          UPDATE public.products SET stock = v_new_stock WHERE id = v_item.product_id;
          v_units_restored := v_units_restored + v_item.qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.offline_sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.offline_sales WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_id', _sale_id,
    'units_restored', v_units_restored,
    'message', 'POS Sale successfully deleted.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) TO authenticated, service_role;

-- 3. admin_bulk_void_offline_sales
DROP FUNCTION IF EXISTS public.admin_bulk_void_offline_sales(uuid[], text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_bulk_void_offline_sales CASCADE;

CREATE OR REPLACE FUNCTION public.admin_bulk_void_offline_sales(
  _sale_ids uuid[],
  _reason text DEFAULT 'Bulk voided by administrator',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_voided_count int := 0;
  v_res jsonb;
BEGIN
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin') 
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only administrators can void POS sale records';
  END IF;

  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'voided_count', 0, 'message', 'No sales provided');
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    v_res := public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
    IF (v_res->>'success')::boolean = true THEN
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'voided_count', v_voided_count, 'message', 'Bulk void completed');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) TO authenticated, service_role;

-- 4. admin_hard_delete_offline_returns
DROP FUNCTION IF EXISTS public.admin_hard_delete_offline_returns(uuid[], boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_hard_delete_offline_returns CASCADE;

CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_returns(
  _return_ids uuid[],
  _revert_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_ret_id uuid;
  v_item record;
  v_deleted_count int := 0;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin') 
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner'))
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only administrators can delete POS return records';
  END IF;

  IF _return_ids IS NULL OR array_length(_return_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted_count', 0, 'message', 'No return IDs provided');
  END IF;

  FOREACH v_ret_id IN ARRAY _return_ids LOOP
    IF _revert_stock = true THEN
      FOR v_item IN SELECT * FROM public.offline_return_items WHERE return_id = v_ret_id LOOP
        IF v_item.variant_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
          IF v_prev_stock IS NOT NULL THEN
            v_new_stock := GREATEST(0, v_prev_stock - v_item.qty);
            UPDATE public.product_variants SET stock = v_new_stock WHERE id = v_item.variant_id;
            UPDATE public.products SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_item.product_id) WHERE id = v_item.product_id;
          END IF;
        ELSIF v_item.product_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
          IF v_prev_stock IS NOT NULL THEN
            v_new_stock := GREATEST(0, v_prev_stock - v_item.qty);
            UPDATE public.products SET stock = v_new_stock WHERE id = v_item.product_id;
          END IF;
        END IF;
      END LOOP;
    END IF;

    DELETE FROM public.offline_return_items WHERE return_id = v_ret_id;
    DELETE FROM public.offline_returns WHERE id = v_ret_id;
    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted_count, 'message', 'Returns successfully deleted');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: STANDALONE PRODUCT SUPPORT & SECURITY LOCKDOWN ON finalize_paid_order
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.finalize_paid_order(text, text, text, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.finalize_paid_order CASCADE;

CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text,
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _razorpay_signature text,
  _verified_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  attempt_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock int;
  v_new_stock int;
  v_cust_details jsonb;
  v_user_id uuid;
BEGIN
  -- 1. Idempotency Check: if order already exists for this payment_id or razorpay_order_id
  SELECT id, order_number, invoice_no, payment_status INTO existing_order
  FROM public.orders
  WHERE razorpay_payment_id = _razorpay_payment_id
     OR (razorpay_order_id = _razorpay_order_id AND payment_status = 'paid')
  LIMIT 1;

  IF existing_order.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'duplicate', true
    );
  END IF;

  -- 2. Fetch and Lock Checkout Session
  IF _session_id IS NOT NULL AND trim(_session_id) != '' THEN
    SELECT * INTO session_rec
    FROM public.checkout_sessions
    WHERE session_id = _session_id
    FOR UPDATE;
  END IF;

  -- Fallback: lookup session via payment_attempt
  IF session_rec.id IS NULL THEN
    SELECT * INTO attempt_rec
    FROM public.payment_attempts
    WHERE razorpay_order_id = _razorpay_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF attempt_rec.session_id IS NOT NULL THEN
      SELECT * INTO session_rec
      FROM public.checkout_sessions
      WHERE session_id = attempt_rec.session_id
      FOR UPDATE;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for order finalization.';
  END IF;

  -- 3. Verify Payment Amount if provided
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF ABS((session_rec.total * 100) - _verified_amount) > 100 THEN
      RAISE EXCEPTION 'Payment amount mismatch: session ₹% vs paid ₹%', session_rec.total, (_verified_amount / 100.0);
    END IF;
  END IF;

  -- 4. Inventory Lock & Verification for all items
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Variant not found: %', item_rec.variant_id;
      END IF;

      IF variant_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          item_rec.product_name, COALESCE(variant_rec.name, ''), variant_rec.stock, item_rec.qty;
      END IF;
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT * INTO product_rec
      FROM public.products
      WHERE id = item_rec.product_id
      FOR UPDATE;

      IF product_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', item_rec.product_id;
      END IF;

      IF product_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          item_rec.product_name, product_rec.stock, item_rec.qty;
      END IF;
    END IF;
  END LOOP;

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_no();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Canonical Order
  INSERT INTO public.orders (
    id,
    order_number,
    invoice_no,
    user_id,
    full_name,
    email,
    phone,
    shipping_address,
    city,
    state,
    pincode,
    subtotal,
    shipping_fee,
    discount,
    total,
    payment_method,
    payment_status,
    status,
    coupon_code,
    notes,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    paid_at,
    created_at,
    updated_at
  ) VALUES (
    new_order_id,
    new_order_number,
    new_invoice,
    v_user_id,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    'razorpay',
    'paid',
    'processing',
    session_rec.coupon_code,
    COALESCE(v_cust_details->>'notes', ''),
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
    now(),
    now(),
    now()
  );

  -- 7. Insert Order Items & Deduct Stock Atomically
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    variant_sku text,
    variant_barcode text,
    variant_color text,
    variant_size text,
    price numeric,
    mrp numeric,
    qty int,
    image_url text
  ) LOOP
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      variant_info,
      sku,
      barcode,
      price,
      mrp,
      qty,
      image_url,
      created_at
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      item_rec.product_name,
      COALESCE(item_rec.product_slug, ''),
      TRIM(BOTH ' ' FROM CONCAT(COALESCE(item_rec.variant_color, ''), ' ', COALESCE(item_rec.variant_size, ''))),
      COALESCE(item_rec.variant_sku, ''),
      COALESCE(item_rec.variant_barcode, ''),
      item_rec.price,
      COALESCE(item_rec.mrp, item_rec.price),
      item_rec.qty,
      item_rec.image_url,
      now()
    );

    IF item_rec.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock - item_rec.qty
      WHERE id = item_rec.variant_id;
    END IF;

    IF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = item_rec.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_rec.product_id,
          item_rec.variant_id,
          'sale'::public.inventory_tx_type,
          -item_rec.qty,
          'order',
          new_order_id,
          'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
          v_user_id
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Mark checkout session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      converted_order_id = new_order_id,
      converted_at = now(),
      updated_at = now()
  WHERE id = session_rec.id;

  -- 9. Update payment attempt status to completed
  UPDATE public.payment_attempts
  SET status = 'completed',
      razorpay_payment_id = _razorpay_payment_id,
      razorpay_signature = _razorpay_signature,
      completed_at = now()
  WHERE razorpay_order_id = _razorpay_order_id;

  -- 10. Record coupon usage
  IF session_rec.coupon_code IS NOT NULL AND session_rec.coupon_code != '' THEN
    DECLARE
      v_cpn record;
    BEGIN
      SELECT * INTO v_cpn FROM public.coupons WHERE UPPER(code) = UPPER(session_rec.coupon_code) LIMIT 1;
      IF v_cpn.id IS NOT NULL THEN
        UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_cpn.id;
        INSERT INTO public.coupon_usage (coupon_id, user_id, order_id, phone, email, discount_amount, created_at)
        VALUES (
          v_cpn.id,
          v_user_id,
          new_order_id,
          v_cust_details->>'phone',
          v_cust_details->>'email',
          session_rec.discount,
          now()
        );
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'duplicate', false
  );
END;
$$;

-- IMPORTANT: finalize_paid_order must ONLY be callable by service_role (from the edge function verify-razorpay-payment)
REVOKE EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO service_role, postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: STANDALONE PRODUCT SUPPORT ON place_cod_order
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.place_cod_order(text) CASCADE;
DROP FUNCTION IF EXISTS public.place_cod_order CASCADE;

CREATE OR REPLACE FUNCTION public.place_cod_order(
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  ps_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock int;
  v_new_stock int;
  v_cust_details jsonb;
  v_user_id uuid;
BEGIN
  -- 1. Fetch Payment Settings and verify COD is active
  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.cod_enabled = false THEN
    RAISE EXCEPTION 'Cash on Delivery is currently disabled.';
  END IF;

  -- 2. Fetch and Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found.';
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no INTO existing_order
    FROM public.orders
    WHERE id = session_rec.converted_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'duplicate', true
    );
  END IF;

  IF session_rec.payment_method != 'cod' THEN
    RAISE EXCEPTION 'Checkout session is not configured for Cash on Delivery.';
  END IF;

  -- 3. Verify min/max COD constraints
  IF ps_rec.cod_min_order_value > 0 AND session_rec.subtotal < ps_rec.cod_min_order_value THEN
    RAISE EXCEPTION 'Minimum order value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
  END IF;

  IF ps_rec.cod_max_order_value > 0 AND session_rec.subtotal > ps_rec.cod_max_order_value THEN
    RAISE EXCEPTION 'Maximum order value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
  END IF;

  -- 4. Inventory Lock & Verification for all items
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Variant not found: %', item_rec.variant_id;
      END IF;

      IF variant_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          item_rec.product_name, COALESCE(variant_rec.name, ''), variant_rec.stock, item_rec.qty;
      END IF;
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT * INTO product_rec
      FROM public.products
      WHERE id = item_rec.product_id
      FOR UPDATE;

      IF product_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', item_rec.product_id;
      END IF;

      IF product_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          item_rec.product_name, product_rec.stock, item_rec.qty;
      END IF;
    END IF;
  END LOOP;

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_no();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Canonical COD Order
  INSERT INTO public.orders (
    id,
    order_number,
    invoice_no,
    user_id,
    full_name,
    email,
    phone,
    shipping_address,
    city,
    state,
    pincode,
    subtotal,
    shipping_fee,
    discount,
    total,
    payment_method,
    payment_status,
    status,
    coupon_code,
    notes,
    created_at,
    updated_at
  ) VALUES (
    new_order_id,
    new_order_number,
    new_invoice,
    v_user_id,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    'cod',
    'pending',
    'processing',
    session_rec.coupon_code,
    COALESCE(v_cust_details->>'notes', ''),
    now(),
    now()
  );

  -- 7. Insert Order Items & Deduct Stock Atomically
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    variant_sku text,
    variant_barcode text,
    variant_color text,
    variant_size text,
    price numeric,
    mrp numeric,
    qty int,
    image_url text
  ) LOOP
    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      variant_info,
      sku,
      barcode,
      price,
      mrp,
      qty,
      image_url,
      created_at
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      item_rec.product_name,
      COALESCE(item_rec.product_slug, ''),
      TRIM(BOTH ' ' FROM CONCAT(COALESCE(item_rec.variant_color, ''), ' ', COALESCE(item_rec.variant_size, ''))),
      COALESCE(item_rec.variant_sku, ''),
      COALESCE(item_rec.variant_barcode, ''),
      item_rec.price,
      COALESCE(item_rec.mrp, item_rec.price),
      item_rec.qty,
      item_rec.image_url,
      now()
    );

    IF item_rec.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock - item_rec.qty
      WHERE id = item_rec.variant_id;
    END IF;

    IF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = item_rec.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_rec.product_id,
          item_rec.variant_id,
          'sale'::public.inventory_tx_type,
          -item_rec.qty,
          'order',
          new_order_id,
          'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
          v_user_id
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Mark checkout session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      converted_order_id = new_order_id,
      converted_at = now(),
      updated_at = now()
  WHERE id = session_rec.id;

  -- 9. Record coupon usage
  IF session_rec.coupon_code IS NOT NULL AND session_rec.coupon_code != '' THEN
    DECLARE
      v_cpn record;
    BEGIN
      SELECT * INTO v_cpn FROM public.coupons WHERE UPPER(code) = UPPER(session_rec.coupon_code) LIMIT 1;
      IF v_cpn.id IS NOT NULL THEN
        UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_cpn.id;
        INSERT INTO public.coupon_usage (coupon_id, user_id, order_id, phone, email, discount_amount, created_at)
        VALUES (
          v_cpn.id,
          v_user_id,
          new_order_id,
          v_cust_details->>'phone',
          v_cust_details->>'email',
          session_rec.discount,
          now()
        );
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_cod_order(text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: REMOVE BACKDOOR IN update_payment_settings
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.update_payment_settings(boolean, numeric, numeric, numeric, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.update_payment_settings CASCADE;

CREATE OR REPLACE FUNCTION public.update_payment_settings(
  _cod_enabled boolean,
  _cod_fee numeric DEFAULT 0,
  _cod_min_order_value numeric DEFAULT 0,
  _cod_max_order_value numeric DEFAULT 0,
  _updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  rec record;
BEGIN
  -- Completely eradicate backdoor test key; require actual admin / service_role
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized: only store administrators can update payment settings';
    END IF;
  ELSE
    -- If called without user context, must be postgres/service_role
    IF current_user NOT IN ('postgres', 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: direct invocation requires administrator session';
    END IF;
  END IF;

  SELECT id INTO rec FROM public.payment_settings LIMIT 1;

  IF rec.id IS NOT NULL THEN
    UPDATE public.payment_settings
    SET cod_enabled = _cod_enabled,
        cod_fee = COALESCE(_cod_fee, 0),
        cod_min_order_value = COALESCE(_cod_min_order_value, 0),
        cod_max_order_value = COALESCE(_cod_max_order_value, 0),
        updated_by = COALESCE(uid, _updated_by),
        updated_at = now()
    WHERE id = rec.id;
  ELSE
    INSERT INTO public.payment_settings (
      cod_enabled, cod_fee, cod_min_order_value, cod_max_order_value, updated_by, created_at, updated_at
    ) VALUES (
      _cod_enabled,
      COALESCE(_cod_fee, 0),
      COALESCE(_cod_min_order_value, 0),
      COALESCE(_cod_max_order_value, 0),
      COALESCE(uid, _updated_by),
      now(),
      now()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Payment settings updated successfully');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_payment_settings(boolean, numeric, numeric, numeric, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_payment_settings(boolean, numeric, numeric, numeric, uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: FIX THREE-VALUED SQL LOGIC (GUEST ORDER HIJACKING VULNERABILITY)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. cancel_customer_order hardening
DROP FUNCTION IF EXISTS public.cancel_customer_order(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.cancel_customer_order CASCADE;

CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
  item record;
  v_prod record;
  v_total_var_stock int;
  v_prev_stock int;
  v_new_stock int;
  v_new_payment_status public.payment_status;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- CRITICAL SECURITY FIX: ord.user_id IS NULL evaluates to NULL on != uid
  -- If ord.user_id is NULL or different from uid, strictly reject unless caller is admin
  IF (ord.user_id IS NULL OR ord.user_id != uid)
     AND NOT public.has_role(uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at status "%"', ord.status;
  END IF;

  IF ord.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', ord.id,
      'status', 'cancelled',
      'payment_status', ord.payment_status,
      'duplicate', true
    );
  END IF;

  IF ord.payment_status = 'paid' THEN
    v_new_payment_status := 'refund_pending'::public.payment_status;
  ELSE
    v_new_payment_status := ord.payment_status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Cancelled by customer');

  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      payment_status = v_new_payment_status,
      cancel_reason = final_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled by customer. Reason: ' || final_reason,
    uid
  );

  -- Restock items
  FOR item IN SELECT * FROM public.order_items WHERE order_id = ord.id LOOP
    IF item.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock + item.qty
      WHERE id = item.variant_id;

      SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
      FROM public.product_variants
      WHERE product_id = item.product_id;

      UPDATE public.products
      SET stock = v_total_var_stock
      WHERE id = item.product_id;
    ELSIF item.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item.qty;
        UPDATE public.products SET stock = v_new_stock WHERE id = item.product_id;
      END IF;
    END IF;

    IF item.product_id IS NOT NULL THEN
      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        transaction_type,
        quantity,
        reference_type,
        reference_id,
        notes,
        created_by
      ) VALUES (
        item.product_id,
        item.variant_id,
        'restock'::public.inventory_tx_type,
        item.qty,
        'order_cancellation',
        ord.id,
        'Restock from cancelled order #' || ord.order_number,
        uid
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', ord.id,
    'status', 'cancelled',
    'payment_status', v_new_payment_status,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) FROM anon;

-- 2. request_online_return hardening
DROP FUNCTION IF EXISTS public.request_online_return(uuid, jsonb, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.request_online_return CASCADE;

CREATE OR REPLACE FUNCTION public.request_online_return(
  _order_id uuid,
  _items jsonb,
  _reason_category text,
  _reason_label text,
  _customer_note text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_calc jsonb;
  v_return_id uuid;
  v_return_number text;
  v_existing_return record;
  v_item record;
  v_calc_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to initiate return';
  END IF;

  -- Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_return
    FROM public.online_returns
    WHERE idempotency_key = trim(_idempotency_key);

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'status', v_existing_return.return_status,
        'final_refund_amount', v_existing_return.final_refund_amount,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Lock Order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- CRITICAL SECURITY FIX: v_order.user_id IS NULL evaluates to NULL on != v_uid
  IF (v_order.user_id IS NULL OR v_order.user_id != v_uid)
     AND NOT public.has_role(v_uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: You can only return orders placed by your account';
  END IF;

  -- Calculate refund and validate constraints
  v_calc := public.calculate_online_return_refund(_order_id, _items, _reason_category);

  IF (v_calc->>'success')::boolean != true THEN
    RAISE EXCEPTION '%', (v_calc->>'error');
  END IF;

  IF (v_calc->>'is_eligible')::boolean != true THEN
    RAISE EXCEPTION '%', COALESCE(v_calc->>'ineligible_reason', 'Order is not eligible for return');
  END IF;

  -- Create online_returns record
  v_return_id := gen_random_uuid();
  v_return_number := public.generate_online_return_number();

  INSERT INTO public.online_returns (
    id,
    return_number,
    order_id,
    user_id,
    return_status,
    refund_status,
    reason_category,
    reason_label,
    customer_note,
    return_shipping_fee,
    eligible_refund_amount,
    final_refund_amount,
    currency,
    refund_calculation_snapshot,
    idempotency_key,
    created_by
  ) VALUES (
    v_return_id,
    v_return_number,
    _order_id,
    v_order.user_id,
    'REQUESTED',
    'PENDING',
    _reason_category,
    _reason_label,
    _customer_note,
    (v_calc->>'return_shipping_fee')::numeric,
    (v_calc->>'eligible_refund_amount')::numeric,
    (v_calc->>'final_refund_amount')::numeric,
    'INR',
    v_calc,
    NULLIF(trim(_idempotency_key), ''),
    v_uid
  );

  -- Insert line items
  FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calc->'items') LOOP
    INSERT INTO public.online_return_items (
      return_id,
      order_item_id,
      product_id,
      variant_id,
      product_name_snapshot,
      sku_snapshot,
      color_snapshot,
      size_snapshot,
      image_snapshot,
      quantity_requested,
      historical_unit_price,
      historical_paid_amount,
      allocated_discount,
      item_refund_amount,
      qc_status
    ) VALUES (
      v_return_id,
      (v_calc_item->>'order_item_id')::uuid,
      (v_calc_item->>'product_id')::uuid,
      (v_calc_item->>'variant_id')::uuid,
      v_calc_item->>'product_name',
      v_calc_item->>'sku',
      v_calc_item->>'color',
      v_calc_item->>'size',
      v_calc_item->>'image_url',
      (v_calc_item->>'qty_requested')::integer,
      (v_calc_item->>'original_unit_price')::numeric,
      (v_calc_item->>'original_unit_price')::numeric * (v_calc_item->>'qty_requested')::integer,
      (v_calc_item->>'allocated_discount')::numeric,
      (v_calc_item->>'item_refund_amount')::numeric,
      'PENDING'
    );
  END LOOP;

  -- Insert audit event
  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    v_return_id,
    'RETURN_REQUESTED',
    NULL,
    'REQUESTED',
    'Customer requested online return: ' || _reason_label,
    v_uid,
    CASE WHEN public.has_role(v_uid, 'admin') THEN 'admin' ELSE 'customer' END,
    jsonb_build_object('reason', _reason_category, 'refund_amount', v_calc->>'final_refund_amount')
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'status', 'REQUESTED',
    'eligible_refund_amount', v_calc->>'eligible_refund_amount',
    'return_shipping_fee', v_calc->>'return_shipping_fee',
    'final_refund_amount', v_calc->>'final_refund_amount',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_online_return(uuid, jsonb, text, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.request_online_return(uuid, jsonb, text, text, text, text) FROM anon;

-- 3. process_open_box_delivery hardening
DROP FUNCTION IF EXISTS public.process_open_box_delivery(uuid, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.process_open_box_delivery CASCADE;

CREATE OR REPLACE FUNCTION public.process_open_box_delivery(
  _order_id uuid,
  _decision text,
  _rejection_reason text DEFAULT '',
  _rejection_notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_linked_return_id uuid := NULL;
  v_existing_event record;
  v_item record;
  v_items_json jsonb := '[]'::jsonb;
BEGIN
  IF _decision NOT IN ('ACCEPTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid decision: Must be ACCEPTED or REJECTED';
  END IF;

  -- 1. Idempotency Check
  SELECT * INTO v_existing_event
  FROM public.open_box_events
  WHERE order_id = _order_id;

  IF v_existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', _order_id,
      'decision', v_existing_event.decision,
      'duplicate', true
    );
  END IF;

  -- 2. Lock Order
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- CRITICAL SECURITY FIX: v_order.user_id IS NULL evaluates to NULL on != v_uid
  IF (v_order.user_id IS NULL OR v_order.user_id != v_uid)
     AND NOT public.has_role(v_uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _decision = 'ACCEPTED' THEN
    UPDATE public.orders
    SET open_box_status = 'ACCEPTED',
        open_box_inspected_at = now(),
        open_box_notes = _rejection_notes,
        status = 'delivered'::public.order_status,
        updated_at = now()
    WHERE id = _order_id;

    INSERT INTO public.open_box_events (
      order_id,
      decision,
      actor_id,
      metadata
    ) VALUES (
      _order_id,
      'ACCEPTED',
      v_uid,
      jsonb_build_object('timestamp', now())
    );

    INSERT INTO public.order_status_history (
      order_id,
      old_status,
      new_status,
      note,
      changed_by
    ) VALUES (
      _order_id,
      v_order.status,
      'delivered',
      'Open Box Delivery Accepted by Customer after verification',
      v_uid
    );

  ELSIF _decision = 'REJECTED' THEN
    UPDATE public.orders
    SET open_box_status = 'REJECTED',
        open_box_inspected_at = now(),
        open_box_notes = _rejection_reason || ': ' || _rejection_notes,
        status = 'open_box_rejected'::public.order_status,
        updated_at = now()
    WHERE id = _order_id;

    -- Build all items for return
    FOR v_item IN SELECT id, qty FROM public.order_items WHERE order_id = _order_id LOOP
      v_items_json := v_items_json || jsonb_build_object('order_item_id', v_item.id, 'qty', v_item.qty);
    END LOOP;

    -- Create linked online return record automatically with fee waived
    SELECT (res->>'return_id')::uuid INTO v_linked_return_id
    FROM (
      SELECT public.request_online_return(
        _order_id,
        v_items_json,
        'OPEN_BOX_REJECTED',
        'Open Box Rejection: ' || _rejection_reason,
        _rejection_notes,
        _idempotency_key
      ) AS res
    ) t;

    INSERT INTO public.open_box_events (
      order_id,
      decision,
      rejection_reason,
      rejection_notes,
      actor_id,
      linked_return_id,
      metadata
    ) VALUES (
      _order_id,
      'REJECTED',
      _rejection_reason,
      _rejection_notes,
      v_uid,
      v_linked_return_id,
      jsonb_build_object('timestamp', now(), 'items_rejected', jsonb_array_length(v_items_json))
    );

    INSERT INTO public.order_status_history (
      order_id,
      old_status,
      new_status,
      note,
      changed_by
    ) VALUES (
      _order_id,
      v_order.status,
      'open_box_rejected',
      'Open Box Delivery Rejected: ' || _rejection_reason,
      v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'decision', _decision,
    'linked_return_id', v_linked_return_id,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_open_box_delivery(uuid, text, text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.process_open_box_delivery(uuid, text, text, text, text) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: COUPONS PRIVACY & PER-USER USAGE ENFORCEMENT
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add is_public column to public.coupons
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;

-- Auto-mark existing sitewide/banner coupons as public
UPDATE public.coupons
SET is_public = true
WHERE UPPER(code) IN ('WELCOME10', 'FIRST50', 'SUMMER10', 'ZERAH10', 'FREESHIP');

-- 2. Update RLS Policy so anon cannot enumerate secret / private coupons
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active coupons" ON public.coupons;
DROP POLICY IF EXISTS "coupons_read_policy" ON public.coupons;
DROP POLICY IF EXISTS "Public can view public coupons" ON public.coupons;

CREATE POLICY "Public can view public coupons"
  ON public.coupons FOR SELECT
  TO anon, authenticated
  USING (
    (COALESCE(is_active, active, true) = true AND is_public = true)
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_admin()
  );

-- 3. Enforce coupon_usage per_user_limit inside create_checkout_session
DROP FUNCTION IF EXISTS public.create_checkout_session(text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_checkout_session CASCADE;

CREATE OR REPLACE FUNCTION public.create_checkout_session(
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
  uid uuid := auth.uid();
  item record;
  variant record;
  coupon_record record;
  existing_session record;
  v_session_id text;
  v_clean_idem text;
  v_clean_coupon text;
  v_clean_payment_method text;
  v_clean_variant_id uuid;
  computed_subtotal numeric := 0;
  computed_mrp_total numeric := 0;
  computed_discount numeric := 0;
  shipping numeric := 0;
  cod_fee numeric := 0;
  computed_total numeric := 0;
  net_subtotal numeric := 0;
  free_shipping_threshold numeric := 999;
  std_shipping numeric := 99;
  ps_rec record;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
  item_image text;
  user_usages int := 0;
BEGIN
  -- 1. Validate Customer Details
  IF _full_name IS NULL OR trim(_full_name) = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF _phone IS NULL OR trim(_phone) = '' THEN
    RAISE EXCEPTION 'Phone number is required.';
  END IF;
  IF _address IS NULL OR trim(_address) = '' THEN
    RAISE EXCEPTION 'Shipping address is required.';
  END IF;
  IF _pincode IS NULL OR trim(_pincode) = '' THEN
    RAISE EXCEPTION 'Pincode is required.';
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO existing_session
    FROM public.checkout_sessions
    WHERE idempotency_key = v_clean_idem
      AND status IN ('active', 'payment_pending', 'payment_cancelled', 'payment_failed')
      AND expires_at > now()
    LIMIT 1;

    IF existing_session.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'session_id', existing_session.session_id,
        'subtotal', existing_session.subtotal,
        'shipping_fee', existing_session.shipping_fee,
        'cod_fee', existing_session.cod_fee,
        'discount', existing_session.discount,
        'total', existing_session.total,
        'currency', existing_session.currency,
        'payment_method', existing_session.payment_method,
        'status', existing_session.status,
        'expires_at', existing_session.expires_at,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate Items & Compute Authoritative Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Checkout must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    variant := NULL;
    v_clean_variant_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_variant_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT NULL::uuid AS variant_id, p.price AS price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL AS variant_color, NULL AS variant_size,
             p.name AS variant_name, NULL AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product not found for item: %', COALESCE(item.variant_id, item.product_slug, item.product_id, 'unknown');
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

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

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
    computed_mrp_total := computed_mrp_total + (variant.mrp * item.qty);

    item_obj := jsonb_build_object(
      'variant_id', variant.variant_id,
      'product_id', variant.p_id,
      'product_slug', variant.product_slug,
      'product_name', variant.product_name,
      'variant_sku', variant.variant_sku,
      'variant_barcode', variant.variant_barcode,
      'variant_color', variant.variant_color,
      'variant_size', variant.variant_size,
      'price', variant.price,
      'mrp', variant.mrp,
      'qty', item.qty,
      'line_subtotal', (variant.price * item.qty),
      'image_url', item_image
    );

    validated_items := validated_items || jsonb_build_array(item_obj);
  END LOOP;

  -- 4. Dynamic Coupon Evaluation & Per-User Usage Limit Enforcement
  v_clean_coupon := NULLIF(trim(COALESCE(_coupon_code, '')), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(v_clean_coupon)
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      -- Validate temporal and threshold conditions
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        -- ENFORCE PER-USER USAGE LIMIT
        IF COALESCE(coupon_record.per_user_limit, 1) > 0 THEN
          SELECT count(*) INTO user_usages
          FROM public.coupon_usage cu
          WHERE cu.coupon_id = coupon_record.id
            AND (
              (uid IS NOT NULL AND cu.user_id = uid)
              OR (cu.phone = _phone)
              OR (_email IS NOT NULL AND _email != '' AND cu.email = _email)
            );

          IF user_usages >= COALESCE(coupon_record.per_user_limit, 1) THEN
            v_clean_coupon := NULL;
            computed_discount := 0;
          END IF;
        END IF;

        IF v_clean_coupon IS NOT NULL THEN
          IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
            computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
            IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
              computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
            END IF;
          ELSE
            computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
          END IF;
        END IF;
      ELSE
        v_clean_coupon := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      v_clean_coupon := NULL;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Calculate Shipping Fee
  IF net_subtotal >= free_shipping_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  -- 6. Calculate Cash on Delivery Fee
  v_clean_payment_method := lower(COALESCE(NULLIF(trim(_payment_method), ''), 'online'));
  IF v_clean_payment_method = 'cod' THEN
    SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
    IF ps_rec.cod_enabled = false THEN
      RAISE EXCEPTION 'Cash on Delivery is currently unavailable.';
    END IF;

    IF ps_rec.cod_min_order_value > 0 AND net_subtotal < ps_rec.cod_min_order_value THEN
      RAISE EXCEPTION 'Minimum order value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
    END IF;

    IF ps_rec.cod_max_order_value > 0 AND net_subtotal > ps_rec.cod_max_order_value THEN
      RAISE EXCEPTION 'Maximum order value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
    END IF;

    cod_fee := COALESCE(ps_rec.cod_fee, 0);
  ELSE
    cod_fee := 0;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.checkout_sessions (
    session_id, user_id, items, customer_details, subtotal, shipping_fee, cod_fee,
    discount, total, currency, payment_method, coupon_code, idempotency_key,
    status, expires_at
  ) VALUES (
    v_session_id,
    uid,
    validated_items,
    jsonb_build_object(
      'full_name', _full_name,
      'email', _email,
      'phone', _phone,
      'alt_phone', _alt_phone,
      'address', _address,
      'address_line2', _address_line2,
      'landmark', _landmark,
      'city', _city,
      'state', _state,
      'pincode', _pincode,
      'notes', _notes
    ),
    computed_subtotal,
    shipping,
    cod_fee,
    computed_discount,
    computed_total,
    'INR',
    v_clean_payment_method,
    v_clean_coupon,
    v_clean_idem,
    'active',
    now() + interval '30 minutes'
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'subtotal', computed_subtotal,
    'shipping_fee', shipping,
    'cod_fee', cod_fee,
    'discount', computed_discount,
    'total', computed_total,
    'currency', 'INR',
    'payment_method', v_clean_payment_method,
    'status', 'active',
    'expires_at', now() + interval '30 minutes',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_session(text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: MASK STORE OWNER PII IN public.site_settings RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings public read" ON public.site_settings;
DROP POLICY IF EXISTS "settings public read non sensitive" ON public.site_settings;

CREATE POLICY "settings public read non sensitive"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (
    key NOT IN (
      'owner_notification_phone',
      'owner_notification_email',
      'admin_phone',
      'admin_email'
    )
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_admin()
  );

NOTIFY pgrst, 'reload schema';
