-- ==============================================================================
-- Migration: 20260928000326_fix_returnable_quantity_and_offline_sale_items_sold.sql
-- Description: Fix "Cannot return X unit(s). Only 0 returnable unit(s) remain." error.
--
-- Root Cause:
-- 1. In offline_sale_items table, quantity_sold had a column default of 0.
-- 2. When place_offline_sale inserted sale items, it populated qty and quantity
--    but omitted quantity_sold, so PostgreSQL set quantity_sold = 0.
-- 3. In process_offline_return:
--    v_item_returnable := GREATEST(0, COALESCE(v_orig_item.quantity_sold, v_orig_item.qty, 1) - ...);
--    Since 0 is NOT NULL in SQL, COALESCE(0, 1, 1) returned 0!
--    This forced returnable quantity to 0 and blocked any return with:
--    "Cannot return 1 unit(s) of [item]. Only 0 returnable unit(s) remain."
--
-- Fix:
-- 1. Repair all existing corrupted offline_sale_items records so quantity_sold = GREATEST(1, qty).
-- 2. Alter column default for quantity_sold, quantity_returnable, returnable_qty to 1.
-- 3. In process_offline_return, use NULLIF(v_orig_item.quantity_sold, 0) and NULLIF(quantity_returnable, 0).
-- 4. In place_offline_sale, explicitly insert quantity_sold, quantity_returnable, and returnable_qty.
-- ==============================================================================

-- 1. Repair existing corrupted offline_sale_items records
UPDATE public.offline_sale_items
SET quantity_sold = GREATEST(1, COALESCE(NULLIF(quantity_sold, 0), quantity, qty, 1)),
    quantity_returnable = GREATEST(0, GREATEST(1, COALESCE(NULLIF(quantity_sold, 0), quantity, qty, 1)) - COALESCE(quantity_returned, returned_quantity, 0)),
    returnable_qty = GREATEST(0, GREATEST(1, COALESCE(NULLIF(quantity_sold, 0), quantity, qty, 1)) - COALESCE(quantity_returned, returned_quantity, 0))
WHERE quantity_sold = 0 OR quantity_sold IS NULL OR quantity_returnable = 0;

-- 2. Set safe column defaults
ALTER TABLE public.offline_sale_items ALTER COLUMN quantity_sold SET DEFAULT 1;
ALTER TABLE public.offline_sale_items ALTER COLUMN quantity_returnable SET DEFAULT 1;
ALTER TABLE public.offline_sale_items ALTER COLUMN returnable_qty SET DEFAULT 1;

-- 3. Canonical process_offline_return with defensive NULLIF for zero values
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer Return',
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _custom_return_number text DEFAULT NULL,
  _custom_credit_token text DEFAULT NULL,
  _created_by uuid DEFAULT NULL,
  _return_number text DEFAULT NULL,
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
  item_refund_price numeric;
  item_mrp numeric;
  item_name text;
  item_sku text;
  item_barcode text;
  item_slug text;
  item_variant_info text;
  item_orig_sale_item_id uuid;
  v_item_returnable int;
  computed_total_refund numeric := 0;
  v_existing_return record;
  v_orig_sale record;
  v_orig_item record;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  v_effective_return_num text;
  v_effective_credit_tok text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_prev_credit numeric := 0;
  v_new_credit numeric := 0;
  v_resolved_cust_id uuid;
  v_norm_phone text := public.normalize_phone(_customer_phone);
  v_clean_sale_id uuid := _original_sale_id;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '365 days';
  v_cust_rec record;
  v_clean_method text := lower(trim(COALESCE(_refund_method, 'exchange_credit')));
  v_is_credit_method boolean;
