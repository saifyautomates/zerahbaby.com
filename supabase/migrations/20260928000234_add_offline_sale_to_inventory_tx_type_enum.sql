-- Migration: 20260928000234_add_offline_sale_to_inventory_tx_type_enum.sql
-- Description: Add 'offline_sale' and 'offline_return' values to inventory_tx_type enum
-- and update place_offline_sale and process_offline_return RPCs to use safe enum values.

-- 1. Extend the enum type safely
ALTER TYPE public.inventory_tx_type ADD VALUE IF NOT EXISTS 'offline_sale';
ALTER TYPE public.inventory_tx_type ADD VALUE IF NOT EXISTS 'offline_return';

-- 2. Recreate place_offline_sale with valid enum values
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
  -- 1. Strict Mandatory Staff/Admin Authorization Check
  IF (COALESCE(auth.jwt()->>'role', '') != 'service_role') AND (
    uid IS NULL OR (
      NOT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
      )
      AND NOT public.is_admin()
    )
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

  -- 4. Calculate Subtotal from Items
  FOR v_item IN
    SELECT
      (item->>'price')::numeric as price,
      COALESCE((item->>'quantity')::int, (item->>'qty')::int, 1) as qty,
      (item->>'is_custom')::boolean as is_custom,
      (item->>'variant_id')::uuid as variant_id,
      (item->>'product_id')::uuid as product_id
    FROM jsonb_array_elements(_items) as item
  LOOP
    IF COALESCE(v_item.is_custom, false) = true THEN
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

    v_subtotal := v_subtotal + (v_item_price * COALESCE(v_item.qty, 1));
    v_total_units := v_total_units + COALESCE(v_item.qty, 1);
  END LOOP;

  -- 5. Calculate Bill-Level Discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value / 100), 2);
  ELSIF _discount_type = 'fixed' AND _discount_value > 0 THEN
    v_discount := LEAST(v_subtotal, _discount_value);
  ELSE
    v_discount := 0;
  END IF;

  -- 6. Evaluate Coupon if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE upper(code) = upper(trim(_coupon_code))
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > now())
      AND (starts_at IS NULL OR starts_at <= now())
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF (v_subtotal - v_discount) >= COALESCE(v_applied_coupon.min_order_value, 0) THEN
        IF v_applied_coupon.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND(((v_subtotal - v_discount) * v_applied_coupon.discount_value / 100), 2);
          IF v_applied_coupon.max_discount_amount IS NOT NULL AND v_coupon_discount > v_applied_coupon.max_discount_amount THEN
            v_coupon_discount := v_applied_coupon.max_discount_amount;
          END IF;
        ELSE
          v_coupon_discount := LEAST((v_subtotal - v_discount), v_applied_coupon.discount_value);
        END IF;
      END IF;
    END IF;
  END IF;

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Validate & Apply Store Credit / Voucher
  IF _store_credit_used > 0 THEN
    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_voucher_record
      FROM public.store_credit_vouchers
      WHERE upper(token) = upper(trim(_credit_token))
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND current_balance > 0
      FOR UPDATE;

      IF v_voucher_record.id IS NOT NULL THEN
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
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Effective payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 9. Generate sequential POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 10. Customer Link / Upsert
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
        total_visits,
        last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_payable_total,
        1,
        now()
      )
      RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = total_spent + v_payable_total,
          total_visits = total_visits + 1,
          last_visit = now(),
          name = CASE WHEN (name = 'Walk-in Customer' OR name IS NULL OR name = '') AND trim(_customer_name) != '' AND trim(_customer_name) != 'Walk-in Customer' THEN trim(_customer_name) ELSE name END,
          email = CASE WHEN (email IS NULL OR email = '') AND trim(_customer_email) != '' THEN trim(_customer_email) ELSE email END
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = total_spent + v_payable_total,
        total_visits = total_visits + 1,
        last_visit = now()
    WHERE id = v_cust_id;
  END IF;

  -- 11. Insert into offline_sales safely
  INSERT INTO public.offline_sales (
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    notes,
    discount_type,
    discount_value,
    discount,
    subtotal,
    total,
    store_credit_used,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    v_effective_payment_method,
    COALESCE(_notes, ''),
    _discount_type,
    _discount_value,
    (v_discount + v_coupon_discount),
    v_subtotal,
    v_payable_total,
    v_voucher_used,
    NULLIF(trim(_idempotency_key), ''),
    uid,
    now(),
    now()
  )
  RETURNING id INTO v_sale_id;

  -- 12. Insert Line Items & Atomic Stock Deduction
  FOR v_item IN
    SELECT
      (item->>'price')::numeric as price,
      (item->>'mrp')::numeric as mrp,
      COALESCE((item->>'quantity')::int, (item->>'qty')::int, 1) as qty,
      (item->>'name')::text as name,
      (item->>'sku')::text as sku,
      (item->>'barcode')::text as barcode,
      (item->>'product_slug')::text as product_slug,
      (item->>'variant_info')::text as variant_info,
      (item->>'is_custom')::boolean as is_custom,
      (item->>'variant_id')::uuid as variant_id,
      (item->>'product_id')::uuid as product_id
    FROM jsonb_array_elements(_items) as item
  LOOP
    IF COALESCE(v_item.is_custom, false) = true THEN
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
      product_name,
      name,
      variant_info,
      sku,
      barcode,
      price,
      mrp,
      unit_selling_price,
      unit_mrp,
      allocated_bill_discount,
      allocated_coupon_discount,
      final_unit_price,
      final_unit_paid_price,
      quantity,
      qty,
      quantity_sold,
      returned_quantity,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, ''),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.name, 'Item'),
      v_item.variant_info,
      v_item.sku,
      v_item.barcode,
      v_item_price,
      COALESCE(v_item.mrp, v_item_price),
      v_item_price,
      COALESCE(v_item.mrp, v_item_price),
      v_alloc_bill,
      v_alloc_coupon,
      v_final_unit_paid,
      v_final_unit_paid,
      COALESCE(v_item.qty, 1),
      COALESCE(v_item.qty, 1),
      COALESCE(v_item.qty, 1),
      0,
      now()
    );

    -- STRICT INVENTORY DEDUCTION WITH ROW LOCK:
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
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
        uid
      );

    ELSIF v_item.product_id IS NOT NULL AND COALESCE(v_item.is_custom, false) = false THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;

      IF v_prev_stock IS NOT NULL THEN
        IF v_prev_stock < v_item.qty THEN
          RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
            COALESCE(v_item.name, 'Item'), v_prev_stock, v_item.qty;
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
    'subtotal', v_subtotal,
    'discount', (v_discount + v_coupon_discount),
    'store_credit_used', v_voucher_used,
    'payment_method', v_effective_payment_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

