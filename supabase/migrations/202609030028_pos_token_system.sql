-- ============================================================
-- POS CUSTOMER TOKEN SYSTEM
-- Migration: 202609030028_pos_token_system.sql
-- 
-- Adds a daily sequential token number to every completed
-- offline POS sale. Tokens reset to 1 each local business
-- day (Asia/Kolkata / IST, UTC+5:30).
--
-- Token generation is atomic, idempotent, and embedded inside
-- the existing place_offline_sale() RPC transaction.
-- ============================================================

-- ======================== DAILY TOKEN SEQUENCE TABLE =========
-- One row per business date. Monotonically incrementing counter.
-- Using IST date so tokens reset at midnight Kota time, not UTC.

CREATE TABLE IF NOT EXISTS public.pos_daily_token_seq (
  token_date date NOT NULL,
  last_token integer NOT NULL DEFAULT 0,
  CONSTRAINT pos_daily_token_seq_pkey PRIMARY KEY (token_date),
  CONSTRAINT pos_daily_token_seq_last_token_check CHECK (last_token >= 0)
);

COMMENT ON TABLE public.pos_daily_token_seq IS
  'Daily POS token counter. One row per business date (IST). last_token = highest token issued that day.';

GRANT SELECT, INSERT, UPDATE ON public.pos_daily_token_seq TO authenticated;
GRANT ALL ON public.pos_daily_token_seq TO service_role;

ALTER TABLE public.pos_daily_token_seq ENABLE ROW LEVEL SECURITY;

-- Only admins can read the sequence (no public access)
DROP POLICY IF EXISTS "admins manage pos daily token seq" ON public.pos_daily_token_seq;
CREATE POLICY "admins manage pos daily token seq"
  ON public.pos_daily_token_seq
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ======================== ADD TOKEN COLUMNS TO OFFLINE SALES ==

-- Token number: 1, 2, 3 ... resets daily
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS pos_token_number integer;

-- Business date used to assign the token (IST calendar date)
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS pos_token_date date;

-- ======================== INDEXES ============================

-- Fast lookup by token date (for analytics)
CREATE INDEX IF NOT EXISTS idx_offline_sales_token_date
  ON public.offline_sales (pos_token_date, pos_token_number)
  WHERE pos_token_date IS NOT NULL;

-- Fast lookup by token number (for customer display)
CREATE INDEX IF NOT EXISTS idx_offline_sales_token_number
  ON public.offline_sales (pos_token_number)
  WHERE pos_token_number IS NOT NULL;

-- ======================== UNIQUE CONSTRAINT (SOFT) ============
-- Within any business date, token numbers should be unique.
-- Using a partial unique index so NULLs (old/future offline sales
-- without tokens) are excluded and don't cause conflicts.

DROP INDEX IF EXISTS idx_offline_sales_token_unique;
CREATE UNIQUE INDEX idx_offline_sales_token_unique
  ON public.offline_sales (pos_token_date, pos_token_number)
  WHERE pos_token_date IS NOT NULL AND pos_token_number IS NOT NULL;

-- ======================== IST DATE HELPER ====================

CREATE OR REPLACE FUNCTION public.current_ist_date()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

COMMENT ON FUNCTION public.current_ist_date() IS
  'Returns the current calendar date in IST (Asia/Kolkata, UTC+5:30). Used for POS token date assignment.';

-- ======================== UPDATED place_offline_sale RPC ======
-- Atomically generates a daily sequential token number using the
-- pos_daily_token_seq counter table. Token is assigned inside
-- the same transaction as the sale insert, so it is impossible
-- to have a completed sale without a token once internet is available.
--
-- Idempotency: if the same idempotency_key was already processed,
-- return the existing sale (including its original token) without
-- generating a new one.

DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, numeric, jsonb, text, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text);

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
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  item record;
  prod record;
  new_sale_id uuid;
  new_sale_number text;
  new_token_number integer;
  new_token_date date;
  item_count int := 0;
  final_notes text;
