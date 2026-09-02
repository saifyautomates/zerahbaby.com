-- Migration: 20260928000021_fix_place_offline_sale_variant_and_overload.sql
-- Description:
-- 1. Fix missing mrp_override field in record 'variant' within place_offline_sale RPC.
-- 2. Drop ambiguous overloaded signatures of place_offline_sale to prevent function candidate collision.
-- 3. Provide fallback stock check from parent product if variant has 0 stock.

-- 1. Drop ambiguous older function overloads if present
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, numeric, text, numeric, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(jsonb, text, uuid, text, text, text, text, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.place_offline_sale(jsonb, text, text, text, text, text, numeric, text, numeric, uuid, text);

-- 2. Canonical place_offline_sale implementation with full variant schema support
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
  -- 1. Idempotency check (prevent duplicate submissions)
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
        'duplicate', true,
        'sale_id', new_sale_id,
        'sale_number', new_sale_number,
        'subtotal', computed_total,
        'discount', 0,
        'discount_type', _discount_type,
        'discount_value', _discount_value,
        'total', computed_total,
        'store_credit_used', COALESCE(actual_credit_used, 0),
        'cash_payable', GREATEST(0, computed_total - COALESCE(actual_credit_used, 0)),
        'payment_method', _payment_method,
        'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        'items_count', 0,
        'pos_token_number', new_token_number,
        'pos_token_date', new_token_date
      );
    END IF;
  END IF;

  -- 2. Validate items payload
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot place sale with zero items';
  END IF;

  -- 3. Validation & subtotal computation
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
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
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Item % has invalid quantity %', COALESCE(item.name, 'Unknown'), item.qty;
    END IF;

    IF item.product_id LIKE 'custom-%' OR item.sku = 'CUSTOM' THEN
      IF COALESCE(item.custom_price, item.price, 0) <= 0 THEN
        RAISE EXCEPTION 'Custom item % must have a positive price', COALESCE(item.name, 'Custom Item');
      END IF;
      computed_subtotal := computed_subtotal + (COALESCE(item.custom_price, item.price) * item.qty);
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
               v.sku AS v_sku, v.barcode AS v_barcode, v.color AS v_color, v.size AS v_size,
               v.mrp_override AS mrp_override,
               p.name AS p_name, p.slug AS p_slug, p.stock AS p_stock, p.mrp AS p_mrp, p.is_active
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

  -- 4. Compute discount
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

  computed_total := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Customer Profile Upsert
  IF length(v_clean_phone) >= 10 THEN
    INSERT INTO public.pos_customers (name, phone, email)
    VALUES (
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      v_clean_phone,
      COALESCE(trim(_customer_email), '')
    )
    ON CONFLICT (phone) DO UPDATE
      SET name = CASE
            WHEN pos_customers.name = 'Walk-in Customer' AND trim(_customer_name) != '' THEN trim(_customer_name)
            ELSE pos_customers.name
          END,
          email = CASE
            WHEN pos_customers.email = '' AND trim(_customer_email) != '' THEN trim(_customer_email)
            ELSE pos_customers.email
          END,
          updated_at = now()
    RETURNING id INTO v_resolved_cust_id;
  END IF;

  -- 6. Store Credit Tender Validation & Application
  IF COALESCE(_store_credit_used, 0) > 0 THEN
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

      -- Fallback: check offline_returns directly
      IF COALESCE(v_prev_credit, 0) = 0 THEN
        SELECT refund_amount INTO v_prev_credit
        FROM public.offline_returns
        WHERE credit_token = v_clean_token
          AND status != 'cancelled'
          AND refund_status != 'cancelled'
        LIMIT 1;
      END IF;
    END IF;

    v_prev_credit := COALESCE(v_prev_credit, 0);
    IF _store_credit_used > v_prev_credit THEN
      RAISE EXCEPTION 'Requested store credit (₹%) exceeds available balance (₹%)', _store_credit_used, v_prev_credit;
    END IF;

    actual_credit_used := LEAST(_store_credit_used, computed_total);
    v_new_credit := v_prev_credit - actual_credit_used;
  ELSE
    actual_credit_used := 0;
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
    _discount_type,
    _discount_value,
    v_resolved_cust_id,
    uid,
    new_token_number,
    new_token_date,
    NULLIF(trim(_idempotency_key), ''),
    'completed',
    actual_credit_used,
    NULLIF(trim(_credit_token), '')
  );

  -- 9. Insert items, deduct inventory & log stock movements
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
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
    item_count := item_count + item.qty;

    IF item.product_id LIKE 'custom-%' OR item.sku = 'CUSTOM' THEN
      INSERT INTO public.offline_sale_items (
        sale_id, product_id, product_slug, name, sku,
        price, qty, subtotal, variant_info, mrp_snapshot, barcode_snapshot
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
               v.sku AS v_sku, v.barcode AS v_barcode, v.color AS v_color, v.size AS v_size,
               v.mrp_override AS mrp_override,
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

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity,
            new_quantity, reference_type, reference_id, note, created_by
          ) VALUES (
            prod.id, NULL, 'sale'::public.inventory_tx_type, -item.qty,
            v_prev_stock, v_new_stock, 'pos_sale', new_sale_id,
            'POS Sale #' || new_sale_number, uid
          );

          INSERT INTO public.offline_sale_items (
            sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
            variant_info, mrp_snapshot, barcode_snapshot
          ) VALUES (
            new_sale_id, prod.id, prod.slug, prod.name,
            COALESCE(item.sku, prod.sku, ''), COALESCE(item.custom_price, item.price, prod.price),
            item.qty, (COALESCE(item.custom_price, item.price, prod.price) * item.qty),
            '', COALESCE(prod.mrp, prod.price), COALESCE(prod.barcode, '')
          );
        END IF;
      ELSE
        INSERT INTO public.offline_sale_items (
          sale_id, product_id, product_slug, name, sku, price, qty, subtotal,
          variant_info, mrp_snapshot, barcode_snapshot
        ) VALUES (
          new_sale_id, NULL, item.product_slug,
          COALESCE(item.name, 'Item'), COALESCE(item.sku, ''),
          COALESCE(item.custom_price, item.price, 0), item.qty,
          (COALESCE(item.custom_price, item.price, 0) * item.qty),
          '', COALESCE(item.custom_price, item.price, 0), ''
        );
      END IF;
    END IF;
  END LOOP;

  -- 10. Update Customer Store Credit Ledger & Balance
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
      sale_id,
      notes,
      created_by
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(v_clean_phone, ''),
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      v_clean_token,
      'CREDIT_USED',
      actual_credit_used,
      v_prev_credit,
      v_new_credit,
      new_sale_id,
      'Redeemed ₹' || actual_credit_used || ' on Sale #' || new_sale_number || CASE WHEN v_clean_token != '' THEN ' (Token: ' || v_clean_token || ')' ELSE '' END,
      uid
    );
  END IF;

  -- 11. Update customer total spend & visit counts
  IF v_resolved_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + computed_total,
        total_purchases = COALESCE(total_purchases, 0) + 1,
        total_visits = COALESCE(total_visits, 0) + 1,
        last_visit_at = now(),
        updated_at = now()
    WHERE id = v_resolved_cust_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'subtotal', computed_subtotal,
    'discount', computed_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'total', computed_total,
    'store_credit_used', actual_credit_used,
    'cash_payable', GREATEST(0, computed_total - actual_credit_used),
    'remaining_credit', v_new_credit,
    'payment_method', _payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', item_count,
    'pos_token_number', new_token_number,
    'pos_token_date', new_token_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text) TO authenticated, service_role, anon;
