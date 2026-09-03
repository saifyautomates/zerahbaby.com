-- Migration: 20260928000071_fix_store_credit_balance_initialization.sql
-- Fix offline_returns credit_balance initialization and harden get_customer_store_credit calculation

-- 1. Correct existing active return balances
UPDATE public.offline_returns
SET credit_balance = GREATEST(0, refund_amount - COALESCE(credit_used, 0))
WHERE (credit_token_status = 'ACTIVE' OR credit_token_status IS NULL)
  AND (credit_balance IS NULL OR credit_balance = 0)
  AND refund_amount > 0;

-- 2. Redefine get_customer_store_credit with dynamic balance fallback
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
  v_clean_token text := upper(trim(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_ret record;
BEGIN
  -- 1. Search by customer_id
  IF v_cust_id IS NOT NULL THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0), name INTO v_balance, v_cust_name
    FROM public.pos_customers
    WHERE id = v_cust_id;

  -- 2. Search by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name INTO v_cust_id, v_balance, v_cust_name
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;

  -- 3. Search by credit_token on offline_returns
  ELSIF v_clean_token != '' THEN
    SELECT customer_id, 
           COALESCE(
             CASE WHEN credit_balance > 0 THEN credit_balance ELSE NULL END,
             GREATEST(0, refund_amount - COALESCE(credit_used, 0)),
             refund_amount,
             0
           ) AS calculated_balance,
           customer_name
    INTO v_cust_id, v_balance, v_cust_name
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
      AND (credit_token_status = 'ACTIVE' OR credit_token_status IS NULL)
    LIMIT 1;

    -- Fallback to store_credit_ledger if needed
    IF v_balance = 0 OR v_balance IS NULL THEN
      SELECT customer_id, balance_after, customer_name INTO v_cust_id, v_balance, v_cust_name
      FROM public.store_credit_ledger
      WHERE UPPER(credit_token) = v_clean_token
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
  END IF;

  -- 4. Get active return vouchers with unspent credit
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'credit_token', r.credit_token,
      'refund_amount', r.refund_amount,
      'credit_used', r.credit_used,
      'credit_balance', COALESCE(
        CASE WHEN r.credit_balance > 0 THEN r.credit_balance ELSE NULL END,
        GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))
      ),
      'original_sale_id', r.original_sale_id,
      'original_sale_number', r.original_sale_number,
      'linked_sale_id', r.linked_sale_id,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC
  ) INTO active_returns
  FROM public.offline_returns r
  WHERE (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
     OR (v_clean_token != '' AND UPPER(r.credit_token) = v_clean_token);

  -- 5. Get recent ledger transactions
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

-- 3. Ensure process_offline_return explicitly sets credit_balance = computed_total_refund
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
  v_orig_sale record;
  v_orig_item record;
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
  v_already_returned_qty int := 0;
  v_orig_total_units int := 0;
  v_cumul_returned_units int := 0;
  v_cumul_returned_amount numeric := 0;
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
    SELECT id, return_number, refund_amount, credit_token
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token
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

  -- 4. Resolve clean original_sale_id
  v_clean_sale_id := CASE 
    WHEN _original_sale_id IS NULL OR _original_sale_id = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL 
    ELSE _original_sale_id 
  END;

  IF v_clean_sale_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.offline_sales WHERE id = v_clean_sale_id) THEN
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

  -- 6. Insert Return Record with explicit credit_balance = computed_total_refund
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
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
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
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

  -- 8. Update Customer Store Credit and Ledger
  IF v_resolved_cust_id IS NOT NULL AND computed_total_refund > 0 THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit FROM public.pos_customers WHERE id = v_resolved_cust_id FOR UPDATE;
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
      v_new_credit,
      new_credit_token,
      new_return_id,
      'Exchange credit issued via POS Return #' || new_return_number || ' (' || new_credit_token || ')',
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
    'customer_name', _customer_name,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
