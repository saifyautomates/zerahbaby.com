-- =====================================================================
-- Migration: 20260928000242_fix_single_inventory_deduction_and_restock.sql
-- Description: Ensure ELSIF is used for parent product stock deduction and restock
--              in place_offline_sale and process_offline_return so variant-level
--              inventory isn't deducted/restocked twice via trg_sync_variant_to_product_stock.
-- =====================================================================

-- 1. place_offline_sale
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
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
  _customer_email text DEFAULT NULL,
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
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_voucher_avail numeric := 0;
  v_effective_payment_method text;
  v_sale_id uuid;
  v_sale_number text;
  v_token_number int;
  v_cust_id uuid := _customer_id;
  v_clean_phone text;
  v_existing_sale record;
  v_prev_stock int;
  v_new_stock int;
  v_coupon_record record;
  v_credit_rec record;
BEGIN
  -- 1. Authorization: Staff, Admin, or internal/service/session
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT public.has_role(uid, 'pos_user')
       AND NOT public.has_role(uid, 'staff')
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
    END IF;
  END IF;

  -- 2. Clean Phone
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

  -- 4. Calculate Subtotal
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;

  -- 5. Calculate Discount
  IF _discount_type IN ('percentage', 'percent') THEN
    v_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0) / 100.0), 2);
  ELSIF _discount_type = 'fixed' THEN
    v_discount := LEAST(v_subtotal, COALESCE(_discount_value, 0));
  ELSE
    v_discount := 0;
  END IF;

  -- 6. Coupon validation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code)) AND is_active = true
      AND (start_date IS NULL OR start_date <= now())
      AND (end_date IS NULL OR end_date >= now())
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF v_coupon_record.min_order_amount IS NULL OR (v_subtotal - v_discount) >= v_coupon_record.min_order_amount THEN
        IF v_coupon_record.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND(((v_subtotal - v_discount) * v_coupon_record.discount_value / 100.0), 2);
          IF v_coupon_record.max_discount_amount IS NOT NULL THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_record.max_discount_amount);
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_subtotal - v_discount, v_coupon_record.discount_value);
        END IF;
      END IF;
    END IF;
  END IF;

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Validate & Atomically Redeem Store Credit Voucher
  IF _store_credit_used > 0 OR v_clean_token != '' THEN
    IF v_clean_token != '' THEN
      -- Check in offline_returns first
      SELECT * INTO v_credit_rec
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = v_clean_token
      FOR UPDATE;

      IF v_credit_rec.id IS NOT NULL THEN
        v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));
        v_voucher_token := v_clean_token;
      ELSE
        -- Fallback check in store_credit_vouchers
        SELECT * INTO v_credit_rec
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token
          AND is_active = true
        FOR UPDATE;

        IF v_credit_rec.id IS NOT NULL THEN
          v_voucher_avail := GREATEST(0, v_credit_rec.current_balance);
          v_voucher_token := v_clean_token;
        END IF;
      END IF;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail), v_voucher_avail, v_gross_total);
        IF v_voucher_used <= 0 THEN
          v_voucher_used := LEAST(v_voucher_avail, v_gross_total);
        END IF;

        -- Update offline_returns
        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
            credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)),
            credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
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
      END IF;
    ELSIF v_cust_id IS NOT NULL AND _store_credit_used > 0 THEN
      -- Customer Account Store Credit
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);
    END IF;

    -- Deduct from customer profile if customer linked
    IF v_cust_id IS NOT NULL AND v_voucher_used > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
          store_credit = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
          updated_at = now()
      WHERE id = v_cust_id;
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
        name, phone, email, total_spent, total_visits, store_credit, last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        1,
        0,
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = total_spent + v_gross_total,
          total_visits = total_visits + 1,
          last_visit = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = total_spent + v_gross_total,
        total_visits = total_visits + 1,
        last_visit = now()
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
    v_subtotal,
    v_discount,
    _discount_type,
    _discount_value,
    _coupon_code,
    v_coupon_discount,
    v_voucher_used,
    v_voucher_token,
    v_gross_total,
    COALESCE(_notes, ''),
    NULLIF(trim(_idempotency_key), ''),
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 13. Insert Items & Deduct Stock
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_price);
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    -- Look up cost price safely
    BEGIN
      SELECT COALESCE(cost_price, buying_price, 0) INTO item_cost
      FROM public.product_costs
      WHERE (item_variant_id IS NOT NULL AND variant_id = item_variant_id)
         OR (item_product_id IS NOT NULL AND product_id = item_product_id)
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      item_cost := 0;
    END;

    INSERT INTO public.offline_sale_items (
      sale_id, product_id, variant_id, product_slug, name, product_name,
      variant_info, sku, barcode, price, unit_selling_price, mrp,
      cost_price, qty, quantity, total, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp,
      COALESCE(item_cost, 0), item_qty, item_qty, (item_price * item_qty), now()
    );

    -- Decrement variant stock (trg_sync_variant_to_product_stock updates parent products.stock)
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - item_qty);
        UPDATE public.product_variants SET stock = v_new_stock, updated_at = now() WHERE id = item_variant_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, item_variant_id, -item_qty,
          'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
          v_sale_id, 'POS Sale #' || v_sale_number, uid, now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      -- Decrement parent product stock ONLY if variant does not exist
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

  -- 14. Record Store Credit Redemption in Ledger
  IF v_voucher_used > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id, customer_name, customer_phone, type, amount,
      balance_before, balance_after, credit_token, source_sale_id, notes, created_by, created_at
    ) VALUES (
      v_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(v_clean_phone, ''),
      'CREDIT_REDEEMED',
      v_voucher_used,
      v_voucher_avail,
      GREATEST(0, v_voucher_avail - v_voucher_used),
      v_voucher_token,
      v_sale_id,
      'Redeemed at POS Sale #' || v_sale_number || COALESCE(' (Token: ' || v_voucher_token || ')', ''),
      uid,
      now()
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'pos_token_number', v_token_number,
    'total', v_gross_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'credit_token_used', v_voucher_token,
    'payable_total', v_payable_total,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text, text
) TO authenticated, anon, service_role;

