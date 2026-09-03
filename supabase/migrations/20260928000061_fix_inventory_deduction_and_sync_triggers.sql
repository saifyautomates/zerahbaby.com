-- Migration: 20260928000061_fix_inventory_deduction_and_sync_triggers.sql
-- Fix double inventory deduction cascade and products_stock_check constraint violation

-- 1. Drop duplicate/unprotected legacy triggers on products
DROP TRIGGER IF EXISTS trg_sync_product_variant_stock ON public.products;
DROP FUNCTION IF EXISTS public.sync_product_variant_stock();

-- 2. Harden variant-to-product stock sync trigger
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_stock integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_total_stock
  FROM public.product_variants
  WHERE product_id = NEW.product_id;

  UPDATE public.products
  SET stock = GREATEST(0, v_total_stock),
      updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER INSERT OR UPDATE OF stock OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();

-- 3. Harden product-to-variant stock sync trigger
CREATE OR REPLACE FUNCTION public.fn_sync_product_to_variant_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  var_count integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO var_count
  FROM public.product_variants
  WHERE product_id = NEW.id;

  -- If product has only 1 variant or a 'Default' variant, keep them strictly identical
  IF var_count = 1 THEN
    UPDATE public.product_variants
    SET stock = GREATEST(0, NEW.stock),
        updated_at = now()
    WHERE product_id = NEW.id;
  ELSIF var_count > 1 THEN
    -- If default variant exists, update it
    UPDATE public.product_variants
    SET stock = GREATEST(0, NEW.stock),
        updated_at = now()
    WHERE product_id = NEW.id AND name = 'Default';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_to_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_to_variant_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_variant_stock();

-- 3.5 Helper: get_next_daily_pos_token
CREATE OR REPLACE FUNCTION public.get_next_daily_pos_token()
RETURNS TABLE(next_token integer, token_date date) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dt date := CURRENT_DATE;
  v_num integer;
BEGIN
  SELECT COALESCE(MAX(pos_token_number), 0) + 1
  INTO v_num
  FROM public.offline_sales
  WHERE pos_token_date = v_dt;

  RETURN QUERY SELECT v_num, v_dt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_next_daily_pos_token() TO authenticated, anon, service_role;

-- 3.6 Ensure offline_sales and offline_sale_items columns match
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS credit_token text,
  ADD COLUMN IF NOT EXISTS credit_token_used text;

ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS variant_id uuid,
  ADD COLUMN IF NOT EXISTS custom_price numeric;

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS transaction_type public.inventory_tx_type;

