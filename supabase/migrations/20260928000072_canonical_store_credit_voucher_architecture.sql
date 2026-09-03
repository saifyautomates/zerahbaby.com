-- Migration: 20260928000072_canonical_store_credit_voucher_architecture.sql
-- Canonical Store Credit & Exchange Voucher Architecture:
-- 1. Explicit 7-day hard expiry (expires_at)
-- 2. Customer ownership & phone verification
-- 3. Individual token balance isolation (never sum unrelated returns into a single voucher token)
-- 4. Atomic row-locking (FOR UPDATE) & bounded redemption (MIN(balance, net_payable))
-- 5. Safe Apply/Remove lifecycle (zero mutation before checkout completion)
-- 6. Full audit trail via store_credit_ledger

-- 1. Add expires_at column to offline_returns if not exists
ALTER TABLE public.offline_returns
ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '7 days');

-- 2. Backfill existing records
UPDATE public.offline_returns
SET expires_at = COALESCE(expires_at, created_at + interval '7 days'),
    credit_balance = GREATEST(0, refund_amount - COALESCE(credit_used, 0)),
    credit_token_status = CASE 
      WHEN COALESCE(credit_used, 0) >= refund_amount AND refund_amount > 0 THEN 'CONSUMED'
      WHEN COALESCE(expires_at, created_at + interval '7 days') < now() AND COALESCE(credit_used, 0) < refund_amount THEN 'EXPIRED'
      ELSE 'ACTIVE'
    END;

-- 3. Create or replace 4-char unique generator helper
CREATE OR REPLACE FUNCTION public.generate_unique_exchange_credit_token()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_token text;
  v_exists boolean;
  v_iter int := 0;
BEGIN
  LOOP
    v_token := '';
    FOR i IN 1..4 LOOP
      v_token := v_token || substr(v_chars, floor(random() * 36 + 1)::int, 1);
    END LOOP;

    SELECT EXISTS (
      SELECT 1 FROM public.offline_returns 
      WHERE UPPER(credit_token) = v_token 
        AND credit_token_status = 'ACTIVE'
    ) INTO v_exists;

    IF NOT v_exists THEN
      RETURN v_token;
    END IF;

    v_iter := v_iter + 1;
    IF v_iter > 200 THEN
      RAISE EXCEPTION 'Failed to generate unique 4-character voucher token after 200 attempts';
    END IF;
  END LOOP;
END;
$$;

