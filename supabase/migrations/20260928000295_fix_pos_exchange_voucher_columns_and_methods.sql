-- Migration: 20260928000295_fix_pos_exchange_voucher_columns_and_methods.sql
-- Description: 
-- 1. Fix store_credit_vouchers column reference in place_offline_sale (use current_balance, NOT remaining_balance).
-- 2. Add offline_returns fallback lookup for credit tokens in place_offline_sale.
-- 3. In process_offline_return, recognize 'exchange_credit' and 'credit' alongside 'store_credit', 'exchange', 'voucher'.

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
        'total', v_existing_sale.total,
        'subtotal', v_existing_sale.subtotal,
        'discount', v_existing_sale.discount,
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_id', v_existing_sale.customer_id,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Authorization
  IF current_user != 'service_role' AND COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    IF uid IS NULL THEN
      RAISE EXCEPTION 'Authentication required for POS sales';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin', 'owner', 'manager', 'pos_user')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (COALESCE(is_admin, false) = true OR COALESCE(is_super_admin, false) = true OR COALESCE(is_staff, false) = true)
      ) OR
      public.is_admin() OR
      public.is_staff_or_admin() OR
      EXISTS (
        SELECT 1 FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only staff or administrators can place offline sales';
    END IF;
  END IF;

  -- 3. Calculate Subtotal from Items
  v_subtotal := 0;
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := GREATEST(1, COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1));
    item_price := GREATEST(0, COALESCE((elem->>'price')::numeric, 0));
    v_subtotal := COALESCE(v_subtotal, 0) + (item_price * item_qty);
  END LOOP;

  -- 4. Calculate Order-level Discount
  v_discount := 0;
  IF _discount_type = 'percentage' AND COALESCE(_discount_value, 0) > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' AND COALESCE(_discount_value, 0) > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  END IF;

  -- 5. Calculate Coupon Discount if applicable
  v_coupon_discount := 0;
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF (v_coupon_record.valid_from IS NULL OR now() >= v_coupon_record.valid_from) AND
         (v_coupon_record.valid_until IS NULL OR now() <= v_coupon_record.valid_until) AND
         (v_coupon_record.usage_limit IS NULL OR v_coupon_record.usage_limit = 0 OR v_coupon_record.used_count < v_coupon_record.usage_limit) AND
         (COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0) <= 0 OR v_subtotal >= COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0)) THEN

        IF lower(v_coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
          v_coupon_discount := ROUND(((v_subtotal - v_discount) * v_coupon_record.discount_value) / 100, 2);
          IF COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount, 0) > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount));
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_coupon_record.discount_value, (v_subtotal - v_discount));
        END IF;

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1, updated_at = now()
        WHERE id = v_coupon_record.id;
      END IF;
    END IF;
  END IF;

  -- 6. Gross Total
  v_gross_total := GREATEST(0, COALESCE(v_subtotal, 0) - COALESCE(v_discount, 0) - COALESCE(v_coupon_discount, 0));

  -- 7. Process Store Credit / Voucher Redemption
  v_voucher_used := 0;
  IF COALESCE(_store_credit_used, 0) > 0 THEN
    IF v_clean_token != '' THEN
      -- Check store_credit_vouchers (current_balance)
      SELECT COALESCE(current_balance, 0) INTO v_voucher_avail
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token AND is_active = true
      FOR UPDATE;

      -- Fallback to pos_exchange_vouchers (remaining_balance)
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(remaining_balance, 0) INTO v_voucher_avail
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND status = 'active'
        FOR UPDATE;
      END IF;

      -- Fallback to offline_returns directly
      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT GREATEST(0, refund_amount - COALESCE(credit_used, 0)) INTO v_voucher_avail
        FROM public.offline_returns
        WHERE UPPER(TRIM(credit_token)) = v_clean_token 
          AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
          AND (expires_at IS NULL OR expires_at > now())
        FOR UPDATE;
      END IF;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(_store_credit_used, v_voucher_avail, v_gross_total);
        v_voucher_token := v_clean_token;

        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_voucher_used,
            credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
            updated_at = now()
        WHERE UPPER(TRIM(credit_token)) = v_clean_token;

        UPDATE public.pos_exchange_vouchers
        SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
            status = CASE WHEN remaining_balance - v_voucher_used <= 0 THEN 'redeemed' ELSE 'active' END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;

        UPDATE public.store_credit_vouchers
        SET current_balance = GREATEST(0, current_balance - v_voucher_used),
            is_active = (current_balance - v_voucher_used > 0),
            redeemed_at = CASE WHEN current_balance - v_voucher_used <= 0 THEN now() ELSE redeemed_at END,
            updated_at = now()
        WHERE UPPER(TRIM(token)) = v_clean_token;
      END IF;
    ELSIF v_cust_id IS NOT NULL AND _store_credit_used > 0 THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);
    END IF;

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
    item_price := GREATEST(0, COALESCE((elem->>'price')::numeric, 0));
    item_mrp := GREATEST(item_price, COALESCE((elem->>'mrp')::numeric, item_price));
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    -- Calculate allocated discount and final unit paid price
    item_line_subtotal := item_price * item_qty;
    item_bill_discount := CASE WHEN v_subtotal > 0 THEN ROUND((v_discount * item_line_subtotal) / v_subtotal, 2) ELSE 0 END;
    item_coupon_discount := CASE WHEN v_subtotal > 0 THEN ROUND((v_coupon_discount * item_line_subtotal) / v_subtotal, 2) ELSE 0 END;
    item_final_paid := GREATEST(0, item_price - ROUND((item_bill_discount + item_coupon_discount) / item_qty, 2));

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

    -- Fallback: resolve variant if missing but product has variants
    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_qty) DESC, stock DESC
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

