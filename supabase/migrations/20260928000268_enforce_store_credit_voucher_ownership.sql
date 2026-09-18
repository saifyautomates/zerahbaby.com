-- ==============================================================================
-- Migration: 20260928000268_enforce_store_credit_voucher_ownership.sql
-- Description:
-- Strictly enforce customer ownership on Store Credit and Exchange Vouchers
-- across POS and Online Checkout. Prevent cross-customer voucher redemption.
-- Protect personal data (no leaked customer name or phone on mismatch).
-- Support partial balances, verified guest phones, and multi-cart isolation.
-- ==============================================================================

-- 1. Canonical Voucher Customer Ownership Verification Function
CREATE OR REPLACE FUNCTION public.verify_voucher_customer_ownership(
  p_voucher_customer_id uuid,
  p_voucher_customer_phone text,
  p_req_customer_id uuid,
  p_req_phone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_v_phone_digits text;
  v_r_phone_digits text;
  v_rec record;
BEGIN
  -- Normalize to last 10 digits
  v_v_phone_digits := right(regexp_replace(COALESCE(p_voucher_customer_phone, ''), '\D', '', 'g'), 10);
  v_r_phone_digits := right(regexp_replace(COALESCE(p_req_phone, ''), '\D', '', 'g'), 10);

  -- 1. Direct ID match (e.g. same pos_customers.id or same profiles.id)
  IF p_voucher_customer_id IS NOT NULL AND p_req_customer_id IS NOT NULL THEN
    IF p_voucher_customer_id = p_req_customer_id THEN
      RETURN true;
    END IF;
  END IF;

  -- 2. Direct 10-digit phone match
  IF length(v_v_phone_digits) = 10 AND length(v_r_phone_digits) = 10 THEN
    IF v_v_phone_digits = v_r_phone_digits THEN
      RETURN true;
    END IF;
  END IF;

  -- 3. If requester provided customer_id, check if that customer's registered phone matches the voucher phone
  IF p_req_customer_id IS NOT NULL AND length(v_v_phone_digits) = 10 THEN
    -- Check public.profiles
    IF EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = p_req_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_v_phone_digits
    ) THEN
      RETURN true;
    END IF;

    -- Check auth.users
    IF EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = p_req_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_v_phone_digits
    ) THEN
      RETURN true;
    END IF;

    -- Check public.pos_customers
    IF EXISTS (
      SELECT 1 FROM public.pos_customers 
      WHERE id = p_req_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_v_phone_digits
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- 4. If voucher has customer_id, check if that customer's registered phone matches requester's phone
  IF p_voucher_customer_id IS NOT NULL AND length(v_r_phone_digits) = 10 THEN
    -- Check public.profiles
    IF EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = p_voucher_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_r_phone_digits
    ) THEN
      RETURN true;
    END IF;

    -- Check auth.users
    IF EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = p_voucher_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_r_phone_digits
    ) THEN
      RETURN true;
    END IF;

    -- Check public.pos_customers
    IF EXISTS (
      SELECT 1 FROM public.pos_customers 
      WHERE id = p_voucher_customer_id 
        AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_r_phone_digits
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- 5. Cross-entity: If both IDs exist, check if they map to the same phone across profiles/pos_customers
  IF p_voucher_customer_id IS NOT NULL AND p_req_customer_id IS NOT NULL THEN
    FOR v_rec IN 
      SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p
      FROM public.pos_customers WHERE id = p_voucher_customer_id
      UNION
      SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p
      FROM public.profiles WHERE id = p_voucher_customer_id
      UNION
      SELECT right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) AS p
      FROM auth.users WHERE id = p_voucher_customer_id
    LOOP
      IF length(v_rec.p) = 10 THEN
        IF EXISTS (
          SELECT 1 FROM public.pos_customers 
          WHERE id = p_req_customer_id AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_rec.p
          UNION
          SELECT 1 FROM public.profiles 
          WHERE id = p_req_customer_id AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_rec.p
          UNION
          SELECT 1 FROM auth.users 
          WHERE id = p_req_customer_id AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_rec.p
        ) THEN
          RETURN true;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 6. Truly anonymous legacy bearer voucher (no customer ID and no phone on file)
  IF p_voucher_customer_id IS NULL AND length(v_v_phone_digits) < 10 THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_voucher_customer_ownership(uuid, text, uuid, text) TO anon, authenticated, service_role;