BEGIN
  -- 1. Authorization: Allow service_role, unauthenticated POS kiosk operations, and verify staff/admin roles
  IF current_user != 'service_role' AND COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    IF uid IS NOT NULL THEN
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
        ) OR
        EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = uid AND (lower(u.email) LIKE '%admin%' OR lower(u.email) LIKE '%staff%')
        )
      ) THEN
        RAISE EXCEPTION 'Unauthorized: only store staff or administrators can process returns';
      END IF;
    END IF;
  END IF;

  -- 2. Idempotency Check (Prevents duplicate return and duplicate credit creation)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, customer_name, customer_id, original_sale_id, original_sale_number, expires_at
    INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_credit
      FROM public.pos_customers WHERE id = v_existing_return.customer_id;

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
    WHERE id = _original_sale_id
    FOR UPDATE;

    IF v_orig_sale.id IS NOT NULL THEN
      v_clean_sale_id := v_orig_sale.id;
      v_orig_sale_number := v_orig_sale.sale_number;
    END IF;
  END IF;

  -- 5. Calculate Return Amount & STRICT Over-Refund Prevention with Safe NULLIF Fallback
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Return item quantity must be greater than zero';
    END IF;

    item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;

    -- Strict check against original sale item if linked
    IF item_orig_sale_item_id IS NOT NULL THEN
      SELECT * INTO v_orig_item
      FROM public.offline_sale_items
      WHERE id = item_orig_sale_item_id
      FOR UPDATE;

      IF v_orig_item.id IS NOT NULL THEN
        -- Use NULLIF so 0 values fall back to v_orig_item.qty or v_orig_item.quantity
        v_item_returnable := GREATEST(0,
          COALESCE(
            NULLIF(v_orig_item.quantity_returnable, 0),
            NULLIF(v_orig_item.returnable_qty, 0),
            NULLIF(v_orig_item.quantity_sold, 0),
            v_orig_item.qty,
            v_orig_item.quantity,
            1
          ) - COALESCE(v_orig_item.quantity_returned, v_orig_item.returned_quantity, 0)
        );

        IF item_qty > v_item_returnable THEN
          RAISE EXCEPTION 'Cannot return % unit(s) of %. Only % returnable unit(s) remain.',
            item_qty, COALESCE(v_orig_item.name, 'item'), v_item_returnable;
        END IF;

        item_refund_price := COALESCE(v_orig_item.final_unit_paid_price, v_orig_item.unit_selling_price, v_orig_item.price, 0);
      ELSE
        item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
      END IF;
    ELSE
      item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    END IF;

    computed_total_refund := computed_total_refund + ROUND((item_refund_price * item_qty), 2);
    item_count := item_count + 1;
  END LOOP;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return must contain at least one valid item';
  END IF;

  -- 6. Generate Public Return Number & Collision-Safe Credit Token
  v_effective_return_num := COALESCE(NULLIF(trim(_custom_return_number), ''), NULLIF(trim(_return_number), ''));
  v_effective_credit_tok := COALESCE(NULLIF(trim(_custom_credit_token), ''), NULLIF(trim(_credit_token), ''));

  IF v_effective_return_num IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.offline_returns WHERE return_number = v_effective_return_num) THEN
    new_return_number := v_effective_return_num;
  ELSE
    new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  END IF;

  IF v_effective_credit_tok IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.offline_returns WHERE upper(credit_token) = upper(v_effective_credit_tok)) THEN
    new_credit_token := upper(v_effective_credit_tok);
  ELSE
    new_credit_token := public.generate_store_credit_token();
  END IF;

  v_is_credit_method := v_clean_method IN ('exchange_credit', 'store_credit', 'credit', 'voucher', 'exchange');

  -- 7. Insert Canonical offline_returns Record
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
    credit_token,
    credit_balance,
    credit_used,
    credit_token_status,
    status,
    return_reason,
    notes,
    created_by,
    idempotency_key,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    v_norm_phone,
    COALESCE(trim(_customer_email), v_cust_rec.email, ''),
    v_clean_method,
    computed_total_refund,
    CASE WHEN v_is_credit_method THEN new_credit_token ELSE NULL END,
    CASE WHEN v_is_credit_method THEN computed_total_refund ELSE 0 END,
    0,
    CASE WHEN v_is_credit_method THEN 'ACTIVE' ELSE 'COMPLETED' END,
    'completed',
    COALESCE(NULLIF(trim(_return_reason), ''), 'Customer Return'),
    _notes,
    uid,
    NULLIF(trim(_idempotency_key), ''),
    v_expiry_date,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 8. Synchronize Store Credit if credit/voucher refund method
  IF v_is_credit_method AND computed_total_refund > 0 THEN
    v_new_credit := v_prev_credit + computed_total_refund;

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
      v_norm_phone,
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

    -- Insert into immutable Store Credit Ledger
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
      return_id,
      source_sale_id,
      sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
      v_norm_phone,
      new_credit_token,
      'CREDIT_ISSUED',
      computed_total_refund,
      v_prev_credit,
      v_new_credit,
      new_return_id,
      new_return_id,
      v_clean_sale_id,
      v_clean_sale_id,
      'Return #' || new_return_number || ' — Store Credit Issued',
      uid,
      now()
    );

    -- Synchronize pos_customers and profiles
    UPDATE public.pos_customers
    SET store_credit_balance = v_new_credit,
        store_credit = v_new_credit,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

    UPDATE public.profiles
    SET store_credit_balance = v_new_credit,
        updated_at = now()
    WHERE id = v_resolved_cust_id;
  ELSE
    v_new_credit := v_prev_credit;
  END IF;

  -- 9. Insert Return Items & Restock Inventory Atomically (Both Variant and Parent Product)
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
    item_variant_info := elem->>'variant_info';

    IF item_orig_sale_item_id IS NOT NULL THEN
      SELECT * INTO v_orig_item FROM public.offline_sale_items WHERE id = item_orig_sale_item_id;
      IF v_orig_item.id IS NOT NULL THEN
        item_product_id := COALESCE(item_product_id, v_orig_item.product_id);
        item_variant_id := COALESCE(item_variant_id, v_orig_item.variant_id);
        item_refund_price := COALESCE(v_orig_item.final_unit_paid_price, v_orig_item.unit_selling_price, v_orig_item.price, item_refund_price);
        item_mrp := COALESCE(v_orig_item.unit_mrp, v_orig_item.mrp, item_mrp);
        item_name := COALESCE(v_orig_item.name, item_name);
        item_sku := COALESCE(v_orig_item.sku, item_sku);
        item_barcode := COALESCE(v_orig_item.barcode, item_barcode);
      END IF;
    END IF;

    -- If variant_id is still missing but product has variants, select default/first variant
    IF item_variant_id IS NULL AND item_product_id IS NOT NULL THEN
      SELECT id INTO item_variant_id
      FROM public.product_variants
      WHERE product_id = item_product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY stock DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.offline_return_items (
      return_id,
      original_sale_item_id,
      product_id,
      variant_id,
      product_name,
      name,
      variant_info,
      sku,
      barcode,
      qty,
      quantity,
      refund_price,
      mrp,
      subtotal,
      total,
      created_at
    ) VALUES (
      new_return_id,
      item_orig_sale_item_id,
      item_product_id,
      item_variant_id,
      item_name,
      item_name,
      item_variant_info,
      item_sku,
      item_barcode,
      item_qty,
      item_qty,
      item_refund_price,
      item_mrp,
      ROUND(item_refund_price * item_qty, 2),
      ROUND(item_refund_price * item_qty, 2),
      now()
    );

    -- Update returned quantity in original sale item if linked
    IF item_orig_sale_item_id IS NOT NULL THEN
      UPDATE public.offline_sale_items
      SET returned_quantity = COALESCE(returned_quantity, 0) + item_qty,
          quantity_returned = COALESCE(quantity_returned, 0) + item_qty,
          quantity_returnable = GREATEST(0, COALESCE(NULLIF(quantity_returnable, 0), NULLIF(quantity_sold, 0), qty, quantity, 1) - item_qty),
          returnable_qty = GREATEST(0, COALESCE(NULLIF(returnable_qty, 0), NULLIF(quantity_returnable, 0), NULLIF(quantity_sold, 0), qty, quantity, 1) - item_qty),
          return_status = CASE
            WHEN GREATEST(0, COALESCE(NULLIF(quantity_returnable, 0), NULLIF(quantity_sold, 0), qty, quantity, 1) - item_qty) = 0 THEN 'RETURNED'
            ELSE 'PARTIALLY_RETURNED'
          END
      WHERE id = item_orig_sale_item_id;
    END IF;

    -- Restock Variant and synchronize Parent Product stock
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
          product_id,
          variant_id,
          type,
          transaction_type,
          quantity,
          previous_quantity,
          new_quantity,
          reference_type,
          reference_id,
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          item_variant_id,
          'offline_return',
          'offline_return',
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
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
          notes,
          created_by,
          created_at
        ) VALUES (
          item_product_id,
          NULL,
          'offline_return',
          'offline_return',
          item_qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid,
          now()
        );
      END IF;
    END IF;
  END LOOP;

  -- 10. Recalculate Original Sale Return Status if linked
  IF v_clean_sale_id IS NOT NULL THEN
    PERFORM public.recalculate_offline_sale_return_status(v_clean_sale_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', CASE WHEN v_is_credit_method THEN new_credit_token ELSE NULL END,
    'customer_id', v_resolved_cust_id,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    'customer_phone', v_norm_phone,
    'available_credit', v_new_credit,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'expires_at', v_expiry_date,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text, uuid, text, text
) TO authenticated, anon, service_role;

-- 4. Authoritative place_offline_sale with explicit quantity_sold, quantity_returnable, returnable_qty population
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

  -- 10. Generate Sale Number & Token Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_token_number := public.get_next_pos_token();

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

  -- 13. Insert Items & Deduct Stock with Variant Fallback Resolution, Buying Price Snapshot, and Explicit quantity_sold/quantity_returnable
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

    -- Look up cost price safely from joined products & product_costs
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

        -- Authoritative parent product stock sync
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
