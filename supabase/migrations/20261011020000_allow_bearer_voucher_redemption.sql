-- Migration: Allow Unrestricted Bearer Store Credit / Voucher Redemption at POS
-- Anyone holding a valid voucher token can redeem it at POS without forced customer-matching barriers.

-- 1. Canonical Voucher Customer Ownership Verification Function (Unconditionally Valid for Bearer Vouchers)
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
BEGIN
  -- Vouchers in Zérah Baby & Kids POS are treated as physical bearer instruments.
  -- Anyone holding a valid voucher token / code can redeem it at the counter without customer-matching barriers.
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_voucher_customer_ownership(uuid, text, uuid, text) TO anon, authenticated, service_role;


-- 2. Update get_store_credit_voucher to never block on customer ownership mismatch
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

  -- 1. Check in public.offline_returns first (canonical return credit notes)
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

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_ret_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_ret_rec.return_id,
      'return_id', v_ret_rec.return_id,
      'token', v_ret_rec.token,
      'customer_id', v_ret_rec.customer_id,
      'customer_name', v_ret_rec.customer_name,
      'customer_phone', v_ret_rec.customer_phone,
      'original_amount', v_ret_rec.original_amount,
      'credit_used', v_ret_rec.credit_used,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_ret_rec.expires_at,
      'days_remaining', v_days_left,
      'return_number', v_ret_rec.return_number
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

    IF v_remaining <= 0 OR v_pos_rec.status = 'redeemed' THEN
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
      'customer_name', v_pos_rec.customer_name,
      'customer_phone', v_pos_rec.customer_phone,
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
    IF v_coup_rec.valid_until IS NOT NULL AND v_coup_rec.valid_until < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Coupon code ' || v_clean_token || ' has expired',
        'token', v_clean_token
      );
    END IF;

    IF v_coup_rec.usage_limit IS NOT NULL AND COALESCE(v_coup_rec.times_used, 0) >= v_coup_rec.usage_limit THEN
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
      'discount_type', v_coup_rec.type,
      'discount_value', v_coup_rec.value,
      'min_cart_value', COALESCE(v_coup_rec.min_order_amount, 0),
      'max_discount', v_coup_rec.max_discount,
      'remaining_balance', v_coup_rec.value,
      'available_credit', v_coup_rec.value,
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


-- 3. Update get_customer_store_credit to never block on customer ownership mismatch
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
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
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

      RETURN jsonb_build_object(
        'customer_id', v_cust_id,
        'customer_name', v_cust_name,
        'available_credit', v_balance,
        'credit_token', v_clean_token,
        'active_returns', jsonb_build_array(
          jsonb_build_object(
            'id', v_single_voucher.id,
            'credit_token', v_clean_token,
            'credit_balance', v_balance,
            'refund_amount', v_single_voucher.refund_amount,
            'expires_at', v_single_voucher.expires_at
          )
        ),
        'history', '[]'::jsonb
      );
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id
  ELSIF v_cust_id IS NOT NULL THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE id = v_cust_id;

    -- Collect active returns for this customer
    SELECT COALESCE(jsonb_agg(r_row), '[]'::jsonb) INTO active_returns
    FROM (
      SELECT 
        id, return_number, credit_token,
        refund_amount, COALESCE(credit_used, 0) AS credit_used,
        GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS credit_balance,
        expires_at, created_at
      FROM public.offline_returns
      WHERE customer_id = v_cust_id
        AND (refund_amount - COALESCE(credit_used, 0)) > 0
        AND COALESCE(credit_token_status, 'ACTIVE') NOT IN ('EXPIRED', 'CONSUMED')
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC
    ) r_row;

  -- 3. Otherwise search by phone
  ELSIF _phone IS NOT NULL AND trim(_phone) != '' THEN
    DECLARE
      v_norm_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
    BEGIN
      SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, phone
      INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
      FROM public.pos_customers
      WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_norm_phone
      LIMIT 1;

      IF v_cust_id IS NOT NULL THEN
        SELECT COALESCE(jsonb_agg(r_row), '[]'::jsonb) INTO active_returns
        FROM (
          SELECT 
            id, return_number, credit_token,
            refund_amount, COALESCE(credit_used, 0) AS credit_used,
            GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS credit_balance,
            expires_at, created_at
          FROM public.offline_returns
          WHERE (customer_id = v_cust_id OR regexp_replace(COALESCE(customer_phone, ''), '[^0-9]', '', 'g') = v_norm_phone)
            AND (refund_amount - COALESCE(credit_used, 0)) > 0
            AND COALESCE(credit_token_status, 'ACTIVE') NOT IN ('EXPIRED', 'CONSUMED')
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
        ) r_row;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Customer'),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', v_clean_token,
    'active_returns', COALESCE(active_returns, '[]'::jsonb),
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;