BEGIN
  -- Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Only admins can create offline sales';
  END IF;

  -- Idempotency check (prevent double-submit)
  -- Return the existing sale with its ORIGINAL token if key was already processed.
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, sale_number, pos_token_number, pos_token_date
      INTO new_sale_id, new_sale_number, new_token_number, new_token_date
    FROM public.offline_sales
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
      AND created_by = uid
    LIMIT 1;

    IF new_sale_id IS NOT NULL THEN
      -- Return the existing sale — idempotent, token unchanged
      RETURN jsonb_build_object(
        'sale_id', new_sale_id,
        'sale_number', new_sale_number,
        'pos_token_number', new_token_number,
        'pos_token_date', new_token_date,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- Validate and compute subtotal from actual DB prices with row locking
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, qty int, custom_price numeric)
  LOOP
    IF item.product_slug IS NOT NULL AND item.product_slug LIKE 'custom-%' THEN
      -- Custom item (no DB product)
      IF item.custom_price IS NULL OR item.custom_price <= 0 THEN
        RAISE EXCEPTION 'Custom items must have a positive price';
      END IF;
      IF item.qty IS NULL OR item.qty <= 0 OR item.qty > 1000 THEN
        RAISE EXCEPTION 'Invalid quantity for custom item';
      END IF;
      computed_subtotal := computed_subtotal + (item.custom_price * item.qty);
    ELSE
      -- DB product — lock row to prevent race conditions
      IF item.product_id IS NOT NULL THEN
        SELECT id, slug, price, mrp, stock, name, sku, barcode, is_active
        INTO prod
        FROM public.products
        WHERE id = item.product_id
        FOR UPDATE;
      ELSE
        SELECT id, slug, price, mrp, stock, name, sku, barcode, is_active
        INTO prod
        FROM public.products
        WHERE slug = item.product_slug
        FOR UPDATE;
      END IF;

      IF prod.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', COALESCE(item.product_id::text, item.product_slug);
      END IF;

      IF NOT prod.is_active THEN
        RAISE EXCEPTION 'Product "%" is archived and cannot be sold', prod.name;
      END IF;

      IF item.qty IS NULL OR item.qty <= 0 OR item.qty > 1000 THEN
        RAISE EXCEPTION 'Invalid quantity for %: %', prod.name, item.qty;
      END IF;

      IF prod.stock < item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', prod.name, prod.stock, item.qty;
      END IF;

      computed_subtotal := computed_subtotal + (prod.price * item.qty);
    END IF;
  END LOOP;

  IF computed_subtotal <= 0 THEN
    RAISE EXCEPTION 'Order total must be greater than zero';
  END IF;

  -- Compute discount
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

  -- Also accept legacy _discount param if _discount_type is 'none'
  IF _discount_type = 'none' AND _discount > 0 THEN
    computed_discount := LEAST(_discount, computed_subtotal);
  END IF;

  -- Compute final total (no tax/GST)
  computed_total := GREATEST(0, computed_subtotal - computed_discount);

  -- Generate sequential sale number
  new_sale_number := public.generate_pos_sale_number();

  -- ===================== TOKEN GENERATION ==================
  -- Get today's date in IST for the token
  new_token_date := public.current_ist_date();

  -- Atomically increment the daily counter and get the next token.
  -- INSERT ... ON CONFLICT ... DO UPDATE is atomic in PostgreSQL:
  -- it either inserts the first row (token=1) or increments and returns.
  INSERT INTO public.pos_daily_token_seq (token_date, last_token)
  VALUES (new_token_date, 1)
  ON CONFLICT (token_date) DO UPDATE
    SET last_token = pos_daily_token_seq.last_token + 1
  RETURNING last_token INTO new_token_number;
  -- =========================================================

  -- Build notes with idempotency key
  final_notes := COALESCE(_notes, '');
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    final_notes := final_notes || ' [idem:' || _idempotency_key || ']';
  END IF;

  -- Insert the sale with the assigned token
  INSERT INTO public.offline_sales (
    sale_number, customer_name, customer_phone, customer_email,
    payment_method, notes, subtotal, discount, total,
    discount_type, discount_value, customer_id, created_by,
    pos_token_number, pos_token_date
  ) VALUES (
    new_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(_customer_phone, ''),
    COALESCE(_customer_email, ''),
    COALESCE(_payment_method, 'cash'),
    final_notes,
    computed_subtotal,
    computed_discount,
    computed_total,
    COALESCE(_discount_type, 'none'),
    COALESCE(_discount_value, 0),
    _customer_id,
    uid,
    new_token_number,
    new_token_date
  )
  RETURNING id INTO new_sale_id;

  -- Insert sale items with snapshots
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, name text, sku text, qty int, custom_price numeric)
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
      IF item.product_id IS NOT NULL THEN
        SELECT id, slug, price, mrp, stock, name, sku, barcode
        INTO prod
        FROM public.products WHERE id = item.product_id;
      ELSE
        SELECT id, slug, price, mrp, stock, name, sku, barcode
        INTO prod
        FROM public.products WHERE slug = item.product_slug;
      END IF;

      INSERT INTO public.offline_sale_items (
        sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
        variant_info, mrp_snapshot, barcode_snapshot
      ) VALUES (
        new_sale_id, prod.id, prod.slug, prod.name,
        COALESCE(prod.sku, ''), prod.price, item.qty, (prod.price * item.qty),
        '', COALESCE(prod.mrp, prod.price), COALESCE(prod.barcode, '')
      );

      -- Stock deduction is handled by the existing trigger on offline_sale_items
      -- (deduct_stock_per_offline_item)
    END IF;
  END LOOP;

  -- Update POS customer stats if customer_id provided
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + computed_total
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', item_count,
    'pos_token_number', new_token_number,
    'pos_token_date', new_token_date,
    'duplicate', false
  );
END; $$;

-- Ensure anon cannot call this
REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.current_ist_date() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_ist_date() TO authenticated, service_role;

-- ======================== COMMENT ============================
COMMENT ON COLUMN public.offline_sales.pos_token_number IS
  'Daily sequential walk-in token number (1, 2, 3...). Resets to 1 each IST calendar day. Only assigned to completed offline POS sales. Never assigned to online orders.';

COMMENT ON COLUMN public.offline_sales.pos_token_date IS
  'IST (Asia/Kolkata) calendar date used for this token. Determines which day the token sequence belongs to regardless of UTC date.';
