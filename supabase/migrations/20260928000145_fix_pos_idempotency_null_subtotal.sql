-- Migration: 20260928000145_fix_pos_idempotency_null_subtotal.sql
-- Fix: POS sale failed with "null value in column subtotal of relation offline_sales violates not-null constraint"
-- Root Cause: In place_offline_sale, the idempotency check used:
--   SELECT id, sale_number, total, subtotal, discount, customer_name
--   INTO v_sale_id, v_sale_number, v_final_total, v_subtotal, v_discount, _customer_name
--   FROM public.offline_sales WHERE idempotency_key = ...
-- In PL/pgSQL, when SELECT INTO finds NO rows (the normal path for every new sale),
-- ALL target variables are set to NULL. This wiped v_subtotal, v_discount, v_final_total,
-- and _customer_name to NULL. Then v_subtotal := v_subtotal + ... resulted in NULL + X = NULL.
-- Fix:
-- 1. Use a separate record variable v_existing_sale for the idempotency query.
-- 2. Explicitly initialize v_subtotal := 0, v_discount := 0, v_coupon_discount := 0, v_final_total := 0.
-- 3. Defensively compute subtotal using COALESCE(v_subtotal, 0) + (COALESCE(v_item.price, v_item.custom_price, 0) * COALESCE(v_item.qty, 1)).

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
  v_final_total numeric := 0;
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
BEGIN
  -- 1. Strict Staff/Admin Authorization
  IF uid IS NULL OR (
    NOT public.has_role(uid, 'admin')
    AND NOT public.has_role(uid, 'pos_user')
    AND NOT public.has_role(uid, 'staff')
    AND NOT EXISTS (
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

  -- 3. Idempotency Check (select into a record so scalars are NOT wiped to NULL on non-match!)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, customer_name
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
    name text,
    sku text,
    barcode text,
    variant_info text,
    price numeric,
    custom_price numeric,
    mrp numeric,
    cost_price numeric,
    qty int
  ) LOOP
    IF COALESCE(v_item.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    v_item_price := COALESCE(v_item.price, v_item.custom_price, 0);

    IF v_item_price < 0 THEN
      RAISE EXCEPTION 'Sale item price cannot be negative';
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item.qty);
    v_total_units := v_total_units + v_item.qty;
  END LOOP;

  -- 6. Apply Line/Sale Discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  -- 7. Apply POS Coupon if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF (v_applied_coupon.valid_from IS NULL OR now() >= v_applied_coupon.valid_from) AND
         (v_applied_coupon.valid_until IS NULL OR now() <= v_applied_coupon.valid_until) AND
         (v_applied_coupon.usage_limit IS NULL OR v_applied_coupon.usage_limit = 0 OR v_applied_coupon.used_count < v_applied_coupon.usage_limit) AND
         (COALESCE(v_applied_coupon.min_order_amount, v_applied_coupon.minimum_order_value, 0) <= 0 OR v_subtotal >= COALESCE(v_applied_coupon.min_order_amount, v_applied_coupon.minimum_order_value, 0)) THEN

        IF lower(v_applied_coupon.discount_type::text) IN ('percent', 'percentage') THEN
          v_coupon_discount := ROUND((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
          IF COALESCE(v_applied_coupon.max_discount_amount, v_applied_coupon.maximum_discount, 0) > 0 THEN
            v_coupon_discount := LEAST(v_coupon_discount, COALESCE(v_applied_coupon.max_discount_amount, v_applied_coupon.maximum_discount));
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_applied_coupon.discount_value, v_subtotal);
        END IF;

        -- Record coupon usage
        UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_applied_coupon.id;
      END IF;
    END IF;
  END IF;

  v_discount := v_discount + v_coupon_discount;
  v_final_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Handle Store Credit / Voucher Redemption
  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' AND _store_credit_used > 0 THEN
    v_voucher_token := UPPER(trim(_credit_token));
    SELECT * INTO v_voucher_record
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_voucher_token
    FOR UPDATE;

    IF v_voucher_record.id IS NULL THEN
      RAISE EXCEPTION 'Voucher / Exchange credit token not found';
    END IF;

    IF v_voucher_record.credit_token_status != 'ACTIVE' THEN
      RAISE EXCEPTION 'Voucher token is not active (Status: %)', v_voucher_record.credit_token_status;
    END IF;

    IF v_voucher_record.expires_at IS NOT NULL AND v_voucher_record.expires_at < now() THEN
      RAISE EXCEPTION 'Voucher token has expired on %', v_voucher_record.expires_at;
    END IF;

    v_voucher_used := LEAST(_store_credit_used, v_voucher_record.refund_amount, v_final_total);
    v_final_total := GREATEST(0, v_final_total - v_voucher_used);

    -- Update Voucher Status
    IF v_voucher_used >= v_voucher_record.refund_amount THEN
      UPDATE public.offline_returns
      SET credit_token_status = 'REDEEMED',
          notes = COALESCE(notes, '') || ' | Fully redeemed in POS Sale',
          updated_at = now()
      WHERE id = v_voucher_record.id;
    ELSE
      UPDATE public.offline_returns
      SET refund_amount = refund_amount - v_voucher_used,
          notes = COALESCE(notes, '') || ' | Partially redeemed: ' || v_voucher_used,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    END IF;
  ELSIF _store_credit_used > 0 AND v_cust_id IS NOT NULL THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_curr_balance
    FROM public.pos_customers
    WHERE id = v_cust_id
    FOR UPDATE;

    IF v_curr_balance < _store_credit_used THEN
      RAISE EXCEPTION 'Insufficient customer store credit balance (Available: %, Requested: %)', v_curr_balance, _store_credit_used;
    END IF;

    v_voucher_used := LEAST(_store_credit_used, v_final_total);
    v_final_total := GREATEST(0, v_final_total - v_voucher_used);
    v_new_balance := v_curr_balance - v_voucher_used;

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_balance,
        store_credit = v_new_balance,
        last_visit = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 9. Resolve or Upsert Customer Profile
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  IF v_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id INTO v_cust_id FROM public.pos_customers WHERE phone = v_clean_phone LIMIT 1;
    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (name, phone, email, total_spent, visits_count, last_visit, created_at, updated_at)
      VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(NULLIF(trim(_customer_email), ''), ''),
        v_final_total,
        1,
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = COALESCE(total_spent, 0) + v_final_total,
          visits_count = COALESCE(visits_count, 0) + 1,
          last_visit = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_final_total,
        visits_count = COALESCE(visits_count, 0) + 1,
        last_visit = now(),
        updated_at = now()
      WHERE id = v_cust_id;
  END IF;

  -- 10. Generate POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

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
    v_final_total,
    _payment_method,
    _notes,
    _idempotency_key,
    v_voucher_used,
    v_voucher_token,
    _coupon_code,
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 12. Insert Sale Items & Deduct Stock
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    name text,
    sku text,
    barcode text,
    variant_info text,
    price numeric,
    custom_price numeric,
    mrp numeric,
    cost_price numeric,
    qty int
  ) LOOP
    v_item_price := COALESCE(v_item.price, v_item.custom_price, 0);

    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      price,
      mrp,
      cost_price,
      qty,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, ''),
      COALESCE(v_item.name, 'POS Item'),
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.barcode, ''),
      COALESCE(v_item.variant_info, ''),
      v_item_price,
      COALESCE(v_item.mrp, v_item_price),
      COALESCE(v_item.cost_price, 0),
      v_item.qty,
      now()
    );

    -- Stock deduction
    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
      IF v_var_prev_stock IS NOT NULL THEN
        v_var_new_stock := GREATEST(0, v_var_prev_stock - v_item.qty);
        UPDATE public.product_variants SET stock = v_var_new_stock WHERE id = v_item.variant_id;
      END IF;
    END IF;

    IF v_item.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := GREATEST(0, v_prev_stock - v_item.qty);
        UPDATE public.products SET stock = v_new_stock WHERE id = v_item.product_id;

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
          'POS Sale #' || v_sale_number || ' - ' || v_item.name,
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
    'total', v_final_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'store_credit_used', v_voucher_used,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, service_role;
