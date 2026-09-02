-- ==============================================================================
-- POS EXCHANGE CREDIT, RETURN LIFECYCLE & SALES HISTORY RECONCILIATION
-- Migration: 20260928000044_pos_exchange_credit_and_sales_history_reconciliation.sql
-- 
-- 1. Adds return_status ('none', 'partially_returned', 'returned'), returned_amount,
--    and returned_units to public.offline_sales.
-- 2. Adds credit_used, credit_balance, linked_sale_id, and original_sale_number
--    to public.offline_returns.
-- 3. Hardens process_offline_return RPC:
--    - Enforces returnable quantity validation (prevents over-returning).
--    - Enforces return price validation against original sale item price.
--    - Restocks product & variant stock atomically (+qty).
--    - Records 'return' in inventory_transactions.
--    - Automatically updates offline_sales.return_status ('returned' / 'partially_returned').
--    - Issues credit token (CR-YYMM-XXXXX) and logs immutable CREDIT_ISSUED in store_credit_ledger.
-- 4. Hardens place_offline_sale RPC:
--    - Atomic row-level locking (FOR UPDATE) on customer credit to prevent concurrent double-spend.
--    - Enforces credit application as tender settlement (total remains full ₹800).
--    - Deducts credit from customer balance and offline_returns.credit_balance.
--    - Links replacement sale in offline_returns.linked_sale_id.
--    - Logs immutable CREDIT_USED in store_credit_ledger with used_in_sale_id.
-- 5. Upgrades get_customer_store_credit RPC to return token details & active vouchers.
-- ==============================================================================

-- 1. Schema Extensions on offline_sales
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS return_status text NOT NULL DEFAULT 'none' CHECK (return_status IN ('none', 'partially_returned', 'returned')),
  ADD COLUMN IF NOT EXISTS returned_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_units int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_offline_sales_return_status 
  ON public.offline_sales(return_status);

-- 2. Schema Extensions on offline_returns
ALTER TABLE public.offline_returns
  ADD COLUMN IF NOT EXISTS credit_used numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS linked_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_sale_number text;

CREATE INDEX IF NOT EXISTS idx_offline_returns_original_sale 
  ON public.offline_returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_offline_returns_linked_sale 
  ON public.offline_returns(linked_sale_id);
CREATE INDEX IF NOT EXISTS idx_offline_returns_credit_token 
  ON public.offline_returns(credit_token);

-- 3. Sequence for Credit Tokens if not exists
CREATE SEQUENCE IF NOT EXISTS public.pos_credit_token_seq START WITH 1001;

CREATE OR REPLACE FUNCTION public.generate_credit_token()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  seq_val bigint;
  prefix text;
BEGIN
  seq_val := nextval('public.pos_credit_token_seq');
  prefix := 'CR-' || to_char(now(), 'YYMM') || '-';
  RETURN prefix || lpad(seq_val::text, 5, '0');
END; $$;

