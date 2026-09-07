-- ==============================================================================
-- Migration: 20260928000108_fix_pos_coupons_and_walkin_return_variants.sql
-- Description:
--   1. place_offline_sale:
--      - Fix coupon evaluation: handle usage_limit = 0 as unlimited.
--      - Fix max_discount_amount: handle 0 as uncapped (do not force discount to 0).
--   2. process_offline_return:
--      - For walk-in returns lacking an explicit variant_id, resolve variant_id
--        by matching barcode, sku, or 'Default' variant so product_variants stock
--        is accurately restocked for multi-variant products.
-- ==============================================================================

-- 1. Recreate place_offline_sale with hardened coupon evaluation
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
  v_bill_only_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_total_discount numeric := 0;
  v_total numeric := 0;
  v_item_price numeric := 0;
  v_prod_id uuid;
  v_prod_stock int;
  v_prod_name text;
  v_prod_sku text;
  v_prod_barcode text;
  v_prod_mrp numeric;
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
  -- Historical pricing per line
  v_item_mrp numeric;
  v_line_gross numeric;
  v_alloc_bill numeric;
  v_alloc_coupon numeric;
  v_final_unit_paid numeric;
  v_item_qty int;
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

  -- 3. Calculate Subtotal (sum of unit prices × qty, before any discount)
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    price numeric,
    custom_price numeric,
    qty int
  )
  LOOP
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_subtotal := v_subtotal + (v_item_price * COALESCE(v_item.qty, 1));
  END LOOP;

  -- 4. Calculate Bill-Level Discount (stored separately from coupon)
  IF _discount_type = 'percentage' OR _discount_type = 'percent' THEN
    v_bill_only_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'fixed' OR _discount_type = 'flat' THEN
    v_bill_only_discount := LEAST(COALESCE(_discount_value, 0), v_subtotal);
  ELSE
    v_bill_only_discount := 0;
  END IF;

  -- 5. Calculate Coupon Discount (support usage_limit = 0 as unlimited & max_discount_amount = 0 as uncapped)
  v_clean_coupon := NULLIF(trim(upper(COALESCE(_coupon_code, ''))), '');
  IF v_clean_coupon IS NOT NULL THEN
    SELECT * INTO v_coupon_rec
    FROM public.coupons
    WHERE upper(code) = v_clean_coupon AND is_active = true
    FOR UPDATE;

    IF v_coupon_rec.id IS NOT NULL THEN
      IF (v_coupon_rec.valid_from IS NULL OR now() >= v_coupon_rec.valid_from) AND
         (v_coupon_rec.valid_until IS NULL OR now() <= v_coupon_rec.valid_until) AND
         (v_coupon_rec.usage_limit IS NULL OR v_coupon_rec.usage_limit = 0 OR v_coupon_rec.used_count < v_coupon_rec.usage_limit) AND
         (v_coupon_rec.min_order_amount IS NULL OR v_subtotal >= v_coupon_rec.min_order_amount) THEN

        IF v_coupon_rec.discount_type = 'percent' OR v_coupon_rec.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_coupon_rec.discount_value) / 100, 2);
          IF v_coupon_rec.max_discount_amount IS NOT NULL AND v_coupon_rec.max_discount_amount > 0 THEN
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

  v_total_discount := v_bill_only_discount + v_coupon_discount;
  v_total := GREATEST(0, v_subtotal - v_total_discount);

  -- 6. Canonical Store Credit & Voucher Concurrency-Safe Settlement
  v_credit_to_use := 0;
  IF v_clean_token != '' THEN
    SELECT * INTO v_credit_rec
    FROM public.offline_returns
    WHERE UPPER(credit_token) = v_clean_token
    FOR UPDATE;

    IF v_credit_rec.id IS NOT NULL THEN
      IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
        UPDATE public.offline_returns SET credit_token_status = 'EXPIRED', updated_at = now() WHERE id = v_credit_rec.id;
        RAISE EXCEPTION 'Voucher % has expired on % and cannot be redeemed', v_clean_token, to_char(v_credit_rec.expires_at, 'DD Mon YYYY');
      END IF;

      IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
        RAISE EXCEPTION 'Voucher % has already been fully redeemed', v_clean_token;
      END IF;

      v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));
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
    v_total_discount,
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

    IF _customer_id IS NOT NULL AND v_clean_token != '' THEN
      UPDATE public.pos_customers
      SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_credit_to_use),
          store_credit = GREATEST(0, COALESCE(store_credit_balance, 0) - v_credit_to_use),
          updated_at = now()
      WHERE id = _customer_id;
    END IF;
  END IF;

  -- 10. Insert Line Items with Historical Pricing Snapshots & Deduct Inventory
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    mrp numeric,
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
    v_prod_mrp := COALESCE(v_item.mrp, 0);
    v_var_id := NULL;
    v_var_stock := NULL;
    v_buying_price := 0;

    IF v_is_uuid THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(p.mrp, 0), COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_prod_mrp, v_buying_price
      FROM public.products p
      LEFT JOIN public.product_costs c ON c.product_id = p.id
      WHERE p.id = v_item.product_id::uuid
      FOR UPDATE OF p;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' THEN
      SELECT p.id, p.stock, p.name, p.sku, p.barcode, COALESCE(p.mrp, 0), COALESCE(c.buying_price, 0)
      INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode, v_prod_mrp, v_buying_price
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

    v_item_qty  := COALESCE(v_item.qty, 1);
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);
    v_item_mrp   := COALESCE(v_prod_mrp, v_item.mrp, v_item_price, 0);

    -- Historical Pricing Snapshot Calculation
    v_line_gross := v_item_price * v_item_qty;

    v_alloc_bill := CASE
      WHEN v_subtotal > 0 THEN ROUND((v_line_gross / v_subtotal) * v_bill_only_discount / v_item_qty, 4)
      ELSE 0
    END;

    v_alloc_coupon := CASE
      WHEN v_subtotal > 0 THEN ROUND((v_line_gross / v_subtotal) * v_coupon_discount / v_item_qty, 4)
      ELSE 0
    END;

    v_final_unit_paid := GREATEST(0, ROUND(v_item_price - v_alloc_bill - v_alloc_coupon, 2));

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
      unit_mrp,
      unit_selling_price,
      line_gross_amount,
      product_discount_amount,
      allocated_bill_discount,
      allocated_coupon_discount,
      final_unit_paid_price,
      quantity_sold,
      quantity_returned,
      created_at
    ) VALUES (
      v_sale_id,
      v_prod_id,
      v_var_id,
      COALESCE(NULLIF(v_item.product_slug, ''), 'custom-item'),
      COALESCE(v_prod_name, v_item.name, 'Custom Item'),
      COALESCE(v_prod_sku, v_item.sku, ''),
      COALESCE(v_prod_barcode, ''),
      v_item_qty,
      v_item_price,
      v_item_price * v_item_qty,
      v_buying_price,
      v_item_mrp,
      v_item_price,
      v_line_gross,
      0,
      v_alloc_bill,
      v_alloc_coupon,
      v_final_unit_paid,
      v_item_qty,
      0,
      now()
    );

    -- Inventory Deduction
    IF v_prod_id IS NOT NULL THEN
      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - v_item_qty),
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
        SET stock = GREATEST(0, stock - v_item_qty),
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
        -v_item_qty,
        COALESCE(v_prod_stock, 0),
        GREATEST(0, COALESCE(v_prod_stock, 0) - v_item_qty),
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
    'discount', v_total_discount,
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

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;

