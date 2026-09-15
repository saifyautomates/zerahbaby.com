-- =====================================================================
-- Migration: 20260928000246_unify_place_offline_sale_canonical.sql
-- Description: Drop all conflicting overloaded signatures of place_offline_sale
--              and define the single unified canonical signature with all
--              parameters supported so PostgREST resolves calls unambiguously.
-- =====================================================================

-- 1. Drop conflicting overloaded signatures
DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text
);

DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text, text
);

DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text
);

DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid
);

DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text
);

DROP FUNCTION IF EXISTS public.place_offline_sale(
  text, text, text, text, numeric, text, jsonb, uuid, numeric, text
);

-- 2. Define Single Unified Canonical place_offline_sale
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

    -- Decrement variant stock (trg_sync_variant_to_product_stock automatically updates parent products.stock)
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
      -- Decrement parent product stock ONLY if variant is not specified
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

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text
) TO authenticated, anon, service_role;

-- 3. Security Definer Helper for Checkout Session Status (Safe inspection by session_id)
CREATE OR REPLACE FUNCTION public.get_checkout_session_status(_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rec record;
BEGIN
  IF _session_id IS NULL OR trim(_session_id) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Missing session ID');
  END IF;

  SELECT session_id, status, order_id, total, currency, payment_method, expires_at, created_at
  INTO v_rec
  FROM public.checkout_sessions
  WHERE session_id = trim(_session_id)
  LIMIT 1;

  IF v_rec.session_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Session not found');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'session_id', v_rec.session_id,
    'status', v_rec.status,
    'order_id', v_rec.order_id,
    'total', v_rec.total,
    'currency', v_rec.currency,
    'payment_method', v_rec.payment_method,
    'expires_at', v_rec.expires_at,
    'created_at', v_rec.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_checkout_session_status(text) TO authenticated, anon, service_role;
