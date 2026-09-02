-- Migration: 20260928000056_sync_pos_customers_store_credit_columns.sql
-- Ensure both store_credit and store_credit_balance are permanently compatible and synchronized on pos_customers

-- 1. Add store_credit column if missing
ALTER TABLE public.pos_customers 
  ADD COLUMN IF NOT EXISTS store_credit numeric DEFAULT 0;

-- Sync initial values
UPDATE public.pos_customers
SET store_credit = COALESCE(store_credit_balance, 0)
WHERE store_credit = 0 OR store_credit IS NULL;

-- 2. Trigger to keep store_credit and store_credit_balance 100% in sync
CREATE OR REPLACE FUNCTION public.sync_pos_customer_store_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.store_credit_balance IS DISTINCT FROM OLD.store_credit_balance THEN
    NEW.store_credit := NEW.store_credit_balance;
  ELSIF NEW.store_credit IS DISTINCT FROM OLD.store_credit THEN
    NEW.store_credit_balance := NEW.store_credit;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pos_customer_store_credit ON public.pos_customers;
CREATE TRIGGER trg_sync_pos_customer_store_credit
  BEFORE INSERT OR UPDATE ON public.pos_customers
  FOR EACH ROW EXECUTE FUNCTION public.sync_pos_customer_store_credit();

-- 3. Update process_offline_return to use store_credit_balance explicitly
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
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_qty * item_refund_price);
    item_count := item_count + item_qty;
  END LOOP;

  -- Generate human-friendly return number
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- Generate Store Credit Token
  new_credit_token := 'ZCRED-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  -- 4. Resolve or upsert customer
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

  -- 5. Insert Return Record
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
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    _original_sale_id,
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
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
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

    INSERT INTO public.pos_store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
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
      'offline_return',
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