-- Harmonize process_offline_return to auto-provision for exchange_credit and credit
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _idempotency_key text,
  _return_number text,
  _credit_token text,
  _customer_id uuid,
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _refund_method text,
  _items jsonb,
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _return_reason text DEFAULT 'Customer Return'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_resolved_cust_id uuid;
  v_norm_phone text := public.normalize_phone(_customer_phone);
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  computed_total_refund numeric := 0;
  elem jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_orig_sale_item_id uuid;
  item_qty int;
  item_refund_price numeric;
  item_mrp numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_variant_info text;
  v_prev_stock int;
  v_new_stock int;
  v_existing_return record;
  v_orig_sale record;
  v_orig_item record;
  v_cust_rec record;
  v_clean_sale_id uuid := NULL;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '90 days';
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_effective_refund_method text := lower(trim(COALESCE(_refund_method, 'store_credit')));
BEGIN
  -- 1. Check clean sale id
  IF _original_sale_id IS NOT NULL THEN
    v_clean_sale_id := _original_sale_id;
  END IF;

  -- 2. Check Idempotency Key
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit
      FROM public.pos_customers
      WHERE id = v_existing_return.customer_id;

      RETURN jsonb_build_object(
        'success', true,
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'refund_amount', v_existing_return.refund_amount,
        'credit_token', v_existing_return.credit_token,
        'customer_name', v_existing_return.customer_name,
        'customer_id', v_existing_return.customer_id,
        'available_credit', COALESCE(v_prev_credit, 0),
        'original_sale_id', v_existing_return.original_sale_id,
        'original_sale_number', v_existing_return.original_sale_number,
        'expires_at', v_existing_return.expires_at,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Resolve Customer Record & Linkage
  v_resolved_cust_id := public.resolve_or_create_customer(
    _customer_name,
    _customer_phone,
    _customer_email,
    _customer_id
  );

  SELECT id, name, phone, email, COALESCE(store_credit_balance, store_credit, 0) AS store_credit_balance
  INTO v_cust_rec
  FROM public.pos_customers
  WHERE id = v_resolved_cust_id;

  v_prev_credit := COALESCE(v_cust_rec.store_credit_balance, 0);

  -- 4. Validate Original Sale if provided
  IF _original_sale_id IS NOT NULL THEN
    SELECT id, sale_number, total, return_status INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id;

    IF v_orig_sale.id IS NOT NULL THEN
      v_orig_sale_number := v_orig_sale.sale_number;
    END IF;
  END IF;

  -- 5. Calculate Total Refund Amount
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := GREATEST(1, COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1));
    item_refund_price := GREATEST(0, COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0));
    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
  END LOOP;

  -- 6. Generate Return Number and Credit Token
  new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := COALESCE(NULLIF(trim(_credit_token), ''), 'EXCH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)));

  -- 7. Insert Return Record
  INSERT INTO public.offline_returns (
    idempotency_key,
    return_number,
    credit_token,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_amount,
    notes,
    original_sale_id,
    original_sale_number,
    return_reason,
    created_by,
    created_at,
    updated_at,
    expires_at
  ) VALUES (
    NULLIF(trim(_idempotency_key), ''),
    new_return_number,
    new_credit_token,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    COALESCE(v_norm_phone, v_cust_rec.phone, ''),
    COALESCE(trim(_customer_email), v_cust_rec.email, ''),
    v_effective_refund_method,
    computed_total_refund,
    COALESCE(_notes, ''),
    v_clean_sale_id,
    v_orig_sale_number,
    COALESCE(_return_reason, 'Customer Return'),
    auth.uid(),
    now(),
    now(),
    v_expiry_date
  ) RETURNING id INTO new_return_id;

  -- 8. Auto-provision Store Credit Vouchers if refund method is store_credit / exchange / exchange_credit / credit / voucher
  IF v_effective_refund_method IN ('store_credit', 'exchange', 'exchange_credit', 'credit', 'voucher') THEN
    INSERT INTO public.store_credit_vouchers (
      token,
      return_id,
      customer_id,
      customer_name,
      customer_phone,
      initial_amount,
      current_balance,
      is_active,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      new_credit_token,
      new_return_id,
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
      COALESCE(v_norm_phone, v_cust_rec.phone, ''),
      computed_total_refund,
      computed_total_refund,
      true,
      v_expiry_date,
      now(),
      now()
    ) ON CONFLICT (token) DO UPDATE SET
      current_balance = EXCLUDED.current_balance,
      is_active = true,
      updated_at = now();

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
      v_norm_phone,
      COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
      computed_total_refund,
      computed_total_refund,
      'active',
      v_expiry_date,
      now(),
      now()
    ) ON CONFLICT (token) DO UPDATE SET
      remaining_balance = EXCLUDED.remaining_balance,
      status = 'active',
      updated_at = now();

    -- 9. Insert Immutable Store Credit Ledger Audit Entry (CREDIT_ISSUED)
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
      COALESCE(v_norm_phone, v_cust_rec.phone, ''),
      new_credit_token,
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_prev_credit + computed_total_refund,
      'Store credit issued for Return #' || new_return_number,
      auth.uid(),
      now()
    );

    UPDATE public.pos_customers
    SET store_credit_balance = v_prev_credit + computed_total_refund,
        store_credit = v_prev_credit + computed_total_refund,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

    v_new_credit := v_prev_credit + computed_total_refund;
  ELSE
    v_new_credit := v_prev_credit;
  END IF;

  -- 10. Process Items and Restock Atomically
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

    IF elem->>'original_sale_item_id' IS NOT NULL AND trim(elem->>'original_sale_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    ELSE
      item_orig_sale_item_id := NULL;
    END IF;

    item_qty := GREATEST(1, COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1));
    item_refund_price := GREATEST(0, COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0));
    item_mrp := GREATEST(item_refund_price, COALESCE((elem->>'mrp')::numeric, item_refund_price));
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_variant_info := elem->>'variant_info';

    -- Fallback: resolve variant if missing but product has variants
    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY stock DESC
      LIMIT 1;
    END IF;

    -- Insert into offline_return_items
    INSERT INTO public.offline_return_items (
      return_id, product_id, variant_id, original_sale_item_id,
      name, variant_info, sku, barcode, refund_price, mrp, qty, quantity, total, created_at
    ) VALUES (
      new_return_id, item_product_id, item_variant_id, item_orig_sale_item_id,
      item_name, item_variant_info, item_sku, item_barcode, item_refund_price, item_mrp,
      item_qty, item_qty, (item_refund_price * item_qty), now()
    );

    -- Restock Variant
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
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
          item_product_id, item_variant_id, item_qty,
          'return'::public.inventory_tx_type, 'return'::public.inventory_tx_type,
          new_return_id, 'Restocked from POS Return #' || new_return_number, auth.uid(), now()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.products SET stock = v_new_stock, updated_at = now() WHERE id = item_product_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
        ) VALUES (
          item_product_id, NULL, item_qty,
          'return'::public.inventory_tx_type, 'return'::public.inventory_tx_type,
          new_return_id, 'Restocked from POS Return #' || new_return_number, auth.uid(), now()
        );
      END IF;
    END IF;

    -- Update original sale item if linked
    IF item_orig_sale_item_id IS NOT NULL THEN
      UPDATE public.offline_sale_items
      SET quantity_returned = COALESCE(quantity_returned, 0) + item_qty,
          quantity_returnable = GREATEST(0, COALESCE(quantity_returnable, quantity_sold, qty, 1) - item_qty),
          return_status = CASE
            WHEN GREATEST(0, COALESCE(quantity_returnable, quantity_sold, qty, 1) - item_qty) = 0 THEN 'RETURNED'
            ELSE 'PARTIALLY_RETURNED'
          END
      WHERE id = item_orig_sale_item_id;
    END IF;
  END LOOP;

  -- 11. Update Original Sale Return Status if linked
  IF v_clean_sale_id IS NOT NULL THEN
    PERFORM public.recalculate_offline_sale_return_status(v_clean_sale_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    'customer_id', v_resolved_cust_id,
    'available_credit', v_new_credit,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'expires_at', v_expiry_date,
    'duplicate', false
  );
END;
$$;
