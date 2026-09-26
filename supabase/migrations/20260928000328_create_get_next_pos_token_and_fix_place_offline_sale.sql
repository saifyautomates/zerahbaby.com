-- ==============================================================================
-- Migration: 20260928000328_create_get_next_pos_token_and_fix_place_offline_sale.sql
-- Description: Define get_next_pos_token() function and harden token number in place_offline_sale.
-- ==============================================================================

-- 1. Create canonical get_next_pos_token functions so both naming conventions work
CREATE OR REPLACE FUNCTION public.get_next_pos_token()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 FROM public.offline_sales WHERE created_at >= date_trunc('day', now());
$$;

CREATE OR REPLACE FUNCTION public.get_next_pos_token_number()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 FROM public.offline_sales WHERE created_at >= date_trunc('day', now());
$$;

GRANT EXECUTE ON FUNCTION public.get_next_pos_token() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_pos_token_number() TO anon, authenticated, service_role;

-- 2. Update place_offline_sale to safely assign v_token_number
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
        'token_number', v_existing_sale.pos_token_number,
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
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin', 'pos_user', 'manager', 'owner')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (is_admin = true OR is_super_admin = true OR is_staff = true)
      ) OR
      public.is_admin() OR
      public.is_staff_or_admin()
    ) THEN
      RAISE EXCEPTION 'Only authorized administrators or staff may record offline sales';
    END IF;
  END IF;

  -- 3. Items validation
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item.';
  END IF;

  -- 4. Calculate Subtotal with strict zero-fallback
  v_subtotal := 0;
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero';
    END IF;
    item_price := COALESCE((elem->>'custom_price')::numeric, (elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;
  v_subtotal := COALESCE(v_subtotal, 0);

  -- 5. Bill-level discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'flat' AND _discount_value > 0 THEN
    v_discount := LEAST(v_subtotal, _discount_value);
  ELSE
    v_discount := 0;
  END IF;
  v_discount := COALESCE(v_discount, 0);

  -- 6. Coupon discount
  v_coupon_discount := 0;
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_coupon_record
    FROM public.coupons
    WHERE code = UPPER(TRIM(_coupon_code))
      AND is_active = true
      AND (valid_until IS NULL OR valid_until > now())
      AND (valid_from IS NULL OR valid_from <= now())
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF v_coupon_record.min_order_amount IS NULL OR v_subtotal >= v_coupon_record.min_order_amount THEN
        IF v_coupon_record.type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_record.value) / 100, 2);
          IF v_coupon_record.max_discount IS NOT NULL AND v_coupon_record.max_discount > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_record.max_discount);
          END IF;
        ELSE
          v_coupon_discount := v_coupon_record.value;
        END IF;
      END IF;
    END IF;
  END IF;
  v_coupon_discount := COALESCE(v_coupon_discount, 0);

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Store Credit / Exchange Voucher
  v_voucher_used := 0;
  v_voucher_token := NULL;
  IF _store_credit_used > 0 OR (v_clean_token != '' AND v_clean_token IS NOT NULL) THEN
    IF v_clean_token != '' AND v_clean_token IS NOT NULL THEN
      SELECT COALESCE(remaining_balance, original_amount, 0) INTO v_voucher_avail
      FROM public.pos_exchange_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token AND status = 'active'
      FOR UPDATE;

      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(current_balance, original_amount, 0) INTO v_voucher_avail
        FROM public.store_credit_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND is_active = true
        FOR UPDATE;
      END IF;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(v_gross_total, COALESCE(_store_credit_used, v_voucher_avail), v_voucher_avail);
        v_voucher_token := v_clean_token;
      END IF;
    ELSIF v_cust_id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      IF v_voucher_avail > 0 THEN
        v_voucher_used := LEAST(v_gross_total, _store_credit_used, v_voucher_avail);
      END IF;
    END IF;
  END IF;
  v_voucher_used := COALESCE(v_voucher_used, 0);

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Payment Method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(_payment_method, 'cash');
  END IF;

  -- 9. Customer Resolution
  IF v_cust_id IS NULL AND (v_clean_phone != '' OR (_customer_name IS NOT NULL AND trim(_customer_name) != '' AND trim(_customer_name) != 'Walk-in Customer')) THEN
    v_cust_id := public.resolve_or_create_customer(
      _customer_name,
      _customer_phone,
      _customer_email,
      NULL
    );
  END IF;

  -- 10. Generate Sale Number & Token Number safely
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 INTO v_token_number 
  FROM public.offline_sales 
  WHERE created_at >= date_trunc('day', now());

  -- 11. Deduct Store Credit
  IF v_voucher_used > 0 THEN
    IF v_voucher_token IS NOT NULL THEN
      UPDATE public.pos_exchange_vouchers
      SET remaining_balance = GREATEST(0, remaining_balance - v_voucher_used),
          status = CASE WHEN (remaining_balance - v_voucher_used) <= 0 THEN 'redeemed' ELSE 'active' END,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = v_voucher_token;

      UPDATE public.store_credit_vouchers
      SET current_balance = GREATEST(0, current_balance - v_voucher_used),
          is_active = (current_balance - v_voucher_used) > 0,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = v_voucher_token;
    END IF;

    IF v_cust_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_voucher_used),
          store_credit = GREATEST(0, COALESCE(store_credit, 0) - v_voucher_used),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  END IF;

  -- 12. Insert Sale
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
    _discount_type,
    _discount_value,
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

  -- 13. Insert Items & Deduct Stock with Variant Fallback Resolution & Buying Price Snapshot
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'custom_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_price);
    item_name := COALESCE(elem->>'name', 'Product');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    BEGIN
      SELECT COALESCE(pc.buying_price, pc.cost_price, p.buying_price, p.cost_price, 0) INTO item_cost
      FROM public.products p
      LEFT JOIN public.product_costs pc ON pc.product_id = p.id
      WHERE p.id = item_product_id
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      item_cost := 0;
    END;

    IF item_cost IS NULL OR item_cost = 0 THEN
      item_cost := COALESCE((elem->>'cost_price')::numeric, (elem->>'buying_price')::numeric, (elem->>'buyingPrice')::numeric, 0);
    END IF;

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
      variant_info, sku, barcode, price, unit_selling_price, unit_mrp, mrp,
      cost_price, buying_price, qty, quantity, quantity_sold, quantity_returnable, returnable_qty,
      final_unit_paid_price, line_gross_amount, total, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp, item_mrp,
      COALESCE(item_cost, 0), COALESCE(item_cost, 0), item_qty, item_qty, item_qty, item_qty, item_qty,
      item_price, (item_price * item_qty), (item_price * item_qty), now()
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

  NOTIFY pgrst, 'reload schema';

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'token_number', v_token_number,
    'total', v_gross_total,
    'payable_total', v_payable_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'store_credit_used', v_voucher_used,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'customer_id', v_cust_id,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(
  text, text, text, text, text, numeric, text, jsonb, uuid, numeric, text, numeric, text, uuid, text
) TO anon, authenticated, service_role;