-- 2. Update get_store_credit_voucher with strict ownership validation
CREATE OR REPLACE FUNCTION public.get_store_credit_voucher(
  _token text,
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  v_norm_phone text := public.normalize_phone(_phone);
  v_ret_rec record;
  v_pos_rec record;
  v_sc_rec record;
  v_coup_rec record;
  v_remaining numeric := 0;
  v_days_left int := 0;
BEGIN
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Please enter a voucher token or coupon code');
  END IF;

  -- 1. Check in public.offline_returns first (canonical source of truth)
  SELECT 
    id AS return_id,
    UPPER(TRIM(credit_token)) AS token,
    customer_id,
    customer_phone,
    customer_name,
    refund_amount AS original_amount,
    COALESCE(credit_used, 0) AS credit_used,
    GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
    CASE 
      WHEN (refund_amount - COALESCE(credit_used, 0)) <= 0 OR credit_token_status = 'CONSUMED' THEN 'redeemed'
      WHEN expires_at < now() OR credit_token_status = 'EXPIRED' THEN 'expired'
      ELSE 'active'
    END AS status,
    COALESCE(expires_at, now() + interval '365 days') AS expires_at,
    created_at,
    original_sale_id,
    original_sale_number,
    return_number
  INTO v_ret_rec
  FROM public.offline_returns
  WHERE UPPER(TRIM(credit_token)) = v_clean_token
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_ret_rec.token IS NOT NULL THEN
    v_remaining := v_ret_rec.remaining_balance;
    IF v_ret_rec.expires_at IS NOT NULL AND v_ret_rec.expires_at < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has expired',
        'status', 'expired',
        'expired', true,
        'token', v_clean_token,
        'expires_at', v_ret_rec.expires_at,
        'remaining_balance', 0
      );
    END IF;

    IF v_ret_rec.status = 'redeemed' OR v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    -- Strict Customer Ownership Verification (No PII leaked on mismatch)
    IF NOT public.verify_voucher_customer_ownership(
      v_ret_rec.customer_id,
      v_ret_rec.customer_phone,
      _customer_id,
      _phone
    ) THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'This voucher is not available for this customer.',
        'ownership_mismatch', true,
        'status', 'ineligible',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_ret_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_ret_rec.return_id,
      'return_id', v_ret_rec.return_id,
      'token', v_ret_rec.token,
      'customer_id', v_ret_rec.customer_id,
      'original_amount', v_ret_rec.original_amount,
      'credit_used', v_ret_rec.credit_used,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_ret_rec.expires_at,
      'days_remaining', v_days_left,
      'original_sale_id', v_ret_rec.original_sale_id,
      'original_sale_number', v_ret_rec.original_sale_number,
      'original_return_number', v_ret_rec.return_number
    );
  END IF;

  -- 2. Check in public.pos_exchange_vouchers
  SELECT * INTO v_pos_rec
  FROM public.pos_exchange_vouchers
  WHERE UPPER(TRIM(token)) = v_clean_token
  LIMIT 1;

  IF v_pos_rec.token IS NOT NULL THEN
    v_remaining := COALESCE(v_pos_rec.remaining_balance, 0);
    IF v_pos_rec.expires_at IS NOT NULL AND v_pos_rec.expires_at < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has expired',
        'status', 'expired',
        'expired', true,
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    IF v_pos_rec.status = 'redeemed' OR v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    -- Strict Customer Ownership Verification
    IF NOT public.verify_voucher_customer_ownership(
      v_pos_rec.customer_id,
      v_pos_rec.customer_phone,
      _customer_id,
      _phone
    ) THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'This voucher is not available for this customer.',
        'ownership_mismatch', true,
        'status', 'ineligible',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_pos_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_pos_rec.id,
      'return_id', v_pos_rec.return_id,
      'token', v_pos_rec.token,
      'customer_id', v_pos_rec.customer_id,
      'original_amount', v_pos_rec.original_amount,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_pos_rec.expires_at,
      'days_remaining', v_days_left
    );
  END IF;

  -- 3. Check in public.store_credit_vouchers
  SELECT * INTO v_sc_rec
  FROM public.store_credit_vouchers
  WHERE UPPER(TRIM(token)) = v_clean_token
  LIMIT 1;

  IF v_sc_rec.token IS NOT NULL THEN
    v_remaining := COALESCE(v_sc_rec.current_balance, 0);
    IF v_sc_rec.expires_at IS NOT NULL AND v_sc_rec.expires_at < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has expired',
        'status', 'expired',
        'expired', true,
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    IF v_remaining <= 0 OR v_sc_rec.is_active = false THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    -- Strict Customer Ownership Verification
    IF NOT public.verify_voucher_customer_ownership(
      v_sc_rec.customer_id,
      v_sc_rec.customer_phone,
      _customer_id,
      _phone
    ) THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'This voucher is not available for this customer.',
        'ownership_mismatch', true,
        'status', 'ineligible',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_sc_rec.id,
      'token', v_sc_rec.token,
      'customer_id', v_sc_rec.customer_id,
      'original_amount', v_sc_rec.initial_amount,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_sc_rec.expires_at
    );
  END IF;

  -- 4. Check in public.coupons (Promotional coupons)
  SELECT * INTO v_coup_rec
  FROM public.coupons
  WHERE UPPER(TRIM(code)) = v_clean_token
    AND is_active = true
  LIMIT 1;

  IF v_coup_rec.code IS NOT NULL THEN
    IF v_coup_rec.end_date IS NOT NULL AND v_coup_rec.end_date < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Coupon code ' || v_clean_token || ' has expired',
        'token', v_clean_token
      );
    END IF;

    IF v_coup_rec.max_uses IS NOT NULL AND v_coup_rec.used_count >= v_coup_rec.max_uses THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Coupon code ' || v_clean_token || ' has reached its maximum usage limit',
        'token', v_clean_token
      );
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', true,
      'coupon_code', v_coup_rec.code,
      'token', v_coup_rec.code,
      'discount_type', v_coup_rec.discount_type,
      'discount_value', v_coup_rec.discount_value,
      'min_cart_value', COALESCE(v_coup_rec.min_cart_value, 0),
      'max_discount', v_coup_rec.max_discount,
      'remaining_balance', v_coup_rec.discount_value,
      'available_credit', v_coup_rec.discount_value,
      'status', 'active'
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'error', 'Voucher or Coupon ' || v_clean_token || ' not found',
    'token', v_clean_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_credit_voucher(text, uuid, text, uuid) TO authenticated, anon, service_role;

