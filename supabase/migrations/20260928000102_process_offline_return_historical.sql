-- ==============================================================================
-- Migration: 20260928000102_process_offline_return_historical.sql
-- Description:
--   Rewrite process_offline_return to:
--   1. For invoice-linked returns (original_sale_item_id provided):
--      a. Lock the offline_sale_items row with FOR UPDATE (race-condition safe)
--      b. Validate: quantity_returned + item_qty <= quantity_sold
--      c. Calculate refund from historical final_unit_paid_price (NOT frontend price)
--      d. Atomically increment quantity_returned on the sale item row
--
--   2. For walk-in barcode returns (no original_sale_item_id):
--      a. Warn in logs, trust refund_price from frontend (backward compatible)
--      b. Do NOT increment quantity_returned (no original line to track)
--
-- UNCHANGED: voucher issuance, store credit ledger, stock restock, inventory tx.
-- ==============================================================================

-- Drop all existing signatures cleanly
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'process_offline_return'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END;
$$;

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
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;

  -- Item-level variables
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

  -- Historical sale item snapshot
  v_sale_item record;
  v_historical_paid numeric;

  -- Running totals
  computed_total_refund numeric := 0;
  item_count int := 0;

  -- Product / stock helpers
  v_prod record;
  v_prev_stock int;
  v_new_stock int;
  v_total_var_stock int;

  -- Return record
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;

  -- Customer credit
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');

  -- Sale linkage
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
BEGIN
  -- 1. Authorization check
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

  -- 2. Idempotency check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, expires_at
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token, v_expiry_date
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
       OR notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;

    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'credit_token', new_credit_token,
        'expires_at', v_expiry_date,
        'customer_name', _customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with no items specified';
  END IF;

  -- 4. ── HISTORICAL PRICE VALIDATION & REFUND CALCULATION ──────────────────
  --    For each item:
  --      a) If original_sale_item_id is provided → lock row, validate qty, use historical price
  --      b) If no original_sale_item_id → trust frontend refund_price (walk-in fallback)
  computed_total_refund := 0;
  item_count := 0;

  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity % for item %', item_qty, COALESCE(elem->>'name', 'Unknown');
    END IF;

    -- Parse original_sale_item_id
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

    IF item_orig_sale_item_id IS NOT NULL THEN
      -- ── INVOICE-LINKED RETURN: validate against historical snapshot ────────
      SELECT *
      INTO v_sale_item
      FROM public.offline_sale_items
      WHERE id = item_orig_sale_item_id
      FOR UPDATE;  -- Prevent concurrent over-return (race condition safe)

      IF v_sale_item.id IS NULL THEN
        RAISE EXCEPTION 'Original sale item % not found', item_orig_sale_item_id;
      END IF;

      -- Validate returnable quantity
      IF (v_sale_item.quantity_returned + item_qty) > v_sale_item.quantity_sold THEN
        RAISE EXCEPTION 'Over-return attempt: item "%" has % sold, % already returned, cannot return % more',
          v_sale_item.name,
          v_sale_item.quantity_sold,
          v_sale_item.quantity_returned,
          item_qty;
      END IF;

      -- Use HISTORICAL net paid price — NEVER the frontend value
      v_historical_paid := COALESCE(
        NULLIF(v_sale_item.final_unit_paid_price, 0),
        v_sale_item.price  -- fallback for pre-migration rows that have price but no snapshot
      );

      item_refund_price := v_historical_paid;
      item_mrp := COALESCE(NULLIF(v_sale_item.unit_mrp, 0), v_sale_item.price);
      item_name := v_sale_item.name;
      item_sku := v_sale_item.sku;
      item_barcode := COALESCE(v_sale_item.barcode, '');
      item_slug := COALESCE(v_sale_item.product_slug, '');
      item_variant_info := COALESCE(v_sale_item.variant_info, '');

      BEGIN
        item_product_id := v_sale_item.product_id;
      EXCEPTION WHEN OTHERS THEN
        item_product_id := NULL;
      END;

      BEGIN
        item_variant_id := v_sale_item.variant_id;
      EXCEPTION WHEN OTHERS THEN
        item_variant_id := NULL;
      END;

      -- Atomically increment quantity_returned on the sale item
      UPDATE public.offline_sale_items
      SET quantity_returned = quantity_returned + item_qty
      WHERE id = item_orig_sale_item_id;

    ELSE
      -- ── WALK-IN RETURN (no invoice): trust frontend price ─────────────────
      RAISE WARNING 'process_offline_return: no original_sale_item_id for item "%". Using frontend refund_price as fallback.',
        COALESCE(elem->>'name', 'Unknown');

      item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
      IF item_refund_price < 0 THEN
        RAISE EXCEPTION 'Invalid refund price % for item %', item_refund_price, COALESCE(elem->>'name', 'Unknown');
      END IF;

      item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
      item_name := COALESCE(elem->>'name', 'Returned Item');
      item_sku := COALESCE(elem->>'sku', '');
      item_barcode := COALESCE(elem->>'barcode', '');
      item_slug := COALESCE(elem->>'product_slug', '');
      item_variant_info := COALESCE(elem->>'variant_info', '');

      BEGIN
        item_product_id := (elem->>'product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_product_id := NULL;
      END;

      BEGIN
        item_variant_id := (elem->>'variant_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_variant_id := NULL;
      END;
    END IF;

    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
    item_count := item_count + item_qty;
  END LOOP;

  computed_total_refund := GREATEST(0, COALESCE(computed_total_refund, 0));

  -- 5. Generate return number & voucher token
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := public.generate_unique_exchange_credit_token();
  v_expiry_date := now() + interval '7 days';

  -- 6. Resolve original sale linkage
  v_clean_sale_id := CASE
    WHEN _original_sale_id IS NULL OR _original_sale_id = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL
    ELSE _original_sale_id
  END;

  IF v_clean_sale_id IS NOT NULL THEN
    SELECT sale_number INTO v_orig_sale_number
    FROM public.offline_sales
    WHERE id = v_clean_sale_id;

    IF v_orig_sale_number IS NULL THEN
      v_clean_sale_id := NULL;
    END IF;
  END IF;

  -- 7. Resolve or upsert customer
  IF v_resolved_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0)
    INTO v_resolved_cust_id, v_prev_credit
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

  -- 8. Insert Return Header Record
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_status,
    return_reason,
    notes,
    refund_amount,
    credit_used,
    credit_balance,
    credit_token,
    credit_token_status,
    expires_at,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
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
    0,
    COALESCE(computed_total_refund, 0),
    new_credit_token,
    'ACTIVE',
    v_expiry_date,
    _idempotency_key,
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 9. Insert Return Items & Restore Stock
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      item_product_id := (elem->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_product_id := NULL;
    END;

    BEGIN
      item_variant_id := (elem->>'variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_variant_id := NULL;
    END;

    item_qty := COALESCE((elem->>'qty')::int, 1);

    -- Re-derive refund price for this item (same logic as step 4)
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

    IF item_orig_sale_item_id IS NOT NULL THEN
      -- Fetch the (already-updated) sale item for snapshot values
      SELECT * INTO v_sale_item FROM public.offline_sale_items WHERE id = item_orig_sale_item_id;
      v_historical_paid := COALESCE(NULLIF(v_sale_item.final_unit_paid_price, 0), v_sale_item.price);
      item_refund_price := v_historical_paid;
      item_mrp := COALESCE(NULLIF(v_sale_item.unit_mrp, 0), v_sale_item.price);
      item_name := v_sale_item.name;
      item_sku := v_sale_item.sku;
      item_barcode := COALESCE(v_sale_item.barcode, '');
      item_slug := COALESCE(v_sale_item.product_slug, '');
      item_variant_info := COALESCE(v_sale_item.variant_info, '');
      item_product_id := v_sale_item.product_id;
      item_variant_id := v_sale_item.variant_id;
    ELSE
      item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
      item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
      item_name := COALESCE(elem->>'name', 'Returned Item');
      item_sku := COALESCE(elem->>'sku', '');
      item_barcode := COALESCE(elem->>'barcode', '');
      item_slug := COALESCE(elem->>'product_slug', '');
      item_variant_info := COALESCE(elem->>'variant_info', '');
    END IF;

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
      refund_price,
      mrp,
      unit_mrp,
      subtotal,
      original_sale_item_id,
      created_at
    ) VALUES (
      new_return_id,
      item_product_id,
      item_variant_id,
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

    -- Stock restoration (UNCHANGED)
    IF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        IF item_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE id = item_variant_id;

          SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
          FROM public.product_variants
          WHERE product_id = item_product_id;

          UPDATE public.products
          SET stock = v_total_var_stock,
              updated_at = now()
          WHERE id = item_product_id;
        ELSE
          UPDATE public.products
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE id = item_product_id;
        END IF;

        v_new_stock := v_prev_stock + item_qty;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          type,
          transaction_type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          note,
          notes,
          created_by
        ) VALUES (
          item_product_id,
          item_variant_id,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 10. Update Store Credit Ledger & Customer Balance (UNCHANGED)
  IF computed_total_refund > 0 THEN
    IF v_resolved_cust_id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit
      FROM public.pos_customers WHERE id = v_resolved_cust_id FOR UPDATE;
      v_prev_credit := COALESCE(v_prev_credit, 0);
      v_new_credit := v_prev_credit + computed_total_refund;

      UPDATE public.pos_customers
      SET store_credit_balance = v_new_credit,
          store_credit = v_new_credit,
          updated_at = now()
      WHERE id = v_resolved_cust_id;
    END IF;

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
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_prev_credit + computed_total_refund,
      new_credit_token,
      new_return_id,
      'Exchange voucher issued via Return #' || new_return_number || ' (Token: ' || new_credit_token || ', Valid 7 days)',
      uid
    );
  END IF;

  -- 11. Update linked sale's return_status summary
  IF v_clean_sale_id IS NOT NULL THEN
    UPDATE public.offline_sales
    SET return_status = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM public.offline_sale_items
            WHERE sale_id = v_clean_sale_id
              AND quantity_returned < quantity_sold
          ) THEN 'returned'
          WHEN EXISTS (
            SELECT 1 FROM public.offline_sale_items
            WHERE sale_id = v_clean_sale_id
              AND quantity_returned > 0
          ) THEN 'partially_returned'
          ELSE 'none'
        END,
        updated_at = now()
    WHERE id = v_clean_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', _customer_name,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
