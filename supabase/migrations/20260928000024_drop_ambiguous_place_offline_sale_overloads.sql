-- Migration: 20260928000024_drop_ambiguous_place_offline_sale_overloads.sql
-- Description: Drop ambiguous 13-argument place_offline_sale overload containing obsolete _discount parameter.

-- 1. Drop both variants explicitly by full type signature
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text, numeric, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text);

-- 2. Re-assert canonical 12-argument function
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
  sale_id uuid;
  sale_num text;
  subtotal numeric := 0;
  discount numeric := 0;
  total numeric := 0;
  item record;
  prod record;
  variant record;
  inv record;
  order_token_num int;
  order_token_dt date;
  resolved_customer_id uuid := _customer_id;
  current_customer_credit numeric := 0;
  actual_credit_applied numeric := 0;
  customer_record record;
  existing_sale record;
  cash_payable numeric := 0;
  v_token_record record;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method,
           customer_name, customer_phone, store_credit_used, pos_token_number, pos_token_date
    INTO existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = _idempotency_key
       OR notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;

    IF existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', existing_sale.id,
        'sale_number', existing_sale.sale_number,
        'total', existing_sale.total,
        'subtotal', existing_sale.subtotal,
        'discount', existing_sale.discount,
        'discount_type', _discount_type,
        'discount_value', _discount_value,
        'payment_method', existing_sale.payment_method,
        'customer_name', existing_sale.customer_name,
        'customer_phone', existing_sale.customer_phone,
        'items_count', jsonb_array_length(_items),
        'store_credit_used', existing_sale.store_credit_used,
        'cash_payable', GREATEST(0, existing_sale.total - COALESCE(existing_sale.store_credit_used, 0)),
        'pos_token_number', existing_sale.pos_token_number,
        'pos_token_date', existing_sale.pos_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items Payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale cannot be completed without items';
  END IF;

  -- 3. Calculate Subtotal Strictly Server-Side
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid item quantity: % for %', item.qty, item.name;
    END IF;
    subtotal := subtotal + (COALESCE(item.custom_price, item.price, 0) * item.qty);
  END LOOP;

  -- 4. Calculate Discount
  IF _discount_type = 'percentage' THEN
    discount := round((subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    discount := LEAST(subtotal, COALESCE(_discount_value, 0));
  ELSE
    discount := 0;
  END IF;
  total := GREATEST(0, subtotal - discount);

  -- 5. Store Credit Validation & Resolution
  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
    SELECT * INTO v_token_record
    FROM public.store_credit_ledger
    WHERE credit_token = upper(trim(_credit_token))
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_token_record.id IS NOT NULL THEN
      IF resolved_customer_id IS NULL AND v_token_record.customer_id IS NOT NULL THEN
        resolved_customer_id := v_token_record.customer_id;
      END IF;
    END IF;
  END IF;

  IF resolved_customer_id IS NOT NULL THEN
    SELECT * INTO customer_record
    FROM public.pos_customers
    WHERE id = resolved_customer_id
    FOR UPDATE;

    IF customer_record.id IS NOT NULL THEN
      current_customer_credit := COALESCE(customer_record.store_credit_balance, 0);
    END IF;
  ELSIF v_token_record.id IS NOT NULL THEN
    current_customer_credit := COALESCE(v_token_record.balance_after, 0);
  END IF;

  IF _store_credit_used > 0 THEN
    IF _store_credit_used > current_customer_credit THEN
      RAISE EXCEPTION 'Requested store credit (₹%) exceeds available balance (₹%)',
        _store_credit_used, current_customer_credit;
    END IF;
    actual_credit_applied := LEAST(_store_credit_used, total);
  END IF;

  cash_payable := GREATEST(0, total - actual_credit_applied);

  -- 6. Generate Identifiers
  sale_num := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 100000)::text, 5, '0');
  order_token_dt := CURRENT_DATE;

  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = order_token_dt;

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
    sale_num,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    resolved_customer_id,
    subtotal,
    discount,
    _discount_type,
    _discount_value,
    total,
    _payment_method,
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
        COALESCE(_notes, '') || ' [idem:' || _idempotency_key || ']'
      ELSE
        _notes
    END,
    _idempotency_key,
    actual_credit_applied,
    order_token_num,
    order_token_dt,
    now()
  ) RETURNING id INTO sale_id;

  -- 8. Process Line Items & Deduct Inventory
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
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
    IF item.product_id IS NOT NULL AND item.product_id != '' THEN
      IF item.variant_id IS NOT NULL AND item.variant_id != '' THEN
        SELECT v.id, v.sku, v.color, v.size, v.mrp_override AS mrp_override
        INTO variant
        FROM public.product_variants v
        WHERE v.id = item.variant_id::uuid;
      ELSE
        variant.id := NULL;
        variant.mrp_override := NULL;
      END IF;

      SELECT p.id, p.name, p.sku, p.stock, p.mrp, p.sales_channel
      INTO prod
      FROM public.products p
      WHERE p.id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        UPDATE public.products
        SET stock = GREATEST(0, stock - item.qty),
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
          note
        ) VALUES (
          prod.id,
          'sale'::public.inventory_tx_type,
          -item.qty,
          prod.stock,
          GREATEST(0, prod.stock - item.qty),
          'pos_sale',
          sale_id,
          'POS Sale #' || sale_num || ' (' || item.qty || ' sold)'
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
      sale_id,
      CASE WHEN item.product_id IS NOT NULL AND item.product_id != '' THEN item.product_id::uuid ELSE NULL END,
      COALESCE(item.product_slug, ''),
      item.name,
      COALESCE(item.sku, ''),
      item.qty,
      COALESCE(item.price, 0),
      item.custom_price,
      (COALESCE(item.custom_price, item.price, 0) * item.qty)
    );
  END LOOP;

  -- 9. Deduct Store Credit & Log to Ledger
  IF actual_credit_applied > 0 THEN
    IF resolved_customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - actual_credit_applied),
          updated_at = now()
      WHERE id = resolved_customer_id;
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
      resolved_customer_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(trim(_customer_name), 'Walk-in Customer'),
      _credit_token,
      'CREDIT_REDEEMED',
      actual_credit_applied,
      current_customer_credit,
      GREATEST(0, current_customer_credit - actual_credit_applied),
      sale_id,
      -actual_credit_applied,
      'CREDIT_REDEEMED',
      'Store credit applied to POS Sale #' || sale_num
    );
  END IF;

  -- 10. Update Customer Stats
  IF resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spend = COALESCE(total_spend, 0) + total,
        total_spent = COALESCE(total_spent, 0) + total,
        total_purchases = COALESCE(total_purchases, 0) + 1,
        total_visits = COALESCE(total_visits, 0) + 1,
        updated_at = now()
    WHERE id = resolved_customer_id;
  END IF;

  -- 11. Return Authoritative Success JSON
  RETURN jsonb_build_object(
    'sale_id', sale_id,
    'sale_number', sale_num,
    'total', total,
    'subtotal', subtotal,
    'discount', discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'items_count', jsonb_array_length(_items),
    'store_credit_used', actual_credit_applied,
    'cash_payable', cash_payable,
    'remaining_credit', GREATEST(0, current_customer_credit - actual_credit_applied),
    'pos_token_number', order_token_num,
    'pos_token_date', order_token_dt,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role, anon;
