-- =============================================================================
-- Migration: 20260928000202_strict_inventory_boundary_and_realtime_consistency.sql
-- Description:
-- 1. Add public.products and public.product_variants to supabase_realtime publication
--    and set REPLICA IDENTITY FULL to guarantee instant, cross-tab, cross-device
--    realtime data synchronization.
-- 2. Harden place_offline_sale with strict pre-decrement stock boundary checks
--    (matching place_cod_order and finalize_paid_order) to eliminate silent overselling
--    and race condition inventory drift.
-- =============================================================================

-- 1. Ensure supabase_realtime publication includes products and product_variants
DO $$
DECLARE
  tbl text;
  tables_to_add text[] := ARRAY[
    'products',
    'product_variants'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH tbl IN ARRAY tables_to_add LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      END IF;

      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
    END IF;
  END LOOP;
END $$;

-- 2. CANONICAL place_offline_sale with strict stock boundary validation
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
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_existing_sale record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_effective_payment_method text;
  v_item record;
  v_prev_stock int;
  v_new_stock int;
  v_var_prev_stock int;
  v_var_new_stock int;
  v_total_units int := 0;
  v_clean_phone text;
  v_cust_id uuid := _customer_id;
  v_curr_balance numeric := 0;
  v_new_balance numeric := 0;
  v_voucher_record record;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_applied_coupon record;
  v_item_price numeric;
  v_line_gross numeric;
  v_alloc_bill numeric;
  v_alloc_coupon numeric;
  v_final_unit_paid numeric;
BEGIN
  -- 1. Strict Staff/Admin Authorization check
  IF uid IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
  END IF;

  -- 2. Input Sanitation
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) > 10 AND starts_with(v_clean_phone, '91') THEN
    v_clean_phone := substring(v_clean_phone from 3);
  END IF;

  -- 3. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, customer_name, payment_method, store_credit_used
    INTO v_existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'store_credit_used', v_existing_sale.store_credit_used,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 4. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale with empty items';
  END IF;

  -- 5. Calculate subtotal & validate prices and quantities
  v_subtotal := 0;
  v_total_units := 0;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF COALESCE(v_item.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Quantity for item % must be greater than 0', COALESCE(v_item.name, 'item');
    END IF;

    -- Canonical Server-Side Price Verification
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    IF v_item_price IS NULL OR v_item_price < 0 THEN
      RAISE EXCEPTION 'Price for item % cannot be negative', COALESCE(v_item.name, 'item');
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item.qty);
    v_total_units := v_total_units + v_item.qty;
  END LOOP;

  -- 6. Apply Coupon Code if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (expires_at IS NULL OR expires_at >= now())
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF v_applied_coupon.min_order_amount IS NULL OR v_subtotal >= v_applied_coupon.min_order_amount THEN
        IF v_applied_coupon.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
          IF v_applied_coupon.max_discount_amount IS NOT NULL AND v_coupon_discount > v_applied_coupon.max_discount_amount THEN
            v_coupon_discount := v_applied_coupon.max_discount_amount;
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_subtotal, v_applied_coupon.discount_value);
        END IF;

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1
        WHERE id = v_applied_coupon.id;
      END IF;
    END IF;
  END IF;

  -- 7. Calculate manual cashier discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * LEAST(_discount_value, 100)) / 100, 2);
  ELSIF _discount_type = 'flat' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  v_discount := LEAST(v_subtotal, v_discount + v_coupon_discount);
  v_gross_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Validate and handle Store Credit / Voucher Redemption
  IF _store_credit_used > 0 OR (_credit_token IS NOT NULL AND trim(_credit_token) != '') THEN
    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_voucher_record
      FROM public.store_credit_vouchers
      WHERE UPPER(token) = UPPER(trim(_credit_token))
      FOR UPDATE;

      IF v_voucher_record.id IS NULL THEN
        RAISE EXCEPTION 'Store credit voucher % not found', trim(_credit_token);
      END IF;

      IF v_voucher_record.is_active = false OR v_voucher_record.current_balance <= 0 THEN
        RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed or is inactive', trim(_credit_token);
      END IF;

      IF v_voucher_record.expires_at IS NOT NULL AND v_voucher_record.expires_at < now() THEN
        RAISE EXCEPTION 'Store credit voucher % expired on %', trim(_credit_token), v_voucher_record.expires_at;
      END IF;

      v_voucher_used := LEAST(_store_credit_used, v_voucher_record.current_balance, v_gross_total);
      IF v_voucher_used <= 0 THEN
        v_voucher_used := LEAST(v_voucher_record.current_balance, v_gross_total);
      END IF;
      v_voucher_token := v_voucher_record.token;

      UPDATE public.store_credit_vouchers
      SET current_balance = current_balance - v_voucher_used,
          is_active = (current_balance - v_voucher_used > 0),
          redeemed_at = CASE WHEN (current_balance - v_voucher_used) <= 0 THEN now() ELSE redeemed_at END,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 9. Determine effective payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 10. Generate sequential POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 11. Customer Link / Upsert
  IF v_cust_id IS NULL AND v_clean_phone != '' THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || v_clean_phone || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_spend,
        visits_count,
        total_visits,
        total_purchases,
        last_visit,
        last_visit_date,
        created_at,
        updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        v_gross_total,
        1,
        1,
        1,
        now(),
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
          total_spend = COALESCE(total_spend, 0) + v_gross_total,
          visits_count = COALESCE(visits_count, 0) + 1,
          total_visits = COALESCE(total_visits, 0) + 1,
          total_purchases = COALESCE(total_purchases, 0) + 1,
          last_visit = now(),
          last_visit_date = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
        total_spend = COALESCE(total_spend, 0) + v_gross_total,
        visits_count = COALESCE(visits_count, 0) + 1,
        total_visits = COALESCE(total_visits, 0) + 1,
        total_purchases = COALESCE(total_purchases, 0) + 1,
        last_visit = now(),
        last_visit_date = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 12. Insert Master POS Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token_used,
    coupon_code,
    cashier_id,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_subtotal,
    v_discount,
    v_gross_total,
    v_effective_payment_method,
    _notes,
    _idempotency_key,
    v_voucher_used,
    v_voucher_token,
    _coupon_code,
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 13. Process Items & Strict Single-Source Inventory Mutation
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    v_line_gross := v_item_price * COALESCE(v_item.qty, 1);

    v_alloc_bill := CASE
      WHEN v_subtotal > 0 AND (v_discount - v_coupon_discount) > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * (v_discount - v_coupon_discount)) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_alloc_coupon := CASE
      WHEN v_subtotal > 0 AND v_coupon_discount > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * v_coupon_discount) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_final_unit_paid := GREATEST(0, ROUND(v_item_price - v_alloc_bill - v_alloc_coupon, 4));

    -- Insert into offline_sale_items
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      sku,
      barcode,
      price,
      mrp,
      cost_price,
      variant_info,
      qty,
      quantity,
      subtotal,
      unit_mrp,
      unit_selling_price,
      line_gross_amount,
      allocated_bill_discount,
      allocated_coupon_discount,
      final_unit_paid_price,
      quantity_sold,
      quantity_returned,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, v_item.slug, ''),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.barcode, ''),
      v_item_price,
      COALESCE(v_item.mrp, v_item_price, 0),
      COALESCE(v_item.cost_price, 0),
      COALESCE(v_item.variant_info, ''),
      COALESCE(v_item.qty, 1),
      COALESCE(v_item.qty, 1),
      v_item_price * COALESCE(v_item.qty, 1),
      COALESCE(v_item.mrp, v_item_price, 0),
      v_item_price,
      v_line_gross,
      v_alloc_bill,
      v_alloc_coupon,
      v_final_unit_paid,
      COALESCE(v_item.qty, 1),
      0,
      now()
    );

    -- STRICT SINGLE-SOURCE INVENTORY DEDUCTION:
    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;

      IF v_var_prev_stock IS NULL OR v_var_prev_stock < v_item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          COALESCE(v_item.name, 'Item'), COALESCE(v_item.variant_info, ''), COALESCE(v_var_prev_stock, 0), v_item.qty;
      END IF;

      v_var_new_stock := v_var_prev_stock - v_item.qty;

      UPDATE public.product_variants
      SET stock = v_var_new_stock,
          updated_at = now()
      WHERE id = v_item.variant_id;

      -- trg_sync_variant_to_product_stock atomically updates products.stock!
      -- DO NOT manually update products.stock here to avoid double-deduction.

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
        v_item.product_id,
        v_item.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        v_var_prev_stock,
        v_var_new_stock,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        uid
      );
    ELSE
      IF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;

        IF v_prev_stock IS NULL OR v_prev_stock < v_item.qty THEN
          RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
            COALESCE(v_item.name, 'Item'), COALESCE(v_prev_stock, 0), v_item.qty;
        END IF;

        v_new_stock := v_prev_stock - v_item.qty;

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_item.product_id;

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
          v_item.product_id,
          NULL,
          'sale'::public.inventory_tx_type,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          v_prev_stock,
          v_new_stock,
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          uid
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_payable_total,
    'gross_total', v_gross_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;