-- 3. Update get_customer_store_credit with strict ownership validation
CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Customer';
  v_cust_phone text := '';
  v_norm_phone text := public.normalize_phone(_phone);
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_returns_sum numeric := 0;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, isolate to this specific voucher instrument and verify ownership
  IF v_clean_token != '' THEN
    SELECT 
      id, customer_id, customer_name, customer_phone,
      refund_amount, credit_used,
      GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
      expires_at
    INTO v_single_voucher
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_single_voucher.id IS NULL THEN
      SELECT 
        id, customer_id, customer_name, customer_phone,
        original_amount AS refund_amount, (original_amount - remaining_balance) AS credit_used,
        remaining_balance,
        expires_at
      INTO v_single_voucher
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
      LIMIT 1;
    END IF;

    IF v_single_voucher.id IS NULL THEN
      SELECT 
        id, customer_id, '' AS customer_name, customer_phone,
        initial_amount AS refund_amount, (initial_amount - current_balance) AS credit_used,
        current_balance AS remaining_balance,
        expires_at
      INTO v_single_voucher
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
      LIMIT 1;
    END IF;

    IF v_single_voucher.id IS NOT NULL THEN
      -- Strict Ownership Check
      IF NOT public.verify_voucher_customer_ownership(
        v_single_voucher.customer_id,
        v_single_voucher.customer_phone,
        _customer_id,
        _phone
      ) THEN
        RETURN jsonb_build_object(
          'customer_id', _customer_id,
          'customer_name', 'Customer',
          'available_credit', 0,
          'credit_token', v_clean_token,
          'error', 'This voucher is not available for this customer.',
          'ownership_mismatch', true,
          'active_returns', '[]'::jsonb,
          'history', '[]'::jsonb
        );
      END IF;

      IF v_single_voucher.expires_at IS NOT NULL AND v_single_voucher.expires_at < now() THEN
        v_balance := 0;
      ELSE
        v_balance := v_single_voucher.remaining_balance;
      END IF;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := COALESCE(v_single_voucher.customer_name, 'Customer');
      v_cust_phone := COALESCE(v_single_voucher.customer_phone, '');
      v_latest_token := v_clean_token;
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id
  ELSIF v_cust_id IS NOT NULL THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE id = v_cust_id;

    IF v_norm_phone = '' AND v_cust_phone != '' THEN
      v_norm_phone := public.normalize_phone(v_cust_phone);
    END IF;

  -- 3. Otherwise search by normalized phone
  ELSIF v_norm_phone != '' THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE public.normalize_phone(phone) = v_norm_phone
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      SELECT id, full_name, phone
      INTO v_cust_id, v_cust_name, v_cust_phone
      FROM public.profiles
      WHERE public.normalize_phone(phone) = v_norm_phone
      LIMIT 1;
      v_balance := 0;
    END IF;
  END IF;

  -- 4. Aggregate active unredeemed returns for this customer
  IF v_clean_token != '' AND v_single_voucher.id IS NOT NULL THEN
    IF v_balance > 0 THEN
      active_returns := jsonb_build_array(
        jsonb_build_object(
          'id', v_single_voucher.id,
          'credit_token', v_single_voucher.credit_token,
          'refund_amount', v_single_voucher.refund_amount,
          'credit_used', v_single_voucher.credit_used,
          'credit_balance', v_single_voucher.remaining_balance,
          'expires_at', v_single_voucher.expires_at
        )
      );
    END IF;
  ELSIF v_cust_id IS NOT NULL OR v_norm_phone != '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'return_number', r.return_number,
        'credit_token', r.credit_token,
        'refund_amount', r.refund_amount,
        'credit_used', COALESCE(r.credit_used, 0),
        'credit_balance', GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)),
        'created_at', r.created_at,
        'expires_at', r.expires_at
      ) ORDER BY r.created_at DESC
    ), '[]'::jsonb),
    COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
    INTO active_returns, v_returns_sum
    FROM public.offline_returns r
    WHERE (r.customer_id = v_cust_id OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone))
      AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
      AND (r.expires_at IS NULL OR r.expires_at >= now())
      AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL);

    v_balance := GREATEST(v_balance, v_returns_sum);

    SELECT credit_token INTO v_latest_token
    FROM public.offline_returns
    WHERE (customer_id = v_cust_id OR (v_norm_phone != '' AND public.normalize_phone(customer_phone) = v_norm_phone))
      AND (refund_amount - COALESCE(credit_used, 0)) > 0
      AND (expires_at IS NULL OR expires_at >= now())
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Customer'),
    'customer_phone', v_cust_phone,
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', COALESCE(v_latest_token, v_clean_token),
    'active_returns', active_returns,
    'history', recent_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;

-- 4. Update place_offline_sale to strictly enforce ownership and prevent data leaks
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _payment_method text,
  _subtotal numeric,
  _discount numeric,
  _tax numeric,
  _total numeric,
  _amount_paid numeric,
  _change_given numeric,
  _store_credit_used numeric,
  _items jsonb,
  _notes text DEFAULT NULL,
  _cashier_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _coupon_code text DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  _custom_invoice_number text DEFAULT NULL,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;
  item_qty int;
  item_price numeric;
  item_cost numeric;
  item_mrp numeric;
  item_buying_price numeric;
  v_prod_id uuid;
  v_var_id uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_voucher_avail numeric := 0;
  v_effective_payment_method text;
  v_sale_id uuid;
  v_sale_number text;
  v_token_number int;
  v_cust_id uuid;
  v_norm_phone text := public.normalize_phone(_customer_phone);
  v_existing_sale record;
  v_prev_stock int;
  v_new_stock int;
  v_coupon_record record;
  v_credit_rec record;
  v_prev_cust_credit numeric := 0;
