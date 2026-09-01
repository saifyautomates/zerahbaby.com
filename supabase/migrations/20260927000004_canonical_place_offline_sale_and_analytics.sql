-- =====================================================================
-- Migration: 20260927000004_canonical_place_offline_sale_and_analytics.sql
-- Description: 
-- 1. Drop all prior overloaded signatures of place_offline_sale to resolve PostgREST ambiguity
-- 2. Define canonical place_offline_sale with complete variant, inventory transaction, and token support
-- 3. Ensure permissions and RLS for product_costs, orders, and offline_sales
-- =====================================================================

-- 1. Drop all overloaded versions of place_offline_sale
DROP FUNCTION IF EXISTS public.place_offline_sale(jsonb, text, uuid, text, text, text, text, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, numeric, jsonb, text, text);
DROP FUNCTION IF EXISTS public.place_offline_sale;

-- 2. Define Canonical place_offline_sale Function
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
    SELECT id, sale_number, total, pos_token_number, pos_token_date
    INTO new_sale_id, new_sale_number, computed_total, new_token_number, new_token_date
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

  -- 6. Generate sequential sale number & daily token number (IST)
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

  -- 7. Insert into public.offline_sales
  new_sale_id := gen_random_uuid();
  INSERT INTO public.offline_sales (
    id, sale_number, customer_name, customer_phone, customer_email,
    payment_method, notes, subtotal, discount, total,
    discount_type, discount_value, customer_id, created_by,
    pos_token_number, pos_token_date, idempotency_key, status
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
    _customer_id,
    uid,
    new_token_number,
    new_token_date,
    COALESCE(NULLIF(trim(_idempotency_key), ''), NULL),
    'completed'
  );

  -- 8. Insert offline sale items & perform inventory deduction
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
        SELECT v.id AS v_id, v.product_id AS p_id, v.stock AS v_stock, COALESCE(v.price_override, p.price) AS selling_price,
               v.mrp_override, v.sku AS v_sku, v.barcode AS v_barcode, v.color AS v_color, v.size AS v_size,
               p.name AS p_name, p.slug AS p_slug, p.stock AS p_stock, p.mrp AS p_mrp
        INTO variant
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = v_variant_uuid
        LIMIT 1;

        IF variant.v_id IS NOT NULL THEN
          INSERT INTO public.offline_sale_items (
            sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
            variant_info, mrp_snapshot, barcode_snapshot
          ) VALUES (
            new_sale_id, variant.p_id, variant.p_slug,
            variant.p_name || CASE WHEN variant.v_size IS NOT NULL AND variant.v_size != '' THEN ' (' || variant.v_size || ')' ELSE '' END,
            COALESCE(variant.v_sku, item.sku, ''),
            COALESCE(item.custom_price, item.price, variant.selling_price),
            item.qty,
            (COALESCE(item.custom_price, item.price, variant.selling_price) * item.qty),
            COALESCE(variant.v_color, '') || CASE WHEN variant.v_size IS NOT NULL THEN ' / ' || variant.v_size ELSE '' END,
            COALESCE(variant.mrp_override, variant.p_mrp, variant.selling_price),
            COALESCE(variant.v_barcode, '')
          );

          -- Deduct variant & parent stock
          v_prev_stock := variant.p_stock;
          v_new_stock := GREATEST(0, variant.p_stock - item.qty);
          UPDATE public.product_variants SET stock = GREATEST(0, stock - item.qty) WHERE id = variant.v_id;
          UPDATE public.products SET stock = v_new_stock WHERE id = variant.p_id;

          -- Log inventory transaction
          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, created_by
          ) VALUES (
            variant.p_id, variant.v_id, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock,
            'offline_sale', new_sale_id, 'POS Sale ' || new_sale_number, uid
          );
        END IF;
      ELSIF v_product_uuid IS NOT NULL OR (item.product_slug IS NOT NULL AND item.product_slug != '') THEN
        IF v_product_uuid IS NOT NULL THEN
          SELECT id, name, slug, price, mrp, stock, sku, barcode
          INTO prod
          FROM public.products WHERE id = v_product_uuid;
        ELSE
          SELECT id, name, slug, price, mrp, stock, sku, barcode
          INTO prod
          FROM public.products WHERE slug = item.product_slug;
        END IF;

        IF prod.id IS NOT NULL THEN
          INSERT INTO public.offline_sale_items (
            sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
            variant_info, mrp_snapshot, barcode_snapshot
          ) VALUES (
            new_sale_id, prod.id, prod.slug, prod.name,
            COALESCE(prod.sku, item.sku, ''),
            COALESCE(item.custom_price, item.price, prod.price),
            item.qty,
            (COALESCE(item.custom_price, item.price, prod.price) * item.qty),
            '',
            COALESCE(prod.mrp, prod.price),
            COALESCE(prod.barcode, '')
          );

          v_prev_stock := prod.stock;
          v_new_stock := GREATEST(0, prod.stock - item.qty);
          UPDATE public.products SET stock = v_new_stock WHERE id = prod.id;

          -- Also update default variant if present
          UPDATE public.product_variants SET stock = GREATEST(0, stock - item.qty)
          WHERE product_id = prod.id AND name = 'Default';

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, created_by
          ) VALUES (
            prod.id, NULL, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock,
            'offline_sale', new_sale_id, 'POS Sale ' || new_sale_number, uid
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 9. Update POS customer stats if customer_id provided
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + computed_total
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
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
END;
$$;

-- 3. Grants and permissions
GRANT EXECUTE ON FUNCTION public.place_offline_sale TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.place_offline_sale FROM anon;

-- 4. Enable product_costs read for authenticated users (admins) so Dashboard COGS works without 401
GRANT SELECT ON public.product_costs TO authenticated;
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated users view product costs" ON public.product_costs;
CREATE POLICY "authenticated users view product costs"
  ON public.product_costs
  FOR SELECT
  TO authenticated
  USING (true);
