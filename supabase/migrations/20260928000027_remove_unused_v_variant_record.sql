-- Migration: 20260928000027_remove_unused_v_variant_record.sql
-- Description: Remove unused unassigned v_variant record from place_offline_sale RPC.

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT '',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _customer_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_num text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_prod record;
  v_order_token_num int;
  v_order_token_dt date;
  v_resolved_customer_id uuid := _customer_id;
  v_current_customer_credit numeric := 0;
  v_actual_credit_applied numeric := 0;
  v_existing_sale record;
  v_cash_payable numeric := 0;
  v_token_id uuid := NULL;
  v_token_cust_id uuid := NULL;
  v_token_balance numeric := 0;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT s.id, s.sale_number, s.total, s.subtotal, s.discount, s.payment_method,
           s.customer_name, s.customer_phone, s.store_credit_used, s.pos_token_number, s.pos_token_date
    INTO v_existing_sale
    FROM public.offline_sales s
    WHERE s.idempotency_key = _idempotency_key
       OR s.notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'discount_type', _discount_type,
        'discount_value', _discount_value,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_phone', v_existing_sale.customer_phone,
        'items_count', jsonb_array_length(_items),
        'store_credit_used', v_existing_sale.store_credit_used,
        'cash_payable', GREATEST(0, v_existing_sale.total - COALESCE(v_existing_sale.store_credit_used, 0)),
        'pos_token_number', v_existing_sale.pos_token_number,
        'pos_token_date', v_existing_sale.pos_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items Payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale cannot be completed without items';
  END IF;

  -- 3. Calculate Subtotal Strictly Server-Side
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    IF v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: % for %', v_item.qty, v_item.name;
    END IF;
    v_subtotal := v_subtotal + (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty);
  END LOOP;

  -- 4. Calculate Discount
  IF _discount_type = 'percentage' THEN
    v_discount := round((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal, COALESCE(_discount_value, 0));
  ELSE
    v_discount := 0;
  END IF;
  v_total := GREATEST(0, v_subtotal - v_discount);

  -- 5. Store Credit Validation & Resolution
  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
    SELECT id, customer_id, balance_after
    INTO v_token_id, v_token_cust_id, v_token_balance
    FROM public.store_credit_ledger
    WHERE credit_token = upper(trim(_credit_token))
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_token_id IS NOT NULL THEN
      IF v_resolved_customer_id IS NULL AND v_token_cust_id IS NOT NULL THEN
        v_resolved_customer_id := v_token_cust_id;
      END IF;
    END IF;
  END IF;

  IF v_resolved_customer_id IS NOT NULL THEN
    SELECT store_credit_balance INTO v_current_customer_credit
    FROM public.pos_customers
    WHERE id = v_resolved_customer_id
    FOR UPDATE;
    v_current_customer_credit := COALESCE(v_current_customer_credit, 0);
  ELSIF v_token_id IS NOT NULL THEN
    v_current_customer_credit := COALESCE(v_token_balance, 0);
  ELSE
    v_current_customer_credit := 0;
  END IF;

  IF _store_credit_used > 0 THEN
    IF _store_credit_used > v_current_customer_credit THEN
      RAISE EXCEPTION 'Requested store credit (₹%) exceeds available balance (₹%)',
        _store_credit_used, v_current_customer_credit;
    END IF;
    v_actual_credit_applied := LEAST(_store_credit_used, v_total);
  END IF;

  v_cash_payable := GREATEST(0, v_total - v_actual_credit_applied);

  -- 6. Generate Identifiers
  v_sale_num := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 100000)::text, 5, '0');
  v_order_token_dt := CURRENT_DATE;

  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  -- 7. Insert Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    subtotal,
    discount,
    discount_type,
    discount_value,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    pos_token_number,
    pos_token_date,
    created_at
  ) VALUES (
    v_sale_num,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_resolved_customer_id,
    v_subtotal,
    v_discount,
    _discount_type,
    _discount_value,
    v_total,
    _payment_method,
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
        COALESCE(_notes, '') || ' [idem:' || _idempotency_key || ']'
      ELSE
        _notes
    END,
    _idempotency_key,
    v_actual_credit_applied,
    v_order_token_num,
    v_order_token_dt,
    now()
  ) RETURNING id INTO v_sale_id;

  -- 8. Process Line Items & Deduct Inventory
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    IF v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN
      SELECT p.id, p.name, p.sku, p.stock, p.mrp, p.sales_channel
      INTO v_prod
      FROM public.products p
      WHERE p.id = v_item.product_id::uuid
      FOR UPDATE;

      IF v_prod.id IS NOT NULL THEN
        UPDATE public.products
        SET stock = GREATEST(0, stock - v_item.qty),
            updated_at = now()
        WHERE id = v_prod.id;

        INSERT INTO public.inventory_transactions (
          product_id,
          type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          note
        ) VALUES (
          v_prod.id,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          v_prod.stock,
          GREATEST(0, v_prod.stock - v_item.qty),
          'pos_sale',
          v_sale_id,
          'POS Sale #' || v_sale_num || ' (' || v_item.qty || ' sold)'
        );
      END IF;
    END IF;

    -- Insert sale line item
    INSERT INTO public.offline_sale_items (
      offline_sale_id,
      product_id,
      product_slug,
      name,
      sku,
      qty,
      price,
      custom_price,
      subtotal
    ) VALUES (
      v_sale_id,
      CASE WHEN v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN v_item.product_id::uuid ELSE NULL END,
      COALESCE(v_item.product_slug, ''),
      v_item.name,
      COALESCE(v_item.sku, ''),
      v_item.qty,
      COALESCE(v_item.price, 0),
      v_item.custom_price,
      (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty)
    );
  END LOOP;

  -- 9. Deduct Store Credit & Log to Ledger
  IF v_actual_credit_applied > 0 THEN
    IF v_resolved_customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_actual_credit_applied),
          updated_at = now()
      WHERE id = v_resolved_customer_id;
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
      order_id,
      change_amount,
      entry_type,
      notes
    ) VALUES (
      v_resolved_customer_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(trim(_customer_name), 'Walk-in Customer'),
      _credit_token,
      'CREDIT_REDEEMED',
      v_actual_credit_applied,
      v_current_customer_credit,
      GREATEST(0, v_current_customer_credit - v_actual_credit_applied),
      v_sale_id,
      -v_actual_credit_applied,
      'CREDIT_REDEEMED',
      'Store credit applied to POS Sale #' || v_sale_num
    );
  END IF;

  -- 10. Update Customer Stats
  IF v_resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spend = COALESCE(pos_customers.total_spend, 0) + v_total,
        total_spent = COALESCE(pos_customers.total_spent, 0) + v_total,
        total_purchases = COALESCE(pos_customers.total_purchases, 0) + 1,
        total_visits = COALESCE(pos_customers.total_visits, 0) + 1,
        updated_at = now()
    WHERE id = v_resolved_customer_id;
  END IF;

  -- 11. Return Authoritative Success JSON
  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_num,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'items_count', jsonb_array_length(_items),
    'store_credit_used', v_actual_credit_applied,
    'cash_payable', v_cash_payable,
    'remaining_credit', GREATEST(0, v_current_customer_credit - v_actual_credit_applied),
    'pos_token_number', v_order_token_num,
    'pos_token_date', v_order_token_dt,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role, anon;
