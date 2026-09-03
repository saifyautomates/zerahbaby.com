-- ==============================================================================
-- Migration: 20260928000077_fix_place_offline_sale_cost_price_reference.sql
-- Description: Fix place_offline_sale to safely retrieve buying_price from product_costs
--              without referencing deprecated cost_price column on products/variants
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _payment_method text DEFAULT 'cash',
  _notes text DEFAULT '',
  _discount_type text DEFAULT 'none',
  _discount_value numeric DEFAULT 0,
  _customer_id uuid DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_order_token_num int;
  v_order_token_dt date;
  v_existing_sale record;
  v_item record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_total numeric := 0;
  v_item_price numeric := 0;
  v_prod_id uuid;
  v_prod_stock int;
  v_prod_name text;
  v_prod_sku text;
  v_prod_barcode text;
  v_var_id uuid;
  v_var_stock int;
  v_buying_price numeric := 0;
  v_is_uuid boolean;
  v_is_var_uuid boolean;
  v_credit_rec record;
  v_credit_to_use numeric := 0;
  v_voucher_avail numeric := 0;
  v_new_voucher_used numeric := 0;
  v_new_voucher_balance numeric := 0;
  v_coupon_rec record;
  v_clean_coupon text;
  v_clean_token text := UPPER(TRIM(COALESCE(_credit_token, '')));
  v_total_variant_stock int;