-- 3. Recreate process_offline_return with valid enum values
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
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
BEGIN
  -- 1. Strict Mandatory Staff/Admin Authorization Check
  IF (COALESCE(auth.jwt()->>'role', '') != 'service_role') AND (
    uid IS NULL OR (
      NOT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
      )
      AND NOT public.is_admin()
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can process returns';
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, status, credit_token, customer_name
    INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'refund_amount', v_existing_return.refund_amount,
        'status', v_existing_return.status,
        'credit_token', v_existing_return.credit_token,
        'customer_name', v_existing_return.customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Customer Upsert if needed
  IF v_resolved_cust_id IS NULL AND v_clean_phone != '' THEN
    SELECT id INTO v_resolved_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || v_clean_phone || '%'
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_visits,
        store_credit,
        last_visit
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        0,
        1,
        0,
        now()
      )
      RETURNING id INTO v_resolved_cust_id;
    END IF;
  END IF;

  -- 4. Check Original Sale if provided
  IF _original_sale_id IS NOT NULL THEN
    SELECT id, sale_number INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id;

    IF v_orig_sale.id IS NOT NULL THEN
      v_clean_sale_id := v_orig_sale.id;
      v_orig_sale_number := v_orig_sale.sale_number;
    END IF;
  END IF;

  -- 5. Calculate Return Amount
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
    item_count := item_count + 1;
  END LOOP;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return must contain at least one item';
  END IF;

  -- 6. Generate Return Number & Credit Token
  new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));

  -- Ensure token uniqueness
  WHILE EXISTS (SELECT 1 FROM public.offline_returns WHERE credit_token = new_credit_token AND status = 'active')
     OR EXISTS (SELECT 1 FROM public.store_credit_vouchers WHERE upper(token) = new_credit_token AND is_active = true)
  LOOP
    new_credit_token := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));
  END LOOP;

  -- 7. Insert into offline_returns
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    refund_method,
    refund_amount,
    credit_token,
    status,
    reason,
    notes,
    created_by,
    idempotency_key,
    credit_expires_at,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    _refund_method,
    computed_total_refund,
    new_credit_token,
    'completed',
    COALESCE(NULLIF(trim(_return_reason), ''), 'Customer Return'),
    COALESCE(_notes, ''),
    uid,
    NULLIF(trim(_idempotency_key), ''),
    v_expiry_date,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 8. Insert into store_credit_vouchers
  IF computed_total_refund > 0 THEN
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
  END IF;

  -- 9. Insert items & Restock Inventory
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_product_id := (elem->>'product_id')::uuid;
    item_variant_id := (elem->>'variant_id')::uuid;
    item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Returned Item');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', '');
    item_variant_info := elem->>'variant_info';

    INSERT INTO public.offline_return_items (
      return_id,
      original_sale_item_id,
      product_id,
      variant_id,
      product_name,
      variant_info,
      sku,
      barcode,
      quantity,
      refund_price,
      mrp,
      created_at
    ) VALUES (
      new_return_id,
      item_orig_sale_item_id,
      item_product_id,
      item_variant_id,
      item_name,
      item_variant_info,
      item_sku,
      item_barcode,
      item_qty,
      item_refund_price,
      item_mrp,
      now()
    );

    IF item_orig_sale_item_id IS NOT NULL THEN
      UPDATE public.offline_sale_items
      SET returned_quantity = COALESCE(returned_quantity, 0) + item_qty
      WHERE id = item_orig_sale_item_id;
    END IF;

    -- Atomic Restock with Row Locking:
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.product_variants SET stock = v_new_stock, updated_at = now() WHERE id = item_variant_id;

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
          item_product_id,
          item_variant_id,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.products SET stock = v_new_stock, updated_at = now() WHERE id = item_product_id;

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
          item_product_id,
          NULL,
          'return'::public.inventory_tx_type,
          'return'::public.inventory_tx_type,
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'status', 'completed',
    'credit_token', new_credit_token,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'duplicate', false
  );
END;
$$;

-- 4. Permissions
REVOKE EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, service_role;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
