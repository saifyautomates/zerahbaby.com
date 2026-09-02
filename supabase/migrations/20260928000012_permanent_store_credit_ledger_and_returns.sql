-- ==============================================================================
-- Migration: 20260928000012_permanent_store_credit_ledger_and_returns.sql
-- Description:
-- 1. Ensure store_credit_ledger columns are fully forgiving and compatible
-- 2. Ensure process_offline_return RPC writes strictly to canonical store_credit_ledger columns
-- ==============================================================================

-- 1. store_credit_ledger schema extensions for backwards & forwards compatibility
ALTER TABLE public.store_credit_ledger ADD COLUMN IF NOT EXISTS return_id uuid;
ALTER TABLE public.store_credit_ledger ADD COLUMN IF NOT EXISTS change_amount numeric;
ALTER TABLE public.store_credit_ledger ADD COLUMN IF NOT EXISTS entry_type text;

-- 2. Drop any legacy overloaded signatures
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb);

-- 3. Canonical single process_offline_return RPC
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
BEGIN
  -- 1. Authentication & Admin/Staff Verification
  uid := auth.uid();
  IF uid IS NOT NULL THEN
    SELECT role INTO user_role FROM public.user_roles WHERE user_id = uid LIMIT 1;
    IF user_role IS NULL OR user_role NOT IN ('admin', 'staff', 'manager', 'owner') THEN
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true) THEN
        RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
      END IF;
    END IF;
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

  -- 3. Validate items payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with no items specified';
  END IF;

  -- 4. Calculate total refund strictly server-side
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item %', item.qty, item.name;
    END IF;
    IF item.refund_price IS NULL OR item.refund_price < 0 THEN
      RAISE EXCEPTION 'Invalid refund price % for item %', item.refund_price, item.name;
    END IF;
    computed_total_refund := computed_total_refund + (item.refund_price * item.qty);
  END LOOP;

  -- 5. Customer identity resolution
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

  -- 6. Generate return identifier & unique store credit voucher token
  new_return_number := public.generate_pos_return_number();
  new_credit_token := 'ZCR-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));

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
    credit_token
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
    new_credit_token
  ) RETURNING id INTO new_return_id;

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
        UPDATE public.products
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = prod.id;

        -- Canonical insertion into public.inventory_transactions using valid columns
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
      mrp_snapshot,
      refund_price
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
      item.refund_price
    );
  END LOOP;

  -- 9. Update Customer Store Credit Balance & Append to Immutable Ledger
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
        COALESCE(trim(_customer_name), 'Customer'),
        new_credit_token,
        'CREDIT_ISSUED',
        computed_total_refund,
        COALESCE(current_customer_credit, 0),
        new_customer_credit,
        new_return_id,
        new_return_id,
        computed_total_refund,
        'CREDIT_ISSUED',
        'Return voucher issued for #' || new_return_number,
        uid
      );
    END IF;
  END IF;

  -- 10. Return detailed success JSON payload
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', _customer_name,
    'customer_credit_balance', new_customer_credit,
    'items_restocked', jsonb_array_length(_items)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, service_role, anon;
