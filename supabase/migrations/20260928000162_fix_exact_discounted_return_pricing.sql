-- =====================================================================
-- Migration: 20260928000162_fix_exact_discounted_return_pricing.sql
-- Description: Ensure exact discounted price (e.g. 7.5 instead of 10 or rounded 8)
--              is recorded in offline_sale_items and used in returns without roundoff.
-- =====================================================================

-- 1. Backfill existing offline_sale_items with exact historical net paid price
UPDATE public.offline_sale_items osi
SET 
  unit_selling_price = COALESCE(NULLIF(osi.unit_selling_price, 0), osi.price),
  quantity_sold = COALESCE(NULLIF(osi.quantity_sold, 0), osi.qty, 1),
  allocated_bill_discount = CASE 
    WHEN os.subtotal > 0 AND os.discount > 0 THEN 
      ROUND(((osi.price * COALESCE(osi.qty, 1)) / os.subtotal * os.discount) / COALESCE(osi.qty, 1), 4)
    ELSE 0 
  END,
  final_unit_paid_price = CASE 
    WHEN os.subtotal > 0 AND os.discount > 0 THEN 
      GREATEST(0, ROUND(osi.price - (((osi.price * COALESCE(osi.qty, 1)) / os.subtotal * os.discount) / COALESCE(osi.qty, 1)), 4))
    ELSE osi.price 
  END
FROM public.offline_sales os
WHERE osi.sale_id = os.id
  AND (osi.final_unit_paid_price IS NULL OR osi.final_unit_paid_price = 0 OR (osi.final_unit_paid_price = osi.price AND os.discount > 0));

-- 2. Update place_offline_sale to calculate & store final_unit_paid_price and allocated discounts
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
  -- 1. Strict Staff/Admin Authorization
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

  -- 2. Validate non-negative discount value
  IF COALESCE(_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Discount value cannot be negative';
  END IF;

  IF COALESCE(_store_credit_used, 0) < 0 THEN
    RAISE EXCEPTION 'Store credit used cannot be negative';
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
    IF v_item.variant_id IS NOT NULL THEN
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

    IF v_item_price IS NULL OR v_item_price <= 0 THEN
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    IF v_item_price < 0 THEN
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
      IF v_subtotal >= COALESCE(v_applied_coupon.min_order_amount, 0) THEN
        IF v_applied_coupon.discount_type = 'percentage' THEN
          v_coupon_discount := round((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
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

  -- 7. Apply Manual Cashier Discount
  IF _discount_type = 'percentage' THEN
    v_discount := round(((v_subtotal - v_coupon_discount) * LEAST(100, _discount_value)) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal - v_coupon_discount, _discount_value);
  ELSE
    v_discount := 0;
  END IF;

  v_discount := GREATEST(0, v_discount) + v_coupon_discount;
  v_gross_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Verify & Deduct Store Credit / Exchange Voucher
  IF COALESCE(_store_credit_used, 0) > 0 THEN
    v_voucher_used := LEAST(COALESCE(_store_credit_used, 0), v_gross_total);

    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_voucher_record
      FROM public.pos_exchange_vouchers
      WHERE UPPER(token) = UPPER(trim(_credit_token))
        AND status = 'active'
        AND remaining_balance > 0
        AND expires_at > now()
      FOR UPDATE;

      IF v_voucher_record.id IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired exchange credit token: %', _credit_token;
      END IF;

      IF v_voucher_used > v_voucher_record.remaining_balance THEN
        v_voucher_used := v_voucher_record.remaining_balance;
      END IF;

      v_voucher_token := UPPER(trim(_credit_token));
      v_curr_balance := v_voucher_record.remaining_balance;
      v_new_balance := v_voucher_record.remaining_balance - v_voucher_used;

      UPDATE public.pos_exchange_vouchers
      SET remaining_balance = v_new_balance,
          status = CASE WHEN v_new_balance <= 0 THEN 'redeemed' ELSE 'active' END,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    ELSIF v_cust_id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_curr_balance
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      IF v_voucher_used > v_curr_balance THEN
        v_voucher_used := v_curr_balance;
      END IF;

      v_new_balance := v_curr_balance - v_voucher_used;

      UPDATE public.pos_customers
      SET store_credit_balance = v_new_balance,
          store_credit = v_new_balance,
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 9. Upsert POS Customer Record
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) >= 10 THEN
    v_clean_phone := right(v_clean_phone, 10);
  END IF;

  IF v_cust_id IS NULL AND length(v_clean_phone) = 10 THEN
    SELECT id INTO v_cust_id FROM public.pos_customers WHERE phone = v_clean_phone LIMIT 1;
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

  -- 10. Generate POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_effective_payment_method := COALESCE(NULLIF(trim(_payment_method), ''), CASE WHEN v_payable_total = 0 THEN 'store_credit' ELSE 'cash' END);

  -- 11. Insert Sale Record
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
    credit_token,
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

  -- 12. Process Items & Single-Source Inventory Deduction with Historical Snapshot
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
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
    IF v_item.variant_id IS NOT NULL THEN
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

    IF v_item_price IS NULL OR v_item_price <= 0 THEN
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    IF v_item_price < 0 THEN
      RAISE EXCEPTION 'Price for item % cannot be negative', COALESCE(v_item.name, 'item');
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

    -- Insert into offline_sale_items populating all schema variations with foolproof COALESCE
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
      COALESCE(NULLIF(v_item.product_slug, ''), NULLIF(v_item.slug, ''), 'item'),
      COALESCE(NULLIF(v_item.name, ''), 'Item'),
      COALESCE(NULLIF(v_item.name, ''), 'Item'),
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

    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
      v_var_new_stock := GREATEST(0, COALESCE(v_var_prev_stock, 0) - v_item.qty);

      UPDATE public.product_variants
      SET stock = v_var_new_stock,
          updated_at = now()
      WHERE id = v_item.variant_id;

      IF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - v_item.qty);

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_item.product_id;
      END IF;

      INSERT INTO public.inventory_transactions (
        product_id,
        variant_id,
        transaction_type,
        quantity,
        reference_type,
        reference_id,
        notes,
        created_by
      ) VALUES (
        v_item.product_id,
        v_item.variant_id,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        uid
      );
    ELSE
      IF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - v_item.qty);

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_item.product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          v_item.product_id,
          v_item.variant_id,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 13. Record Store Credit Ledger Entry if used
  IF v_voucher_used > 0 AND v_cust_id IS NOT NULL THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      v_voucher_token,
      'CREDIT_REDEEMED',
      -v_voucher_used,
      v_curr_balance,
      v_new_balance,
      v_sale_id,
      'Store credit / voucher redeemed in POS Sale #' || v_sale_number,
      uid,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_gross_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'store_credit_used', v_voucher_used,
    'credit_token_used', v_voucher_token,
    'payable_amount', v_payable_total,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, service_role;
