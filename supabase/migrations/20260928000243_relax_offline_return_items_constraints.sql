-- =====================================================================
-- Migration: 20260928000243_relax_offline_return_items_constraints.sql
-- Description: Drop NOT NULL constraint on sku, barcode, and variant_info in offline_return_items
--              and update process_offline_return to COALESCE item_sku, barcode, etc.
-- =====================================================================

-- 1. Relax constraints on offline_return_items
ALTER TABLE public.offline_return_items
  ALTER COLUMN sku DROP NOT NULL,
  ALTER COLUMN sku SET DEFAULT '',
  ALTER COLUMN barcode DROP NOT NULL,
  ALTER COLUMN barcode SET DEFAULT '',
  ALTER COLUMN variant_info DROP NOT NULL,
  ALTER COLUMN variant_info SET DEFAULT '',
  ALTER COLUMN product_slug DROP NOT NULL,
  ALTER COLUMN product_slug SET DEFAULT '';

-- 2. Update process_offline_return
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
  v_existing_return record;
  v_prod record;
  v_variant record;
  v_orig_sale record;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
  v_reason_text text := COALESCE(NULLIF(trim(_return_reason), ''), 'Customer Return');
  v_chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_iter int := 0;
  v_exists boolean := false;
BEGIN
  -- 1. Authorization check: Staff, Admin, or internal/service/session
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
      RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can process returns';
    END IF;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, status, credit_token, customer_name, expires_at
    INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
       OR notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'refund_amount', v_existing_return.refund_amount,
        'status', v_existing_return.status,
        'credit_token', v_existing_return.credit_token,
        'expires_at', v_existing_return.expires_at,
        'customer_name', v_existing_return.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Customer Upsert if needed
  IF v_resolved_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_resolved_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_visits,
        store_credit,
        store_credit_balance,
        last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        0,
        1,
        0,
        0,
        now()
      ) RETURNING id INTO v_resolved_cust_id;
    END IF;
  END IF;

  -- 4. Calculate total refund
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_count := item_count + 1;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
  END LOOP;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return items list cannot be empty';
  END IF;

  -- 5. Link original sale if provided
  v_clean_sale_id := _original_sale_id;
  IF v_clean_sale_id IS NOT NULL THEN
    SELECT sale_number INTO v_orig_sale_number
    FROM public.offline_sales
    WHERE id = v_clean_sale_id;
  END IF;

  -- 6. Generate Return Number and Credit Token
  new_return_id := gen_random_uuid();
  new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- Generate 4-character token
  LOOP
    new_credit_token := '';
    FOR i IN 1..4 LOOP
      new_credit_token := new_credit_token || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    END LOOP;

    SELECT EXISTS (
      SELECT 1 FROM public.offline_returns WHERE UPPER(credit_token) = new_credit_token AND credit_token_status = 'ACTIVE'
    ) OR EXISTS (
      SELECT 1 FROM public.pos_exchange_vouchers WHERE UPPER(token) = new_credit_token AND status = 'active'
    ) OR EXISTS (
      SELECT 1 FROM public.store_credit_vouchers WHERE UPPER(token) = new_credit_token AND is_active = true
    ) INTO v_exists;

    IF NOT v_exists THEN
      EXIT;
    END IF;

    v_iter := v_iter + 1;
    IF v_iter > 200 THEN
      new_credit_token := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));
      EXIT;
    END IF;
  END LOOP;

  -- 7. Insert into public.offline_returns
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_amount,
    credit_used,
    credit_balance,
    credit_token,
    credit_token_status,
    status,
    refund_status,
    reason,
    return_reason,
    notes,
    created_by,
    idempotency_key,
    credit_expires_at,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_refund_method), ''), 'exchange_credit'),
    computed_total_refund,
    0,
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    'completed',
    'completed',
    v_reason_text,
    v_reason_text,
    COALESCE(_notes, ''),
    uid,
    NULLIF(trim(_idempotency_key), ''),
    v_expiry_date,
    v_expiry_date,
    now(),
    now()
  ) RETURNING id INTO new_return_id;

  -- 8. Synchronize to pos_exchange_vouchers
  IF computed_total_refund > 0 THEN
    INSERT INTO public.pos_exchange_vouchers (
      token,
      return_id,
      customer_id,
      customer_phone,
      customer_name,
      original_amount,
      remaining_balance,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      new_credit_token,
      new_return_id,
      v_resolved_cust_id,
      COALESCE(v_clean_phone, ''),
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      computed_total_refund,
      computed_total_refund,
      'active',
      v_expiry_date,
      now(),
      now()
    );

    -- 9. Synchronize to store_credit_vouchers
    INSERT INTO public.store_credit_vouchers (
      token,
      customer_id,
      customer_phone,
      initial_amount,
      current_balance,
      is_active,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      new_credit_token,
      v_resolved_cust_id,
      COALESCE(v_clean_phone, ''),
      computed_total_refund,
      computed_total_refund,
      true,
      v_expiry_date,
      now(),
      now()
    );

    -- 10. Synchronize customer store credit
    IF v_resolved_cust_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + computed_total_refund,
          store_credit = COALESCE(store_credit, 0) + computed_total_refund,
          updated_at = now()
      WHERE id = v_resolved_cust_id;
    END IF;

    -- 11. Record in store_credit_ledger
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
      created_by,
      created_at
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(v_clean_phone, ''),
      'CREDIT_ISSUED',
      computed_total_refund,
      0,
      computed_total_refund,
      new_credit_token,
      new_return_id,
      'Return #' || new_return_number || ' exchange credit issued',
      uid,
      now()
    );
  END IF;

  -- 12. Insert return line items & Restock Inventory
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Returned Item');
    item_sku := COALESCE(elem->>'sku', '');
    item_barcode := COALESCE(elem->>'barcode', '');
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := COALESCE(elem->>'variant_info', '');

    IF item_sku = '' AND item_variant_id IS NOT NULL THEN
      SELECT COALESCE(sku, '') INTO item_sku FROM public.product_variants WHERE id = item_variant_id;
    END IF;

    INSERT INTO public.offline_return_items (
      return_id,
      original_sale_item_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      variant_info,
      sku,
      barcode,
      qty,
      quantity,
      refund_price,
      mrp,
      created_at
    ) VALUES (
      new_return_id,
      item_orig_sale_item_id,
      item_product_id,
      item_variant_id,
      item_slug,
      item_name,
      item_name,
      item_variant_info,
      item_sku,
      item_barcode,
      item_qty,
      item_qty,
      item_refund_price,
      item_mrp,
      now()
    );

    -- Restock Variant (trg_sync_variant_to_product_stock updates parent products.stock)
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.product_variants
        SET stock = v_new_stock, updated_at = now()
        WHERE id = item_variant_id;

        -- Record inventory transaction
        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          quantity,
          type,
          transaction_type,
          reference_id,
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          item_variant_id,
          item_qty,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      -- Restock Parent Product ONLY when item_variant_id IS NULL
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products
        SET stock = v_prev_stock + item_qty, updated_at = now()
        WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          quantity,
          type,
          transaction_type,
          reference_id,
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          NULL,
          item_qty,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
        );
      END IF;
    END IF;
  END LOOP;

  -- 13. Return canonical complete result
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'status', 'completed',
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text
) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