BEGIN
  -- 1. Authorization
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT public.has_role(uid, 'pos_user')
       AND NOT public.has_role(uid, 'staff')
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
    END IF;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, customer_name, payment_method, store_credit_used
    INTO v_existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'store_credit_used', v_existing_sale.store_credit_used,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Resolve Customer Record
  v_cust_id := public.resolve_or_create_customer(
    _customer_name,
    _customer_phone,
    _customer_email,
    _customer_id
  );

  SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_cust_credit
  FROM public.pos_customers
  WHERE id = v_cust_id;

  -- 4. Calculate Subtotal
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;

  -- 5. Calculate Discount
  IF _discount_type IN ('percentage', 'percent') THEN
    v_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0) / 100.0), 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal, COALESCE(_discount_value, 0));
  ELSE
    v_discount := 0;
  END IF;

  -- 6. Coupon validation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now())
      AND (COALESCE(max_uses, usage_limit, 0) <= 0 OR COALESCE(used_count, usage_count, 0) < COALESCE(max_uses, usage_limit))
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0) <= 0 
         OR (v_subtotal - v_discount) >= COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0) THEN
        
        IF v_coupon_record.discount_type IN ('percentage', 'percent') THEN
          v_coupon_discount := ROUND(((v_subtotal - v_discount) * v_coupon_record.discount_value / 100.0), 2);
        ELSIF v_coupon_record.discount_type = 'fixed' THEN
          v_coupon_discount := v_coupon_record.discount_value;
        END IF;

        IF COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount, 0) > 0 THEN
          v_coupon_discount := LEAST(v_coupon_discount, COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount));
        END IF;

        v_coupon_discount := LEAST(v_coupon_discount, GREATEST(0, v_subtotal - v_discount));

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1,
            usage_count = COALESCE(usage_count, 0) + 1
        WHERE id = v_coupon_record.id;
      END IF;
    END IF;
  END IF;

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Validate & Atomically Redeem Store Credit with Strict Customer Ownership
  IF _store_credit_used > 0 OR v_clean_token != '' THEN
    IF v_clean_token != '' THEN
      SELECT * INTO v_credit_rec
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = v_clean_token
      FOR UPDATE;

      IF v_credit_rec.id IS NOT NULL THEN
        -- Check Expiry
        IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
          RAISE EXCEPTION 'Store credit voucher % has expired', v_clean_token;
        END IF;

        -- Check Status
        IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
          RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed (Balance ₹0)', v_clean_token;
        END IF;

        -- STRICT OWNERSHIP CHECK: No personal information leaked!
        IF NOT public.verify_voucher_customer_ownership(
          v_credit_rec.customer_id,
          v_credit_rec.customer_phone,
          v_cust_id,
          _customer_phone
        ) THEN
          RAISE EXCEPTION 'This voucher is not available for this customer.';
        END IF;

        v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));
        v_voucher_token := v_clean_token;
      ELSE
        -- Check pos_exchange_vouchers fallback
        SELECT * INTO v_credit_rec
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token
        FOR UPDATE;

        IF v_credit_rec.id IS NOT NULL THEN
          IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
            RAISE EXCEPTION 'Store credit voucher % has expired', v_clean_token;
          END IF;

          IF v_credit_rec.status = 'redeemed' OR COALESCE(v_credit_rec.remaining_balance, 0) <= 0 THEN
            RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed (Balance ₹0)', v_clean_token;
          END IF;

          -- STRICT OWNERSHIP CHECK
          IF NOT public.verify_voucher_customer_ownership(
            v_credit_rec.customer_id,
            v_credit_rec.customer_phone,
            v_cust_id,
            _customer_phone
          ) THEN
            RAISE EXCEPTION 'This voucher is not available for this customer.';
          END IF;

          v_voucher_avail := GREATEST(0, v_credit_rec.remaining_balance);
          v_voucher_token := v_clean_token;
        END IF;
      END IF;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail), v_voucher_avail, v_gross_total);
        IF v_voucher_used <= 0 THEN
          v_voucher_used := LEAST(v_voucher_avail, v_gross_total);
        END IF;

        -- Update offline_returns
        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
            credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)),
            credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' ELSE 'PARTIALLY_USED' END,
            updated_at = now()
        WHERE UPPER(TRIM(credit_token)) = v_clean_token;

        -- Update pos_exchange_vouchers
        UPDATE public.pos_exchange_vouchers
        SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
            status = CASE WHEN remaining_balance - v_voucher_used <= 0 THEN 'redeemed' ELSE 'active' END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;

        -- Update store_credit_vouchers
        UPDATE public.store_credit_vouchers
        SET current_balance = GREATEST(0, current_balance - v_voucher_used),
            is_active = (current_balance - v_voucher_used > 0),
            redeemed_at = CASE WHEN current_balance - v_voucher_used <= 0 THEN now() ELSE redeemed_at END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;
      END IF;
    ELSIF v_prev_cust_credit > 0 THEN
      v_voucher_used := LEAST(_store_credit_used, v_prev_cust_credit, v_gross_total);
      IF v_voucher_used > 0 THEN
        UPDATE public.pos_customers
        SET store_credit_balance = GREATEST(0, store_credit_balance - v_voucher_used),
            store_credit = GREATEST(0, store_credit - v_voucher_used),
            updated_at = now()
        WHERE id = v_cust_id;
      END IF;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment Method Resolution
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(trim(_payment_method), ''), 'cash');
  END IF;

  -- 9. Sale Number Generation
  IF _custom_invoice_number IS NOT NULL AND trim(_custom_invoice_number) != '' THEN
    v_sale_number := upper(trim(_custom_invoice_number));
  ELSE
    v_sale_number := public.generate_pos_invoice_number();
  END IF;

  v_token_number := public.get_next_pos_token_number();
  v_sale_id := gen_random_uuid();

  -- 10. Insert Sale Record
  INSERT INTO public.offline_sales (
    id,
    sale_number,
    token_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    subtotal,
    discount,
    tax,
    total,
    amount_paid,
    change_given,
    store_credit_used,
    credit_token_used,
    notes,
    cashier_id,
    created_by,
    idempotency_key
  ) VALUES (
    v_sale_id,
    v_sale_number,
    v_token_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    _customer_phone,
    _customer_email,
    v_effective_payment_method,
    v_subtotal,
    v_discount + v_coupon_discount,
    COALESCE(_tax, 0),
    v_payable_total,
    CASE WHEN v_payable_total = 0 THEN 0 ELSE COALESCE(_amount_paid, v_payable_total) END,
    CASE WHEN v_payable_total = 0 THEN 0 ELSE COALESCE(_change_given, 0) END,
    v_voucher_used,
    v_voucher_token,
    _notes,
    COALESCE(_cashier_id, uid),
    uid,
    _idempotency_key
  );

  -- 11. Insert Ledger Entry
  IF v_voucher_used > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      amount,
      type,
      balance_before,
      balance_after,
      notes,
      credit_token,
      sale_id
    ) VALUES (
      v_cust_id,
      v_voucher_used,
      'CREDIT_USED',
      v_voucher_avail,
      GREATEST(0, v_voucher_avail - v_voucher_used),
      'Redeemed on POS Sale #' || v_sale_number || COALESCE(' using voucher ' || v_voucher_token, ''),
      v_voucher_token,
      v_sale_id
    );
  END IF;

  -- 12. Process Sale Items & Deduct Inventory
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_price);
    item_cost := COALESCE((elem->>'cost_price')::numeric, (elem->>'cost')::numeric, 0);

    v_prod_id := CASE 
      WHEN elem->>'product_id' IS NOT NULL AND elem->>'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN (elem->>'product_id')::uuid 
      ELSE NULL 
    END;

    v_var_id := CASE 
      WHEN elem->>'variant_id' IS NOT NULL AND elem->>'variant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN (elem->>'variant_id')::uuid 
      ELSE NULL 
    END;

    IF v_prod_id IS NULL AND elem->>'product_slug' IS NOT NULL THEN
      SELECT id INTO v_prod_id FROM public.products WHERE slug = elem->>'product_slug' LIMIT 1;
    END IF;

    SELECT COALESCE(buying_price, cost_price, 0) INTO item_buying_price
    FROM public.products
    WHERE id = v_prod_id;
    IF item_cost = 0 THEN
      item_cost := COALESCE(item_buying_price, 0);
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      sku,
      barcode,
      variant_info,
      unit_mrp,
      unit_selling_price,
      final_unit_paid_price,
      cost_price,
      quantity,
      price,
      subtotal,
      total
    ) VALUES (
      v_sale_id,
      v_prod_id,
      v_var_id,
      COALESCE(elem->>'product_name', elem->>'name', 'Item'),
      COALESCE(elem->>'product_slug', elem->>'slug', 'custom-item'),
      COALESCE(elem->>'sku', ''),
      COALESCE(elem->>'barcode', ''),
      COALESCE(elem->>'variant_info', elem->>'variant_name', ''),
      item_mrp,
      item_price,
      item_price,
      item_cost,
      item_qty,
      item_price,
      (item_price * item_qty),
      (item_price * item_qty)
    );

    IF v_var_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_var_id FOR UPDATE;
      v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - item_qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = v_var_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        v_prod_id,
        v_var_id,
        'offline_sale'::public.inventory_tx_type,
        'offline_sale'::public.inventory_tx_type,
        -item_qty,
        v_prev_stock,
        v_new_stock,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number,
        'POS Sale #' || v_sale_number,
        uid
      );
    ELSIF v_prod_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_prod_id FOR UPDATE;
      v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - item_qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = v_prod_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        v_prod_id,
        NULL,
        'offline_sale'::public.inventory_tx_type,
        'offline_sale'::public.inventory_tx_type,
        -item_qty,
        v_prev_stock,
        v_new_stock,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number,
        'POS Sale #' || v_sale_number,
        uid
      );
    END IF;
  END LOOP;

  -- 13. Update Customer stats
  IF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_payable_total,
        total_orders = COALESCE(total_orders, 0) + 1,
        visits_count = COALESCE(visits_count, 0) + 1,
        last_order_date = now(),
        last_visit_date = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'token_number', v_token_number,
    'total', v_payable_total,
    'subtotal', v_subtotal,
    'discount', v_discount + v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'credit_token', v_voucher_token,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid, text, text, numeric, text, uuid, text, text
) TO authenticated, anon, service_role;

