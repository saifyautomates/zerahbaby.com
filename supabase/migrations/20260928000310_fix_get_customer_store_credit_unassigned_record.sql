-- =====================================================================
-- Migration: 20260928000310_fix_get_customer_store_credit_unassigned_record.sql
-- Description: Fix unassigned record error on v_single_voucher in get_customer_store_credit
--              when token is not supplied.
-- =====================================================================

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
  IF v_clean_token != '' THEN
    IF v_single_voucher.id IS NOT NULL AND v_balance > 0 THEN
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
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

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
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

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
