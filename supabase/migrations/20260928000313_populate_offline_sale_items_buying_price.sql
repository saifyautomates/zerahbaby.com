-- Migration: 20260928000313_populate_offline_sale_items_buying_price.sql
-- Description: Backfill buying_price = cost_price on offline_sale_items and ensure place_offline_sale populates both cost columns for accurate profit reporting.

-- 1. Ensure column buying_price exists on offline_sale_items
ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS buying_price numeric DEFAULT 0;

-- 2. Backfill buying_price from cost_price where buying_price is 0 or null
UPDATE public.offline_sale_items
SET buying_price = COALESCE(cost_price, 0)
WHERE (buying_price IS NULL OR buying_price = 0) AND cost_price IS NOT NULL AND cost_price > 0;

-- 3. Backfill cost_price from buying_price where cost_price is 0 or null
UPDATE public.offline_sale_items
SET cost_price = COALESCE(buying_price, 0)
WHERE (cost_price IS NULL OR cost_price = 0) AND buying_price IS NOT NULL AND buying_price > 0;

-- 4. Re-declare place_offline_sale populating both cost_price and buying_price
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _created_by uuid DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _coupon_code text DEFAULT NULL,
  _cash_tendered numeric DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  _credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := COALESCE(_created_by, auth.uid());
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_qty int;
  item_price numeric;
  item_mrp numeric;
  item_cost numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  item_line_subtotal numeric;
  item_bill_discount numeric;
  item_coupon_discount numeric;
  item_final_paid numeric;
  v_existing_sale record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_voucher_avail numeric := 0;
  v_prev_customer_credit numeric := 0;
  v_effective_payment_method text;
  v_sale_number text;
  v_token_number int;
  v_sale_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_coupon_record record;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_sale
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_sale.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing_sale.id,
        'sale_number', v_existing_sale.sale_number,
        'token_number', v_existing_sale.pos_token_number,
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'coupon_discount', v_existing_sale.coupon_discount,
        'store_credit_used', v_existing_sale.store_credit_used,
        'payable_total', GREATEST(0, v_existing_sale.total - COALESCE(v_existing_sale.store_credit_used, 0)),
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_id', v_existing_sale.customer_id,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Compute Cart Subtotal & Line Item Costs
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := GREATEST(1, COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1));
    
    IF elem->>'custom_price' IS NOT NULL AND (elem->>'custom_price')::numeric >= 0 THEN
      item_price := ROUND((elem->>'custom_price')::numeric, 2);
    ELSE
      item_price := ROUND(COALESCE((elem->>'price')::numeric, (elem->>'unit_price')::numeric, 0), 2);
    END IF;

    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;

  -- 3. Bill-level Discount
  IF _discount_type = 'percentage' THEN
    v_discount := ROUND(v_subtotal * (LEAST(100, GREATEST(0, COALESCE(_discount_value, 0))) / 100.0), 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal, GREATEST(0, COALESCE(_discount_value, 0)));
  ELSE
    v_discount := 0;
  END IF;

  -- 4. Coupon Code Verification & Discount
  v_coupon_discount := 0;
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE UPPER(TRIM(code)) = UPPER(TRIM(_coupon_code))
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (starts_at IS NULL OR starts_at <= now())
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF (v_subtotal - v_discount) >= COALESCE(v_coupon_record.min_order_amount, 0) THEN
        IF v_coupon_record.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal - v_discount) * (v_coupon_record.discount_value / 100.0), 2);
          IF v_coupon_record.max_discount_amount IS NOT NULL AND v_coupon_discount > v_coupon_record.max_discount_amount THEN
            v_coupon_discount := v_coupon_record.max_discount_amount;
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_subtotal - v_discount, v_coupon_record.discount_value);
        END IF;

        IF v_coupon_record.usage_limit IS NOT NULL AND v_coupon_record.usage_count >= v_coupon_record.usage_limit THEN
          v_coupon_discount := 0;
        ELSE
          UPDATE public.coupons
          SET usage_count = usage_count + 1, updated_at = now()
          WHERE id = v_coupon_record.id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5. Gross Total
  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 6. Canonical Store Credit Voucher Redemption
  v_voucher_used := 0;
  v_voucher_token := NULL;

  IF _store_credit_used > 0 THEN
    IF length(v_clean_token) > 0 THEN
      -- A. Explicit voucher redemption by token code
      SELECT current_balance INTO v_voucher_avail
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
      FOR UPDATE;

      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT refund_amount - COALESCE(credit_used, 0) INTO v_voucher_avail
        FROM public.offline_returns
        WHERE UPPER(TRIM(credit_token)) = v_clean_token
          AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
          AND (expires_at IS NULL OR expires_at > now())
        FOR UPDATE;
      END IF;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);

      IF v_voucher_used > 0 THEN
        v_voucher_token := v_clean_token;
        v_prev_customer_credit := COALESCE(v_voucher_avail, 0);

        -- Update offline_returns
        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
            credit_token_status = CASE WHEN refund_amount - (COALESCE(credit_used, 0) + v_voucher_used) <= 0 THEN 'REDEEMED' ELSE 'PARTIALLY_USED' END,
            updated_at = now()
        WHERE UPPER(TRIM(credit_token)) = v_clean_token;

        -- Update store_credit_vouchers table
        UPDATE public.store_credit_vouchers
        SET current_balance = GREATEST(0, current_balance - v_voucher_used),
            is_active = (current_balance - v_voucher_used > 0),
            redeemed_at = CASE WHEN current_balance - v_voucher_used <= 0 THEN now() ELSE redeemed_at END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;

        -- Synchronize linked pos_customers balance
        IF v_cust_id IS NOT NULL THEN
          SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_customer_credit
          FROM public.pos_customers WHERE id = v_cust_id;

          UPDATE public.pos_customers
          SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
              store_credit = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
              updated_at = now()
          WHERE id = v_cust_id;

          UPDATE public.profiles
          SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_voucher_used),
              updated_at = now()
          WHERE id = v_cust_id;
        END IF;
      END IF;

    ELSIF (v_cust_id IS NOT NULL OR length(v_clean_phone) >= 10) AND _store_credit_used > 0 THEN
      -- B. Customer Account Credit Redemption (FIFO deduction across customer's active return vouchers)
      IF v_cust_id IS NOT NULL THEN
        SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
        FROM public.pos_customers
        WHERE id = v_cust_id
        FOR UPDATE;
      END IF;

      -- If pos_customers balance is 0 or unassigned, compute available from active returns
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(SUM(GREATEST(0, refund_amount - COALESCE(credit_used, 0))), 0)
        INTO v_voucher_avail
        FROM public.offline_returns
        WHERE (
          (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
          OR (length(v_clean_phone) >= 10 AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%')
        )
        AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
        AND (expires_at IS NULL OR expires_at > now())
        AND (refund_amount - COALESCE(credit_used, 0)) > 0;
      END IF;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);

      IF v_voucher_used > 0 THEN
        v_prev_customer_credit := COALESCE(v_voucher_avail, 0);

        -- Update customer account balance
        IF v_cust_id IS NOT NULL THEN
          UPDATE public.pos_customers
          SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
              store_credit = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
              updated_at = now()
          WHERE id = v_cust_id;

          UPDATE public.profiles
          SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_voucher_used),
              updated_at = now()
          WHERE id = v_cust_id;
        END IF;

        -- Deduct FIFO from customer's active returns & matching vouchers
        DECLARE
          v_rem_to_deduct numeric := v_voucher_used;
          v_ret_row record;
          v_alloc numeric;
        BEGIN
          FOR v_ret_row IN
            SELECT id, credit_token, refund_amount, COALESCE(credit_used, 0) AS used,
                   GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS avail
            FROM public.offline_returns
            WHERE (
              (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
              OR (length(v_clean_phone) >= 10 AND regexp_replace(customer_phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%')
            )
            AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
            AND (expires_at IS NULL OR expires_at > now())
            AND (refund_amount - COALESCE(credit_used, 0)) > 0
            ORDER BY created_at ASC
          LOOP
            EXIT WHEN v_rem_to_deduct <= 0;
            v_alloc := LEAST(v_rem_to_deduct, v_ret_row.avail);
            IF v_alloc > 0 THEN
              UPDATE public.offline_returns
              SET credit_used = credit_used + v_alloc,
                  credit_token_status = CASE WHEN refund_amount - (credit_used + v_alloc) <= 0 THEN 'REDEEMED' ELSE 'PARTIALLY_USED' END,
                  updated_at = now()
              WHERE id = v_ret_row.id;

              IF v_ret_row.credit_token IS NOT NULL THEN
                UPDATE public.store_credit_vouchers
                SET current_balance = GREATEST(0, current_balance - v_alloc),
                    is_active = (current_balance - v_alloc > 0),
                    redeemed_at = CASE WHEN current_balance - v_alloc <= 0 THEN now() ELSE redeemed_at END,
                    updated_at = now()
                WHERE UPPER(TRIM(token)) = UPPER(TRIM(v_ret_row.credit_token));

                IF v_voucher_token IS NULL THEN
                  v_voucher_token := v_ret_row.credit_token;
                END IF;
              END IF;

              v_rem_to_deduct := v_rem_to_deduct - v_alloc;
            END IF;
          END LOOP;
        END;
      END IF;
    END IF;
  END IF;

  -- 7. Net Payable
  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment Method Resolution
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(trim(_payment_method), ''), 'cash');
  END IF;

  -- 9. Sale Number Generation
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || LPAD(FLOOR(random() * 100000)::text, 5, '0');

  -- 10. Customer Record Creation / Update
  IF v_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_visits,
        last_visit,
        created_at,
        updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        1,
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = total_spent + v_gross_total,
          total_visits = total_visits + 1,
          last_visit = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = total_spent + v_gross_total,
        total_visits = total_visits + 1,
        last_visit = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 11. Daily Token Number
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 INTO v_token_number
  FROM public.offline_sales
  WHERE created_at >= date_trunc('day', now());

  -- 12. Insert offline_sale
  INSERT INTO public.offline_sales (
    sale_number,
    pos_token_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    subtotal,
    discount,
    discount_type,
    discount_value,
    coupon_code,
    coupon_discount,
    store_credit_used,
    credit_token_used,
    total,
    notes,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_token_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    v_effective_payment_method,
    COALESCE(v_subtotal, 0),
    COALESCE(v_discount, 0),
    COALESCE(_discount_type, 'none'),
    COALESCE(_discount_value, 0),
    _coupon_code,
    COALESCE(v_coupon_discount, 0),
    COALESCE(v_voucher_used, 0),
    v_voucher_token,
    COALESCE(v_gross_total, 0),
    COALESCE(_notes, ''),
    NULLIF(trim(_idempotency_key), ''),
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 12b. Record Audit Ledger Entry for Store Credit Redemption
  IF v_voucher_used > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      sale_id,
      source_sale_id,
      used_in_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Customer'),
      v_clean_phone,
      v_voucher_token,
      'CREDIT_REDEEMED',
      -v_voucher_used,
      COALESCE(v_prev_customer_credit, v_voucher_used),
      GREATEST(0, COALESCE(v_prev_customer_credit, v_voucher_used) - v_voucher_used),
      v_sale_id,
      v_sale_id,
      v_sale_id,
      'POS Sale #' || v_sale_number || ' — Store Credit Redeemed: ₹' || v_voucher_used || ' (₹' || GREATEST(0, COALESCE(v_prev_customer_credit, v_voucher_used) - v_voucher_used) || ' Remaining)',
      uid,
      now()
    );
  END IF;

  -- 13. Insert Items with Explicit Returnable & Sold Quantities and BOTH cost_price & buying_price
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF elem->>'product_id' IS NOT NULL AND trim(elem->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      item_product_id := (elem->>'product_id')::uuid;
    ELSE
      item_product_id := NULL;
    END IF;

    IF elem->>'variant_id' IS NOT NULL AND trim(elem->>'variant_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      item_variant_id := (elem->>'variant_id')::uuid;
    ELSE
      item_variant_id := NULL;
    END IF;

    item_qty := GREATEST(1, COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1));
    
    IF elem->>'custom_price' IS NOT NULL AND (elem->>'custom_price')::numeric >= 0 THEN
      item_price := ROUND((elem->>'custom_price')::numeric, 2);
    ELSE
      item_price := ROUND(COALESCE((elem->>'price')::numeric, (elem->>'unit_price')::numeric, 0), 2);
    END IF;

    item_mrp := ROUND(COALESCE((elem->>'mrp')::numeric, item_price), 2);
    item_cost := ROUND(COALESCE((elem->>'cost_price')::numeric, (elem->>'buying_price')::numeric, (elem->>'buyingPrice')::numeric, 0), 2);
    
    -- If cost was not supplied in cart item, resolve from product_costs
    IF item_cost <= 0 AND item_product_id IS NOT NULL THEN
      SELECT COALESCE(buying_price, 0) INTO item_cost
      FROM public.product_costs
      WHERE product_id = item_product_id
      LIMIT 1;
    END IF;

    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Item');
    item_sku := COALESCE(elem->>'sku', '');
    item_barcode := COALESCE(elem->>'barcode', '');
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', 'item');
    item_variant_info := COALESCE(elem->>'variant_info', '');

    item_line_subtotal := item_price * item_qty;
    IF v_subtotal > 0 THEN
      item_bill_discount := ROUND((item_line_subtotal / v_subtotal) * v_discount, 2);
      item_coupon_discount := ROUND((item_line_subtotal / v_subtotal) * v_coupon_discount, 2);
    ELSE
      item_bill_discount := 0;
      item_coupon_discount := 0;
    END IF;
    item_final_paid := GREATEST(0, item_line_subtotal - item_bill_discount - item_coupon_discount);

    -- Fallback variant resolution if variant_id was not provided directly
    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY stock DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, variant_id, product_slug, name, product_name,
      variant_info, sku, barcode, price, unit_selling_price, mrp,
      cost_price, buying_price, qty, quantity, quantity_sold, quantity_returned, quantity_returnable,
      allocated_bill_discount, allocated_coupon_discount, final_unit_paid_price,
      total, line_gross_amount, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp,
      COALESCE(item_cost, 0), COALESCE(item_cost, 0), item_qty, item_qty, item_qty, 0, item_qty,
      item_bill_discount, item_coupon_discount, item_final_paid,
      (item_price * item_qty), (item_final_paid * item_qty), now()
    );

    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_qty);
        UPDATE public.product_variants SET stock = v_new_stock, updated_at = now() WHERE id = item_variant_id;

        IF item_product_id IS NOT NULL THEN
          UPDATE public.products
          SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = item_product_id),
              updated_at = now()
          WHERE id = item_product_id;
        END IF;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, transaction_type, notes, created_by, created_at
        ) VALUES (
          item_product_id, item_variant_id, -item_qty, 'offline_sale',
          'POS Sale #' || v_sale_number || ' (' || item_name || ')', uid, now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_qty);
        UPDATE public.products SET stock = v_new_stock, updated_at = now() WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id, quantity, transaction_type, notes, created_by, created_at
        ) VALUES (
          item_product_id, -item_qty, 'offline_sale',
          'POS Sale #' || v_sale_number || ' (' || item_name || ')', uid, now()
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'token_number', v_token_number,
    'total', v_gross_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'payable_total', v_payable_total,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'customer_id', v_cust_id,
    'duplicate', false
  );
END;
$$;