-- 4. Canonical process_offline_return RPC
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
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  computed_total_refund numeric := 0;
  total_units_returning int := 0;
  item record;
  prod record;
  v_rec record;
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
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role IN ('admin', 'staff', 'manager', 'owner')
    ) THEN
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

  -- 3. Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return cart must have at least one product';
  END IF;

  -- 4. If original sale provided, validate sale and lock it
  IF _original_sale_id IS NOT NULL THEN
    SELECT id, sale_number, customer_id, customer_name, customer_phone, is_voided, total
    INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id
    FOR UPDATE;

    IF v_orig_sale.id IS NULL THEN
      RAISE EXCEPTION 'Original sale record not found';
    END IF;

    IF v_orig_sale.is_voided THEN
      RAISE EXCEPTION 'Cannot return items from a voided sale';
    END IF;

    IF v_resolved_cust_id IS NULL AND v_orig_sale.customer_id IS NOT NULL THEN
      v_resolved_cust_id := v_orig_sale.customer_id;
    END IF;

    -- Calculate total original units in sale
    SELECT COALESCE(SUM(qty), 0) INTO v_orig_total_units
    FROM public.offline_sale_items
    WHERE sale_id = _original_sale_id;
  END IF;

  -- 5. Validate return quantities and compute total return credit
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be at least 1';
    END IF;
    IF item.refund_price IS NULL OR item.refund_price < 0 THEN
      RAISE EXCEPTION 'Return price cannot be negative';
    END IF;

    total_units_returning := total_units_returning + item.qty;
    computed_total_refund := computed_total_refund + (item.refund_price * item.qty);

    -- Strict partial return validation against original sale
    IF _original_sale_id IS NOT NULL THEN
      SELECT id, qty, price INTO v_orig_item
      FROM public.offline_sale_items
      WHERE sale_id = _original_sale_id
        AND (
          (item.product_id IS NOT NULL AND product_id = item.product_id)
          OR (item.sku IS NOT NULL AND item.sku != '' AND sku = item.sku)
          OR (item.name IS NOT NULL AND name = item.name)
        )
      LIMIT 1;

      IF v_orig_item.id IS NULL THEN
        RAISE EXCEPTION 'Item "%" was not found in original sale #%', item.name, v_orig_sale.sale_number;
      END IF;

      -- Check price ceiling
      IF item.refund_price > v_orig_item.price THEN
        RAISE EXCEPTION 'Return price (₹%) cannot exceed original purchase price (₹%) for "%"',
          item.refund_price, v_orig_item.price, item.name;
      END IF;

      -- Compute already returned units for this item across past returns
      SELECT COALESCE(SUM(ri.qty), 0) INTO v_already_returned_qty
      FROM public.offline_return_items ri
      JOIN public.offline_returns r ON r.id = ri.return_id
      WHERE r.original_sale_id = _original_sale_id
        AND (
          (item.product_id IS NOT NULL AND ri.product_id = item.product_id)
          OR (item.sku IS NOT NULL AND item.sku != '' AND ri.sku = item.sku)
          OR (item.name IS NOT NULL AND ri.name = item.name)
        );

      IF (v_already_returned_qty + item.qty) > v_orig_item.qty THEN
        RAISE EXCEPTION 'Cannot return % units of "%". Only % units returnable (originally purchased %, already returned %)',
          item.qty, item.name, (v_orig_item.qty - v_already_returned_qty), v_orig_item.qty, v_already_returned_qty;
      END IF;
    END IF;
  END LOOP;

  -- 6. Resolve Customer Profile & Available Store Credit
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

  -- 7. Generate unique return reference & credit token
  new_return_id := gen_random_uuid();
  new_return_number := public.generate_pos_return_number();
  new_credit_token := public.generate_credit_token();

  -- 8. Insert offline return record with full audit linkage
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
    credit_balance,
    credit_used,
    original_sale_id,
    original_sale_number
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
    computed_total_refund, -- Full initial credit balance on voucher
    0, -- Credit used initially zero
    _original_sale_id,
    v_orig_sale.sale_number
  );

  -- 9. Process items: lock products, increase inventory, and log inventory transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.product_id IS NOT NULL THEN
      SELECT id, slug, stock, name, sku, barcode, is_active
      INTO prod
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        v_prev_stock := prod.stock;
        v_new_stock := prod.stock + item.qty;

        -- Atomic stock increment on parent product
        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
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
          SET stock = stock + item.qty,
              updated_at = now()
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
      item.product_id,
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

  -- 10. Update Original Sale return_status, returned_amount, returned_units
  IF _original_sale_id IS NOT NULL THEN
    SELECT COALESCE(SUM(ri.qty), 0), COALESCE(SUM(ri.qty * ri.refund_price), 0)
    INTO v_cumul_returned_units, v_cumul_returned_amount
    FROM public.offline_return_items ri
    JOIN public.offline_returns r ON r.id = ri.return_id
    WHERE r.original_sale_id = _original_sale_id;

    UPDATE public.offline_sales
    SET return_status = CASE 
          WHEN v_cumul_returned_units >= v_orig_total_units THEN 'returned'
          ELSE 'partially_returned'
        END,
        returned_amount = v_cumul_returned_amount,
        returned_units = v_cumul_returned_units,
        updated_at = now()
    WHERE id = _original_sale_id;
  END IF;

  -- 11. Update Customer Store Credit Balance & Append to Immutable Ledger
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
    'Issued on Return #' || new_return_number || CASE WHEN v_orig_sale.sale_number IS NOT NULL THEN ' (Orig Sale #' || v_orig_sale.sale_number || ')' ELSE '' END,
    uid
  );

  -- 12. Return response
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'available_credit', v_new_credit,
    'items_count', item_count,
    'original_sale_id', _original_sale_id,
    'original_sale_number', v_orig_sale.sale_number,
    'status', 'completed'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, anon, service_role;


