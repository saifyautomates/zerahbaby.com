-- =====================================================================
-- Migration: 20260928000247_fix_pos_store_credit_and_voucher_unification.sql
-- Description: 
--   1. Fix get_store_credit_voucher RPC to eliminate PostgreSQL 42703 error
--      (record "v_voucher" has no field "id") by safely checking offline_returns,
--      pos_exchange_vouchers, store_credit_vouchers, and promotional coupons.
--   2. Update get_customer_store_credit RPC to calculate available_credit
--      from active unexpired return vouchers and auto-sync to pos_customers.
--   3. Update get_pos_customer_intel RPC to accept both _customer_id and
--      p_customer_id and report real-time store credit balances.
--   4. Sync pos_exchange_vouchers and pos_customers.store_credit_balance
--      from existing offline_returns records.
-- =====================================================================

-- 1. Synchronize pos_exchange_vouchers from existing offline_returns
INSERT INTO public.pos_exchange_vouchers (
  token, return_id, customer_id, customer_phone, customer_name,
  original_amount, remaining_balance, status, expires_at, created_at
)
SELECT 
  UPPER(TRIM(credit_token)), id, customer_id, customer_phone, customer_name,
  refund_amount, GREATEST(0, refund_amount - COALESCE(credit_used, 0)),
  CASE 
    WHEN (refund_amount - COALESCE(credit_used, 0)) <= 0 OR credit_token_status = 'CONSUMED' THEN 'redeemed'
    WHEN expires_at < now() OR credit_token_status = 'EXPIRED' THEN 'expired'
    ELSE 'active'
  END,
  COALESCE(expires_at, credit_expires_at, created_at + interval '365 days'),
  created_at
FROM public.offline_returns
WHERE credit_token IS NOT NULL AND TRIM(credit_token) != ''
ON CONFLICT (UPPER(token)) DO UPDATE
SET remaining_balance = EXCLUDED.remaining_balance,
    status = EXCLUDED.status,
    customer_id = COALESCE(EXCLUDED.customer_id, pos_exchange_vouchers.customer_id),
    customer_phone = COALESCE(EXCLUDED.customer_phone, pos_exchange_vouchers.customer_phone),
    updated_at = now();

-- 2. Synchronize pos_customers.store_credit_balance from active returns
UPDATE public.pos_customers c
SET store_credit_balance = COALESCE((
  SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
  FROM public.offline_returns r
  WHERE (r.customer_id = c.id OR (c.phone != '' AND (r.customer_phone = c.phone OR right(r.customer_phone, 10) = right(c.phone, 10))))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND r.refund_amount > COALESCE(r.credit_used, 0)
), 0),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.offline_returns r
  WHERE (r.customer_id = c.id OR (c.phone != '' AND (r.customer_phone = c.phone OR right(r.customer_phone, 10) = right(c.phone, 10))))
);

-- 3. Robust Authoritative get_store_credit_voucher RPC
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
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
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

  -- 1. Check in public.offline_returns first (source of truth for returns)
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
    COALESCE(expires_at, credit_expires_at, created_at + interval '365 days') AS expires_at,
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

  -- 3. Check in public.store_credit_vouchers
  SELECT * INTO v_sc_rec
  FROM public.store_credit_vouchers
  WHERE UPPER(TRIM(token)) = v_clean_token
  LIMIT 1;

  IF v_sc_rec.token IS NOT NULL THEN
    v_remaining := COALESCE(v_sc_rec.current_balance, 0);
    IF v_remaining > 0 AND (v_sc_rec.expires_at IS NULL OR v_sc_rec.expires_at >= now()) AND v_sc_rec.is_active = true THEN
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
  END IF;

  -- 4. Check in public.coupons (Allow promotional coupons entered in this same box!)
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

