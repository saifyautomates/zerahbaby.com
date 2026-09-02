-- Fix idempotency SELECT INTO assigning NULL to core variables and product_id UUID casting
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    existing_return record;
    uid uuid := auth.uid();
  computed_total_refund numeric := 0;
  item record;
  prod record;
  v_rec record;
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
BEGIN
  -- 1. Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'staff') THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
  END IF;

  -- 2. Idempotency check (prevent duplicate return submissions)
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

  -- 3. Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return cart must have at least one product';
  END IF;

  -- 4. Validate and compute total return credit
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be at least 1';
    END IF;
    IF item.refund_price IS NULL OR item.refund_price < 0 THEN
      RAISE EXCEPTION 'Return price cannot be negative';
    END IF;

    computed_total_refund := computed_total_refund + (item.refund_price * item.qty);
  END LOOP;

  -- 5. Resolve Customer Profile & Available Store Credit
  IF v_resolved_cust_id IS NOT NULL THEN
    SELECT store_credit_balance INTO v_prev_credit
    FROM public.pos_customers
    WHERE id = v_resolved_cust_id
    FOR UPDATE;
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, store_credit_balance INTO v_resolved_cust_id, v_prev_credit
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1
    FOR UPDATE;

    -- If no pos_customer row exists for this phone, create one automatically
    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (name, phone, email, store_credit_balance)
      VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        0
      )
      RETURNING id, store_credit_balance INTO v_resolved_cust_id, v_prev_credit;
    END IF;
  END IF;

  v_prev_credit := COALESCE(v_prev_credit, 0);
  v_new_credit := v_prev_credit + computed_total_refund;

  -- 6. Generate unique return reference & credit token
  new_return_id := gen_random_uuid();
  new_return_number := public.generate_pos_return_number();
  new_credit_token := public.generate_credit_token();

  -- 7. Insert offline return record
  INSERT INTO public.offline_returns (
    id,
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
    new_return_id,
    new_return_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_resolved_cust_id,
    computed_total_refund,
    'exchange_credit', -- 100% Exchange Credit
    'completed',
    COALESCE(NULLIF(trim(_return_reason), ''), 'Customer changed mind'),
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != ''
      THEN _notes || ' [idem:' || _idempotency_key || ']'
      ELSE _notes
    END,
    'completed',
    uid,
    new_credit_token,
    _original_sale_id
  );

  -- 8. Process items: lock products, increase inventory, and log inventory transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.product_id IS NOT NULL AND item.product_id != 'walk-in-return' THEN
      SELECT id, slug, stock, name, sku, barcode, is_active
      INTO prod
      FROM public.products
      WHERE id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        v_prev_stock := prod.stock;
        v_new_stock := prod.stock + item.qty;

        -- Atomic stock increment on parent product
        UPDATE public.products
        SET stock = v_new_stock
        WHERE id = prod.id;

        -- Atomic stock increment on matching variant or default variant
        SELECT id, stock INTO v_rec
        FROM public.product_variants
        WHERE product_id = prod.id
          AND (sku ILIKE item.sku OR barcode = item.barcode OR name = 'Default')
        ORDER BY (sku ILIKE item.sku) DESC, (barcode = item.barcode) DESC, (name = 'Default') DESC
        LIMIT 1
        FOR UPDATE;

        IF v_rec.id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item.qty
          WHERE id = v_rec.id;
        END IF;

        -- Record auditable inventory transaction
        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
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
          v_rec.id,
          'return'::public.inventory_tx_type,
          item.qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return ' || new_return_number || ': ' || COALESCE(_return_reason, 'Restock'),
          uid
        );
      END IF;
    END IF;

    -- Insert return item record
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
      refund_price
    ) VALUES (
      new_return_id,
      CASE WHEN item.product_id = 'walk-in-return' THEN NULL ELSE item.product_id::uuid END,
      item.product_slug,
      item.name,
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      item.variant_info,
      item.qty,
      item.mrp,
      item.refund_price
    );
  END LOOP;

  -- 9. Update Customer Store Credit Balance & Append to Immutable Ledger
  IF v_resolved_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET store_credit_balance = v_new_credit,
        updated_at = now()
    WHERE id = v_resolved_cust_id;
  END IF;

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
    notes,
    created_by
  ) VALUES (
    v_resolved_cust_id,
    COALESCE(trim(_customer_phone), ''),
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    new_credit_token,
    'CREDIT_ISSUED',
    computed_total_refund,
    v_prev_credit,
    v_new_credit,
    new_return_id,
    'Issued on Return #' || new_return_number,
    uid
  );

  -- 10. Return response
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'available_credit', v_new_credit,
    'items_count', item_count,
    'status', 'completed'
  );
END; $$;