-- 5. Canonical place_offline_sale RPC with Concurrency Lock & Replacement Sale Linkage
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'place_offline_sale'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

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
  v_prod_id uuid := NULL;
  v_prod_stock int := 0;
  v_buying_price numeric := 0;
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
  v_clean_token text := upper(trim(COALESCE(_credit_token, '')));
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_is_uuid boolean;
  v_is_var_uuid boolean;
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
    product_slug text,
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

  -- Final sale total remains the full value of goods purchased (e.g. ₹800)
  v_total := GREATEST(0, v_subtotal - v_discount);

  -- 5. Store Credit Validation, Row Locking & Tender Calculation
  IF v_clean_token != '' THEN
    SELECT id, customer_id, credit_balance
    INTO v_token_id, v_token_cust_id, v_token_balance
    FROM public.offline_returns
    WHERE credit_token = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_token_id IS NOT NULL THEN
      IF v_resolved_customer_id IS NULL AND v_token_cust_id IS NOT NULL THEN
        v_resolved_customer_id := v_token_cust_id;
      END IF;
    END IF;
  END IF;

  -- Lock customer record to prevent concurrent double-spend
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
    -- Credit is a payment tender: it cannot exceed total sale amount
    v_actual_credit_applied := LEAST(_store_credit_used, v_total);
  END IF;

  -- Additional payment due (Cash / UPI / Card)
  v_cash_payable := GREATEST(0, v_total - v_actual_credit_applied);

  -- 6. Generate Identifiers
  v_sale_num := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 100000)::text, 5, '0');
  v_order_token_dt := CURRENT_DATE;

  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  -- 7. Insert Sale Record (Total = Full ₹800, store_credit_used = ₹500)
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
    credit_token_used,
    pos_token_number,
    pos_token_date,
    return_status,
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
    CASE WHEN v_actual_credit_applied > 0 THEN v_clean_token ELSE NULL END,
    v_order_token_num,
    v_order_token_dt,
    'none',
    now()
  ) RETURNING id INTO v_sale_id;

  -- 8. Process Line Items, Deduct Inventory & Capture Historical Buying Price
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
    v_prod_id := NULL;
    v_prod_stock := 0;
    v_buying_price := 0;
    v_is_uuid := FALSE;
    v_is_var_uuid := FALSE;

    IF v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN
      v_is_uuid := (v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    IF v_item.variant_id IS NOT NULL AND v_item.variant_id != '' THEN
      v_is_var_uuid := (v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    IF v_is_uuid THEN
      SELECT id, stock INTO v_prod_id, v_prod_stock
      FROM public.products
      WHERE id = v_item.product_id::uuid
      FOR UPDATE;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' AND v_item.product_slug NOT LIKE 'custom-%' THEN
      SELECT id, stock INTO v_prod_id, v_prod_stock
      FROM public.products
      WHERE slug = v_item.product_slug
      FOR UPDATE;
    END IF;

    IF v_prod_id IS NOT NULL THEN
      UPDATE public.products
      SET stock = GREATEST(0, stock - v_item.qty),
          updated_at = now()
      WHERE id = v_prod_id;

      SELECT COALESCE(buying_price, 0) INTO v_buying_price
      FROM public.product_costs
      WHERE product_id = v_prod_id
      LIMIT 1;

      IF v_is_var_uuid AND v_item.variant_id != '00000000-0000-0000-0000-000000000000' THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - v_item.qty),
            updated_at = now()
        WHERE id = v_item.variant_id::uuid;
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
        note
      ) VALUES (
        v_prod_id,
        CASE 
          WHEN v_is_var_uuid AND v_item.variant_id != '00000000-0000-0000-0000-000000000000' THEN v_item.variant_id::uuid 
          ELSE NULL 
        END,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        v_prod_stock,
        GREATEST(0, v_prod_stock - v_item.qty),
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_num
      );
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      product_slug,
      name,
      sku,
      qty,
      price,
      subtotal,
      buying_price
    ) VALUES (
      v_sale_id,
      v_prod_id,
      COALESCE(v_item.product_slug, 'custom'),
      v_item.name,
      COALESCE(v_item.sku, ''),
      v_item.qty,
      COALESCE(v_item.custom_price, v_item.price, 0),
      (COALESCE(v_item.custom_price, v_item.price, 0) * v_item.qty),
      COALESCE(v_buying_price, 0)
    );
  END LOOP;

  -- 9. Deduct Store Credit from Customer & Voucher, Link Replacement Sale
  IF v_actual_credit_applied > 0 THEN
    IF v_resolved_customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_actual_credit_applied),
          updated_at = now()
      WHERE id = v_resolved_customer_id;
    END IF;

    -- Update offline_returns record (remaining credit & linked replacement sale)
    IF v_clean_token != '' THEN
      UPDATE public.offline_returns
      SET credit_used = credit_used + v_actual_credit_applied,
          credit_balance = GREATEST(0, credit_balance - v_actual_credit_applied),
          linked_sale_id = v_sale_id,
          updated_at = now()
      WHERE credit_token = v_clean_token;
    END IF;

    -- Append immutable CREDIT_USED audit record in store_credit_ledger
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      used_in_sale_id,
      credit_token,
      notes
    ) VALUES (
      v_resolved_customer_id,
      COALESCE(_customer_name, 'Customer'),
      COALESCE(_customer_phone, ''),
      'CREDIT_USED',
      v_actual_credit_applied,
      v_current_customer_credit,
      GREATEST(0, v_current_customer_credit - v_actual_credit_applied),
      v_sale_id,
      v_clean_token,
      'Applied to Replacement Sale #' || v_sale_num
    );
  END IF;

  -- 10. Update Customer Lifetime Metrics
  IF v_resolved_customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spent = COALESCE(total_spent, 0) + v_total,
        total_spend = COALESCE(total_spend, 0) + v_total,
        total_visits = COALESCE(total_visits, 0) + 1,
        updated_at = now()
    WHERE id = v_resolved_customer_id;
  END IF;

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
    'pos_token_number', v_order_token_num,
    'pos_token_date', v_order_token_dt,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, anon, service_role;