-- 5. Update validate_coupon to support online Store Credit / Exchange Voucher validation with ownership check
CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _user_id uuid, _order_total numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  c record;
  v_voucher record;
  user_uses integer;
  discount numeric := 0;
  clean_code text;
  v_user_phone text;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon or voucher code is required');
  END IF;

  clean_code := upper(trim(_code));

  -- 1. Check in public.coupons first
  SELECT * INTO c 
  FROM public.coupons 
  WHERE upper(code) = clean_code 
    AND COALESCE(is_active, active, true) = true;

  IF c.id IS NOT NULL THEN 
    IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN 
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon not yet active'); 
    ELSIF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon not yet active');
    END IF;

    IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN 
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon has expired'); 
    ELSIF c.expires_at IS NOT NULL AND now() > c.expires_at THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon has expired');
    END IF;

    IF COALESCE(c.max_uses, c.usage_limit, 0) > 0 AND COALESCE(c.used_count, c.usage_count, 0) >= COALESCE(c.max_uses, c.usage_limit) THEN 
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon usage limit reached'); 
    END IF;

    IF _order_total < COALESCE(c.min_order_amount, c.minimum_order_value, 0) THEN 
      RETURN jsonb_build_object('valid', false, 'error', 'Minimum order value is ₹' || COALESCE(c.min_order_amount, c.minimum_order_value, 0)); 
    END IF;

    IF _user_id IS NOT NULL THEN
      SELECT count(*) INTO user_uses FROM public.coupon_usage WHERE coupon_id = c.id AND user_id = _user_id;
      IF c.per_user_limit > 0 AND user_uses >= c.per_user_limit THEN 
        RETURN jsonb_build_object('valid', false, 'error', 'You have already used this coupon'); 
      END IF;
    END IF;

    IF lower(c.discount_type::text) IN ('percentage', 'percent') THEN
      discount := ROUND((_order_total * c.discount_value) / 100, 0);
      IF COALESCE(c.max_discount_amount, c.maximum_discount, 0) > 0 AND discount > COALESCE(c.max_discount_amount, c.maximum_discount) THEN 
        discount := COALESCE(c.max_discount_amount, c.maximum_discount); 
      END IF;
    ELSE
      discount := LEAST(c.discount_value, GREATEST(0, _order_total));
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'is_voucher', false,
      'code', c.code,
      'coupon_id', c.id,
      'discount_type', c.discount_type::text,
      'discount_value', c.discount_value,
      'discount', discount,
      'minimum_order_value', COALESCE(c.min_order_amount, c.minimum_order_value, 0),
      'maximum_discount', COALESCE(c.max_discount_amount, c.maximum_discount, 0)
    );
  END IF;

  -- 2. If not found in coupons, check if it's a Store Credit / Exchange Voucher
  SELECT 
    id, customer_id, customer_phone,
    refund_amount, credit_used,
    GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
    expires_at, credit_token_status
  INTO v_voucher
  FROM public.offline_returns
  WHERE UPPER(TRIM(credit_token)) = clean_code
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_voucher.id IS NULL THEN
    SELECT 
      id, customer_id, customer_phone,
      original_amount AS refund_amount, 0 AS credit_used,
      remaining_balance, expires_at, status AS credit_token_status
    INTO v_voucher
    FROM public.pos_exchange_vouchers
    WHERE UPPER(TRIM(token)) = clean_code
    LIMIT 1;
  END IF;

  IF v_voucher.id IS NULL THEN
    SELECT 
      id, customer_id, customer_phone,
      initial_amount AS refund_amount, 0 AS credit_used,
      current_balance AS remaining_balance, expires_at, 'ACTIVE' AS credit_token_status
    INTO v_voucher
    FROM public.store_credit_vouchers
    WHERE UPPER(TRIM(token)) = clean_code
    LIMIT 1;
  END IF;

  IF v_voucher.id IS NOT NULL THEN
    -- Check expiry
    IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Voucher ' || clean_code || ' has expired');
    END IF;

    -- Check remaining balance
    IF v_voucher.remaining_balance <= 0 OR v_voucher.credit_token_status IN ('CONSUMED', 'redeemed') THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Voucher ' || clean_code || ' has already been fully redeemed (Balance ₹0)');
    END IF;

    -- Look up authenticated user's registered phone
    IF _user_id IS NOT NULL THEN
      SELECT phone INTO v_user_phone FROM public.profiles WHERE id = _user_id;
      IF v_user_phone IS NULL OR trim(v_user_phone) = '' THEN
        SELECT phone INTO v_user_phone FROM auth.users WHERE id = _user_id;
      END IF;
    END IF;

    -- Strictly verify customer ownership
    IF NOT public.verify_voucher_customer_ownership(
      v_voucher.customer_id,
      v_voucher.customer_phone,
      _user_id,
      v_user_phone
    ) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'This voucher is not available for this customer.');
    END IF;

    discount := LEAST(v_voucher.remaining_balance, GREATEST(0, _order_total));

    RETURN jsonb_build_object(
      'valid', true,
      'is_voucher', true,
      'code', clean_code,
      'coupon_id', v_voucher.id,
      'discount_type', 'fixed',
      'discount_value', discount,
      'discount', discount,
      'minimum_order_value', 0,
      'maximum_discount', v_voucher.remaining_balance,
      'remaining_balance', v_voucher.remaining_balance
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'error', 'Invalid coupon code');
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(text, uuid, numeric) TO anon, authenticated, service_role;