-- 4. Authoritative Voucher Lookup RPC (Single Instrument Scope)
CREATE OR REPLACE FUNCTION public.get_store_credit_voucher(
  _token text,
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  v_voucher record;
  v_remaining numeric := 0;
  v_is_expired boolean := false;
  v_days_left int := 0;
BEGIN
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Please enter a voucher token');
  END IF;

  SELECT * INTO v_voucher
  FROM public.offline_returns
  WHERE UPPER(credit_token) = v_clean_token
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_voucher.id IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'error', 'Voucher token ' || v_clean_token || ' not found',
      'token', v_clean_token
    );
  END IF;

  -- Compute remaining balance
  v_remaining := GREATEST(0, v_voucher.refund_amount - COALESCE(v_voucher.credit_used, 0));

  -- Compute expiry
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    v_is_expired := true;
    IF v_voucher.credit_token_status = 'ACTIVE' THEN
      UPDATE public.offline_returns SET credit_token_status = 'EXPIRED', updated_at = now() WHERE id = v_voucher.id;
    END IF;
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Voucher ' || v_clean_token || ' expired on ' || to_char(v_voucher.expires_at, 'DD Mon YYYY'),
      'status', 'EXPIRED',
      'expired', true,
      'token', v_clean_token,
      'expires_at', v_voucher.expires_at,
      'remaining_balance', 0
    );
  END IF;

  -- Check consumed status
  IF v_voucher.credit_token_status = 'CONSUMED' OR v_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
      'status', 'CONSUMED',
      'token', v_clean_token,
      'remaining_balance', 0
    );
  END IF;

  -- Ownership / Customer verification check (if provided and customer is identified)
  IF _customer_id IS NOT NULL AND v_voucher.customer_id IS NOT NULL AND _customer_id != v_voucher.customer_id THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Voucher ' || v_clean_token || ' belongs to customer ' || v_voucher.customer_name || ' and cannot be transferred',
      'ownership_mismatch', true,
      'token', v_clean_token
    );
  END IF;

  IF length(v_clean_phone) >= 10 AND length(regexp_replace(COALESCE(v_voucher.customer_phone, ''), '[^0-9]', '', 'g')) >= 10 THEN
    IF right(v_clean_phone, 10) != right(regexp_replace(v_voucher.customer_phone, '[^0-9]', '', 'g'), 10) THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' is registered under mobile ' || v_voucher.customer_phone,
        'ownership_mismatch', true,
        'token', v_clean_token
      );
    END IF;
  END IF;

  v_days_left := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(v_voucher.expires_at, v_voucher.created_at + interval '7 days') - now())) / 86400.0)::int);

  RETURN jsonb_build_object(
    'valid', true,
    'voucher_id', v_voucher.id,
    'token', v_voucher.credit_token,
    'customer_id', v_voucher.customer_id,
    'customer_name', v_voucher.customer_name,
    'customer_phone', v_voucher.customer_phone,
    'original_sale_id', v_voucher.original_sale_id,
    'original_sale_number', v_voucher.original_sale_number,
    'original_return_number', v_voucher.return_number,
    'original_amount', v_voucher.refund_amount,
    'credit_used', COALESCE(v_voucher.credit_used, 0),
    'remaining_balance', v_remaining,
    'available_credit', v_remaining,
    'issued_at', v_voucher.created_at,
    'expires_at', COALESCE(v_voucher.expires_at, v_voucher.created_at + interval '7 days'),
    'days_remaining', v_days_left,
    'status', v_voucher.credit_token_status
  );
END;
$$;

-- 5. Updated get_customer_store_credit with strict token isolation
CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Walk-in Customer';
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
BEGIN
  -- 1. If Token is provided, ISOLATE to this specific voucher instrument only
  IF v_clean_token != '' THEN
    SELECT * INTO v_single_voucher
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_single_voucher.id IS NOT NULL THEN
      -- Check expiry
      IF v_single_voucher.expires_at IS NOT NULL AND v_single_voucher.expires_at < now() THEN
        v_balance := 0;
      ELSE
        v_balance := GREATEST(0, v_single_voucher.refund_amount - COALESCE(v_single_voucher.credit_used, 0));
      END IF;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := v_single_voucher.customer_name;
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id
  ELSIF v_cust_id IS NOT NULL THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0), name INTO v_balance, v_cust_name
    FROM public.pos_customers
    WHERE id = v_cust_id;

  -- 3. Otherwise search by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name INTO v_cust_id, v_balance, v_cust_name
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;
  END IF;

  -- 4. Aggregate active unexpired returns
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
  WHERE ((v_cust_id IS NOT NULL AND r.customer_id = v_cust_id) OR (v_clean_token != '' AND UPPER(r.credit_token) = v_clean_token))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND (r.refund_amount > COALESCE(r.credit_used, 0));

  -- 5. Aggregate recent ledger history
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
       OR (length(v_clean_phone) >= 10 AND (customer_phone = v_clean_phone OR customer_phone = right(v_clean_phone, 10)))
       OR (v_clean_token != '' AND UPPER(credit_token) = v_clean_token)
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Walk-in Customer'),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', v_clean_token,
    'active_returns', COALESCE(active_returns, '[]'::jsonb),
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END;
$$;

