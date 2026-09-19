-- =====================================================================
-- Migration: 20260928000309_fix_partial_store_credit_redemption_and_balance.sql
-- Description: Fix partial store credit redemption so remaining balance (e.g. ₹100
--              left from ₹600 credit after ₹500 purchase) is accurately preserved,
--              persisted across offline_returns, pos_exchange_vouchers,
--              store_credit_vouchers, pos_customers, profiles, and store_credit_ledger.
-- =====================================================================

-- 1. Heal any existing offline_returns with stale/null credit_balance
UPDATE public.offline_returns
SET credit_balance = GREATEST(0, refund_amount - COALESCE(credit_used, 0)),
    credit_token_status = CASE 
      WHEN (refund_amount - COALESCE(credit_used, 0)) <= 0 THEN 'CONSUMED' 
      ELSE 'ACTIVE' 
    END
WHERE credit_balance IS NULL 
   OR credit_balance != GREATEST(0, refund_amount - COALESCE(credit_used, 0));

-- 2. CANONICAL place_offline_sale with Early Customer Resolution & Full Partial Credit Persistence
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

        UPDATE public.coupons
        SET usage_count = COALESCE(usage_count, 0) + 1,
            updated_at = now()
        WHERE id = v_coupon_record.id;
      END IF;
    END IF;
  END IF;

  -- 5. Gross Total
  v_gross_total := GREATEST(0, COALESCE(v_subtotal, 0) - COALESCE(v_discount, 0) - COALESCE(v_coupon_discount, 0));

  -- 6. EARLY Customer Resolution (Critical for accurate credit linkage and customer account deductions)
  IF v_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      SELECT id INTO v_cust_id
      FROM public.profiles
      WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
      LIMIT 1;
    END IF;
  END IF;

  IF v_cust_id IS NULL AND v_clean_token != '' THEN
    SELECT customer_id INTO v_cust_id FROM public.offline_returns WHERE UPPER(TRIM(credit_token)) = v_clean_token LIMIT 1;
    IF v_cust_id IS NULL THEN
      SELECT customer_id INTO v_cust_id FROM public.pos_exchange_vouchers WHERE UPPER(TRIM(token)) = v_clean_token LIMIT 1;
    END IF;
    IF v_cust_id IS NULL THEN
      SELECT customer_id INTO v_cust_id FROM public.store_credit_vouchers WHERE UPPER(TRIM(token)) = v_clean_token LIMIT 1;
    END IF;
  END IF;

  -- 7. Process Store Credit / Voucher Redemption
  v_voucher_used := 0;
  IF COALESCE(_store_credit_used, 0) > 0 THEN
    IF v_clean_token != '' THEN
      -- A. Specific Voucher Token Redemption
      -- 1. Check offline_returns directly
      SELECT GREATEST(0, refund_amount - COALESCE(credit_used, 0)) INTO v_voucher_avail
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = v_clean_token 
        AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
        AND (expires_at IS NULL OR expires_at > now())
      FOR UPDATE;

      -- 2. Fallback to store_credit_vouchers
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(current_balance, 0) INTO v_voucher_avail
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND is_active = true
        FOR UPDATE;
      END IF;

      -- 3. Fallback to pos_exchange_vouchers
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(remaining_balance, 0) INTO v_voucher_avail
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND status = 'active'
        FOR UPDATE;
      END IF;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(_store_credit_used, v_voucher_avail, v_gross_total);
        v_voucher_token := v_clean_token;

        -- Update offline_returns with remaining credit_balance and appropriate active status
        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
            credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)),
            credit_token_status = CASE 
              WHEN (refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' 
              ELSE 'ACTIVE' 
            END,
            updated_at = now()
        WHERE UPPER(TRIM(credit_token)) = v_clean_token;

        -- Update pos_exchange_vouchers
        UPDATE public.pos_exchange_vouchers
        SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
            status = CASE WHEN remaining_balance - v_voucher_used <= 0 THEN 'redeemed' ELSE 'active' END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;

        -- Update store_credit_vouchers
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
            FOR UPDATE
          LOOP
            IF v_rem_to_deduct <= 0 THEN
              EXIT;
            END IF;

            v_alloc := LEAST(v_rem_to_deduct, v_ret_row.avail);
            v_rem_to_deduct := v_rem_to_deduct - v_alloc;

            UPDATE public.offline_returns
            SET credit_used = credit_used + v_alloc,
                credit_balance = GREATEST(0, refund_amount - (credit_used + v_alloc)),
                credit_token_status = CASE 
                  WHEN (refund_amount - (credit_used + v_alloc)) <= 0 THEN 'CONSUMED' 
                  ELSE 'ACTIVE' 
                END,
                updated_at = now()
            WHERE id = v_ret_row.id;

            IF v_ret_row.credit_token IS NOT NULL AND trim(v_ret_row.credit_token) != '' THEN
              UPDATE public.pos_exchange_vouchers
              SET remaining_balance = GREATEST(0, remaining_balance - v_alloc),
                  status = CASE WHEN (remaining_balance - v_alloc) <= 0 THEN 'redeemed' ELSE 'active' END,
                  updated_at = now()
              WHERE UPPER(TRIM(token)) = UPPER(TRIM(v_ret_row.credit_token));

              UPDATE public.store_credit_vouchers
              SET current_balance = GREATEST(0, current_balance - v_alloc),
                  is_active = ((current_balance - v_alloc) > 0),
                  redeemed_at = CASE WHEN (current_balance - v_alloc) <= 0 THEN now() ELSE redeemed_at END,
                  updated_at = now()
              WHERE UPPER(TRIM(token)) = UPPER(TRIM(v_ret_row.credit_token));

              IF v_voucher_token IS NULL THEN
                v_voucher_token := v_ret_row.credit_token;
              END IF;
            END IF;
          END LOOP;
        END;
      END IF;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 9. Generate Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 10. Customer Upsert / Link
  IF v_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, total_spent, total_visits, store_credit, store_credit_balance, last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        1,
        0,
        0,
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

  -- 13. Insert Items with Explicit Returnable & Sold Quantities
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
    item_cost := ROUND(COALESCE((elem->>'cost_price')::numeric, (elem->>'buying_price')::numeric, 0), 2);
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
      cost_price, qty, quantity, quantity_sold, quantity_returned, quantity_returnable,
      allocated_bill_discount, allocated_coupon_discount, final_unit_paid_price,
      total, line_gross_amount, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp,
      COALESCE(item_cost, 0), item_qty, item_qty, item_qty, 0, item_qty,
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
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, item_variant_id, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products SET stock = GREATEST(0, v_prev_stock - item_qty), updated_at = now() WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, NULL, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
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
    'credit_token', v_voucher_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text) TO authenticated, service_role, anon;