-- 6. Update create_checkout_session to support vouchers with customer ownership verification
CREATE OR REPLACE FUNCTION public.create_checkout_session(
  _items jsonb,
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _coupon_code text DEFAULT NULL,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL,
  _payment_method text DEFAULT 'online',
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
  std_shipping numeric := 65;
  free_shipping_threshold numeric := 999;
  free_delivery_enabled boolean := true;
  coupon_record record;
  v_voucher record;
  v_session_id text;
  existing_session record;
  ps_rec record;
  cod_fee numeric := 0;
  v_raw_val text;
  v_delivery_fees_raw text;
  v_delivery_fees jsonb;
  v_custom_shipping numeric := NULL;
  v_item_fee numeric;
  v_has_explicit_fee boolean := false;
  v_all_items_free boolean := true;
  v_clean_payment_method text;
  v_clean_coupon text := NULL;
  v_clean_var_id uuid;
  v_item_qty int;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT *
    INTO existing_session
    FROM public.checkout_sessions
    WHERE idempotency_key = trim(_idempotency_key)
      AND expires_at > now()
      AND status IN ('active', 'pending', 'payment_pending', 'payment_cancelled', 'payment_failed')
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

  -- 3. Validate Items & Compute Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Checkout items cannot be empty.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := COALESCE(item.qty, item.quantity, 0);
    IF v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_var_id IS NOT NULL THEN
      SELECT pv.id AS variant_id,
             COALESCE(pv.price_override, p.price) AS price,
             COALESCE(pv.mrp_override, p.mrp) AS mrp,
             pv.sku AS variant_sku,
             pv.barcode AS variant_barcode,
             pv.color AS variant_color,
             pv.size AS variant_size,
             pv.name AS variant_name,
             pv.image_url AS variant_image,
             pv.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT NULL::uuid AS variant_id,
             p.price,
             p.mrp,
             p.sku AS variant_sku,
             p.barcode AS variant_barcode,
             NULL::text AS variant_color,
             NULL::text AS variant_size,
             'Default' AS variant_name,
             (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS variant_image,
             p.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND p.id::text = item.product_id)
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product item not found in catalog.';
    END IF;

    IF variant.stock < v_item_qty THEN
      RAISE EXCEPTION 'Item "%" is out of stock or requested quantity exceeds available inventory.', variant.product_name;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * v_item_qty);

    item_obj := jsonb_build_object(
      'product_id', variant.p_id,
      'variant_id', variant.variant_id,
      'product_name', variant.product_name,
      'product_slug', variant.product_slug,
      'variant_sku', variant.variant_sku,
      'variant_barcode', variant.variant_barcode,
      'variant_color', variant.variant_color,
      'variant_size', variant.variant_size,
      'price', variant.price,
      'mrp', variant.mrp,
      'qty', v_item_qty,
      'line_subtotal', (variant.price * v_item_qty),
      'image_url', variant.variant_image
    );

    validated_items := validated_items || jsonb_build_array(item_obj);
  END LOOP;

  -- 4. Dynamic Coupon OR Store Credit Voucher Evaluation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
          computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
          IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
            computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
          END IF;
        ELSE
          computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
        END IF;
        v_clean_coupon := coupon_record.code;
      ELSE
        v_clean_coupon := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      -- Check if it's a Store Credit or Exchange Voucher
      SELECT 
        id, customer_id, customer_phone,
        refund_amount, credit_used,
        GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
        expires_at, credit_token_status
      INTO v_voucher
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(_coupon_code))
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_voucher.id IS NULL THEN
        SELECT 
          id, customer_id, customer_phone,
          original_amount AS refund_amount, 0 AS credit_used,
          remaining_balance, expires_at, status AS credit_token_status
        INTO v_voucher
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = UPPER(TRIM(_coupon_code))
        LIMIT 1;
      END IF;

      IF v_voucher.id IS NULL THEN
        SELECT 
          id, customer_id, customer_phone,
          initial_amount AS refund_amount, 0 AS credit_used,
          current_balance AS remaining_balance, expires_at, 'ACTIVE' AS credit_token_status
        INTO v_voucher
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = UPPER(TRIM(_coupon_code))
        LIMIT 1;
      END IF;

      IF v_voucher.id IS NOT NULL THEN
        IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
          RAISE EXCEPTION 'Voucher % has expired.', UPPER(TRIM(_coupon_code));
        END IF;

        IF v_voucher.remaining_balance <= 0 OR v_voucher.credit_token_status IN ('CONSUMED', 'redeemed') THEN
          RAISE EXCEPTION 'Voucher % has already been fully redeemed.', UPPER(TRIM(_coupon_code));
        END IF;

        -- Strictly verify customer ownership
        IF NOT public.verify_voucher_customer_ownership(
          v_voucher.customer_id,
          v_voucher.customer_phone,
          uid,
          _phone
        ) THEN
          RAISE EXCEPTION 'This voucher is not available for this customer.';
        END IF;

        computed_discount := LEAST(v_voucher.remaining_balance, computed_subtotal);
        v_clean_coupon := UPPER(TRIM(_coupon_code));
      ELSE
        v_clean_coupon := NULL;
      END IF;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Read Shipping Settings from site_settings (Synchronized)
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_charge' LIMIT 1;
  IF v_raw_val IS NULL THEN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee' LIMIT 1;
  END IF;
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := trim(v_raw_val)::numeric;
  ELSE
    std_shipping := 65;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold' LIMIT 1;
  IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
    free_shipping_threshold := trim(v_raw_val)::numeric;
  ELSE
    free_shipping_threshold := 999;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
  IF v_raw_val IS NOT NULL THEN
    free_delivery_enabled := (lower(trim(v_raw_val)) = 'true');
  ELSE
    free_delivery_enabled := true;
  END IF;

  -- 6. Check per-product custom delivery fee overrides
  SELECT value INTO v_delivery_fees_raw FROM public.site_settings WHERE key = 'product_delivery_fees' LIMIT 1;
  IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
    BEGIN
      v_delivery_fees := v_delivery_fees_raw::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_delivery_fees := '{}'::jsonb;
    END;
  ELSE
    v_delivery_fees := '{}'::jsonb;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(validated_items) LOOP
    v_item_fee := NULL;
    IF v_delivery_fees ? (item->>'product_id') THEN
      v_item_fee := (v_delivery_fees->>(item->>'product_id'))::numeric;
    ELSIF v_delivery_fees ? (item->>'product_slug') THEN
      v_item_fee := (v_delivery_fees->>(item->>'product_slug'))::numeric;
    END IF;

    IF v_item_fee IS NOT NULL THEN
      v_has_explicit_fee := true;
      IF v_item_fee > 0 THEN
        v_all_items_free := false;
        IF v_custom_shipping IS NULL OR v_item_fee > v_custom_shipping THEN
          v_custom_shipping := v_item_fee;
        END IF;
      END IF;
    ELSE
      v_all_items_free := false;
    END IF;
  END LOOP;

  IF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSIF v_custom_shipping IS NOT NULL THEN
    shipping := v_custom_shipping;
  ELSE
    IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
      shipping := 0;
    ELSE
      shipping := std_shipping;
    END IF;
  END IF;

  -- 7. Payment method validation
  v_clean_payment_method := lower(COALESCE(NULLIF(trim(_payment_method), ''), 'online'));
  IF v_clean_payment_method NOT IN ('online', 'cod') THEN
    v_clean_payment_method := 'online';
  END IF;

  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.id IS NOT NULL THEN
    IF v_clean_payment_method = 'cod' THEN
      IF NOT ps_rec.cod_enabled THEN
        RAISE EXCEPTION 'Cash on Delivery is currently disabled by store management.';
      END IF;
      IF net_subtotal < ps_rec.min_cod_amount THEN
        RAISE EXCEPTION 'Minimum order amount for COD is ₹%', ps_rec.min_cod_amount;
      END IF;
      IF ps_rec.max_cod_amount > 0 AND net_subtotal > ps_rec.max_cod_amount THEN
        RAISE EXCEPTION 'Maximum order amount for COD is ₹%', ps_rec.max_cod_amount;
      END IF;
      cod_fee := ps_rec.cod_charge;
    ELSIF v_clean_payment_method = 'online' THEN
      IF NOT ps_rec.razorpay_enabled THEN
        RAISE EXCEPTION 'Online payment is currently disabled.';
      END IF;
    END IF;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.checkout_sessions (
    session_id,
    user_id,
    idempotency_key,
    items,
    customer_details,
    subtotal,
    shipping_fee,
    cod_fee,
    discount,
    total,
    coupon_code,
    payment_method,
    status,
    expires_at
  ) VALUES (
    v_session_id,
    uid,
    _idempotency_key,
    validated_items,
    jsonb_build_object(
      'full_name', trim(_full_name),
      'email', trim(_email),
      'phone', trim(_phone),
      'alt_phone', trim(COALESCE(_alt_phone, '')),
      'address', trim(_address),
      'address_line2', trim(COALESCE(_address_line2, '')),
      'landmark', trim(COALESCE(_landmark, '')),
      'city', trim(_city),
      'state', trim(_state),
      'pincode', trim(_pincode),
      'notes', trim(COALESCE(_notes, ''))
    ),
    computed_subtotal,
    shipping,
    cod_fee,
    computed_discount,
    computed_total,
    v_clean_coupon,
    v_clean_payment_method,
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
    'expires_at', (now() + interval '30 minutes')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_session(
  jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated, anon, service_role;

-- 7. Update place_cod_order to atomically deduct store credit vouchers
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
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_details jsonb;
  v_user_id uuid;
  v_buying_price numeric;
BEGIN
  -- 1. Fetch and Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id OR id::text = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found: %', _session_id;
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
    FROM public.orders
    WHERE id = session_rec.order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  IF session_rec.expires_at < now() THEN
    RAISE EXCEPTION 'Checkout session has expired. Please initiate checkout again.';
  END IF;

  -- 2. Verify Stock
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
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

  -- 3. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 4. Insert Canonical COD Order with status strictly 'placed'
  INSERT INTO public.orders (
    id,
    user_id,
    invoice_no,
    order_number,
    subtotal,
    shipping,
    shipping_fee,
    discount,
    total,
    coupon_code,
    status,
    payment_method,
    payment_status,
    full_name,
    email,
    phone,
    alt_phone,
    address,
    address_line2,
    landmark,
    city,
    state,
    pincode,
    notes,
    idempotency_key
  ) VALUES (
    new_order_id,
    v_user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'placed'::public.order_status,
    'cod',
    'pending'::public.payment_status,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'alt_phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'address_line2', ''),
    COALESCE(v_cust_details->>'landmark', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    COALESCE(v_cust_details->>'notes', ''),
    session_rec.idempotency_key
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Cash on Delivery Order placed successfully', v_user_id);

  -- 5. Insert Order Items & Deduct Stock Atomically
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
    SELECT COALESCE(buying_price, cost_price, 0) INTO v_buying_price
    FROM public.products
    WHERE id = item_rec.product_id;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      title,
      product_slug,
      slug,
      sku,
      unit_price,
      price,
      price_at_time,
      subtotal,
      quantity,
      mrp,
      variant_sku,
      variant_color,
      variant_size,
      variant_barcode,
      image_url,
      item_image,
      item_title,
      buying_price
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      item_rec.product_name,
      item_rec.product_name,
      item_rec.product_slug,
      item_rec.product_slug,
      COALESCE(item_rec.variant_sku, ''),
      item_rec.price,
      item_rec.price,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      item_rec.qty,
      COALESCE(item_rec.mrp, item_rec.price),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      COALESCE(v_buying_price, 0)
    );

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_rec.variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.variant_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        item_rec.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.product_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        NULL,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 6. Atomically deduct store credit voucher if one was applied
  IF session_rec.coupon_code IS NOT NULL AND session_rec.discount > 0 THEN
    UPDATE public.offline_returns
    SET credit_used = COALESCE(credit_used, 0) + session_rec.discount,
        credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)),
        credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)) <= 0 THEN 'CONSUMED' ELSE 'PARTIALLY_USED' END,
        updated_at = now()
    WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.pos_exchange_vouchers
    SET remaining_balance = GREATEST(0, remaining_balance - session_rec.discount),
        status = CASE WHEN remaining_balance - session_rec.discount <= 0 THEN 'redeemed' ELSE 'active' END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.store_credit_vouchers
    SET current_balance = GREATEST(0, current_balance - session_rec.discount),
        is_active = (current_balance - session_rec.discount > 0),
        redeemed_at = CASE WHEN current_balance - session_rec.discount <= 0 THEN now() ELSE redeemed_at END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));
  END IF;

  -- 7. Mark Session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      order_id = new_order_id,
      updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'pending',
    'status', 'placed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_cod_order(text) TO authenticated, anon, service_role;

