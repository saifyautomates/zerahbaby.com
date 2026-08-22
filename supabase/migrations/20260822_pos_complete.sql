-- ============================================================
-- ZERAH BABY — COMPLETE POS / BARCODE / INVOICE SYSTEM
-- Production-grade migration — run in Supabase SQL Editor
-- ============================================================

-- ======================== POS CUSTOMERS =====================
-- Separate table for offline/walk-in customers (no auth account needed)

CREATE TABLE IF NOT EXISTS public.pos_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  total_purchases integer NOT NULL DEFAULT 0,
  total_spend numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Phone uniqueness (ignore empty strings)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_customers_phone
  ON public.pos_customers(phone) WHERE phone != '';

CREATE INDEX IF NOT EXISTS idx_pos_customers_name ON public.pos_customers(name);

GRANT SELECT, INSERT, UPDATE ON public.pos_customers TO authenticated;
GRANT ALL ON public.pos_customers TO service_role;
ALTER TABLE public.pos_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage pos customers" ON public.pos_customers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER pos_customers_touch
  BEFORE UPDATE ON public.pos_customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== SKU UNIQUE CONSTRAINT ==============
-- Ensure no duplicate SKUs (ignore empty strings)

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique
  ON public.products(sku) WHERE sku != '';

-- ======================== BARCODE INDEX (fast POS lookup) =====

CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON public.products(barcode) WHERE barcode IS NOT NULL AND barcode != '';

-- ======================== OFFLINE SALES ENHANCEMENTS =========

-- Add discount_type and discount_value columns
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL;

-- Add snapshot columns to offline_sale_items
ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS variant_info text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS mrp_snapshot numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS barcode_snapshot text NOT NULL DEFAULT '';

-- ======================== SEQUENTIAL SALE NUMBERS =============

-- Create a sequence for POS sale numbers
CREATE SEQUENCE IF NOT EXISTS public.pos_sale_seq START 1;

-- Function to generate sequential sale number: POS-YYMM-NNNNN
CREATE OR REPLACE FUNCTION public.generate_pos_sale_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  seq_val bigint;
  prefix text;
BEGIN
  seq_val := nextval('public.pos_sale_seq');
  prefix := 'POS-' || to_char(now(), 'YYMM') || '-';
  RETURN prefix || lpad(seq_val::text, 5, '0');
END; $$;

-- ======================== AUTO-GENERATE BARCODES =============
-- Generate 12-digit numeric barcodes for products that don't have one

DO $$
DECLARE
  p record;
  new_barcode text;
  attempts int;
BEGIN
  FOR p IN SELECT id FROM public.products WHERE barcode IS NULL OR barcode = '' LOOP
    attempts := 0;
    LOOP
      -- Generate a 12-digit barcode: timestamp-based + random for uniqueness
      new_barcode := lpad(
        (floor(random() * 900000000000) + 100000000000)::bigint::text,
        12, '0'
      );
      -- Check uniqueness
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE barcode = new_barcode) THEN
        UPDATE public.products SET barcode = new_barcode WHERE id = p.id;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE WARNING 'Could not generate unique barcode for product %', p.id;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END; $$;

-- ======================== BARCODE LOOKUP RPC ==================
-- Fast indexed lookup for POS scanning