-- 6. Canonical process_offline_return with 7-Day Hard Expiry
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _customer_id uuid,
  _refund_method text,
  _refund_status text,
  _return_reason text,
  _notes text,
  _original_sale_id uuid,
  _items jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_total_var_stock int;
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_orig_total_units int := 0;
  v_cumul_returned_units int := 0;
  v_cumul_returned_amount numeric := 0;
  v_expiry_date timestamptz := now() + interval '7 days';
BEGIN
  -- 1. Authorization check
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') 
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
    THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
    END IF;
  END IF;

  -- 2. Idempotency check (prevent duplicate return submissions)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, expires_at
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token, v_expiry_date
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
       OR notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;

    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'credit_token', new_credit_token,
        'expires_at', v_expiry_date,
        'customer_name', _customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Calculate refund total from items
  computed_total_refund := 0;
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_qty * item_refund_price);
    item_count := item_count + item_qty;
  END LOOP;
  computed_total_refund := COALESCE(computed_total_refund, 0);

  -- Generate human-friendly return number & 4-CHARACTER EXCHANGE VOUCHER TOKEN
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := public.generate_unique_exchange_credit_token();
  v_expiry_date := now() + interval '7 days';

  -- 4. Resolve clean original_sale_id & sale_number
  v_clean_sale_id := CASE 
    WHEN _original_sale_id IS NULL OR _original_sale_id = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL 
    ELSE _original_sale_id 
  END;

  IF v_clean_sale_id IS NOT NULL THEN
    SELECT sale_number INTO v_orig_sale_number
    FROM public.offline_sales
    WHERE id = v_clean_sale_id;

    IF v_orig_sale_number IS NULL THEN
      v_clean_sale_id := NULL;
    END IF;
  END IF;

  -- 5. Resolve or upsert customer
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

  -- 6. Insert Return Record with 7-Day Hard Expiry and explicit initial balances
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
    credit_used,
    credit_balance,
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
    CASE 
      WHEN _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
        COALESCE(trim(_notes), '') || ' [idem:' || trim(_idempotency_key) || ']'
      ELSE COALESCE(trim(_notes), '')
    END,
    COALESCE(computed_total_refund, 0),
    0,
    COALESCE(computed_total_refund, 0),
    new_credit_token,
    'ACTIVE',
    v_expiry_date,
    _idempotency_key,
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 7. Insert Return Items & Restore Stock
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
      unit_mrp,
      subtotal,
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
      item_mrp,
      item_qty * item_refund_price,
      item_orig_sale_item_id,
      now()
    );

    -- Stock restoration
    IF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        IF item_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE id = item_variant_id;

          SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
          FROM public.product_variants
          WHERE product_id = item_product_id;

          UPDATE public.products
          SET stock = v_total_var_stock,
              updated_at = now()
          WHERE id = item_product_id;
        ELSE
          UPDATE public.product_variants
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE product_id = item_product_id
            AND ((sku IS NOT NULL AND sku ILIKE item_sku) OR (barcode IS NOT NULL AND barcode = item_barcode) OR name = 'Default');

          SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
          FROM public.product_variants
          WHERE product_id = item_product_id;

          IF v_total_var_stock > 0 THEN
            UPDATE public.products SET stock = v_total_var_stock, updated_at = now() WHERE id = item_product_id;
          ELSE
            UPDATE public.products SET stock = stock + item_qty, updated_at = now() WHERE id = item_product_id;
          END IF;
        END IF;

        v_new_stock := v_prev_stock + item_qty;

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
          item_product_id,
          item_variant_id,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 8. Record in Store Credit Ledger (Auditable Issuance)
  IF computed_total_refund > 0 THEN
    IF v_resolved_cust_id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit FROM public.pos_customers WHERE id = v_resolved_cust_id FOR UPDATE;
      v_prev_credit := COALESCE(v_prev_credit, 0);
      v_new_credit := v_prev_credit + computed_total_refund;

      UPDATE public.pos_customers
      SET store_credit_balance = v_new_credit,
          store_credit = v_new_credit,
          updated_at = now()
      WHERE id = v_resolved_cust_id;
    END IF;

    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      credit_token,
      source_return_id,
      notes,
      created_by
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_prev_credit + computed_total_refund,
      new_credit_token,
      new_return_id,
      'Exchange voucher issued via Return #' || new_return_number || ' (Token: ' || new_credit_token || ', Valid 7 days)',
      uid
    );
  END IF;

  -- 9. Update Original Sale Return Status if linked
  IF v_clean_sale_id IS NOT NULL THEN
    SELECT COALESCE(SUM(qty), 0) INTO v_orig_total_units
    FROM public.offline_sale_items WHERE sale_id = v_clean_sale_id;

    SELECT COALESCE(SUM(ori.qty), 0), COALESCE(SUM(ori.refund_price * ori.qty), 0)
    INTO v_cumul_returned_units, v_cumul_returned_amount
    FROM public.offline_returns r
    JOIN public.offline_return_items ori ON ori.return_id = r.id
    WHERE r.original_sale_id = v_clean_sale_id;

    UPDATE public.offline_sales
    SET return_status = CASE 
          WHEN v_cumul_returned_units >= v_orig_total_units AND v_orig_total_units > 0 THEN 'returned'
          WHEN v_cumul_returned_units > 0 THEN 'partially_returned'
          ELSE 'none'
        END,
        returned_units = v_cumul_returned_units,
        returned_amount = v_cumul_returned_amount,
        updated_at = now()
    WHERE id = v_clean_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', _customer_name,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