-- 4. Update place_offline_sale to eliminate all artificial customer ownership blocks
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _created_by uuid DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _coupon_code text DEFAULT NULL,
  _cash_tendered numeric DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := COALESCE(_created_by, auth.uid());
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_qty int;
  item_price numeric;
  item_mrp numeric;
  item_cost numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  item_line_subtotal numeric := 0;
  item_bill_discount numeric := 0;
  item_coupon_discount numeric := 0;
  item_final_paid numeric := 0;
  v_amount_paid numeric := 0;
  v_change_given numeric := 0;
  v_payment_status text := 'paid';
  v_existing_sale record;
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
  v_sale_number text;
  v_token_number int;
  v_sale_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_coupon_record record;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'token_number', v_existing_sale.pos_token_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_id', v_existing_sale.customer_id,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Authorization
  IF current_user != 'service_role' AND COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    IF uid IS NULL THEN
      RAISE EXCEPTION 'Authentication required for POS sales';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin', 'pos_user', 'manager', 'owner')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (is_admin = true OR is_super_admin = true OR is_staff = true)
      ) OR
      public.is_admin() OR
      public.is_staff_or_admin()
    ) THEN
      RAISE EXCEPTION 'Only authorized administrators or staff may record offline sales';
    END IF;
  END IF;

  -- 3. Items validation
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item.';
  END IF;

  -- 4. Calculate Subtotal with strict zero-fallback
  v_subtotal := 0;
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;
    item_price := COALESCE((elem->>'custom_price')::numeric, (elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;
  v_subtotal := COALESCE(v_subtotal, 0);

  -- 5. Bill-level discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type IN ('fixed', 'flat') AND _discount_value > 0 THEN
    v_discount := LEAST(v_subtotal, _discount_value);
  ELSE
    v_discount := 0;
  END IF;
  v_discount := COALESCE(v_discount, 0);

  -- 6. Coupon discount
  v_coupon_discount := 0;
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE code = UPPER(TRIM(_coupon_code))
      AND is_active = true
      AND (valid_until IS NULL OR valid_until > now())
      AND (valid_from IS NULL OR valid_from <= now())
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF v_coupon_record.min_order_amount IS NULL OR v_subtotal >= v_coupon_record.min_order_amount THEN
        IF v_coupon_record.type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_record.value) / 100, 2);
          IF v_coupon_record.max_discount IS NOT NULL AND v_coupon_record.max_discount > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_record.max_discount);
          END IF;
        ELSE
          v_coupon_discount := v_coupon_record.value;
        END IF;
      END IF;
    END IF;
  END IF;
  v_coupon_discount := COALESCE(v_coupon_discount, 0);

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Store Credit / Exchange Voucher (Universal Bearer Instrument)
  v_voucher_used := 0;
  v_voucher_token := NULL;
  IF _store_credit_used > 0 OR (v_clean_token != '' AND v_clean_token IS NOT NULL) THEN
    IF v_clean_token != '' AND v_clean_token IS NOT NULL THEN
      -- Lookup 1: pos_exchange_vouchers
      SELECT COALESCE(remaining_balance, original_amount, 0) INTO v_voucher_avail
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      FOR UPDATE;

      -- Lookup 2: store_credit_vouchers
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(current_balance, original_amount, 0) INTO v_voucher_avail
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
        FOR UPDATE;
      END IF;

      -- Lookup 3: offline_returns canonical return credit note
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT GREATEST(0, COALESCE(refund_amount, 0) - COALESCE(credit_used, 0)) INTO v_voucher_avail
        FROM public.offline_returns
        WHERE UPPER(TRIM(credit_token)) = v_clean_token
          AND COALESCE(credit_token_status, 'ACTIVE') NOT IN ('EXPIRED', 'CONSUMED')
          AND (expires_at IS NULL OR expires_at > now())
        FOR UPDATE;
      END IF;

      IF COALESCE(v_voucher_avail, 0) <= 0 THEN
        RAISE EXCEPTION 'Invalid, expired, or exhausted store credit voucher: %', v_clean_token;
      END IF;

      IF _store_credit_used > v_voucher_avail + 0.01 THEN
        RAISE EXCEPTION 'Requested store credit ₹% exceeds the available voucher balance ₹%.',
          ROUND(_store_credit_used, 2), ROUND(v_voucher_avail, 2);
      END IF;

      v_voucher_used := LEAST(
        v_gross_total,
        COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail),
        v_voucher_avail
      );
      v_voucher_token := v_clean_token;

    ELSIF v_cust_id IS NOT NULL THEN
      -- Customer Account Store Credit
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      IF v_voucher_avail > 0 THEN
        IF _store_credit_used > v_voucher_avail + 0.01 THEN
          RAISE EXCEPTION 'Requested customer credit ₹% exceeds the available balance ₹%.',
            ROUND(_store_credit_used, 2), ROUND(v_voucher_avail, 2);
        END IF;
        v_voucher_used := LEAST(v_gross_total, _store_credit_used, v_voucher_avail);
      END IF;
    END IF;
  END IF;
  v_voucher_used := COALESCE(v_voucher_used, 0);

  IF _store_credit_used > 0 AND v_voucher_used <= 0 THEN
    RAISE EXCEPTION 'No available store credit can be applied to this sale.';
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment Method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(trim(_payment_method), ''), 'cash');
  END IF;

  -- 9. Customer Resolution (Auto-create customer only if named details are entered)
  IF v_cust_id IS NULL AND (v_clean_phone != '' OR (_customer_name IS NOT NULL AND trim(_customer_name) != '' AND trim(_customer_name) != 'Walk-in Customer')) THEN
    v_cust_id := public.resolve_or_create_customer(
      _customer_name,
      _customer_phone,
      _customer_email,
      NULL
    );
  END IF;

  -- 10. Persist What was actually collected
  IF lower(COALESCE(v_effective_payment_method, 'cash')) = 'due' THEN
    v_amount_paid := 0;
    v_change_given := 0;
  ELSIF lower(COALESCE(v_effective_payment_method, 'cash')) = 'cash'
        AND _cash_tendered IS NOT NULL THEN
    v_amount_paid := LEAST(v_payable_total, GREATEST(0, _cash_tendered));
    v_change_given := GREATEST(0, _cash_tendered - v_payable_total);
  ELSE
    v_amount_paid := v_payable_total;
    v_change_given := 0;
  END IF;

  IF v_amount_paid + v_voucher_used + 0.01 >= v_gross_total THEN
    v_payment_status := 'paid';
  ELSIF v_amount_paid > 0 OR v_voucher_used > 0 THEN
    v_payment_status := 'partial';
  ELSE
    v_payment_status := 'pending';
  END IF;

  IF v_payment_status IN ('pending', 'partial')
     AND (
       v_cust_id IS NULL
       OR trim(COALESCE(_customer_name, '')) = ''
       OR lower(trim(COALESCE(_customer_name, ''))) = 'walk-in customer'
     ) THEN
    RAISE EXCEPTION 'Select a named customer before recording a sale with an outstanding balance.';
  END IF;

  -- 11. Generate Sale Number & Token Number safely
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 INTO v_token_number 
  FROM public.offline_sales 
  WHERE created_at >= date_trunc('day', now());

  -- 12. Deduct Store Credit
  IF v_voucher_used > 0 THEN
    IF v_voucher_token IS NOT NULL THEN
      UPDATE public.pos_exchange_vouchers
      SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
          status = CASE WHEN (remaining_balance - v_voucher_used) <= 0 THEN 'redeemed' ELSE 'active' END,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = v_voucher_token;

      UPDATE public.store_credit_vouchers
      SET current_balance = GREATEST(0, current_balance - v_voucher_used),
          is_active = (current_balance - v_voucher_used) > 0,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = v_voucher_token;

      UPDATE public.offline_returns
      SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
          credit_token_status = CASE 
            WHEN (COALESCE(refund_amount, 0) - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' 
            ELSE 'PARTIALLY_USED' 
          END,
          updated_at = now()
      WHERE UPPER(TRIM(credit_token)) = v_voucher_token;
    END IF;

    -- Only deduct pos_customers direct account balance if credit was redeemed directly from customer account without a voucher token
    IF v_cust_id IS NOT NULL AND v_voucher_token IS NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_voucher_used),
          store_credit = GREATEST(0, COALESCE(store_credit, 0) - v_voucher_used),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  END IF;

  -- 13. Insert Sale
  INSERT INTO public.offline_sales (
    sale_number,
    pos_token_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    subtotal,
    discount,
    discount_type,
    discount_value,
    coupon_code,
    coupon_discount,
    store_credit_used,
    credit_token_used,
    total,
    amount_paid,
    change_given,
    payment_status,
    notes,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_token_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    v_effective_payment_method,
    COALESCE(v_subtotal, 0),
    COALESCE(v_discount, 0),
    _discount_type,
    _discount_value,
    _coupon_code,
    COALESCE(v_coupon_discount, 0),
    COALESCE(v_voucher_used, 0),
    v_voucher_token,
    COALESCE(v_gross_total, 0),
    COALESCE(v_amount_paid, 0),
    COALESCE(v_change_given, 0),
    COALESCE(v_payment_status, 'pending'),
    COALESCE(_notes, ''),
    NULLIF(trim(_idempotency_key), ''),
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 14. Record in store_credit_ledger
  IF v_voucher_used > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id, customer_phone, customer_name, credit_token, type,
      amount, balance_before, balance_after, used_in_sale_id, sale_id,
      notes, created_by, created_at
    ) VALUES (
      v_cust_id,
      COALESCE(v_clean_phone, ''),
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(v_voucher_token, 'CUSTOMER-BALANCE'),
      'CREDIT_USED',
      v_voucher_used,
      GREATEST(0, COALESCE(v_voucher_avail, v_voucher_used)),
      GREATEST(0, COALESCE(v_voucher_avail, v_voucher_used) - v_voucher_used),
      v_sale_id,
      v_sale_id,
      'Store credit redeemed on POS Sale #' || v_sale_number,
      uid,
      now()
    );
  END IF;

  -- 15. Insert Items & Deduct Stock with Variant Fallback Resolution & Buying Price Snapshot
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'custom_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_price);
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    BEGIN
      SELECT COALESCE(pc.buying_price, pc.cost_price, p.buying_price, p.cost_price, 0) INTO item_cost
      FROM public.products p
      LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = item_product_id
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      item_cost := 0;
    END;

    IF item_cost IS NULL OR item_cost = 0 THEN
      item_cost := COALESCE((elem->>'cost_price')::numeric, (elem->>'buying_price')::numeric, (elem->>'buyingPrice')::numeric, 0);
    END IF;

    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    item_line_subtotal := item_price * item_qty;
    IF v_subtotal > 0 THEN
      item_bill_discount := ROUND(((item_line_subtotal / v_subtotal) * v_discount) / item_qty, 4);
      item_coupon_discount := ROUND(((item_line_subtotal / v_subtotal) * v_coupon_discount) / item_qty, 4);
    ELSE
      item_bill_discount := 0;
      item_coupon_discount := 0;
    END IF;
    item_final_paid := GREATEST(0, ROUND(item_price - item_bill_discount - item_coupon_discount, 4));

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, variant_id, product_slug, name, product_name,
      variant_info, sku, barcode, price, unit_selling_price, unit_mrp, mrp,
      cost_price, buying_price, qty, quantity, quantity_sold, quantity_returnable, returnable_qty,
      allocated_bill_discount, allocated_coupon_discount, final_unit_paid_price,
      line_gross_amount, total, hsn_code, gst_rate, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp, item_mrp,
      COALESCE(item_cost, 0), COALESCE(item_cost, 0), item_qty, item_qty, item_qty, item_qty, item_qty,
      item_bill_discount, item_coupon_discount, item_final_paid,
      (item_price * item_qty), (item_price * item_qty),
      COALESCE(NULLIF(trim(elem->>'hsn_code'), ''), (SELECT hsn_code FROM public.products WHERE id = item_product_id LIMIT 1)),
      COALESCE((elem->>'gst_rate')::numeric, (SELECT gst_rate FROM public.products WHERE id = item_product_id LIMIT 1)),
      now()
    );

    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_qty);
        UPDATE public.product_variants SET stock = v_new_stock, updated_at = now() WHERE id = item_variant_id;

        IF item_product_id IS NOT NULL THEN
          UPDATE public.products
          SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = item_product_id),
              updated_at = now()
          WHERE id = item_product_id;
        END IF;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, item_variant_id, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products SET stock = GREATEST(0, v_prev_stock - item_qty), updated_at = now() WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, NULL, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    END IF;
  END LOOP;

  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'token_number', v_token_number,
    'total', v_gross_total,
    'payable_total', v_payable_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'customer_id', v_cust_id,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text
) TO authenticated, anon, service_role;