CREATE OR REPLACE FUNCTION public.lookup_barcode(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prod record;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- Try barcode first, then SKU
  SELECT id, slug, name, brand, category, price, mrp, stock, sku, barcode,
         image_url, is_active, age_group, description
  INTO prod
  FROM public.products
  WHERE barcode = trim(_code) OR sku = trim(_code)
  LIMIT 1;

  IF prod.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Product not found');
  END IF;

  IF NOT prod.is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'archived', true,
      'error', 'Product is archived / unavailable for new sale',
      'product_id', prod.id,
      'name', prod.name,
      'sku', prod.sku,
      'barcode', prod.barcode
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'archived', false,
    'product_id', prod.id,
    'slug', prod.slug,
    'name', prod.name,
    'brand', prod.brand,
    'category', prod.category,
    'price', prod.price,
    'mrp', prod.mrp,
    'stock', prod.stock,
    'sku', prod.sku,
    'barcode', prod.barcode,
    'image_url', prod.image_url,
    'age_group', prod.age_group,
    'description', prod.description
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.lookup_barcode(text) FROM anon;

-- ======================== ENHANCED PLACE OFFLINE SALE RPC =====
-- Complete atomic POS sale with all validations

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
  item_count int := 0;
BEGIN
  -- Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Only admins can create offline sales';
  END IF;

  -- Idempotency check (prevent double-submit)
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, sale_number INTO new_sale_id, new_sale_number
    FROM public.offline_sales
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
    AND created_by = uid
    LIMIT 1;
    IF new_sale_id IS NOT NULL THEN
      -- Return existing sale (double-submit protection)
      RETURN jsonb_build_object(
        'sale_id', new_sale_id,
        'sale_number', new_sale_number,
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

  -- Build notes with idempotency key
  DECLARE
    final_notes text := COALESCE(_notes, '');
  BEGIN
    IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
      final_notes := final_notes || ' [idem:' || _idempotency_key || ']';
    END IF;

    -- Insert the sale
    INSERT INTO public.offline_sales (
      sale_number, customer_name, customer_phone, customer_email,
      payment_method, notes, subtotal, discount, total,
      discount_type, discount_value, customer_id, created_by
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
      uid
    )
    RETURNING id INTO new_sale_id;
  END;

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
    'duplicate', false
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.place_offline_sale FROM anon;

-- ======================== POS CUSTOMER SEARCH RPC =============

CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS SETOF public.pos_customers
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY
    SELECT * FROM public.pos_customers
    WHERE phone ILIKE '%' || trim(_query) || '%'
       OR name ILIKE '%' || trim(_query) || '%'
    ORDER BY updated_at DESC
    LIMIT 20;
END; $$;

REVOKE EXECUTE ON FUNCTION public.search_pos_customers(text) FROM anon;

-- ======================== ARCHIVE PROTECTION ==================
-- Prevent hard-deletion of products with historical transactions

CREATE OR REPLACE FUNCTION public.protect_product_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  has_online_orders boolean;
  has_offline_sales boolean;
BEGIN
  -- Check for online order items
  SELECT EXISTS (
    SELECT 1 FROM public.order_items WHERE product_id = OLD.id
  ) INTO has_online_orders;

  -- Check for offline sale items
  SELECT EXISTS (
    SELECT 1 FROM public.offline_sale_items WHERE product_id = OLD.id
  ) INTO has_offline_sales;

  IF has_online_orders OR has_offline_sales THEN
    RAISE EXCEPTION 'Cannot delete product "%" — it has historical transactions. Archive it instead by setting is_active = false.', OLD.name;
  END IF;

  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS products_protect_deletion ON public.products;
CREATE TRIGGER products_protect_deletion
  BEFORE DELETE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_product_deletion();

-- ======================== FIX: Stock deduction trigger =========
-- Update the offline sale items trigger to also record previous_stock

CREATE OR REPLACE FUNCTION public.deduct_stock_per_offline_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prev_stock integer;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    -- Get current stock before deduction
    SELECT stock INTO prev_stock FROM public.products WHERE id = NEW.product_id;

    -- Atomically deduct stock
    UPDATE public.products
    SET stock = GREATEST(0, stock - NEW.qty)
    WHERE id = NEW.product_id;

    -- Create inventory transaction record with previous stock info
    INSERT INTO public.inventory_transactions
      (product_id, type, quantity, reference_type, reference_id, note, created_by)
    VALUES
      (NEW.product_id, 'sale', -NEW.qty, 'offline_sale', NEW.sale_id,
       'POS sale | prev_stock: ' || COALESCE(prev_stock, 0)::text || ' | new_stock: ' || GREATEST(0, COALESCE(prev_stock, 0) - NEW.qty)::text,
       auth.uid());
  END IF;

  RETURN NEW;
END;
$$;