-- 2. Recreate process_offline_return with automated variant fallback for walk-in returns
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
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;

  -- Item-level variables
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

  -- Historical sale item snapshot
  v_sale_item record;
  v_historical_paid numeric;

  -- Running totals
  computed_total_refund numeric := 0;
  item_count int := 0;

  -- Product / stock helpers
  v_prod record;
  v_prev_stock int;
  v_new_stock int;
  v_total_var_stock int;

  -- Return record
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;

  -- Customer credit
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');

  -- Sale linkage
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
BEGIN
  -- 1. Authorization check
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT public.has_role(uid, 'pos_user')
       AND NOT public.has_role(uid, 'staff') THEN
      RAISE EXCEPTION 'Unauthorized: only admin, pos_user, or staff can process offline returns';
    END IF;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, customer_name, original_sale_id, original_sale_number, expires_at
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token, _customer_name, v_clean_sale_id, v_orig_sale_number, v_expiry_date
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'credit_token', new_credit_token,
        'expires_at', v_expiry_date,
        'customer_name', _customer_name,
        'original_sale_id', v_clean_sale_id,
        'original_sale_number', v_orig_sale_number,
        'items_count', 0,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with empty items';
  END IF;

  -- 4. Validate & Compute refund amounts (using historical snapshots when available)
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Item return quantity must be greater than zero';
    END IF;

    -- Try to parse original_sale_item_id
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

    IF item_orig_sale_item_id IS NOT NULL THEN
      -- INVOICE-LINKED RETURN: Lock line item & validate against quantity_sold
      SELECT id, sale_id, product_id, variant_id, name, sku, barcode, product_slug,
             unit_mrp, unit_selling_price, final_unit_paid_price, price,
             quantity_sold, quantity_returned
      INTO v_sale_item
      FROM public.offline_sale_items
      WHERE id = item_orig_sale_item_id
      FOR UPDATE;

      IF v_sale_item.id IS NULL THEN
        RAISE EXCEPTION 'Original sale line item % not found', item_orig_sale_item_id;
      END IF;

      -- Validate return quantity does not exceed returnable balance
      IF (COALESCE(v_sale_item.quantity_returned, 0) + item_qty) > v_sale_item.quantity_sold THEN
        RAISE EXCEPTION 'Return quantity % exceeds remaining returnable units (%) for "%"',
          item_qty,
          v_sale_item.quantity_sold - COALESCE(v_sale_item.quantity_returned, 0),
          v_sale_item.name;
      END IF;

      -- Use immutable historical final_unit_paid_price
      v_historical_paid := COALESCE(
        v_sale_item.final_unit_paid_price,
        v_sale_item.unit_selling_price,
        v_sale_item.price,
        0
      );
      item_refund_price := v_historical_paid;
      item_mrp := COALESCE(v_sale_item.unit_mrp, item_refund_price);
      item_product_id := v_sale_item.product_id;
      item_variant_id := v_sale_item.variant_id;
      item_name := v_sale_item.name;
      item_sku := COALESCE(v_sale_item.sku, '');
      item_barcode := COALESCE(v_sale_item.barcode, '');
      item_slug := COALESCE(v_sale_item.product_slug, '');
      item_variant_info := COALESCE(elem->>'variant_info', '');

    ELSE
      -- WALK-IN RETURN WITHOUT INVOICE
      item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
      IF item_refund_price < 0 THEN
        RAISE EXCEPTION 'Invalid refund price % for item %', item_refund_price, COALESCE(elem->>'name', 'Unknown');
      END IF;

      item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
      item_name := COALESCE(elem->>'name', 'Returned Item');
      item_sku := COALESCE(elem->>'sku', '');
      item_barcode := COALESCE(elem->>'barcode', '');
      item_slug := COALESCE(elem->>'product_slug', '');
      item_variant_info := COALESCE(elem->>'variant_info', '');

      BEGIN
        item_product_id := (elem->>'product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_product_id := NULL;
      END;

      BEGIN
        item_variant_id := (elem->>'variant_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_variant_id := NULL;
      END;
    END IF;

    computed_total_refund := computed_total_refund + (item_refund_price * item_qty);
    item_count := item_count + item_qty;
  END LOOP;

  computed_total_refund := GREATEST(0, COALESCE(computed_total_refund, 0));

  -- 5. Generate return number & voucher token
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_credit_token := public.generate_unique_exchange_credit_token();
  v_expiry_date := now() + interval '7 days';

  -- 6. Resolve original sale linkage
  v_clean_sale_id := CASE
    WHEN _original_sale_id IS NULL OR _original_sale_id = '00000000-0000-0000-0000-000000000000'::uuid THEN NULL
    ELSE _original_sale_id
  END;

  IF v_clean_sale_id IS NOT NULL THEN
    SELECT sale_number INTO v_orig_sale_number
    FROM public.offline_sales
    WHERE id = v_clean_sale_id;

    IF v_orig_sale_number IS NULL THEN
      v_clean_sale_id := NULL;
    END IF;
  END IF;

  -- 7. Resolve or upsert customer
  IF v_resolved_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0)
    INTO v_resolved_cust_id, v_prev_credit
    FROM public.pos_customers
    WHERE phone = v_clean_phone
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, store_credit_balance, store_credit, created_at, updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(NULLIF(trim(_customer_email), ''), ''),
        computed_total_refund,
        computed_total_refund,
        now(),
        now()
      )
      RETURNING id, store_credit_balance INTO v_resolved_cust_id, v_new_credit;
      v_prev_credit := 0;
    END IF;
  END IF;

  -- 8. Insert Return Header Record
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    original_sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_status,
    return_reason,
    notes,
    refund_amount,
    credit_used,
    credit_balance,
    credit_token,
    credit_token_status,
    expires_at,
    idempotency_key,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    _refund_method,
    _refund_status,
    _return_reason,
    COALESCE(trim(_notes), ''),
    computed_total_refund,
    0,
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    v_expiry_date,
    _idempotency_key,
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 9. Insert Line Items, Update Historical Sales, & Restore Inventory
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);

    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

    IF item_orig_sale_item_id IS NOT NULL THEN
      SELECT id, product_id, variant_id, name, sku, barcode, product_slug,
             unit_mrp, final_unit_paid_price, price
      INTO v_sale_item
      FROM public.offline_sale_items
      WHERE id = item_orig_sale_item_id;

      item_refund_price := COALESCE(v_sale_item.final_unit_paid_price, v_sale_item.price, 0);
      item_mrp := COALESCE(v_sale_item.unit_mrp, item_refund_price);
      item_product_id := v_sale_item.product_id;
      item_variant_id := v_sale_item.variant_id;
      item_name := v_sale_item.name;
      item_sku := COALESCE(v_sale_item.sku, '');
      item_barcode := COALESCE(v_sale_item.barcode, '');
      item_slug := COALESCE(v_sale_item.product_slug, '');
      item_variant_info := COALESCE(elem->>'variant_info', '');

      UPDATE public.offline_sale_items
      SET quantity_returned = COALESCE(quantity_returned, 0) + item_qty
      WHERE id = item_orig_sale_item_id;

    ELSE
      item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
      item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
      item_name := COALESCE(elem->>'name', 'Returned Item');
      item_sku := COALESCE(elem->>'sku', '');
      item_barcode := COALESCE(elem->>'barcode', '');
      item_slug := COALESCE(elem->>'product_slug', '');
      item_variant_info := COALESCE(elem->>'variant_info', '');

      BEGIN
        item_product_id := (elem->>'product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_product_id := NULL;
      END;

      BEGIN
        item_variant_id := (elem->>'variant_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        item_variant_id := NULL;
      END;
    END IF;

    -- Resolve variant_id for walk-in returns if missing
    IF item_product_id IS NOT NULL AND item_variant_id IS NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (
          (item_barcode IS NOT NULL AND item_barcode != '' AND barcode = item_barcode)
          OR (item_sku IS NOT NULL AND item_sku != '' AND sku = item_sku)
          OR name = 'Default'
        )
      LIMIT 1;
    END IF;

    INSERT INTO public.offline_return_items (
      return_id,
      product_id,
      variant_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      qty,
      refund_price,
      mrp,
      unit_mrp,
      subtotal,
      original_sale_item_id,
      created_at
    ) VALUES (
      new_return_id,
      item_product_id,
      item_variant_id,
      item_slug,
      item_name,
      item_sku,
      item_barcode,
      item_variant_info,
      item_qty,
      item_refund_price,
      item_mrp,
      item_mrp,
      item_qty * item_refund_price,
      item_orig_sale_item_id,
      now()
    );

    -- Stock restoration
    IF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        IF item_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE id = item_variant_id;

          SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
          FROM public.product_variants
          WHERE product_id = item_product_id;

          UPDATE public.products
          SET stock = v_total_var_stock,
              updated_at = now()
          WHERE id = item_product_id;
        ELSE
          UPDATE public.products
          SET stock = stock + item_qty,
              updated_at = now()
          WHERE id = item_product_id;
        END IF;

        v_new_stock := v_prev_stock + item_qty;

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
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          item_qty,
          COALESCE(v_prev_stock, 0),
          v_new_stock,
          'offline_return',
          new_return_id,
          'Return #' || new_return_number || ' - ' || item_name,
          'Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 10. Update Customer Credit Ledger & Balance
  IF v_resolved_cust_id IS NOT NULL AND computed_total_refund > 0 THEN
    SELECT COALESCE(store_credit_balance, store_credit, 0)
    INTO v_prev_credit
    FROM public.pos_customers
    WHERE id = v_resolved_cust_id
    FOR UPDATE;

    UPDATE public.pos_customers
    SET store_credit_balance = v_prev_credit + computed_total_refund,
        store_credit = v_prev_credit + computed_total_refund,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

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
      created_by
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_prev_credit + computed_total_refund,
      new_credit_token,
      new_return_id,
      'Exchange voucher issued via Return #' || new_return_number || ' (Token: ' || new_credit_token || ', Valid 7 days)',
      uid
    );
  END IF;

  -- 11. Update linked sale's return_status summary
  IF v_clean_sale_id IS NOT NULL THEN
    UPDATE public.offline_sales
    SET return_status = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM public.offline_sale_items
            WHERE sale_id = v_clean_sale_id
              AND quantity_returned < quantity_sold
          ) THEN 'returned'
          WHEN EXISTS (
            SELECT 1 FROM public.offline_sale_items
            WHERE sale_id = v_clean_sale_id
              AND quantity_returned > 0
          ) THEN 'partially_returned'
          ELSE 'none'
        END,
        updated_at = now()
    WHERE id = v_clean_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'expires_at', v_expiry_date,
    'customer_name', _customer_name,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