-- 8. Update finalize_paid_order to atomically deduct store credit vouchers
DROP FUNCTION IF EXISTS public.finalize_paid_order(text, text, text, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.finalize_paid_order CASCADE;

CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text DEFAULT NULL,
  _razorpay_order_id text DEFAULT NULL,
  _razorpay_payment_id text DEFAULT NULL,
  _razorpay_signature text DEFAULT NULL,
  _verified_amount numeric DEFAULT NULL
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
  v_buying_price numeric;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_user_id uuid;
  v_cust_details jsonb;
  v_effective_variant_id uuid;
BEGIN
  -- 1. Idempotency Check: Already processed?
  SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
  FROM public.orders
  WHERE (_razorpay_payment_id IS NOT NULL AND razorpay_payment_id = _razorpay_payment_id)
     OR (_razorpay_order_id IS NOT NULL AND razorpay_order_id = _razorpay_order_id AND payment_status = 'paid')
  LIMIT 1;

  IF existing_order.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  -- 2. Fetch and Lock Checkout Session
  IF _session_id IS NOT NULL AND trim(_session_id) != '' THEN
    SELECT * INTO session_rec
    FROM public.checkout_sessions
    WHERE session_id = _session_id OR id::text = _session_id
    FOR UPDATE;
  END IF;

  IF session_rec.id IS NULL AND _razorpay_order_id IS NOT NULL THEN
    SELECT * INTO attempt_rec
    FROM public.payment_attempts
    WHERE razorpay_order_id = _razorpay_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF attempt_rec.id IS NOT NULL AND attempt_rec.session_id IS NOT NULL THEN
      SELECT * INTO session_rec
      FROM public.checkout_sessions
      WHERE session_id = attempt_rec.session_id OR id::text = attempt_rec.session_id
      FOR UPDATE;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for session_id: %, rzp_order_id: %', _session_id, _razorpay_order_id;
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
    FROM public.orders
    WHERE id = session_rec.order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  -- 3. Verify Amount with Paise-to-Rupees Normalization
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF session_rec.total > 0 AND _verified_amount >= (session_rec.total * 50) THEN
      _verified_amount := _verified_amount / 100.0;
    END IF;

    IF abs(session_rec.total - _verified_amount) > 0.05 THEN
      RAISE EXCEPTION 'Verified amount (₹%) does not match session total (₹%)', _verified_amount, session_rec.total;
    END IF;
  END IF;

  -- 4. Inventory Lock & Verification
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    v_effective_variant_id := item_rec.variant_id;
    IF v_effective_variant_id IS NULL AND item_rec.product_id IS NOT NULL THEN
      SELECT id INTO v_effective_variant_id
      FROM public.product_variants
      WHERE product_id = item_rec.product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_rec.qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    IF v_effective_variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = v_effective_variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', v_effective_variant_id;
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
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Order with initial status strictly 'placed'
  INSERT INTO public.orders (
    id,
    user_id,
    invoice_no,
    order_number,
    subtotal,
    shipping,
    shipping_fee,
    discount,
    total,
    coupon_code,
    status,
    payment_method,
    payment_status,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    full_name,
    email,
    phone,
    alt_phone,
    address,
    address_line2,
    landmark,
    city,
    state,
    pincode,
    notes,
    idempotency_key
  ) VALUES (
    new_order_id,
    v_user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'placed'::public.order_status,
    COALESCE(session_rec.payment_method, 'online'),
    'paid'::public.payment_status,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'alt_phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'address_line2', ''),
    COALESCE(v_cust_details->>'landmark', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    COALESCE(v_cust_details->>'notes', ''),
    session_rec.idempotency_key
  );

  -- Insert payment record
  INSERT INTO public.payments (
    order_id,
    provider,
    payment_id,
    order_reference,
    method,
    amount,
    status,
    metadata
  ) VALUES (
    new_order_id,
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    'online',
    session_rec.total,
    'paid'::public.payment_status,
    jsonb_build_object(
      'signature', _razorpay_signature,
      'verified_amount', _verified_amount,
      'session_id', session_rec.id
    )
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully and payment verified', v_user_id);

  -- 7. Insert Order Items & Deduct Stock Atomically (SINGLE-SOURCE MUTATION)
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
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    v_effective_variant_id := item_rec.variant_id;
    IF v_effective_variant_id IS NULL AND item_rec.product_id IS NOT NULL THEN
      SELECT id INTO v_effective_variant_id
      FROM public.product_variants
      WHERE product_id = item_rec.product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_rec.qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_slug,
      qty,
      price,
      subtotal,
      sku_snapshot,
      color,
      size,
      barcode_snapshot,
      image_url_snapshot,
      image_url,
      product_name_snapshot,
      name,
      buying_price
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      v_effective_variant_id,
      COALESCE(item_rec.product_slug, ''),
      item_rec.qty,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      item_rec.product_name,
      COALESCE(v_buying_price, 0)
    );

    IF v_effective_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_effective_variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = v_effective_variant_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        v_effective_variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.product_id;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        item_rec.product_id,
        NULL,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 8. Deduct store credit voucher if one was applied
  IF session_rec.coupon_code IS NOT NULL AND session_rec.discount > 0 THEN
    UPDATE public.offline_returns
    SET credit_used = COALESCE(credit_used, 0) + session_rec.discount,
        credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)),
        credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)) <= 0 THEN 'CONSUMED' ELSE 'PARTIALLY_USED' END,
        updated_at = now()
    WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.pos_exchange_vouchers
    SET remaining_balance = GREATEST(0, remaining_balance - session_rec.discount),
        status = CASE WHEN remaining_balance - session_rec.discount <= 0 THEN 'redeemed' ELSE 'active' END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.store_credit_vouchers
    SET current_balance = GREATEST(0, current_balance - session_rec.discount),
        is_active = (current_balance - session_rec.discount > 0),
        redeemed_at = CASE WHEN current_balance - session_rec.discount <= 0 THEN now() ELSE redeemed_at END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));
  END IF;

  -- 9. Mark Session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      order_id = new_order_id,
      updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'paid',
    'status', 'placed',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO anon, authenticated, service_role;

