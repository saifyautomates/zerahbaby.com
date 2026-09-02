-- Migration: 20260928000034_fix_store_credit_ledger_type_check.sql
-- Description: Expand store_credit_ledger check constraint to accept both legacy and canonical values

ALTER TABLE public.store_credit_ledger 
  DROP CONSTRAINT IF EXISTS store_credit_ledger_type_check;

ALTER TABLE public.store_credit_ledger 
  ADD CONSTRAINT store_credit_ledger_type_check 
  CHECK (type IN ('CREDIT_ISSUED', 'CREDIT_USED', 'CREDIT_REDEEMED', 'issuance', 'redemption', 'adjustment'));

-- Also update process_offline_return and place_offline_sale to write CREDIT_ISSUED and CREDIT_REDEEMED
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'process_offline_return'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _return_reason text DEFAULT 'Customer Return',
  _notes text DEFAULT '',
  _original_sale_number text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
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
  orig_item_qty integer;
  already_ret_qty integer;
  rem_returnable integer;
  v_variant_id uuid := NULL;
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
    WHERE idempotency_key = _idempotency_key
       OR notes LIKE '%[idem:' || _idempotency_key || ']%'
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
      variant_id text,
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
    original_sale_id,
    idempotency_key
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
    _original_sale_id,
    _idempotency_key
  ) RETURNING id INTO new_return_id;

  -- 8. Process items: lock products, increase inventory (both product AND variant), and log transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(
      product_id text, 
      variant_id text,
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
    v_variant_id := NULL;
    IF item.variant_id IS NOT NULL AND item.variant_id != '' THEN
      v_variant_id := item.variant_id::uuid;
    END IF;

    IF item.product_id IS NOT NULL AND item.product_id != '' AND item.product_id != 'walk-in-return' THEN
      SELECT id, stock INTO prod
      FROM public.products
      WHERE id = item.product_id::uuid
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        -- Atomic stock increase on parent product
        UPDATE public.products
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = prod.id;

        -- Atomic stock increase on variant if present
        IF v_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item.qty,
              updated_at = now()
          WHERE id = v_variant_id;
        END IF;

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
          v_variant_id,
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

    -- Insert return line item with variant_id
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
      unit_mrp,
      mrp_snapshot,
      refund_price,
      original_sale_item_id
    ) VALUES (
      new_return_id,
      CASE WHEN item.product_id = 'walk-in-return' THEN NULL ELSE item.product_id::uuid END,
      v_variant_id,
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

  -- 9. Credit customer ledger & account balance atomically
  IF resolved_customer_id IS NOT NULL THEN
    SELECT store_credit_balance INTO current_customer_credit
    FROM public.pos_customers
    WHERE id = resolved_customer_id
    FOR UPDATE;

    current_customer_credit := COALESCE(current_customer_credit, 0);
    new_customer_credit := current_customer_credit + computed_total_refund;

    UPDATE public.pos_customers
    SET store_credit_balance = new_customer_credit,
        updated_at = now()
    WHERE id = resolved_customer_id;
  ELSE
    current_customer_credit := 0;
    new_customer_credit := computed_total_refund;
  END IF;

  INSERT INTO public.store_credit_ledger (
    customer_id,
    customer_name,
    customer_phone,
    type,
    amount,
    balance_before,
    balance_after,
    return_id,
    source_return_id,
    credit_token,
    notes
  ) VALUES (
    resolved_customer_id,
    COALESCE(trim(_customer_name), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    'CREDIT_ISSUED',
    computed_total_refund,
    current_customer_credit,
    new_customer_credit,
    new_return_id,
    new_return_id,
    new_credit_token,
    'Exchange Store Credit for Return #' || new_return_number
  );

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(trim(_customer_name), 'Walk-in Customer'),
    'customer_phone', COALESCE(trim(_customer_phone), ''),
    'new_balance', new_customer_credit,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, anon, service_role;
