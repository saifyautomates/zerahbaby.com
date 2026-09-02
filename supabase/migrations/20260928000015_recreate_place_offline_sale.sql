-- ==============================================================================
-- Migration: 20260928000015_recreate_place_offline_sale.sql
-- Description:
-- 1. Ensure generate_pos_invoice_number alias exists pointing to generate_pos_sale_number
-- 2. Cleanly recreate canonical 13-parameter place_offline_sale RPC
-- ==============================================================================

-- 1. Ensure sequential invoice generator alias
CREATE OR REPLACE FUNCTION public.generate_pos_invoice_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN public.generate_pos_sale_number();
END; $$;

-- 2. Drop old 11-parameter signatures
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb);

-- 3. Canonical 13-parameter place_offline_sale RPC
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT '',
  _discount numeric DEFAULT 0,
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
  uid uuid := auth.uid();
  new_sale_id uuid;
  new_sale_number text;
  token_number integer;
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  item record;
  prod record;
  variant record;
  resolved_customer_id uuid := _customer_id;
  existing_sale record;
  current_credit numeric := 0;
  new_credit numeric := 0;
  is_walkin boolean := false;
  v_credit_token text := _credit_token;
BEGIN
  -- 1. Authentication check
  IF uid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = uid AND role IN ('admin', 'staff', 'manager', 'owner')
    ) AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    ) THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can place offline sales';
    END IF;
  END IF;

  -- 2. Idempotency check
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, sale_number, total, pos_token_number
    INTO existing_sale
    FROM public.offline_sales
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;
    IF existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', existing_sale.id,
        'sale_number', existing_sale.sale_number,
        'token_number', existing_sale.pos_token_number,
        'total', existing_sale.total,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Customer resolution
  IF _customer_name IS NULL OR trim(_customer_name) = '' OR _customer_name = 'Walk-in Customer' THEN
    is_walkin := true;
  END IF;

  IF NOT is_walkin AND resolved_customer_id IS NULL AND _customer_phone IS NOT NULL AND trim(_customer_phone) != '' THEN
    SELECT id INTO resolved_customer_id
    FROM public.pos_customers
    WHERE phone = trim(_customer_phone)
    LIMIT 1;

    IF resolved_customer_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, store_credit_balance, total_spend, total_spent, total_purchases, total_visits
      ) VALUES (
        trim(_customer_name), trim(_customer_phone), COALESCE(trim(_customer_email), ''), 0, 0, 0, 0, 0
      ) RETURNING id INTO resolved_customer_id;
    END IF;
  END IF;

  -- 4. Store Credit Redemption Verification
  IF _store_credit_used > 0 THEN
    IF resolved_customer_id IS NOT NULL THEN
      SELECT store_credit_balance INTO current_credit
      FROM public.pos_customers
      WHERE id = resolved_customer_id
      FOR UPDATE;
    ELSIF v_credit_token IS NOT NULL AND v_credit_token != '' THEN
      SELECT customer_id, balance_after INTO resolved_customer_id, current_credit
      FROM public.store_credit_ledger
      WHERE credit_token = upper(trim(v_credit_token))
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF current_credit IS NULL OR current_credit < _store_credit_used THEN
      RAISE EXCEPTION 'Insufficient store credit balance (available: %, requested: %)', COALESCE(current_credit, 0), _store_credit_used;
    END IF;
  END IF;

  -- 5. Calculate financial totals
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, variant_id text, name text, price numeric, mrp numeric, qty int, sku text, barcode text, color text, size text)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item %', item.qty, item.name;
    END IF;
    IF item.price IS NULL OR item.price < 0 THEN
      RAISE EXCEPTION 'Invalid price % for item %', item.price, item.name;
    END IF;
    computed_subtotal := computed_subtotal + (item.price * item.qty);
  END LOOP;

  -- Apply Discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    computed_discount := round((computed_subtotal * (_discount_value / 100.0)), 2);
  ELSIF _discount_type = 'fixed' AND _discount_value > 0 THEN
    computed_discount := LEAST(computed_subtotal, _discount_value);
  ELSIF _discount > 0 THEN
    computed_discount := LEAST(computed_subtotal, _discount);
  END IF;

  computed_total := GREATEST(0, computed_subtotal - computed_discount);

  -- 6. Generate Sale Identifiers
  new_sale_number := public.generate_pos_sale_number();
  token_number := public.get_next_pos_token();

  -- 7. Insert into offline_sales
  INSERT INTO public.offline_sales (
    sale_number, customer_name, customer_phone, customer_email, customer_id,
    subtotal, discount, total, payment_method, status, notes, created_by,
    pos_token_number
  ) VALUES (
    new_sale_number,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    resolved_customer_id,
    computed_subtotal,
    computed_discount,
    computed_total,
    _payment_method,
    'completed',
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
        COALESCE(_notes, '') || ' [idem:' || _idempotency_key || ']'
      ELSE
        COALESCE(_notes, '')
    END,
    uid,
    token_number
  ) RETURNING id INTO new_sale_id;

  -- 8. Deduct Inventory & Record Items
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, variant_id text, name text, price numeric, mrp numeric, qty int, sku text, barcode text, color text, size text)
  LOOP
    IF item.product_id IS NOT NULL AND item.product_id != 'custom-item' THEN
      SELECT id, name, stock INTO prod
      FROM public.products
      WHERE id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        UPDATE public.products
        SET stock = stock - item.qty, updated_at = now()
        WHERE id = prod.id;

        INSERT INTO public.inventory_transactions (
          product_id, type, quantity, previous_quantity, new_quantity,
          reference_type, reference_id, note, created_by
        ) VALUES (
          prod.id, 'sale'::public.inventory_tx_type, -item.qty,
          prod.stock, prod.stock - item.qty,
          'pos_sale', new_sale_id,
          'POS Sale #' || new_sale_number, uid
        );
      END IF;
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, name, sku, barcode, color, size, qty, price, mrp
    ) VALUES (
      new_sale_id,
      CASE WHEN item.product_id = 'custom-item' THEN NULL ELSE item.product_id::uuid END,
      item.name,
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      COALESCE(item.color, ''),
      COALESCE(item.size, ''),
      item.qty,
      item.price,
      COALESCE(item.mrp, item.price)
    );
  END LOOP;

  -- 9. Deduct Store Credit if Used
  IF _store_credit_used > 0 AND resolved_customer_id IS NOT NULL THEN
    new_credit := current_credit - _store_credit_used;
    UPDATE public.pos_customers
    SET store_credit_balance = new_credit, updated_at = now()
    WHERE id = resolved_customer_id;

    INSERT INTO public.store_credit_ledger (
      customer_id, customer_phone, customer_name, credit_token,
      type, amount, balance_before, balance_after,
      used_in_sale_id, notes, created_by
    ) VALUES (
      resolved_customer_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(trim(_customer_name), 'Customer'),
      COALESCE(v_credit_token, 'POS-USE'),
      'CREDIT_USED',
      _store_credit_used,
      current_credit,
      new_credit,
      new_sale_id,
      'Store credit redeemed in #' || new_sale_number,
      uid
    );
  END IF;

  -- 10. Update Customer Metrics
  IF resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spend = total_spend + computed_total,
        total_spent = total_spent + computed_total,
        total_purchases = total_purchases + 1,
        total_visits = total_visits + 1,
        updated_at = now()
    WHERE id = resolved_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'token_number', token_number,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'store_credit_used', _store_credit_used,
    'remaining_credit', new_credit,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role, anon;