-- 2. process_offline_return
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_qty int;
  item_refund_price numeric;
  item_mrp numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  item_orig_sale_item_id uuid;
  computed_total_refund numeric := 0;
  v_existing_return record;
  v_prod record;
  v_variant record;
  v_orig_sale record;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
  v_reason_text text := COALESCE(NULLIF(trim(_return_reason), ''), 'Customer Return');
  v_chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_iter int := 0;
  v_exists boolean := false;
BEGIN
  -- 1. Authorization check: Staff, Admin, or internal/service/session
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT public.has_role(uid, 'pos_user')
       AND NOT public.has_role(uid, 'staff')
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
       AND NOT public.is_admin()
    THEN
      RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can process returns';
    END IF;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, status, credit_token, customer_name, expires_at
    INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
       OR notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'refund_amount', v_existing_return.refund_amount,
        'status', v_existing_return.status,
        'credit_token', v_existing_return.credit_token,
        'expires_at', v_existing_return.expires_at,
        'customer_name', v_existing_return.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Customer Upsert if needed
  IF v_resolved_cust_id IS NULL AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_resolved_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(v_clean_phone, 10) || '%'
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_visits,
        store_credit,
        store_credit_balance,
        last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        0,
        1,
        0,
        0,
        now()
      ) RETURNING id INTO v_resolved_cust_id;
    END IF;
  END IF;

  -- 4. Calculate total refund
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_count := item_count + 1;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
  END LOOP;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return items list cannot be empty';
  END IF;

  -- 5. Link original sale if provided
  v_clean_sale_id := _original_sale_id;
  IF v_clean_sale_id IS NOT NULL THEN
    SELECT sale_number INTO v_orig_sale_number
    FROM public.offline_sales
    WHERE id = v_clean_sale_id;
  END IF;

  -- 6. Generate Return Number and Credit Token
  new_return_id := gen_random_uuid();
  new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- Generate 4-character token
  LOOP
    new_credit_token := '';
    FOR i IN 1..4 LOOP
      new_credit_token := new_credit_token || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    END LOOP;

    SELECT EXISTS (
      SELECT 1 FROM public.offline_returns WHERE UPPER(credit_token) = new_credit_token AND credit_token_status = 'ACTIVE'
    ) OR EXISTS (
      SELECT 1 FROM public.pos_exchange_vouchers WHERE UPPER(token) = new_credit_token AND status = 'active'
    ) OR EXISTS (
      SELECT 1 FROM public.store_credit_vouchers WHERE UPPER(token) = new_credit_token AND is_active = true
    ) INTO v_exists;

    IF NOT v_exists THEN
      EXIT;
    END IF;

    v_iter := v_iter + 1;
    IF v_iter > 200 THEN
      new_credit_token := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));
      EXIT;
    END IF;
  END LOOP;

  -- 7. Insert into public.offline_returns
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_amount,
    credit_used,
    credit_balance,
    credit_token,
    credit_token_status,
    status,
    refund_status,
    reason,
    return_reason,
    notes,
    created_by,
    idempotency_key,
    credit_expires_at,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_refund_method), ''), 'exchange_credit'),
    computed_total_refund,
    0,
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    'completed',
    'completed',
    v_reason_text,
    v_reason_text,
    COALESCE(_notes, ''),
    uid,
    NULLIF(trim(_idempotency_key), ''),
    v_expiry_date,
    v_expiry_date,
    now(),
    now()
  ) RETURNING id INTO new_return_id;

  -- 8. Synchronize to pos_exchange_vouchers
  IF computed_total_refund > 0 THEN
    INSERT INTO public.pos_exchange_vouchers (
      token,
      return_id,
      customer_id,
      customer_phone,
      customer_name,
      original_amount,
      remaining_balance,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      new_credit_token,
      new_return_id,
      v_resolved_cust_id,
      COALESCE(v_clean_phone, ''),
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      computed_total_refund,
      computed_total_refund,
      'active',
      v_expiry_date,
      now(),
      now()
    );

    -- 9. Synchronize to store_credit_vouchers
    INSERT INTO public.store_credit_vouchers (
      token,
      customer_id,
      customer_phone,
      initial_amount,
      current_balance,
      is_active,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      new_credit_token,
      v_resolved_cust_id,
      COALESCE(v_clean_phone, ''),
      computed_total_refund,
      computed_total_refund,
      true,
      v_expiry_date,
      now(),
      now()
    );

    -- 10. Synchronize customer store credit
    IF v_resolved_cust_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + computed_total_refund,
          store_credit = COALESCE(store_credit, 0) + computed_total_refund,
          updated_at = now()
      WHERE id = v_resolved_cust_id;
    END IF;

    -- 11. Record in store_credit_ledger
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      credit_token,
      source_return_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(v_clean_phone, ''),
      'CREDIT_ISSUED',
      computed_total_refund,
      0,
      computed_total_refund,
      new_credit_token,
      new_return_id,
      'Return #' || new_return_number || ' exchange credit issued',
      uid,
      now()
    );
  END IF;

  -- 12. Insert return line items & Restock Inventory
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Returned Item');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    INSERT INTO public.offline_return_items (
      return_id,
      original_sale_item_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      variant_info,
      sku,
      barcode,
      qty,
      quantity,
      refund_price,
      mrp,
      created_at
    ) VALUES (
      new_return_id,
      item_orig_sale_item_id,
      item_product_id,
      item_variant_id,
      item_slug,
      item_name,
      item_name,
      item_variant_info,
      item_sku,
      item_barcode,
      item_qty,
      item_qty,
      item_refund_price,
      item_mrp,
      now()
    );

    -- Restock Variant (trg_sync_variant_to_product_stock updates parent products.stock)
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.product_variants
        SET stock = v_new_stock, updated_at = now()
        WHERE id = item_variant_id;

        -- Record inventory transaction
        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          quantity,
          type,
          transaction_type,
          reference_id,
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          item_variant_id,
          item_qty,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      -- Restock Parent Product ONLY when item_variant_id IS NULL
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products
        SET stock = v_prev_stock + item_qty, updated_at = now()
        WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id,
          variant_id,
          quantity,
          type,
          transaction_type,
          reference_id,
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          NULL,
          item_qty,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
        );
      END IF;
    END IF;
  END LOOP;

  -- 13. Return canonical complete result
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'status', 'completed',
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text
) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