-- 7. Canonical place_offline_sale with Concurrency Protection, Row-locking & Partial Redemption
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _payment_method text,
  _notes text,
  _discount_type text,
  _discount_value numeric,
  _customer_id uuid,
  _items jsonb,
  _idempotency_key text DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_order_token_num int;
  v_order_token_dt date;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_prod_id uuid;
  v_prod_stock int;
  v_prod_name text;
  v_prod_sku text;
  v_prod_barcode text;
  v_var_id uuid;
  v_var_stock int;
  v_item_price numeric;
  v_buying_price numeric := 0;
  v_is_uuid boolean;
  v_is_var_uuid boolean;
  v_existing_sale record;
  v_credit_to_use numeric := 0;
  v_credit_rec record;
  v_voucher_avail numeric := 0;
  v_new_voucher_used numeric := 0;
  v_new_voucher_balance numeric := 0;
  v_coupon_rec record;
  v_clean_coupon text;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_total_variant_stock int;
BEGIN
  -- 1. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method, customer_name, customer_phone, pos_token_number
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
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_phone', v_existing_sale.customer_phone,
        'pos_token_number', v_existing_sale.pos_token_number,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot place sale with empty items';
  END IF;

  -- 3. Calculate Subtotal
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_subtotal := v_subtotal + (v_item_price * COALESCE(v_item.qty, 1));
  END LOOP;

  -- 4. Calculate Basic Discount
  IF _discount_type = 'percentage' OR _discount_type = 'percent' THEN
    v_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' OR _discount_type = 'flat' THEN
    v_discount := LEAST(COALESCE(_discount_value, 0), v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  -- 5. Calculate Coupon Discount (if provided)
  v_clean_coupon := NULLIF(trim(upper(COALESCE(_coupon_code, ''))), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO v_coupon_rec
    FROM public.coupons
    WHERE upper(code) = v_clean_coupon AND is_active = true
    FOR UPDATE;

    IF v_coupon_rec.id IS NOT NULL THEN
      IF (v_coupon_rec.valid_from IS NULL OR now() >= v_coupon_rec.valid_from) AND
         (v_coupon_rec.valid_until IS NULL OR now() <= v_coupon_rec.valid_until) AND
         (v_coupon_rec.usage_limit IS NULL OR v_coupon_rec.used_count < v_coupon_rec.usage_limit) AND
         (v_coupon_rec.min_order_amount IS NULL OR v_subtotal >= v_coupon_rec.min_order_amount) THEN

        IF v_coupon_rec.discount_type = 'percent' OR v_coupon_rec.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_rec.discount_value) / 100, 2);
          IF v_coupon_rec.max_discount_amount IS NOT NULL THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_rec.max_discount_amount);
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_coupon_rec.discount_value, v_subtotal);
        END IF;

        UPDATE public.coupons
        SET used_count = used_count + 1
        WHERE id = v_coupon_rec.id;
      END IF;
    END IF;
  END IF;

  v_discount := v_discount + v_coupon_discount;
  v_total := GREATEST(0, v_subtotal - v_discount);

  -- 6. Canonical Store Credit & Voucher Concurrency-Safe Settlement
  v_credit_to_use := 0;
  IF v_clean_token != '' THEN
    -- Lock the voucher row atomically
    SELECT * INTO v_credit_rec
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
    FOR UPDATE;

    IF v_credit_rec.id IS NOT NULL THEN
      -- Validate voucher status & expiry
      IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
        UPDATE public.offline_returns SET credit_token_status = 'EXPIRED', updated_at = now() WHERE id = v_credit_rec.id;
        RAISE EXCEPTION 'Voucher % has expired on % and cannot be redeemed', v_clean_token, to_char(v_credit_rec.expires_at, 'DD Mon YYYY');
      END IF;

      IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
        RAISE EXCEPTION 'Voucher % has already been fully redeemed', v_clean_token;
      END IF;

      -- Authoritative available balance on this voucher instrument
      v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));

      -- Bounded deduction: MIN(requested, voucher_available, sale_total)
      v_credit_to_use := LEAST(COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail), v_voucher_avail, v_total);

      IF v_credit_to_use > 0 THEN
        v_new_voucher_used := COALESCE(v_credit_rec.credit_used, 0) + v_credit_to_use;
        v_new_voucher_balance := GREATEST(0, v_credit_rec.refund_amount - v_new_voucher_used);

        UPDATE public.offline_returns
        SET credit_used = v_new_voucher_used,
            credit_balance = v_new_voucher_balance,
            credit_token_status = CASE WHEN v_new_voucher_balance <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
            updated_at = now()
        WHERE id = v_credit_rec.id;
      END IF;
    END IF;

  ELSIF _customer_id IS NOT NULL AND COALESCE(_store_credit_used, 0) > 0 THEN
    -- Customer Account Balance Settlement (when no specific token passed)
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
    FROM public.pos_customers
    WHERE id = _customer_id
    FOR UPDATE;

    v_credit_to_use := LEAST(COALESCE(_store_credit_used, 0), COALESCE(v_voucher_avail, 0), v_total);
    IF v_credit_to_use > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_credit_to_use),
          store_credit = GREATEST(0, store_credit_balance - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 7. Generate Daily Token & Sale Number
  v_order_token_dt := CURRENT_DATE;
  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  v_sale_number := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(v_order_token_num::text, 5, '0');

  -- 8. Insert Offline Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    notes,
    discount_type,
    discount_value,
    customer_id,
    idempotency_key,
    store_credit_used,
    credit_token,
    credit_token_used,
    coupon_code,
    coupon_discount,
    subtotal,
    discount,
    total,
    status,
    pos_token_number,
    pos_token_date,
    created_by,
    created_at
  ) VALUES (
    v_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_payment_method), ''), 'cash'),
    COALESCE(trim(_notes), ''),
    COALESCE(NULLIF(trim(_discount_type), ''), 'none'),
    COALESCE(_discount_value, 0),
    _customer_id,
    _idempotency_key,
    v_credit_to_use,
    v_clean_token,
    v_clean_token,
    v_clean_coupon,
    v_coupon_discount,
    v_subtotal,
    v_discount,
    v_total,
    'completed',
    v_order_token_num,
    v_order_token_dt,
    uid,
    now()
  )
  RETURNING id INTO v_sale_id;

  -- 9. Insert Single Redemption Ledger Entry
  IF v_credit_to_use > 0 THEN
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
      used_in_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      COALESCE(_customer_id, v_credit_rec.customer_id),
      COALESCE(NULLIF(trim(_customer_name), ''), v_credit_rec.customer_name, 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), v_credit_rec.customer_phone, ''),
      v_clean_token,
      'CREDIT_REDEEMED',
      v_credit_to_use,
      v_voucher_avail,
      GREATEST(0, v_voucher_avail - v_credit_to_use),
      v_credit_rec.id,
      v_sale_id,
      'Voucher ' || v_clean_token || ' redeemed in POS Sale #' || v_sale_number,
      uid,
      now()
    );

    -- Also adjust account balance if customer record is present
    IF _customer_id IS NOT NULL AND v_clean_token != '' THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_credit_to_use),
          store_credit = GREATEST(0, COALESCE(store_credit, 0) - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 10. Insert Line Items & Deduct Inventory
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_is_uuid := v_item.product_id IS NOT NULL AND v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    v_is_var_uuid := v_item.variant_id IS NOT NULL AND v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    
    v_prod_id := NULL;
    v_prod_stock := NULL;
    v_prod_name := v_item.name;
    v_prod_sku := v_item.sku;
    v_prod_barcode := NULL;
    v_var_id := NULL;
    v_var_stock := NULL;
    v_buying_price := 0;

    IF v_is_uuid THEN
      SELECT id, stock, name, sku, barcode, COALESCE(cost_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_buying_price
      FROM public.products
      WHERE id = v_item.product_id::uuid
      FOR UPDATE;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' THEN
      SELECT id, stock, name, sku, barcode, COALESCE(cost_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_buying_price
      FROM public.products
      WHERE slug = v_item.product_slug
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_is_var_uuid THEN
      SELECT id, stock, name, sku, barcode, COALESCE(cost_price, v_buying_price)
      INTO v_var_id, v_var_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_buying_price
      FROM public.product_variants
      WHERE id = v_item.variant_id::uuid
      FOR UPDATE;
    END IF;

    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);

    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      qty,
      price,
      subtotal,
      buying_price,
      created_at
    ) VALUES (
      v_sale_id,
      v_prod_id,
      v_var_id,
      COALESCE(NULLIF(v_item.product_slug, ''), 'custom-item'),
      COALESCE(v_prod_name, v_item.name, 'Custom Item'),
      COALESCE(v_prod_sku, v_item.sku, ''),
      COALESCE(v_prod_barcode, ''),
      COALESCE(v_item.qty, 1),
      v_item_price,
      v_item_price * COALESCE(v_item.qty, 1),
      v_buying_price,
      now()
    );

    -- Inventory Deduction
    IF v_prod_id IS NOT NULL THEN
      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_var_id;

        SELECT COALESCE(SUM(stock), 0) INTO v_total_variant_stock
        FROM public.product_variants
        WHERE product_id = v_prod_id;

        UPDATE public.products
        SET stock = v_total_variant_stock,
            updated_at = now()
        WHERE id = v_prod_id;
      ELSE
        UPDATE public.products
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_prod_id;
      END IF;

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
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -COALESCE(v_item.qty, 1),
        COALESCE(v_prod_stock, 0),
        GREATEST(0, COALESCE(v_prod_stock, 0) - COALESCE(v_item.qty, 1)),
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
        uid
      );
    END IF;
  END LOOP;

  -- 11. Update Customer Aggregate Spend & Visit Count
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spend = COALESCE(total_spend, 0) + v_total,
        last_visit_date = now(),
        updated_at = now()
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'store_credit_used', v_credit_to_use,
    'payable_after_credit', GREATEST(0, v_total - v_credit_to_use),
    'credit_token_used', v_clean_token,
    'payment_method', _payment_method,
    'customer_name', _customer_name,
    'customer_phone', _customer_phone,
    'pos_token_number', v_order_token_num,
    'duplicate', false
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
