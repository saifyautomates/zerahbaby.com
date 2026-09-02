-- ==============================================================================
-- Migration: 20260928000016_restore_canonical_place_offline_sale.sql
-- Description:
-- Recreate the full canonical 13-argument place_offline_sale RPC
-- ==============================================================================

-- 1. Ensure token sequence table exists
CREATE TABLE IF NOT EXISTS public.pos_daily_token_seq (
  token_date date PRIMARY KEY,
  last_token integer NOT NULL DEFAULT 0
);

-- 2. Drop any legacy overloaded signatures
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
  -- 1. Auth check (optional if anon/test)
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

  -- Customer resolution
  IF _customer_name IS NOT NULL AND trim(_customer_name) != '' AND _customer_name != 'Walk-in Customer' THEN
    IF v_resolved_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
      SELECT id INTO v_resolved_cust_id FROM public.pos_customers WHERE phone = v_clean_phone LIMIT 1;
      IF v_resolved_cust_id IS NULL THEN
        INSERT INTO public.pos_customers (name, phone, email, store_credit_balance, total_spend, total_spent, total_purchases, total_visits)
        VALUES (trim(_customer_name), v_clean_phone, COALESCE(trim(_customer_email), ''), 0, 0, 0, 0, 0)
        RETURNING id INTO v_resolved_cust_id;
      END IF;
    END IF;
  END IF;

  -- 6. Store Credit Tender Validation & Application
  IF _store_credit_used > 0 THEN
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

    actual_credit_used := LEAST(_store_credit_used, computed_total);
    v_new_credit := v_prev_credit - actual_credit_used;
  END IF;

  -- 7. Generate sequential sale number & daily token number (IST)
  new_sale_number := public.generate_pos_sale_number();
  new_token_date := CURRENT_DATE;

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

          UPDATE public.products
          SET stock = GREATEST(0, stock - item.qty)
          WHERE id = variant.p_id;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity,
            new_quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            variant.p_id, variant.v_id, 'sale'::public.inventory_tx_type, -item.qty,
            v_prev_stock, v_new_stock, 'pos_sale', new_sale_id,
            'POS Sale #' || new_sale_number, uid
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
            prod.id, v_rec.id, 'sale'::public.inventory_tx_type, -item.qty,
            v_prev_stock, v_new_stock, 'pos_sale', new_sale_id,
            'POS Sale #' || new_sale_number, uid
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

  -- 11. Update Customer Total Purchases & Spend
  IF v_resolved_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = total_purchases + 1,
        total_spend = total_spend + computed_total,
        total_spent = total_spent + computed_total,
        total_visits = total_visits + 1,
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

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role, anon;