-- 4. Redefine canonical place_offline_sale RPC with single-source inventory mutation
DROP FUNCTION IF EXISTS public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.place_offline_sale CASCADE;

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _payment_method text,
  _notes text,
  _discount_type text,
  _discount_value numeric,
  _customer_id uuid,
  _items jsonb,
  _idempotency_key text DEFAULT NULL,
  _store_credit_used numeric DEFAULT 0,
  _credit_token text DEFAULT NULL,
  _coupon_code text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_order_token_num int;
  v_order_token_dt date;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_total numeric := 0;
  v_item record;
  v_prod_id uuid;
  v_prod_stock int;
  v_prod_name text;
  v_prod_sku text;
  v_prod_barcode text;
  v_var_id uuid;
  v_var_stock int;
  v_item_price numeric;
  v_buying_price numeric := 0;
  v_is_uuid boolean;
  v_is_var_uuid boolean;
  v_existing_sale record;
  v_cust_credit numeric := 0;
  v_credit_to_use numeric := 0;
  v_credit_rec record;
  v_coupon_rec record;
  v_clean_coupon text;
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
  IF _discount_type = 'percent' THEN
    v_discount := ROUND((v_subtotal * COALESCE(_discount_value, 0)) / 100, 2);
  ELSIF _discount_type = 'flat' THEN
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

        IF v_coupon_rec.discount_type = 'percent' THEN
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

  -- 6. Process Store Credit Deduction
  v_credit_to_use := LEAST(COALESCE(_store_credit_used, 0), v_total);
  IF v_credit_to_use > 0 THEN
    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_credit_rec
      FROM public.offline_returns
      WHERE upper(credit_token) = upper(trim(_credit_token))
        AND credit_token_status = 'ACTIVE'
      FOR UPDATE;

      IF v_credit_rec.id IS NOT NULL THEN
        UPDATE public.offline_returns
        SET credit_used = COALESCE(credit_used, 0) + v_credit_to_use,
            credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + v_credit_to_use)),
            credit_token_status = CASE 
              WHEN (COALESCE(credit_used, 0) + v_credit_to_use) >= refund_amount THEN 'CONSUMED' 
              ELSE 'ACTIVE' 
            END,
            updated_at = now()
        WHERE id = v_credit_rec.id;
      END IF;
    END IF;

    IF _customer_id IS NOT NULL THEN
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
    _credit_token,
    _credit_token,
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
  ) RETURNING id INTO v_sale_id;

  -- 9. Process Line Items and Atomic Inventory Deduction
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id text,
    variant_id text,
    product_slug text,
    name text,
    sku text,
    qty int,
    price numeric,
    custom_price numeric
  )
  LOOP
    v_prod_id := NULL;
    v_prod_stock := 0;
    v_prod_name := v_item.name;
    v_prod_sku := COALESCE(v_item.sku, '');
    v_prod_barcode := '';
    v_var_id := NULL;
    v_var_stock := 0;
    v_buying_price := 0;
    v_is_uuid := FALSE;
    v_is_var_uuid := FALSE;
    v_item_price := COALESCE(v_item.custom_price, v_item.price, 0);

    IF v_item.product_id IS NOT NULL AND v_item.product_id != '' THEN
      v_is_uuid := (v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    IF v_item.variant_id IS NOT NULL AND v_item.variant_id != '' THEN
      v_is_var_uuid := (v_item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
    END IF;

    -- Row lock product record for update
    IF v_is_uuid THEN
      SELECT id, stock, name, sku, barcode INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode
      FROM public.products
      WHERE id = v_item.product_id::uuid
      FOR UPDATE;
    ELSIF v_item.product_slug IS NOT NULL AND v_item.product_slug != '' AND v_item.product_slug NOT LIKE 'custom-%' THEN
      SELECT id, stock, name, sku, barcode INTO v_prod_id, v_prod_stock, v_prod_name, v_prod_sku, v_prod_barcode
      FROM public.products
      WHERE slug = v_item.product_slug
      FOR UPDATE;
    END IF;

    IF v_prod_id IS NOT NULL THEN
      -- Strict Stock Sufficiency Check
      IF v_prod_stock < COALESCE(v_item.qty, 1) THEN
        RAISE EXCEPTION 'Insufficient stock for "%": available %, requested %',
          v_prod_name, v_prod_stock, v_item.qty;
      END IF;

      -- Check and update variant stock if specified or if default variant exists
      IF v_is_var_uuid AND v_item.variant_id != '00000000-0000-0000-0000-000000000000' THEN
        SELECT id, stock INTO v_var_id, v_var_stock
        FROM public.product_variants
        WHERE id = v_item.variant_id::uuid
        FOR UPDATE;
      ELSE
        SELECT id, stock INTO v_var_id, v_var_stock
        FROM public.product_variants
        WHERE product_id = v_prod_id
        ORDER BY (CASE WHEN name = 'Default' THEN 0 ELSE 1 END)
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF v_var_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_var_id;

        -- Recalculate parent product stock from sum of variants to prevent double deduction
        SELECT COALESCE(SUM(stock), 0) INTO v_total_variant_stock
        FROM public.product_variants
        WHERE product_id = v_prod_id;

        UPDATE public.products
        SET stock = GREATEST(0, v_total_variant_stock),
            updated_at = now()
        WHERE id = v_prod_id;
      ELSE
        -- No variants: update product stock directly
        UPDATE public.products
        SET stock = GREATEST(0, stock - COALESCE(v_item.qty, 1)),
            updated_at = now()
        WHERE id = v_prod_id;
      END IF;

      SELECT COALESCE(buying_price, 0) INTO v_buying_price
      FROM public.product_costs
      WHERE product_id = v_prod_id
      LIMIT 1;

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
        v_prod_stock,
        GREATEST(0, v_prod_stock - COALESCE(v_item.qty, 1)),
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || v_prod_name,
        'POS Sale #' || v_sale_number || ' - ' || v_prod_name,
        uid
      );
    END IF;

    -- Insert sale item
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
      custom_price,
      subtotal,
      buying_price,
      created_at
    ) VALUES (
      v_sale_id,
      v_prod_id,
      v_var_id,
      COALESCE(v_item.product_slug, 'custom'),
      COALESCE(v_prod_name, v_item.name, 'Item'),
      COALESCE(v_prod_sku, v_item.sku, ''),
      COALESCE(v_prod_barcode, ''),
      COALESCE(v_item.qty, 1),
      v_item_price,
      v_item.custom_price,
      v_item_price * COALESCE(v_item.qty, 1),
      v_buying_price,
      now()
    );
  END LOOP;

  -- 10. Update Customer Statistics
  IF _customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = COALESCE(total_purchases, 0) + 1,
        total_spend = COALESCE(total_spend, 0) + v_total,
        total_spent = COALESCE(total_spent, 0) + v_total,
        total_visits = COALESCE(total_visits, 0) + 1,
        updated_at = now()
    WHERE id = _customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_total,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'discount_type', _discount_type,
    'discount_value', _discount_value,
    'payment_method', _payment_method,
    'customer_name', _customer_name,
    'customer_phone', _customer_phone,
    'items_count', jsonb_array_length(_items),
    'duplicate', false,
    'pos_token_number', v_order_token_num,
    'pos_token_date', v_order_token_dt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;