-- 3. Comprehensive get_customer_store_credit Supporting Partially Used Returns
CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Walk-in Customer';
  v_cust_phone text := '';
  v_norm_phone text := public.normalize_phone(_phone);
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_returns_sum numeric := 0;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, look up that specific voucher instrument
  IF v_clean_token != '' THEN
    SELECT 
      id, customer_id, customer_name, customer_phone,
      refund_amount, credit_used,
      GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
      expires_at
    INTO v_single_voucher
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_single_voucher.id IS NULL THEN
      SELECT 
        id, customer_id, customer_name, customer_phone,
        original_amount AS refund_amount, (original_amount - remaining_balance) AS credit_used,
        remaining_balance,
        expires_at
      INTO v_single_voucher
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
      LIMIT 1;
    END IF;

    IF v_single_voucher.id IS NULL THEN
      SELECT 
        id, customer_id, '' AS customer_name, customer_phone,
        initial_amount AS refund_amount, (initial_amount - current_balance) AS credit_used,
        current_balance AS remaining_balance,
        expires_at
      INTO v_single_voucher
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token
      LIMIT 1;
    END IF;

    IF v_single_voucher.id IS NOT NULL THEN
      IF v_single_voucher.expires_at IS NOT NULL AND v_single_voucher.expires_at < now() THEN
        v_balance := 0;
      ELSE
        v_balance := v_single_voucher.remaining_balance;
      END IF;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := COALESCE(v_single_voucher.customer_name, 'Customer');
      v_cust_phone := COALESCE(v_single_voucher.customer_phone, '');
      v_latest_token := v_clean_token;
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id
  ELSIF v_cust_id IS NOT NULL THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE id = v_cust_id;

    IF v_norm_phone = '' AND v_cust_phone != '' THEN
      v_norm_phone := public.normalize_phone(v_cust_phone);
    END IF;

  -- 3. Otherwise search by normalized phone
  ELSIF v_norm_phone != '' THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE public.normalize_phone(phone) = v_norm_phone
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      SELECT id, full_name, phone
      INTO v_cust_id, v_cust_name, v_cust_phone
      FROM public.profiles
      WHERE public.normalize_phone(phone) = v_norm_phone
      LIMIT 1;
      v_balance := 0;
    END IF;
  END IF;

  -- 4. Aggregate active unredeemed returns for this customer
  IF v_clean_token != '' THEN
    IF v_single_voucher.id IS NOT NULL AND v_balance > 0 THEN
      active_returns := jsonb_build_array(
        jsonb_build_object(
          'id', v_single_voucher.id,
          'credit_token', v_clean_token,
          'refund_amount', v_single_voucher.refund_amount,
          'credit_used', v_single_voucher.credit_used,
          'credit_balance', v_single_voucher.remaining_balance,
          'expires_at', v_single_voucher.expires_at
        )
      );
    END IF;
  ELSIF v_cust_id IS NOT NULL OR v_norm_phone != '' THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'return_number', r.return_number,
        'credit_token', r.credit_token,
        'refund_amount', r.refund_amount,
        'credit_used', COALESCE(r.credit_used, 0),
        'credit_balance', GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)),
        'created_at', r.created_at,
        'expires_at', r.expires_at
      ) ORDER BY r.created_at DESC
    ), '[]'::jsonb)
    INTO active_returns
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

    -- Calculate total active unredeemed balance
    SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
    INTO v_returns_sum
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

    v_balance := GREATEST(v_balance, v_returns_sum);

    -- Get latest active token
    IF jsonb_array_length(active_returns) > 0 THEN
      v_latest_token := active_returns->0->>'credit_token';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Customer'),
    'customer_phone', COALESCE(v_cust_phone, ''),
    'available_credit', v_balance,
    'credit_token', v_latest_token,
    'active_returns', active_returns,
    'history', recent_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;