-- 4. Authoritative get_customer_store_credit RPC
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
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_returns_sum numeric := 0;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, isolate to this specific voucher instrument
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

    IF v_single_voucher.id IS NOT NULL THEN
      IF v_single_voucher.expires_at IS NOT NULL AND v_single_voucher.expires_at < now() THEN
        v_balance := 0;
      ELSE
        v_balance := v_single_voucher.remaining_balance;
      END IF;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := COALESCE(v_single_voucher.customer_name, 'Walk-in Customer');
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

    IF v_clean_phone = '' AND v_cust_phone != '' THEN
      v_clean_phone := regexp_replace(v_cust_phone, '[^0-9]', '', 'g');
    END IF;

  -- 3. Otherwise search by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, phone
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;
  END IF;

  -- 4. Calculate active returns sum and latest token
  SELECT 
    COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0),
    COALESCE((
      SELECT credit_token 
      FROM public.offline_returns sub_r
      WHERE ((v_cust_id IS NOT NULL AND sub_r.customer_id = v_cust_id) 
             OR (length(v_clean_phone) >= 10 AND (sub_r.customer_phone = v_clean_phone OR right(sub_r.customer_phone, 10) = right(v_clean_phone, 10))))
        AND (sub_r.credit_token_status = 'ACTIVE' OR sub_r.credit_token_status IS NULL)
        AND (sub_r.expires_at IS NULL OR sub_r.expires_at >= now())
        AND sub_r.refund_amount > COALESCE(sub_r.credit_used, 0)
      ORDER BY sub_r.created_at DESC LIMIT 1
    ), '')
  INTO v_returns_sum, v_latest_token
  FROM public.offline_returns r
  WHERE ((v_cust_id IS NOT NULL AND r.customer_id = v_cust_id) 
         OR (length(v_clean_phone) >= 10 AND (r.customer_phone = v_clean_phone OR right(r.customer_phone, 10) = right(v_clean_phone, 10))))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND r.refund_amount > COALESCE(r.credit_used, 0);

  IF v_clean_token = '' THEN
    v_balance := GREATEST(COALESCE(v_balance, 0), v_returns_sum);
    -- Sync customer store credit balance
    IF v_cust_id IS NOT NULL AND v_balance > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = v_balance, updated_at = now()
      WHERE id = v_cust_id AND COALESCE(store_credit_balance, 0) < v_balance;
    END IF;
  END IF;

  -- 5. Aggregate active unexpired returns JSON
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'credit_token', r.credit_token,
      'refund_amount', r.refund_amount,
      'credit_used', r.credit_used,
      'credit_balance', GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)),
      'original_sale_id', r.original_sale_id,
      'original_sale_number', r.original_sale_number,
      'linked_sale_id', r.linked_sale_id,
      'created_at', r.created_at,
      'expires_at', r.expires_at
    ) ORDER BY r.created_at DESC
  ) INTO active_returns
  FROM public.offline_returns r
  WHERE ((v_cust_id IS NOT NULL AND r.customer_id = v_cust_id) 
         OR (length(v_clean_phone) >= 10 AND (r.customer_phone = v_clean_phone OR right(r.customer_phone, 10) = right(v_clean_phone, 10)))
         OR (v_clean_token != '' AND UPPER(r.credit_token) = v_clean_token))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND (r.refund_amount > COALESCE(r.credit_used, 0));

  -- 6. Aggregate recent ledger history
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'balance_before', balance_before,
      'balance_after', balance_after,
      'credit_token', credit_token,
      'source_return_id', source_return_id,
      'used_in_sale_id', used_in_sale_id,
      'notes', notes,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO recent_history
  FROM (
    SELECT *
    FROM public.store_credit_ledger
    WHERE (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
       OR (length(v_clean_phone) >= 10 AND (customer_phone = v_clean_phone OR right(customer_phone, 10) = right(v_clean_phone, 10)))
       OR (v_clean_token != '' AND UPPER(credit_token) = v_clean_token)
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Walk-in Customer'),
    'customer_phone', COALESCE(v_cust_phone, ''),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', COALESCE(v_latest_token, v_clean_token),
    'active_returns', COALESCE(active_returns, '[]'::jsonb),
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;

-- 5. Robust get_pos_customer_intel supporting both _customer_id and p_customer_id
CREATE OR REPLACE FUNCTION public.get_pos_customer_intel(
  p_customer_id uuid DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  p_phone text DEFAULT '',
  _phone text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid := COALESCE(p_customer_id, _customer_id);
  v_phone text := COALESCE(NULLIF(p_phone, ''), _phone);
  v_clean_phone text := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_prof record;
  v_recent_sales jsonb;
  v_recent_orders jsonb;
  v_total_purchases integer;
  v_total_spend numeric;
  v_credit_balance numeric := 0;
  v_returns_sum numeric := 0;
BEGIN
  IF v_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_id FROM public.pos_customers WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10) LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_id;
  IF v_prof.id IS NULL THEN
    SELECT 
      id, name AS full_name, phone, email, city, address, COALESCE(store_credit_balance, store_credit, 0) AS store_credit_balance
    INTO v_prof 
    FROM public.pos_customers WHERE id = v_id;
  END IF;

  IF v_prof.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate active returns credit
  SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
  INTO v_returns_sum
  FROM public.offline_returns r
  WHERE (r.customer_id = v_id OR (v_prof.phone != '' AND (r.customer_phone = v_prof.phone OR right(r.customer_phone, 10) = right(v_prof.phone, 10))))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND r.refund_amount > COALESCE(r.credit_used, 0);

  v_credit_balance := GREATEST(COALESCE(v_prof.store_credit_balance, 0), v_returns_sum);

  -- Combined total purchases and spend
  SELECT 
    (COALESCE((SELECT COUNT(*) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT COUNT(*) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0)),
    (COALESCE((SELECT SUM(total) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT SUM(total) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0))
  INTO v_total_purchases, v_total_spend;

  -- Recent POS Sales
  SELECT jsonb_agg(sub) INTO v_recent_sales
  FROM (
    SELECT id, sale_number, total, payment_method, return_status, created_at
    FROM public.offline_sales
    WHERE customer_id = v_id
    ORDER BY created_at DESC
    LIMIT 3
  ) sub;

  -- Recent Online Orders
  SELECT jsonb_agg(sub) INTO v_recent_orders
  FROM (
    SELECT id, order_number, total, payment_method, status, created_at
    FROM public.orders
    WHERE user_id = v_id
    ORDER BY created_at DESC
    LIMIT 3
  ) sub;

  RETURN jsonb_build_object(
    'id', v_prof.id,
    'name', COALESCE(NULLIF(v_prof.full_name, ''), 'Guest Customer'),
    'phone', COALESCE(v_prof.phone, ''),
    'email', COALESCE(v_prof.email, ''),
    'city', COALESCE(v_prof.city, ''),
    'address', COALESCE(v_prof.address, ''),
    'total_purchases', v_total_purchases,
    'total_spend', v_total_spend,
    'store_credit_balance', v_credit_balance,
    'recentSales', COALESCE(v_recent_sales, '[]'::jsonb),
    'recentOrders', COALESCE(v_recent_orders, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customer_intel(uuid, uuid, text, text) TO authenticated, anon, service_role;
