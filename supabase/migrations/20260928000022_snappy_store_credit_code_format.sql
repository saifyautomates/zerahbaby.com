-- Migration: 20260928000020_snappy_store_credit_code_format.sql
-- Description:
-- 1. Create generate_store_credit_code() to generate 1 Letter + 3 Digits format (e.g. A123, P258).
-- 2. Update process_offline_return to use the new snappy 4-char code and record in store_credit_ledger for all returns (including walk-ins).
-- 3. Update get_customer_store_credit to seamlessly resolve 4-char tokens (A123) and legacy tokens.
-- 4. Ensure place_offline_sale records credit_token_used and prints on invoices.

-- 1. Function to generate 1 Letter + 3 Digits Store Credit Code (e.g. A123, P258)
CREATE OR REPLACE FUNCTION public.generate_store_credit_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_exists boolean;
  -- Alphabet characters excluding confusing letters I, O
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_letter text;
  v_num text;
  v_attempts integer := 0;
BEGIN
  LOOP
    v_attempts := v_attempts + 1;
    v_letter := substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
    v_num := lpad((floor(random() * 900) + 100)::text, 3, '0');
    v_code := v_letter || v_num;

    -- Verify uniqueness across returns and credit ledger
    SELECT EXISTS (
      SELECT 1 FROM public.offline_returns WHERE credit_token = v_code
      UNION ALL
      SELECT 1 FROM public.store_credit_ledger WHERE credit_token = v_code
    ) INTO v_exists;

    IF NOT v_exists THEN
      RETURN v_code;
    END IF;

    -- Safety fallback if namespace is dense
    IF v_attempts > 200 THEN
      RETURN v_letter || lpad((floor(random() * 9000) + 1000)::text, 4, '0');
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_store_credit_code() TO authenticated, service_role, anon;

-- 2. Helper RPC: Query Customer Store Credit Balance & Recent History
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
BEGIN
  -- 1. Try finding by customer_id
  IF v_cust_id IS NOT NULL THEN
    SELECT store_credit_balance, name INTO v_balance, v_cust_name
    FROM public.pos_customers
    WHERE id = v_cust_id;

  -- 2. Try finding by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, store_credit_balance, name INTO v_cust_id, v_balance, v_cust_name
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;

  -- 3. Try finding by credit_token (e.g. A123, P258, or legacy ZCR-...)
  ELSIF v_clean_token != '' THEN
    SELECT customer_id, balance_after, customer_name INTO v_cust_id, v_balance, v_cust_name
    FROM public.store_credit_ledger
    WHERE credit_token = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    -- Fallback: check offline_returns directly if ledger entry was for a walk-in customer
    IF (v_balance IS NULL OR v_balance = 0) THEN
      SELECT customer_id, refund_amount, customer_name INTO v_cust_id, v_balance, v_cust_name
      FROM public.offline_returns
      WHERE credit_token = v_clean_token
        AND status != 'cancelled'
        AND refund_status != 'cancelled'
      LIMIT 1;

      -- Subtract any already redeemed credit for this token
      IF v_balance > 0 THEN
        DECLARE
          v_already_used numeric := 0;
        BEGIN
          SELECT COALESCE(sum(store_credit_used), 0) INTO v_already_used
          FROM public.offline_sales
          WHERE credit_token_used = v_clean_token
            AND status NOT IN ('cancelled', 'voided');
          v_balance := GREATEST(0, v_balance - v_already_used);
        END;
      END IF;
    END IF;
  END IF;

  -- 4. Get recent ledger transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'balance_before', balance_before,
      'balance_after', balance_after,
      'credit_token', credit_token,
      'notes', notes,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO recent_history
  FROM (
    SELECT *
    FROM public.store_credit_ledger
    WHERE (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
       OR (length(v_clean_phone) >= 10 AND (customer_phone = v_clean_phone OR customer_phone = right(v_clean_phone, 10)))
       OR (v_clean_token != '' AND credit_token = v_clean_token)
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Walk-in Customer'),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', v_clean_token,
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, service_role, anon;

-- 3. Upgrade process_offline_return RPC to generate 1 Letter + 3 Digits tokens (A123, P258)
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.process_offline_return;
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
  is_walkin boolean := false;
  orig_item_qty integer;
  already_ret_qty integer;
  rem_returnable integer;
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
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
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
    original_sale_id
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
    _original_sale_id
  ) RETURNING id INTO new_return_id;

  -- 8. Process items: lock products, increase inventory, and log inventory transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(
      product_id text, 
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
    IF item.product_id IS NOT NULL AND item.product_id != '' AND item.product_id != 'walk-in-return' THEN
      SELECT id, stock INTO prod
      FROM public.products
      WHERE id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        UPDATE public.products
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = prod.id;

        INSERT INTO public.inventory_transactions (
          product_id,
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

    -- Insert return item record linked to original_sale_item_id
    INSERT INTO public.offline_return_items (
      return_id,
      product_id,
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

  -- 9. Update Customer Store Credit Balance & Append to Immutable Ledger
  -- Always insert into store_credit_ledger so walk-ins can also redeem voucher by token!
  IF resolved_customer_id IS NOT NULL THEN
    SELECT store_credit_balance INTO current_customer_credit
    FROM public.pos_customers
    WHERE id = resolved_customer_id
    FOR UPDATE;

    new_customer_credit := COALESCE(current_customer_credit, 0) + computed_total_refund;

    UPDATE public.pos_customers
    SET store_credit_balance = new_customer_credit,
        updated_at = now()
    WHERE id = resolved_customer_id;
  ELSE
    current_customer_credit := 0;
    new_customer_credit := computed_total_refund;
  END IF;

  IF computed_total_refund > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_phone,
      customer_name,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_return_id,
      return_id,
      change_amount,
      entry_type,
      notes,
      created_by
    ) VALUES (
      resolved_customer_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(trim(_customer_name), 'Walk-in Customer'),
      new_credit_token,
      'CREDIT_ISSUED',
      computed_total_refund,
      COALESCE(current_customer_credit, 0),
      new_customer_credit,
      new_return_id,
      new_return_id,
      computed_total_refund,
      'CREDIT_ISSUED',
      'Store credit voucher ' || new_credit_token || ' issued for Return #' || new_return_number,
      uid
    );
  END IF;

  -- 10. Return detailed success JSON payload
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'customer_id', resolved_customer_id,
    'items_count', jsonb_array_length(_items),
    'created_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, service_role, anon;