-- 4. Update get_pos_customer_intel to Accurately Reflect Active / Partially Used Returns
CREATE OR REPLACE FUNCTION public.get_pos_customer_intel(
  p_customer_id uuid DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  p_phone text DEFAULT '',
  _phone text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid := COALESCE(p_customer_id, _customer_id);
  v_phone text := COALESCE(NULLIF(p_phone, ''), _phone);
  v_norm_phone text := public.normalize_phone(v_phone);
  v_prof record;
  v_recent_sales jsonb;
  v_recent_orders jsonb;
  v_total_purchases integer;
  v_total_spend numeric;
  v_credit_balance numeric := 0;
  v_returns_sum numeric := 0;
BEGIN
  IF v_id IS NULL AND length(v_norm_phone) = 10 THEN
    SELECT id INTO v_id FROM public.pos_customers WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.profiles WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_id;
  IF v_prof.id IS NULL THEN
    SELECT 
      id, name AS full_name, phone, email, city, address, COALESCE(store_credit_balance, store_credit, 0) AS store_credit_balance
    INTO v_prof 
    FROM public.pos_customers WHERE id = v_id;
  END IF;

  IF v_prof.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate active returns credit (including partially used tokens)
  SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
  INTO v_returns_sum
  FROM public.offline_returns r
  WHERE (r.customer_id = v_id OR (v_prof.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(v_prof.phone)))
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0;

  v_credit_balance := GREATEST(COALESCE(v_prof.store_credit_balance, 0), v_returns_sum);

  -- Combined total purchases and spend
  SELECT 
    (COALESCE((SELECT COUNT(*) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT COUNT(*) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0)),
    (COALESCE((SELECT SUM(total) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT SUM(total) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0))
  INTO v_total_purchases, v_total_spend;

  -- Recent POS Sales
  SELECT jsonb_agg(sub) INTO v_recent_sales
  FROM (
    SELECT id, sale_number, total, payment_method, return_status, created_at
    FROM public.offline_sales
    WHERE customer_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  -- Recent Online Orders
  SELECT jsonb_agg(sub) INTO v_recent_orders
  FROM (
    SELECT id, order_number, total, payment_method, status, created_at
    FROM public.orders
    WHERE user_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'id', v_prof.id,
    'name', COALESCE(NULLIF(v_prof.full_name, ''), 'Guest Customer'),
    'phone', COALESCE(v_prof.phone, ''),
    'email', COALESCE(v_prof.email, ''),
    'city', COALESCE(v_prof.city, ''),
    'address', COALESCE(v_prof.address, ''),
    'total_purchases', v_total_purchases,
    'total_spend', v_total_spend,
    'store_credit_balance', v_credit_balance,
    'recentSales', COALESCE(v_recent_sales, '[]'::jsonb),
    'recentOrders', COALESCE(v_recent_orders, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customer_intel(uuid, uuid, text, text) TO authenticated, anon, service_role;

-- 5. Update search_pos_customers to accurately calculate store_credit_balance
CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS TABLE(
  id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  state text,
  pincode text,
  notes text,
  total_purchases integer,
  total_spend numeric,
  store_credit_balance numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean text := trim(_query);
  v_norm text := public.normalize_phone(v_clean);
  v_voucher_cust_id uuid := NULL;
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  IF length(v_clean) >= 3 THEN
    SELECT customer_id INTO v_voucher_cust_id
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = UPPER(v_clean)
      AND (credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR credit_token_status IS NULL)
      AND (expires_at IS NULL OR expires_at > now())
      AND (refund_amount - COALESCE(credit_used, 0)) > 0
    LIMIT 1;

    IF v_voucher_cust_id IS NULL THEN
      SELECT customer_id INTO v_voucher_cust_id
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = UPPER(v_clean)
        AND status = 'active'
        AND remaining_balance > 0
      LIMIT 1;
    END IF;

    IF v_voucher_cust_id IS NULL THEN
      SELECT customer_id INTO v_voucher_cust_id
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = UPPER(v_clean)
        AND is_active = true
        AND current_balance > 0
      LIMIT 1;
    END IF;
  END IF;

  RETURN QUERY
  WITH combined_customers AS (
    SELECT 
      pc.id,
      pc.name,
      pc.phone,
      pc.email,
      pc.city,
      pc.address,
      pc.state,
      pc.pincode,
      pc.notes,
      pc.created_at,
      pc.updated_at
    FROM public.pos_customers pc

    UNION ALL

    SELECT 
      p.id,
      COALESCE(NULLIF(trim(p.full_name), ''), 'Online Customer') AS name,
      p.phone,
      p.email,
      p.city,
      p.address,
      NULL::text AS state,
      NULL::text AS pincode,
      NULL::text AS notes,
      p.created_at,
      p.updated_at
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pos_customers pc2 
      WHERE pc2.id = p.id 
         OR (p.phone IS NOT NULL AND p.phone != '' AND public.normalize_phone(pc2.phone) = public.normalize_phone(p.phone))
    )
  ),
  deduped AS (
    SELECT DISTINCT ON (c.id)
      c.id,
      c.name,
      c.phone,
      c.email,
      c.city,
      c.address,
      c.state,
      c.pincode,
      c.notes,
      c.created_at,
      c.updated_at
    FROM combined_customers c
    ORDER BY c.id, c.updated_at DESC
  )
  SELECT 
    d.id,
    d.name,
    d.phone,
    d.email,
    d.city,
    d.address,
    d.state,
    d.pincode,
    d.notes,
    (
      COALESCE((SELECT COUNT(*)::integer FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT COUNT(*)::integer FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::integer AS total_purchases,
    (
      COALESCE((SELECT SUM(s.total)::numeric FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT SUM(o.total)::numeric FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::numeric AS total_spend,
    GREATEST(
      COALESCE((SELECT pc.store_credit_balance FROM public.pos_customers pc WHERE pc.id = d.id), 0),
      COALESCE((
        SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
        FROM public.offline_returns r
        WHERE (r.customer_id = d.id OR (d.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(d.phone)))
          AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL)
          AND (r.expires_at IS NULL OR r.expires_at >= now())
      ), 0)
    )::numeric AS store_credit_balance,
    d.created_at,
    d.updated_at
  FROM deduped d
  WHERE 
    (v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id)
    OR d.name ILIKE '%' || v_clean || '%'
    OR (v_norm != '' AND public.normalize_phone(d.phone) = v_norm)
    OR d.phone ILIKE '%' || v_clean || '%'
    OR d.email ILIKE '%' || v_clean || '%'
    OR d.city ILIKE '%' || v_clean || '%'
    OR d.id::text ILIKE '%' || v_clean || '%'
  ORDER BY 
    CASE 
      WHEN v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id THEN 0
      WHEN v_norm != '' AND public.normalize_phone(d.phone) = v_norm THEN 1
      WHEN lower(trim(d.name)) = lower(v_clean) THEN 2
      WHEN lower(trim(d.name)) ILIKE lower(v_clean) || '%' THEN 3
      ELSE 4
    END,
    d.updated_at DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pos_customers(text) TO authenticated, anon, service_role;

-- 6. Harden admin_void_offline_sale to Restore offline_returns credit_balance & credit_used
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Voided by Store Admin',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  target_sale record;
  target_item record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Voided by Store Admin');
  v_eff_var_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  net_restore_qty integer;
  uid uuid := auth.uid();
BEGIN
  -- 1. Fetch target sale
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sale not found');
  END IF;

  -- 2. Idempotency Check
  IF target_sale.status = 'cancelled' OR target_sale.is_voided = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'sale_id', _sale_id,
      'sale_number', target_sale.sale_number,
      'items_restored', 0,
      'total_units_restored', 0,
      'message', 'Sale #' || target_sale.sale_number || ' has already been cancelled.'
    );
  END IF;

  -- 3. Stock restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        v_eff_var_id := target_item.variant_id;

        IF v_eff_var_id IS NULL AND target_item.sku IS NOT NULL AND trim(target_item.sku) != '' THEN
          SELECT pv.id, pv.product_id INTO v_eff_var_id, target_item.product_id
          FROM public.product_variants pv
          WHERE lower(trim(pv.sku)) = lower(trim(target_item.sku))
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NULL AND target_item.product_id IS NOT NULL THEN
          SELECT id INTO v_eff_var_id
          FROM public.product_variants
          WHERE product_id = target_item.product_id
            AND (is_active IS NULL OR is_active = true)
          ORDER BY stock DESC
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_eff_var_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_eff_var_id;

          IF target_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = target_item.product_id),
                updated_at = now()
            WHERE id = target_item.product_id;
          END IF;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, transaction_type,
            quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, notes, created_by
          ) VALUES (
            target_item.product_id, v_eff_var_id,
            'adjustment'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type,
            net_restore_qty, v_prev_stock, v_new_stock,
            'offline_sale_void', _sale_id,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        ELSIF target_item.product_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.products WHERE id = target_item.product_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.product_id;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, transaction_type,
            quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, notes, created_by
          ) VALUES (
            target_item.product_id, NULL,
            'adjustment'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type,
            net_restore_qty, v_prev_stock, v_new_stock,
            'offline_sale_void', _sale_id,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        END IF;

        items_restored := items_restored + 1;
        total_units_restored := total_units_restored + net_restore_qty;
      END IF;
    END LOOP;
  END IF;

  -- 4. Restore Customer Store Credit / Voucher Balances if used
  IF COALESCE(target_sale.store_credit_used, 0) > 0 THEN
    -- Restore voucher balances across all voucher tables and offline_returns
    IF target_sale.credit_token_used IS NOT NULL AND trim(target_sale.credit_token_used) != '' THEN
      UPDATE public.offline_returns
      SET credit_used = GREATEST(0, COALESCE(credit_used, 0) - target_sale.store_credit_used),
          credit_balance = refund_amount - GREATEST(0, COALESCE(credit_used, 0) - target_sale.store_credit_used),
          credit_token_status = 'ACTIVE',
          updated_at = now()
      WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(target_sale.credit_token_used));

      UPDATE public.store_credit_vouchers
      SET current_balance = current_balance + target_sale.store_credit_used,
          is_active = true,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = UPPER(TRIM(target_sale.credit_token_used));

      UPDATE public.pos_exchange_vouchers
      SET remaining_balance = remaining_balance + target_sale.store_credit_used,
          status = 'active',
          updated_at = now()
      WHERE UPPER(TRIM(token)) = UPPER(TRIM(target_sale.credit_token_used));
    END IF;

    -- Restore customer store credit ledger and balances
    IF target_sale.customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          store_credit = COALESCE(store_credit, 0) + target_sale.store_credit_used,
          total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
          updated_at = now()
      WHERE id = target_sale.customer_id;

      UPDATE public.profiles
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          updated_at = now()
      WHERE id = target_sale.customer_id;
    END IF;
  ELSIF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
        updated_at = now()
    WHERE id = target_sale.customer_id;
  END IF;

  -- 5. Mark sale as CANCELLED and VOIDED
  UPDATE public.offline_sales
  SET status = 'cancelled',
      is_voided = true,
      void_reason = v_clean_reason,
      voided_at = now(),
      voided_by = uid,
      notes = '[VOIDED] ' || v_clean_reason || CASE WHEN trim(COALESCE(notes, '')) != '' THEN ' | Original Notes: ' || notes ELSE '' END,
      updated_at = now()
  WHERE id = _sale_id;

  -- 6. Zero out returnable quantities on items since sale is voided
  UPDATE public.offline_sale_items
  SET quantity_returnable = 0
  WHERE sale_id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' voided successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;
