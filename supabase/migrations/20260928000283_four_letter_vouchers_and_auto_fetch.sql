-- ==============================================================================
-- Migration: 20260928000283_four_letter_vouchers_and_auto_fetch.sql
-- Description:
-- 1. Update public.generate_store_credit_token() to generate concise 4-character
--    alphanumeric tokens (e.g. 7J5X, K9M2).
-- 2. Update get_store_credit_voucher to allow seamless POS counter voucher redemption
--    without false ownership mismatch errors.
-- 3. Update get_customer_store_credit to automatically fetch and aggregate all active
--    unredeemed vouchers and return tokens for any selected customer.
-- ==============================================================================

-- 1. Concise 4-Character High-Entropy Voucher Token Generator
CREATE OR REPLACE FUNCTION public.generate_store_credit_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- Unambiguous characters
  candidate text;
  i int;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..4 LOOP
      candidate := candidate || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM public.offline_returns 
      WHERE UPPER(TRIM(credit_token)) = candidate 
        AND (credit_token_status = 'ACTIVE' OR credit_token_status IS NULL OR (refund_amount - COALESCE(credit_used, 0)) > 0)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.store_credit_vouchers 
      WHERE UPPER(TRIM(token)) = candidate 
        AND is_active = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.pos_exchange_vouchers 
      WHERE UPPER(TRIM(token)) = candidate 
        AND status = 'active'
    )
    THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_store_credit_token() TO authenticated, anon, service_role;

-- 2. Comprehensive get_store_credit_voucher RPC
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

  -- A. Check in public.offline_returns (Primary Return Vouchers)
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

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_ret_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_ret_rec.return_id,
      'return_id', v_ret_rec.return_id,
      'token', v_ret_rec.token,
      'customer_id', v_ret_rec.customer_id,
      'customer_name', COALESCE(v_ret_rec.customer_name, 'Walk-in Customer'),
      'customer_phone', COALESCE(v_ret_rec.customer_phone, ''),
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

  -- B. Check in public.pos_exchange_vouchers
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

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_pos_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_pos_rec.id,
      'return_id', v_pos_rec.return_id,
      'token', v_pos_rec.token,
      'customer_id', v_pos_rec.customer_id,
      'customer_name', COALESCE(v_pos_rec.customer_name, 'Walk-in Customer'),
      'customer_phone', COALESCE(v_pos_rec.customer_phone, ''),
      'original_amount', v_pos_rec.original_amount,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_pos_rec.expires_at,
      'days_remaining', v_days_left
    );
  END IF;

  -- C. Check in public.store_credit_vouchers
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

    IF v_sc_rec.is_active = false OR v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_sc_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_sc_rec.id,
      'token', v_sc_rec.token,
      'customer_id', v_sc_rec.customer_id,
      'customer_phone', COALESCE(v_sc_rec.customer_phone, ''),
      'original_amount', v_sc_rec.initial_amount,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_sc_rec.expires_at,
      'days_remaining', v_days_left
    );
  END IF;

  -- D. Check in promotional coupons
  SELECT * INTO v_coup_rec
  FROM public.coupons
  WHERE UPPER(TRIM(code)) = v_clean_token
    AND is_active = true
  LIMIT 1;

  IF v_coup_rec.code IS NOT NULL THEN
    IF v_coup_rec.expires_at IS NOT NULL AND v_coup_rec.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Coupon ' || v_clean_token || ' has expired');
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', true,
      'coupon_code', v_coup_rec.code,
      'token', v_coup_rec.code,
      'discount_type', v_coup_rec.discount_type,
      'discount_value', v_coup_rec.discount_value,
      'min_cart_value', COALESCE(v_coup_rec.minimum_order_value, 0),
      'max_discount', v_coup_rec.maximum_discount,
      'remaining_balance', v_coup_rec.discount_value,
      'available_credit', v_coup_rec.discount_value,
      'status', 'active'
    );
  END IF;

  RETURN jsonb_build_object('valid', false, 'error', 'Voucher or Coupon ' || v_clean_token || ' not found');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_credit_voucher(text, uuid, text, uuid) TO authenticated, anon, service_role;

-- 3. Comprehensive get_customer_store_credit RPC
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
  v_cust_name text := 'Walk-in Customer';
  v_cust_phone text := '';
  v_norm_phone text := public.normalize_phone(_phone);
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_returns_sum numeric := 0;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, look up that specific voucher instrument
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
          'credit_token', v_clean_token,
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
    ), '[]'::jsonb)
    INTO active_returns
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL);

    -- Calculate total active unredeemed balance
    SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
    INTO v_returns_sum
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL);

    v_balance := GREATEST(v_balance, v_returns_sum);

    -- Get latest active token
    IF jsonb_array_length(active_returns) > 0 THEN
      v_latest_token := active_returns->0->>'credit_token';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Customer'),
    'customer_phone', COALESCE(v_cust_phone, ''),
    'available_credit', v_balance,
    'credit_token', v_latest_token,
    'active_returns', active_returns,
    'history', recent_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;