BEGIN
  -- 1. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method, customer_name, customer_phone, pos_token_number
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
        'payment_method', v_existing_sale.payment_method,
        'customer_name', v_existing_sale.customer_name,
        'customer_phone', v_existing_sale.customer_phone,
        'pos_token_number', v_existing_sale.pos_token_number,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Validate Items
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot place sale with empty items';
  END IF;

  -- 3. Calculate Subtotal
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_subtotal := v_subtotal + (v_item_price * COALESCE(v_item.qty, 1));
  END LOOP;

  -- 4. Calculate Basic Discount
  IF _discount_type = 'percentage' OR _discount_type = 'percent' THEN
    v_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' OR _discount_type = 'flat' THEN
    v_discount := LEAST(COALESCE(_discount_value, 0), v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  -- 5. Calculate Coupon Discount (if provided)
  v_clean_coupon := NULLIF(trim(upper(COALESCE(_coupon_code, ''))), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO v_coupon_rec
    FROM public.coupons
    WHERE upper(code) = v_clean_coupon AND is_active = true
    FOR UPDATE;

    IF v_coupon_rec.id IS NOT NULL THEN
      IF (v_coupon_rec.valid_from IS NULL OR now() >= v_coupon_rec.valid_from) AND
         (v_coupon_rec.valid_until IS NULL OR now() <= v_coupon_rec.valid_until) AND
         (v_coupon_rec.usage_limit IS NULL OR v_coupon_rec.used_count < v_coupon_rec.usage_limit) AND
         (v_coupon_rec.min_order_amount IS NULL OR v_subtotal >= v_coupon_rec.min_order_amount) THEN

        IF v_coupon_rec.discount_type = 'percent' OR v_coupon_rec.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_rec.discount_value) / 100, 2);
          IF v_coupon_rec.max_discount_amount IS NOT NULL THEN
            v_coupon_discount := LEAST(v_coupon_discount, v_coupon_rec.max_discount_amount);
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_coupon_rec.discount_value, v_subtotal);
        END IF;

        UPDATE public.coupons
        SET used_count = used_count + 1
        WHERE id = v_coupon_rec.id;
      END IF;
    END IF;
  END IF;

  v_discount := v_discount + v_coupon_discount;
  v_total := GREATEST(0, v_subtotal - v_discount);

  -- 6. Canonical Store Credit & Voucher Concurrency-Safe Settlement
  v_credit_to_use := 0;
  IF v_clean_token != '' THEN
    -- Lock the voucher row atomically
    SELECT * INTO v_credit_rec
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
    FOR UPDATE;

    IF v_credit_rec.id IS NOT NULL THEN
      -- Validate voucher status & expiry
      IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
        UPDATE public.offline_returns SET credit_token_status = 'EXPIRED', updated_at = now() WHERE id = v_credit_rec.id;
        RAISE EXCEPTION 'Voucher % has expired on % and cannot be redeemed', v_clean_token, to_char(v_credit_rec.expires_at, 'DD Mon YYYY');
      END IF;

      IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
        RAISE EXCEPTION 'Voucher % has already been fully redeemed', v_clean_token;
      END IF;

      -- Authoritative available balance on this voucher instrument
      v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));

      -- Bounded deduction: MIN(requested, voucher_available, sale_total)
      v_credit_to_use := LEAST(COALESCE(NULLIF(_store_credit_used, 0), v_voucher_avail), v_voucher_avail, v_total);

      IF v_credit_to_use > 0 THEN
        v_new_voucher_used := COALESCE(v_credit_rec.credit_used, 0) + v_credit_to_use;
        v_new_voucher_balance := GREATEST(0, v_credit_rec.refund_amount - v_new_voucher_used);

        UPDATE public.offline_returns
        SET credit_used = v_new_voucher_used,
            credit_balance = v_new_voucher_balance,
            credit_token_status = CASE WHEN v_new_voucher_balance <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
            updated_at = now()
        WHERE id = v_credit_rec.id;
      END IF;
    END IF;

  ELSIF _customer_id IS NOT NULL AND COALESCE(_store_credit_used, 0) > 0 THEN
    -- Customer Account Balance Settlement (when no specific token passed)
    SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
    FROM public.pos_customers
    WHERE id = _customer_id
    FOR UPDATE;

    v_credit_to_use := LEAST(COALESCE(_store_credit_used, 0), COALESCE(v_voucher_avail, 0), v_total);
    IF v_credit_to_use > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, store_credit_balance - v_credit_to_use),
          store_credit = GREATEST(0, store_credit_balance - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 7. Generate Daily Token & Sale Number
  v_order_token_dt := CURRENT_DATE;
  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_order_token_num
  FROM public.offline_sales
  WHERE pos_token_date = v_order_token_dt;

  v_sale_number := 'POS-' || to_char(now(), 'YYMM') || '-' || lpad(v_order_token_num::text, 5, '0');

  -- 8. Insert Offline Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    payment_method,
    notes,
    discount_type,
    discount_value,
    customer_id,
    idempotency_key,
    store_credit_used,
    credit_token,
    credit_token_used,
    coupon_code,
    coupon_discount,
    subtotal,
    discount,
    total,
    status,
    pos_token_number,
    pos_token_date,
    created_by,
    created_at
  ) VALUES (
    v_sale_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_payment_method), ''), 'cash'),
    COALESCE(trim(_notes), ''),
    COALESCE(NULLIF(trim(_discount_type), ''), 'none'),
    COALESCE(_discount_value, 0),
    _customer_id,
    _idempotency_key,
    v_credit_to_use,
    v_clean_token,
    v_clean_token,
    v_clean_coupon,
    v_coupon_discount,
    v_subtotal,
    v_discount,
    v_total,
    'completed',
    v_order_token_num,
    v_order_token_dt,
    uid,
    now()
  )
  RETURNING id INTO v_sale_id;

  -- 9. Insert Single Redemption Ledger Entry
  IF v_credit_to_use > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_return_id,
      used_in_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      COALESCE(_customer_id, v_credit_rec.customer_id),
      COALESCE(NULLIF(trim(_customer_name), ''), v_credit_rec.customer_name, 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), v_credit_rec.customer_phone, ''),
      v_clean_token,
      'CREDIT_REDEEMED',
      v_credit_to_use,
      v_voucher_avail,
      GREATEST(0, v_voucher_avail - v_credit_to_use),
      v_credit_rec.id,
      v_sale_id,
      'Voucher ' || v_clean_token || ' redeemed in POS Sale #' || v_sale_number,
      uid,
      now()
    );

    -- Also adjust account balance if customer record is present
    IF _customer_id IS NOT NULL AND v_clean_token != '' THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_credit_to_use),
          store_credit = GREATEST(0, COALESCE(store_credit, 0) - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 10. Insert Line Items & Deduct Inventory
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_is_uuid := v_item.product_id IS NOT NULL AND v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    v_is_var_uuid := v_item.variant_id IS NOT NULL AND v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    
    v_prod_id := NULL;
    v_prod_stock := NULL;
    v_prod_name := v_item.name;
    v_prod_sku := v_item.sku;
    v_prod_barcode := NULL;
    v_var_id := NULL;
    v_var_stock := NULL;
    v_buying_price := 0;

    IF v_is_uuid THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_buying_price
      FROM public.products p
      LEFT JOIN public.product_costs c ON c.product_id = p.id
      WHERE p.id = v_item.product_id::uuid
      FOR UPDATE OF p;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_buying_price
      FROM public.products p
      LEFT JOIN public.product_costs c ON c.product_id = p.id
      WHERE p.slug = v_item.product_slug
      LIMIT 1
      FOR UPDATE OF p;
    END IF;

    IF v_is_var_uuid THEN
      SELECT id, stock, name, sku, barcode
      INTO v_var_id, v_var_stock, v_prod_name, v_prod_sku, v_prod_barcode
      FROM public.product_variants
      WHERE id = v_item.variant_id::uuid
      FOR UPDATE;
    END IF;

    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);

    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      qty,
      price,
      subtotal,
      buying_price,
      created_at
    ) VALUES (
      v_sale_id,
      v_prod_id,
      v_var_id,
      COALESCE(NULLIF(v_item.product_slug, ''), 'custom-item'),
      COALESCE(v_prod_name, v_item.name, 'Custom Item'),
      COALESCE(v_prod_sku, v_item.sku, ''),
      COALESCE(v_prod_barcode, ''),
      COALESCE(v_item.qty, 1),
      v_item_price,
      v_item_price * COALESCE(v_item.qty, 1),
      v_buying_price,
      now()
    );

    -- Inventory Deduction
    IF v_prod_id IS NOT NULL THEN
      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_var_id;

        SELECT COALESCE(SUM(stock), 0) INTO v_total_variant_stock
        FROM public.product_variants
        WHERE product_id = v_prod_id;

        UPDATE public.products
        SET stock = v_total_variant_stock,
            updated_at = now()
        WHERE id = v_prod_id;
      ELSE
        UPDATE public.products
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_prod_id;
      END IF;

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
        v_prod_id,
        v_var_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -COALESCE(v_item.qty, 1),
        COALESCE(v_prod_stock, 0),
        GREATEST(0, COALESCE(v_prod_stock, 0) - COALESCE(v_item.qty, 1)),
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_prod_name, v_item.name),
        uid
      );
    END IF;
  END LOOP;

  -- 11. Update Customer Aggregate Spend & Visit Count
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spend = COALESCE(total_spend, 0) + v_total,
        last_visit_date = now(),
        updated_at = now()
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'store_credit_used', v_credit_to_use,
    'payable_after_credit', GREATEST(0, v_total - v_credit_to_use),
    'credit_token_used', v_clean_token,
    'payment_method', _payment_method,
    'customer_name', _customer_name,
    'customer_phone', _customer_phone,
    'pos_token_number', v_order_token_num,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, numeric, text, text, jsonb, text) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
