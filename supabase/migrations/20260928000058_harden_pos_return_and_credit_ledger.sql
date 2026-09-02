-- Migration: 20260928000058_harden_pos_return_and_credit_ledger.sql
-- Fix offline_returns, offline_return_items, and store_credit_ledger schemas for POS Returns

-- 1. Add credit_token_status to offline_returns
ALTER TABLE public.offline_returns
  ADD COLUMN IF NOT EXISTS credit_token_status text DEFAULT 'ACTIVE';

-- 2. Add mrp column to offline_return_items
ALTER TABLE public.offline_return_items
  ADD COLUMN IF NOT EXISTS mrp numeric DEFAULT 0;

-- 3. Create view pos_store_credit_ledger for backward compatibility
CREATE OR REPLACE VIEW public.pos_store_credit_ledger AS 
SELECT 
  id,
  customer_id,
  customer_name,
  customer_phone,
  type,
  amount,
  balance_before,
  balance_after,
  credit_token,
  source_return_id as return_id,
  used_in_sale_id as sale_id,
  notes,
  created_by,
  created_at
FROM public.store_credit_ledger;

-- 4. Redefine process_offline_return with exact matching table and column names
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
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_already_returned_qty int := 0;
  v_orig_total_units int := 0;
  v_cumul_returned_units int := 0;
  v_cumul_returned_amount numeric := 0;
  v_clean_sale_id uuid;
BEGIN
  -- 1. Auth check
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
    WHERE notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
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

  -- Generate human-friendly return number
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- Generate Store Credit Token
  new_credit_token := 'ZCRED-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

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

  -- 6. Insert Return Record
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
    new_credit_token,
    'ACTIVE',
    _idempotency_key,
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 6. Insert Return Items & Restore Stock
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      item_product_id := (elem->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_product_id := NULL;
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
        UPDATE public.products SET stock = stock + item_qty WHERE id = item_product_id;
        v_new_stock := v_prev_stock + item_qty;

        -- Update variants if matched
        UPDATE public.product_variants
        SET stock = stock + item_qty
        WHERE product_id = item_product_id
          AND ((sku IS NOT NULL AND sku ILIKE item_sku) OR (barcode IS NOT NULL AND barcode = item_barcode) OR name = 'Default');

        INSERT INTO public.inventory_transactions (
          product_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_product_id,
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

  -- 7. Update Customer Store Credit and Ledger
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
      'credit_added',
      computed_total_refund,
      v_prev_credit,
      v_new_credit,
      new_credit_token,
      new_return_id,
      'Exchange credit issued via POS Return #' || new_return_number || ' (' || new_credit_token || ')',
      uid
    );
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

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, anon, service_role;
