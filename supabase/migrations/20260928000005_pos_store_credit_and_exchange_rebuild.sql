-- =====================================================================
-- Migration: 20260928000005_pos_store_credit_and_exchange_rebuild.sql
-- Description:
-- 1. Create immutable store_credit_ledger for full auditability
-- 2. Add store_credit_balance to pos_customers and profiles
-- 3. Add store_credit_used and credit_token to offline_sales and offline_returns
-- 4. Update process_offline_return to enforce 100% Exchange Credit / Store Credit model
-- 5. Update place_offline_sale to support Store Credit tender settlement
-- 6. Add get_customer_store_credit helper RPC
-- =====================================================================

-- 1. Create Sequence for Credit Tokens
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

-- 2. Add Balance & Reference Columns
ALTER TABLE public.pos_customers
  ADD COLUMN IF NOT EXISTS store_credit_balance numeric NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS store_credit_balance numeric NOT NULL DEFAULT 0;

ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS store_credit_used numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_token_used text DEFAULT NULL;

ALTER TABLE public.offline_returns
  ADD COLUMN IF NOT EXISTS credit_token text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL;

-- 3. Immutable Store Credit Ledger Table
CREATE TABLE IF NOT EXISTS public.store_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_phone text NOT NULL DEFAULT '',
  customer_name text NOT NULL DEFAULT 'Walk-in Customer',
  credit_token text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('CREDIT_ISSUED', 'CREDIT_USED', 'CREDIT_ADJUSTED')),
  amount numeric NOT NULL CHECK (amount > 0),
  balance_before numeric NOT NULL DEFAULT 0 CHECK (balance_before >= 0),
  balance_after numeric NOT NULL DEFAULT 0 CHECK (balance_after >= 0),
  source_return_id uuid REFERENCES public.offline_returns(id) ON DELETE SET NULL,
  used_in_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_customer ON public.store_credit_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_phone ON public.store_credit_ledger(customer_phone);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_token ON public.store_credit_ledger(credit_token);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_created_at ON public.store_credit_ledger(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.store_credit_ledger TO authenticated;
GRANT ALL ON public.store_credit_ledger TO service_role;
ALTER TABLE public.store_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage store credit ledger" ON public.store_credit_ledger;
CREATE POLICY "staff manage store credit ledger" ON public.store_credit_ledger
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- 4. Helper RPC: Query Customer Store Credit Balance & Recent History
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
BEGIN
  -- 1. Try finding by customer_id
  IF v_cust_id IS NOT NULL THEN
    SELECT store_credit_balance, name INTO v_balance, v_cust_name
    FROM public.pos_customers
    WHERE id = v_cust_id;
  -- 2. Try finding by phone
  ELSIF length(v_clean_phone) >= 10 THEN
    SELECT id, store_credit_balance, name INTO v_cust_id, v_balance, v_cust_name
    FROM public.pos_customers
    WHERE phone = v_clean_phone OR phone = right(v_clean_phone, 10)
    LIMIT 1;
  -- 3. Try finding by credit_token
  ELSIF v_clean_token != '' THEN
    SELECT customer_id, balance_after, customer_name INTO v_cust_id, v_balance, v_cust_name
    FROM public.store_credit_ledger
    WHERE credit_token = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 4. Get recent ledger transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'balance_before', balance_before,
      'balance_after', balance_after,
      'credit_token', credit_token,
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
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, service_role;

-- 5. Canonical process_offline_return (100% Store Credit Model)
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
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token
    FROM public.offline_returns
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
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

  -- 4. Validate and compute total return credit
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

-- 6. Canonical place_offline_sale (with Store Credit Tender Support)
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
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  actual_credit_used numeric := 0;
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_token text := upper(trim(COALESCE(_credit_token, '')));
  item record;
  prod record;
  variant record;
  v_rec record;
  new_sale_id uuid;
  new_sale_number text;
  new_token_number integer;
  new_token_date date;
  item_count int := 0;
  final_notes text;
  v_prev_stock int;
  v_new_stock int;
  v_variant_uuid uuid;
  v_product_uuid uuid;
BEGIN
  -- 1. Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Idempotency check (prevent duplicate submissions)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, pos_token_number, pos_token_date, store_credit_used
    INTO new_sale_id, new_sale_number, computed_total, new_token_number, new_token_date, actual_credit_used
    FROM public.offline_sales
    WHERE notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
       OR idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF new_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'sale_id', new_sale_id,
        'sale_number', new_sale_number,
        'total', computed_total,
        'store_credit_used', actual_credit_used,
        'pos_token_number', new_token_number,
        'pos_token_date', new_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Sale cart must have at least one product';
  END IF;

  -- 4. Validate and compute subtotal
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, variant_id text, product_slug text, name text, sku text, qty int, price numeric, custom_price numeric)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity for item %', COALESCE(item.name, item.product_slug, 'item');
    END IF;

    IF item.product_slug IS NOT NULL AND item.product_slug LIKE 'custom-%' THEN
      IF item.custom_price IS NULL OR item.custom_price <= 0 THEN
        RAISE EXCEPTION 'Custom items must have a positive price';
      END IF;
      computed_subtotal := computed_subtotal + (item.custom_price * item.qty);
    ELSE
      -- Resolve variant if provided
      v_variant_uuid := NULL;
      IF item.variant_id IS NOT NULL AND item.variant_id != '' AND item.variant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_variant_uuid := item.variant_id::uuid;
      END IF;

      -- Resolve product if provided
      v_product_uuid := NULL;
      IF item.product_id IS NOT NULL AND item.product_id != '' AND item.product_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_product_uuid := item.product_id::uuid;
      END IF;

      IF v_variant_uuid IS NOT NULL THEN
        SELECT v.id AS v_id, v.product_id AS p_id, v.stock, COALESCE(v.price_override, p.price) AS selling_price,
               v.sku AS v_sku, v.barcode AS v_barcode, v.color AS v_color, v.size AS v_size,
               p.name AS p_name, p.slug AS p_slug, p.stock AS p_stock, p.is_active
        INTO variant
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = v_variant_uuid
        FOR UPDATE OF v;

        IF variant.v_id IS NOT NULL THEN
          IF NOT variant.is_active THEN
            RAISE EXCEPTION 'Product "%" is archived and cannot be sold', variant.p_name;
          END IF;
          IF variant.stock < item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%". Available: %, Requested: %', variant.p_name, variant.stock, item.qty;
          END IF;
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, variant.selling_price) * item.qty);
        ELSE
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, 0) * item.qty);
        END IF;
      ELSIF v_product_uuid IS NOT NULL THEN
        SELECT id, name, slug, price, stock, is_active
        INTO prod
        FROM public.products
        WHERE id = v_product_uuid
        FOR UPDATE;

        IF prod.id IS NOT NULL THEN
          IF NOT prod.is_active THEN
            RAISE EXCEPTION 'Product "%" is archived and cannot be sold', prod.name;
          END IF;
          IF prod.stock < item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%". Available: %, Requested: %', prod.name, prod.stock, item.qty;
          END IF;
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, prod.price) * item.qty);
        ELSE
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, 0) * item.qty);
        END IF;
      ELSIF item.product_slug IS NOT NULL AND item.product_slug != '' THEN
        SELECT id, name, slug, price, stock, is_active
        INTO prod
        FROM public.products
        WHERE slug = item.product_slug
        FOR UPDATE;

        IF prod.id IS NOT NULL THEN
          IF NOT prod.is_active THEN
            RAISE EXCEPTION 'Product "%" is archived and cannot be sold', prod.name;
          END IF;
          IF prod.stock < item.qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%". Available: %, Requested: %', prod.name, prod.stock, item.qty;
          END IF;
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, prod.price) * item.qty);
        ELSE
          computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, 0) * item.qty);
        END IF;
      ELSE
        computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price, 0) * item.qty);
      END IF;
    END IF;
  END LOOP;

  IF computed_subtotal <= 0 THEN
    RAISE EXCEPTION 'Order subtotal must be greater than zero';
  END IF;

  -- 5. Compute discount
  IF _discount_type = 'percentage' THEN
    IF _discount_value < 0 OR _discount_value > 100 THEN
      RAISE EXCEPTION 'Percentage discount must be between 0 and 100';
    END IF;
    computed_discount := ROUND(computed_subtotal * _discount_value / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    IF _discount_value < 0 THEN
      RAISE EXCEPTION 'Discount cannot be negative';
    END IF;
    computed_discount := LEAST(_discount_value, computed_subtotal);
  ELSE
    computed_discount := 0;
  END IF;

  IF _discount_type = 'none' AND _discount > 0 THEN
    computed_discount := LEAST(_discount, computed_subtotal);
  END IF;

  computed_total := GREATEST(0, computed_subtotal - computed_discount);

  -- 6. Store Credit Tender Validation & Application
  IF _store_credit_used > 0 THEN
    -- Resolve customer record for credit deduction
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
    ELSIF v_clean_token != '' THEN
      SELECT customer_id, balance_after INTO v_resolved_cust_id, v_prev_credit
      FROM public.store_credit_ledger
      WHERE credit_token = v_clean_token
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_resolved_cust_id IS NOT NULL THEN
        SELECT store_credit_balance INTO v_prev_credit
        FROM public.pos_customers
        WHERE id = v_resolved_cust_id
        FOR UPDATE;
      END IF;
    END IF;

    v_prev_credit := COALESCE(v_prev_credit, 0);
    IF _store_credit_used > v_prev_credit THEN
      RAISE EXCEPTION 'Requested store credit (₹%) exceeds available balance (₹%)', _store_credit_used, v_prev_credit;
    END IF;

    -- Store credit cannot exceed the final payable total
    actual_credit_used := LEAST(_store_credit_used, computed_total);
    v_new_credit := v_prev_credit - actual_credit_used;
  END IF;

  -- 7. Generate sequential sale number & daily token number (IST)
  new_sale_number := public.generate_pos_sale_number();
  new_token_date := public.current_ist_date();

  INSERT INTO public.pos_daily_token_seq (token_date, last_token)
  VALUES (new_token_date, 1)
  ON CONFLICT (token_date) DO UPDATE
    SET last_token = pos_daily_token_seq.last_token + 1
  RETURNING last_token INTO new_token_number;

  final_notes := COALESCE(_notes, '');
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    final_notes := final_notes || ' [idem:' || trim(_idempotency_key) || ']';
  END IF;

  -- 8. Insert into public.offline_sales
  new_sale_id := gen_random_uuid();
  INSERT INTO public.offline_sales (
    id, sale_number, customer_name, customer_phone, customer_email,
    payment_method, notes, subtotal, discount, total,
    discount_type, discount_value, customer_id, created_by,
    pos_token_number, pos_token_date, idempotency_key, status,
    store_credit_used, credit_token_used
  ) VALUES (
    new_sale_id,
    new_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(_payment_method, 'cash'),
    final_notes,
    computed_subtotal,
    computed_discount,
    computed_total,
    COALESCE(_discount_type, 'none'),
    COALESCE(_discount_value, 0),
    v_resolved_cust_id,
    uid,
    new_token_number,
    new_token_date,
    COALESCE(NULLIF(trim(_idempotency_key), ''), NULL),
    'completed',
    actual_credit_used,
    v_clean_token
  );

  -- 9. Insert offline sale items & perform inventory deduction
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id text, variant_id text, product_slug text, name text, sku text, qty int, price numeric, custom_price numeric)
  LOOP
    IF item.product_slug IS NOT NULL AND item.product_slug LIKE 'custom-%' THEN
      INSERT INTO public.offline_sale_items (
        sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
        variant_info, mrp_snapshot, barcode_snapshot
      ) VALUES (
        new_sale_id, NULL, item.product_slug,
        COALESCE(item.name, 'Custom Item'), 'CUSTOM',
        item.custom_price, item.qty, (item.custom_price * item.qty),
        '', item.custom_price, ''
      );
    ELSE
      v_variant_uuid := NULL;
      IF item.variant_id IS NOT NULL AND item.variant_id != '' AND item.variant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_variant_uuid := item.variant_id::uuid;
      END IF;

      v_product_uuid := NULL;
      IF item.product_id IS NOT NULL AND item.product_id != '' AND item.product_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_product_uuid := item.product_id::uuid;
      END IF;

      IF v_variant_uuid IS NOT NULL THEN
        SELECT v.id AS v_id, v.product_id AS p_id, v.stock, COALESCE(v.price_override, p.price) AS selling_price,
               v.mrp_override, v.sku AS v_sku, v.barcode AS v_barcode, v.color AS v_color, v.size AS v_size,
               p.name AS p_name, p.slug AS p_slug, p.stock AS p_stock, p.mrp AS p_mrp
        INTO variant
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = v_variant_uuid
        FOR UPDATE OF v;

        IF variant.v_id IS NOT NULL THEN
          v_prev_stock := variant.stock;
          v_new_stock := GREATEST(0, variant.stock - item.qty);

          UPDATE public.product_variants
          SET stock = v_new_stock
          WHERE id = variant.v_id;

          -- Also decrement parent product stock
          UPDATE public.products
          SET stock = GREATEST(0, stock - item.qty)
          WHERE id = variant.p_id;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity,
            new_quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            variant.p_id, variant.v_id, 'sale'::public.inventory_tx_type, item.qty,
            v_prev_stock, v_new_stock, 'offline_sale', new_sale_id,
            'POS Sale ' || new_sale_number, uid
          );

          INSERT INTO public.offline_sale_items (
            sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
            variant_info, mrp_snapshot, barcode_snapshot
          ) VALUES (
            new_sale_id, variant.p_id, variant.p_slug, variant.p_name,
            COALESCE(variant.v_sku, item.sku, ''), COALESCE(item.custom_price, item.price, variant.selling_price),
            item.qty, (COALESCE(item.custom_price, item.price, variant.selling_price) * item.qty),
            TRIM(COALESCE(variant.v_color, '') || ' ' || COALESCE(variant.v_size, '')),
            COALESCE(variant.mrp_override, variant.p_mrp, variant.selling_price),
            COALESCE(variant.v_barcode, '')
          );
        END IF;
      ELSIF v_product_uuid IS NOT NULL OR (item.product_slug IS NOT NULL AND item.product_slug != '') THEN
        SELECT id, name, slug, price, stock, mrp, sku, barcode
        INTO prod
        FROM public.products
        WHERE (v_product_uuid IS NOT NULL AND id = v_product_uuid)
           OR (v_product_uuid IS NULL AND slug = item.product_slug)
        FOR UPDATE;

        IF prod.id IS NOT NULL THEN
          v_prev_stock := prod.stock;
          v_new_stock := GREATEST(0, prod.stock - item.qty);

          UPDATE public.products
          SET stock = v_new_stock
          WHERE id = prod.id;

          SELECT id, stock INTO v_rec
          FROM public.product_variants
          WHERE product_id = prod.id
            AND (sku ILIKE prod.sku OR barcode = prod.barcode OR name = 'Default')
          LIMIT 1
          FOR UPDATE;

          IF v_rec.id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = GREATEST(0, stock - item.qty)
            WHERE id = v_rec.id;
          END IF;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity,
            new_quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            prod.id, v_rec.id, 'sale'::public.inventory_tx_type, item.qty,
            v_prev_stock, v_new_stock, 'offline_sale', new_sale_id,
            'POS Sale ' || new_sale_number, uid
          );

          INSERT INTO public.offline_sale_items (
            sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
            variant_info, mrp_snapshot, barcode_snapshot
          ) VALUES (
            new_sale_id, prod.id, prod.slug, prod.name,
            COALESCE(prod.sku, item.sku, ''), COALESCE(item.custom_price, item.price, prod.price),
            item.qty, (COALESCE(item.custom_price, item.price, prod.price) * item.qty),
            '', COALESCE(prod.mrp, prod.price), COALESCE(prod.barcode, '')
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 10. Deduct Store Credit from Customer Record & Append to Immutable Ledger
  IF actual_credit_used > 0 THEN
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
      used_in_sale_id,
      notes,
      created_by
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(trim(_customer_phone), ''),
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(v_clean_token, ''),
      'CREDIT_USED',
      actual_credit_used,
      v_prev_credit,
      v_new_credit,
      new_sale_id,
      'Applied on POS Sale #' || new_sale_number,
      uid
    );
  END IF;

  -- 11. Update Customer Total Purchases & Spend (Cash + Credit Paid)
  IF v_resolved_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + computed_total,
        updated_at = now()
    WHERE id = v_resolved_cust_id;
  END IF;

  -- 12. Return Result
  RETURN jsonb_build_object(
    'success', true,
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'total', computed_total,
    'store_credit_used', actual_credit_used,
    'cash_payable', GREATEST(0, computed_total - actual_credit_used),
    'remaining_credit', v_new_credit,
    'pos_token_number', new_token_number,
    'pos_token_date', new_token_date,
    'items_count', item_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role;