-- 6. Upgraded get_customer_store_credit Helper RPC
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname = 'get_customer_store_credit'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Walk-in Customer';
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  v_clean_token text := upper(trim(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
BEGIN
  -- 1. Search by customer_id
  IF v_cust_id IS NOT NULL THEN
    SELECT store_credit_balance, name INTO v_balance, v_cust_name
    FROM public.pos_customers
    WHERE id = v_cust_id;
  -- 2. Search by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, store_credit_balance, name INTO v_cust_id, v_balance, v_cust_name
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;
  -- 3. Search by credit_token on offline_returns
  ELSIF v_clean_token != '' THEN
    SELECT customer_id, credit_balance, customer_name INTO v_cust_id, v_balance, v_cust_name
    FROM public.offline_returns
    WHERE credit_token = v_clean_token
    LIMIT 1;

    -- Fallback to store_credit_ledger if needed
    IF v_cust_id IS NULL AND v_balance = 0 THEN
      SELECT customer_id, balance_after, customer_name INTO v_cust_id, v_balance, v_cust_name
      FROM public.store_credit_ledger
      WHERE credit_token = v_clean_token
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
  END IF;

  -- 4. Get active return vouchers with unspent credit
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'credit_token', r.credit_token,
      'refund_amount', r.refund_amount,
      'credit_used', r.credit_used,
      'credit_balance', r.credit_balance,
      'original_sale_id', r.original_sale_id,
      'original_sale_number', r.original_sale_number,
      'linked_sale_id', r.linked_sale_id,
      'created_at', r.created_at
    )
  ) INTO active_returns
  FROM public.offline_returns r
  WHERE (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
     OR (v_clean_token != '' AND r.credit_token = v_clean_token)
  ORDER BY r.created_at DESC;

  -- 5. Get recent ledger transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'balance_before', balance_before,
      'balance_after', balance_after,
      'credit_token', credit_token,
      'source_return_id', source_return_id,
      'used_in_sale_id', used_in_sale_id,
      'notes', notes,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO recent_history
  FROM (
    SELECT *
    FROM public.store_credit_ledger
    WHERE (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
       OR (length(v_clean_phone) >= 10 AND (customer_phone = v_clean_phone OR customer_phone = right(v_clean_phone, 10)))
       OR (v_clean_token != '' AND credit_token = v_clean_token)
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Walk-in Customer'),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', v_clean_token,
    'active_returns', COALESCE(active_returns, '[]'::jsonb),
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;
