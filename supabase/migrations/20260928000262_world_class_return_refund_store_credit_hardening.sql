-- =====================================================================
-- Migration: 20260928000262_world_class_return_refund_store_credit_hardening.sql
-- Description:
--   1. Canonical phone normalization function (public.normalize_phone)
--   2. High-entropy store credit token generator (public.generate_store_credit_token -> ZRH-XXXX-XXXX)
--   3. Unified customer resolver (public.resolve_or_create_customer)
--   4. Hardened process_offline_return:
--      - Accepts deterministic _custom_return_number and _custom_credit_token for offline sync
--      - Validates returnable quantity against original sale items with FOR UPDATE locking
--      - Recalculates refund amount from historical final_unit_paid_price
--      - Atomically restocks inventory with transaction logs
--      - Automatically logs CREDIT_ISSUED in public.store_credit_ledger
--      - Synchronizes store_credit_balance across pos_customers & profiles
--   5. Hardened place_offline_sale:
--      - Enforces customer ownership on credit vouchers (prevents cross-customer redemption)
--      - Atomic row locking to prevent concurrent double-spending
--      - Automatically logs CREDIT_USED in public.store_credit_ledger
--      - Deducts balance from pos_customers & profiles
--   6. Hardened search_pos_customers:
--      - Unifies profiles and pos_customers
--      - Searches by name, normalized phone, email, UUID, or credit token
--      - Computes real-time available store credit from active returns
--   7. Synchronized get_store_credit_voucher & get_customer_store_credit
-- =====================================================================

-- 1. Canonical Phone Normalization Function
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RETURN '';
  END IF;

  IF length(v_digits) = 12 AND starts_with(v_digits, '91') THEN
    RETURN substring(v_digits from 3);
  ELSIF length(v_digits) = 11 AND starts_with(v_digits, '0') THEN
    RETURN substring(v_digits from 2);
  ELSIF length(v_digits) >= 10 THEN
    RETURN right(v_digits, 10);
  ELSE
    RETURN v_digits;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO authenticated, anon, service_role;

-- 2. High-Entropy Store Credit Token Generator (ZRH-XXXX-XXXX)
CREATE OR REPLACE FUNCTION public.generate_store_credit_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- Unambiguous characters
  part1 text;
  part2 text;
  candidate text;
  i int;
BEGIN
  LOOP
    part1 := '';
    part2 := '';
    FOR i IN 1..4 LOOP
      part1 := part1 || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      part2 := part2 || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    candidate := 'ZRH-' || part1 || '-' || part2;

    IF NOT EXISTS (SELECT 1 FROM public.offline_returns WHERE upper(credit_token) = candidate)
       AND NOT EXISTS (SELECT 1 FROM public.store_credit_vouchers WHERE upper(token) = candidate)
       AND NOT EXISTS (SELECT 1 FROM public.pos_exchange_vouchers WHERE upper(token) = candidate)
    THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_store_credit_token() TO authenticated, anon, service_role;

-- 3. Canonical Customer Resolver & Creator
CREATE OR REPLACE FUNCTION public.resolve_or_create_customer(
  p_name text,
  p_phone text,
  p_email text DEFAULT '',
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_norm_phone text := public.normalize_phone(p_phone);
  v_cust_id uuid := p_id;
  v_clean_name text := COALESCE(NULLIF(trim(p_name), ''), 'Walk-in Customer');
  v_clean_email text := COALESCE(NULLIF(trim(p_email), ''), '');
BEGIN
  -- 1. Check by ID if provided
  IF v_cust_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_cust_id) 
       OR EXISTS (SELECT 1 FROM public.pos_customers WHERE id = v_cust_id) THEN
      RETURN v_cust_id;
    END IF;
  END IF;

  -- 2. Check by normalized 10-digit phone
  IF length(v_norm_phone) = 10 THEN
    SELECT id INTO v_cust_id
    FROM public.profiles
    WHERE public.normalize_phone(phone) = v_norm_phone
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      SELECT id INTO v_cust_id
      FROM public.pos_customers
      WHERE public.normalize_phone(phone) = v_norm_phone
      LIMIT 1;
    END IF;

    IF v_cust_id IS NOT NULL THEN
      RETURN v_cust_id;
    END IF;
  END IF;

  -- 3. Check by email if provided
  IF v_clean_email != '' THEN
    SELECT id INTO v_cust_id
    FROM public.profiles
    WHERE lower(trim(email)) = lower(v_clean_email)
    LIMIT 1;

    IF v_cust_id IS NOT NULL THEN
      RETURN v_cust_id;
    END IF;
  END IF;

  -- 4. Create new customer record with identical UUID in pos_customers and profiles
  v_cust_id := gen_random_uuid();

  INSERT INTO public.pos_customers (
    id, name, phone, email, total_spent, total_visits, store_credit, store_credit_balance, last_visit, created_at, updated_at
  ) VALUES (
    v_cust_id,
    v_clean_name,
    v_norm_phone,
    v_clean_email,
    0,
    1,
    0,
    0,
    now(),
    now(),
    now()
  ) ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      updated_at = now();

  INSERT INTO public.profiles (
    id, full_name, phone, email, store_credit_balance, created_at, updated_at
  ) VALUES (
    v_cust_id,
    v_clean_name,
    v_norm_phone,
    v_clean_email,
    0,
    now(),
    now()
  ) ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      updated_at = now();

  RETURN v_cust_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_or_create_customer(text, text, text, uuid) TO authenticated, anon, service_role;

-- 4. Drop older process_offline_return signatures to prevent parameter ambiguity
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text);

-- 5. Canonical Authoritative process_offline_return RPC
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
  _idempotency_key text DEFAULT NULL,
  _custom_return_number text DEFAULT NULL,
  _custom_credit_token text DEFAULT NULL
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
  v_item_returnable int;
  computed_total_refund numeric := 0;
  v_existing_return record;
  v_orig_sale record;
  v_orig_item record;
  new_return_id uuid;
  new_return_number text;
  new_credit_token text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
  v_prev_credit numeric := 0;
  v_resolved_cust_id uuid;
  v_norm_phone text := public.normalize_phone(_customer_phone);
  v_clean_sale_id uuid := _original_sale_id;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '365 days';
  v_cust_rec record;
BEGIN
  -- 1. Authorization: Verify Admin / Staff role if user is authenticated
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin')
       AND NOT public.has_role(uid, 'pos_user')
       AND NOT public.has_role(uid, 'staff')
       AND NOT public.has_role(uid, 'manager')
       AND NOT public.has_role(uid, 'owner')
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

  -- 2. Idempotency Check (Prevents duplicate return and duplicate credit creation)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token, customer_name, customer_id, original_sale_id, original_sale_number, expires_at
    INTO v_existing_return
    FROM public.offline_returns
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_existing_return.id IS NOT NULL THEN
      SELECT COALESCE(store_credit_balance, 0) INTO v_prev_credit
      FROM public.pos_customers WHERE id = v_existing_return.customer_id;

      RETURN jsonb_build_object(
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

  -- 5. Calculate Return Amount & STRICT Over-Refund Prevention
  FOR elem IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    IF item_qty <= 0 THEN
      RAISE EXCEPTION 'Return item quantity must be greater than zero';
    END IF;

    item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;

    -- Strict check against original sale item
    IF item_orig_sale_item_id IS NOT NULL THEN
      SELECT * INTO v_orig_item
      FROM public.offline_sale_items
      WHERE id = item_orig_sale_item_id
      FOR UPDATE;

      IF v_orig_item.id IS NOT NULL THEN
        v_item_returnable := GREATEST(0, COALESCE(v_orig_item.quantity_sold, v_orig_item.qty, 1) - COALESCE(v_orig_item.quantity_returned, v_orig_item.returned_quantity, 0));
        IF item_qty > v_item_returnable THEN
          RAISE EXCEPTION 'Cannot return % unit(s) of %. Only % returnable unit(s) remain.',
            item_qty, COALESCE(v_orig_item.name, 'item'), v_item_returnable;
        END IF;

        -- Authoritative price: strictly calculate from historical snapshot
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
  IF _custom_return_number IS NOT NULL AND trim(_custom_return_number) != '' 
     AND NOT EXISTS (SELECT 1 FROM public.offline_returns WHERE return_number = trim(_custom_return_number)) THEN
    new_return_number := trim(_custom_return_number);
  ELSE
    new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  END IF;

  IF _custom_credit_token IS NOT NULL AND trim(_custom_credit_token) != ''
     AND NOT EXISTS (SELECT 1 FROM public.offline_returns WHERE upper(credit_token) = upper(trim(_custom_credit_token))) THEN
    new_credit_token := upper(trim(_custom_credit_token));
  ELSE
    new_credit_token := public.generate_store_credit_token();
  END IF;

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
    _refund_method,
    computed_total_refund,
    new_credit_token,
    computed_total_refund,
    0,
    'ACTIVE',
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

  -- 8. Synchronize pos_exchange_vouchers & store_credit_vouchers
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
      v_prev_credit + computed_total_refund,
      new_return_id,
      new_return_id,
      v_clean_sale_id,
      v_clean_sale_id,
      'Return #' || new_return_number || ' — Store Credit Issued',
      uid,
      now()
    );

    -- 10. Synchronize customer profile store credit balances
    UPDATE public.pos_customers
    SET store_credit_balance = v_prev_credit + computed_total_refund,
        store_credit = v_prev_credit + computed_total_refund,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

    UPDATE public.profiles
    SET store_credit_balance = v_prev_credit + computed_total_refund,
        updated_at = now()
    WHERE id = v_resolved_cust_id;
  END IF;

  -- 11. Insert Return Items & Atomically Restock Inventory
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
      now()
    );

    -- Update returned quantity in original sale item
    IF item_orig_sale_item_id IS NOT NULL THEN
      UPDATE public.offline_sale_items
      SET returned_quantity = COALESCE(returned_quantity, 0) + item_qty,
          quantity_returned = COALESCE(quantity_returned, 0) + item_qty,
          quantity_returnable = GREATEST(0, COALESCE(quantity_sold, qty, 1) - (COALESCE(quantity_returned, 0) + item_qty))
      WHERE id = item_orig_sale_item_id;
    END IF;

    -- Atomic Restock with Row Locking
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
          notes,
          created_by
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
          notes,
          created_by
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
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 12. Update Original Sale Return Status
  IF v_clean_sale_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.offline_sale_items
      WHERE sale_id = v_clean_sale_id
        AND (COALESCE(quantity_sold, qty, 1) - COALESCE(quantity_returned, returned_quantity, 0)) > 0
    ) THEN
      UPDATE public.offline_sales SET return_status = 'partially_returned', updated_at = now() WHERE id = v_clean_sale_id;
    ELSE
      UPDATE public.offline_sales SET return_status = 'returned', updated_at = now() WHERE id = v_clean_sale_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_id', v_resolved_cust_id,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    'customer_phone', v_norm_phone,
    'available_credit', v_prev_credit + computed_total_refund,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'expires_at', v_expiry_date,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text
) TO authenticated, anon, service_role;

-- 6. Canonical place_offline_sale with Cross-Customer Verification and Ledger Logging
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
  v_cust_id uuid;
  v_norm_phone text := public.normalize_phone(_customer_phone);
  v_existing_sale record;
  v_prev_stock int;
  v_new_stock int;
  v_coupon_record record;
  v_credit_rec record;
  v_prev_cust_credit numeric := 0;
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

  -- 2. Idempotency Check
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

  -- 3. Resolve Customer Record
  v_cust_id := public.resolve_or_create_customer(
    _customer_name,
    _customer_phone,
    _customer_email,
    _customer_id
  );

  SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_prev_cust_credit
  FROM public.pos_customers
  WHERE id = v_cust_id;

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
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now())
      AND (COALESCE(max_uses, usage_limit, 0) <= 0 OR COALESCE(used_count, usage_count, 0) < COALESCE(max_uses, usage_limit))
    LIMIT 1;

    IF v_coupon_record.id IS NOT NULL THEN
      IF COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0) <= 0 
         OR (v_subtotal - v_discount) >= COALESCE(v_coupon_record.min_order_amount, v_coupon_record.minimum_order_value, 0) THEN
        
        IF v_coupon_record.discount_type IN ('percentage', 'percent') THEN
          v_coupon_discount := ROUND(((v_subtotal - v_discount) * v_coupon_record.discount_value / 100.0), 2);
        ELSIF v_coupon_record.discount_type = 'fixed' THEN
          v_coupon_discount := v_coupon_record.discount_value;
        END IF;

        IF COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount, 0) > 0 THEN
          v_coupon_discount := LEAST(v_coupon_discount, COALESCE(v_coupon_record.max_discount_amount, v_coupon_record.maximum_discount));
        END IF;

        v_coupon_discount := LEAST(v_coupon_discount, GREATEST(0, v_subtotal - v_discount));

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1,
            usage_count = COALESCE(usage_count, 0) + 1
        WHERE id = v_coupon_record.id;
      END IF;
    END IF;
  END IF;

  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Validate & Atomically Redeem Store Credit with Customer Ownership Verification
  IF _store_credit_used > 0 OR v_clean_token != '' THEN
    IF v_clean_token != '' THEN
      SELECT * INTO v_credit_rec
      FROM public.offline_returns
      WHERE UPPER(TRIM(credit_token)) = v_clean_token
      FOR UPDATE;

      IF v_credit_rec.id IS NOT NULL THEN
        -- Check Expiry
        IF v_credit_rec.expires_at IS NOT NULL AND v_credit_rec.expires_at < now() THEN
          RAISE EXCEPTION 'Store credit voucher % has expired on %', v_clean_token, v_credit_rec.expires_at;
        END IF;

        -- Check Status
        IF v_credit_rec.credit_token_status = 'CONSUMED' OR (v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0)) <= 0 THEN
          RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed (Balance ₹0)', v_clean_token;
        END IF;

        -- Verify Customer Ownership (Anti-cross-customer leakage)
        IF v_credit_rec.customer_id IS NOT NULL AND v_cust_id IS NOT NULL THEN
          IF v_credit_rec.customer_id != v_cust_id THEN
            IF v_norm_phone != '' AND public.normalize_phone(v_credit_rec.customer_phone) = v_norm_phone THEN
              NULL; -- Phone matches, allowed
            ELSE
              RAISE EXCEPTION 'Voucher % belongs to customer % (%). It cannot be redeemed for a different customer account.',
                v_clean_token,
                COALESCE(v_credit_rec.customer_name, 'another customer'),
                COALESCE(v_credit_rec.customer_phone, 'registered phone');
            END IF;
          END IF;
        END IF;

        v_voucher_avail := GREATEST(0, v_credit_rec.refund_amount - COALESCE(v_credit_rec.credit_used, 0));
        v_voucher_token := v_clean_token;
      ELSE
        -- Check pos_exchange_vouchers fallback
        SELECT * INTO v_credit_rec
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token
        FOR UPDATE;

        IF v_credit_rec.id IS NOT NULL THEN
          v_voucher_avail := GREATEST(0, v_credit_rec.remaining_balance);
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
            credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + v_voucher_used)) <= 0 THEN 'CONSUMED' ELSE 'PARTIALLY_USED' END,
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
      -- Customer Account Store Credit (Direct balance redemption)
      SELECT COALESCE(store_credit_balance, store_credit, 0) INTO v_voucher_avail
      FROM public.pos_customers
      WHERE id = v_cust_id
      FOR UPDATE;

      v_voucher_used := LEAST(_store_credit_used, COALESCE(v_voucher_avail, 0), v_gross_total);
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 8. Effective Payment Method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 9. Daily Token Number & Sale Number
  SELECT COALESCE(MAX(pos_token_number), 0) + 1 INTO v_token_number
  FROM public.offline_sales
  WHERE created_at >= date_trunc('day', now());

  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 10. Insert offline_sales Record
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
    COALESCE(v_norm_phone, ''),
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

  -- 11. Record Store Credit Redemption in Immutable Ledger
  IF v_voucher_used > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      used_in_sale_id,
      sale_id,
      source_return_id,
      return_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      v_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      v_norm_phone,
      COALESCE(v_voucher_token, 'DIRECT_CREDIT'),
      'CREDIT_USED',
      v_voucher_used,
      v_prev_cust_credit,
      GREATEST(0, v_prev_cust_credit - v_voucher_used),
      v_sale_id,
      v_sale_id,
      v_credit_rec.id,
      v_credit_rec.id,
      'Redeemed in Sale #' || v_sale_number || CASE WHEN v_voucher_token IS NOT NULL THEN ' (Voucher ' || v_voucher_token || ')' ELSE '' END,
      uid,
      now()
    );

    UPDATE public.pos_customers
    SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
        store_credit = GREATEST(0, COALESCE(store_credit_balance, store_credit, 0) - v_voucher_used),
        updated_at = now()
    WHERE id = v_cust_id;

    UPDATE public.profiles
    SET store_credit_balance = GREATEST(0, COALESCE(store_credit_balance, 0) - v_voucher_used),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 12. Update Customer Lifetime Metrics
  UPDATE public.pos_customers
  SET total_spent = total_spent + v_gross_total,
      total_visits = total_visits + 1,
      last_visit = now(),
      updated_at = now()
  WHERE id = v_cust_id;

  -- 13. Insert Sale Items & Deduct Stock
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
      variant_info, sku, barcode, price, unit_selling_price, mrp, unit_mrp,
      cost_price, qty, quantity, quantity_sold, quantity_returned, returned_quantity,
      quantity_returnable, final_unit_paid_price, line_gross_amount, total, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp, item_mrp,
      COALESCE(item_cost, 0), item_qty, item_qty, item_qty, 0, 0,
      item_qty, item_price, (item_price * item_qty), (item_price * item_qty), now()
    );

    -- Decrement variant stock
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

-- 7. High-Performance Authoritative Customer Search
CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  state text,
  pincode text,
  notes text,
  total_purchases integer,
  total_spend numeric,
  store_credit_balance numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean text := trim(COALESCE(_query, ''));
  v_norm text := public.normalize_phone(v_clean);
  v_voucher_cust_id uuid;
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  -- Check if query matches a return credit token
  SELECT customer_id INTO v_voucher_cust_id
  FROM public.offline_returns
  WHERE upper(trim(credit_token)) = upper(v_clean)
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH combined_customers AS (
    SELECT 
      c.id,
      COALESCE(NULLIF(trim(c.name), ''), 'Walk-in Customer') AS name,
      COALESCE(c.phone, '') AS phone,
      COALESCE(c.email, '') AS email,
      COALESCE(c.city, '') AS city,
      COALESCE(c.address, '') AS address,
      COALESCE(c.state, '') AS state,
      COALESCE(c.pincode, '') AS pincode,
      ''::text AS notes,
      c.created_at,
      c.updated_at
    FROM public.pos_customers c
    UNION
    SELECT
      p.id,
      COALESCE(NULLIF(trim(p.full_name), ''), 'Walk-in Customer') AS name,
      COALESCE(p.phone, '') AS phone,
      COALESCE(p.email, '') AS email,
      COALESCE(p.city, '') AS city,
      COALESCE(p.address, '') AS address,
      COALESCE(p.state, '') AS state,
      COALESCE(p.pincode, '') AS pincode,
      ''::text AS notes,
      p.created_at,
      p.updated_at
    FROM public.profiles p
  ),
  deduped AS (
    SELECT DISTINCT ON (id) *
    FROM combined_customers
  )
  SELECT 
    d.id,
    d.name,
    d.phone,
    d.email,
    d.city,
    d.address,
    d.state,
    d.pincode,
    d.notes,
    (
      COALESCE((SELECT COUNT(*)::integer FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT COUNT(*)::integer FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::integer AS total_purchases,
    (
      COALESCE((SELECT SUM(s.total)::numeric FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT SUM(o.total)::numeric FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::numeric AS total_spend,
    -- Calculate live active store credit balance
    GREATEST(
      COALESCE((SELECT store_credit_balance FROM public.pos_customers WHERE id = d.id), 0),
      COALESCE((
        SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
        FROM public.offline_returns r
        WHERE (r.customer_id = d.id OR (d.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(d.phone)))
          AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
          AND (r.expires_at IS NULL OR r.expires_at >= now())
      ), 0)
    )::numeric AS store_credit_balance,
    d.created_at,
    d.updated_at
  FROM deduped d
  WHERE 
    (v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id)
    OR d.name ILIKE '%' || v_clean || '%'
    OR (v_norm != '' AND public.normalize_phone(d.phone) = v_norm)
    OR d.phone ILIKE '%' || v_clean || '%'
    OR d.email ILIKE '%' || v_clean || '%'
    OR d.city ILIKE '%' || v_clean || '%'
    OR d.id::text ILIKE '%' || v_clean || '%'
  ORDER BY 
    CASE 
      WHEN v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id THEN 0
      WHEN v_norm != '' AND public.normalize_phone(d.phone) = v_norm THEN 1
      WHEN lower(trim(d.name)) = lower(v_clean) THEN 2
      WHEN lower(trim(d.name)) ILIKE lower(v_clean) || '%' THEN 3
      ELSE 4
    END,
    d.updated_at DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pos_customers(text) TO authenticated, anon, service_role;

-- 8. Authoritative get_store_credit_voucher RPC
CREATE OR REPLACE FUNCTION public.get_store_credit_voucher(
  _token text,
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  v_norm_phone text := public.normalize_phone(_phone);
  v_ret_rec record;
  v_pos_rec record;
  v_sc_rec record;
  v_coup_rec record;
  v_remaining numeric := 0;
  v_days_left int := 0;
BEGIN
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Please enter a voucher token or coupon code');
  END IF;

  -- 1. Check in public.offline_returns first (canonical source of truth)
  SELECT 
    id AS return_id,
    UPPER(TRIM(credit_token)) AS token,
    customer_id,
    customer_phone,
    customer_name,
    refund_amount AS original_amount,
    COALESCE(credit_used, 0) AS credit_used,
    GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
    CASE 
      WHEN (refund_amount - COALESCE(credit_used, 0)) <= 0 OR credit_token_status = 'CONSUMED' THEN 'redeemed'
      WHEN expires_at < now() OR credit_token_status = 'EXPIRED' THEN 'expired'
      ELSE 'active'
    END AS status,
    COALESCE(expires_at, now() + interval '365 days') AS expires_at,
    created_at,
    original_sale_id,
    original_sale_number,
    return_number
  INTO v_ret_rec
  FROM public.offline_returns
  WHERE UPPER(TRIM(credit_token)) = v_clean_token
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_ret_rec.token IS NOT NULL THEN
    v_remaining := v_ret_rec.remaining_balance;
    IF v_ret_rec.expires_at IS NOT NULL AND v_ret_rec.expires_at < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has expired',
        'status', 'expired',
        'expired', true,
        'token', v_clean_token,
        'expires_at', v_ret_rec.expires_at,
        'remaining_balance', 0
      );
    END IF;

    IF v_ret_rec.status = 'redeemed' OR v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_ret_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_ret_rec.return_id,
      'return_id', v_ret_rec.return_id,
      'token', v_ret_rec.token,
      'customer_id', v_ret_rec.customer_id,
      'customer_name', COALESCE(v_ret_rec.customer_name, 'Walk-in Customer'),
      'customer_phone', COALESCE(v_ret_rec.customer_phone, ''),
      'original_amount', v_ret_rec.original_amount,
      'credit_used', v_ret_rec.credit_used,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_ret_rec.expires_at,
      'days_remaining', v_days_left,
      'original_sale_id', v_ret_rec.original_sale_id,
      'original_sale_number', v_ret_rec.original_sale_number,
      'original_return_number', v_ret_rec.return_number
    );
  END IF;

  -- 2. Check in public.pos_exchange_vouchers
  SELECT * INTO v_pos_rec
  FROM public.pos_exchange_vouchers
  WHERE UPPER(TRIM(token)) = v_clean_token
  LIMIT 1;

  IF v_pos_rec.token IS NOT NULL THEN
    v_remaining := COALESCE(v_pos_rec.remaining_balance, 0);
    IF v_pos_rec.expires_at IS NOT NULL AND v_pos_rec.expires_at < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has expired',
        'status', 'expired',
        'expired', true,
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    IF v_pos_rec.status = 'redeemed' OR v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
        'status', 'redeemed',
        'token', v_clean_token,
        'remaining_balance', 0
      );
    END IF;

    v_days_left := GREATEST(0, EXTRACT(DAY FROM (v_pos_rec.expires_at - now()))::int);

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', false,
      'voucher_id', v_pos_rec.id,
      'return_id', v_pos_rec.return_id,
      'token', v_pos_rec.token,
      'customer_id', v_pos_rec.customer_id,
      'customer_name', COALESCE(v_pos_rec.customer_name, 'Walk-in Customer'),
      'customer_phone', COALESCE(v_pos_rec.customer_phone, ''),
      'original_amount', v_pos_rec.original_amount,
      'remaining_balance', v_remaining,
      'available_credit', v_remaining,
      'status', 'active',
      'expires_at', v_pos_rec.expires_at,
      'days_remaining', v_days_left
    );
  END IF;

  -- 3. Check in public.store_credit_vouchers
  SELECT * INTO v_sc_rec
  FROM public.store_credit_vouchers
  WHERE UPPER(TRIM(token)) = v_clean_token
  LIMIT 1;

  IF v_sc_rec.token IS NOT NULL THEN
    v_remaining := COALESCE(v_sc_rec.current_balance, 0);
    IF v_remaining > 0 AND (v_sc_rec.expires_at IS NULL OR v_sc_rec.expires_at >= now()) AND v_sc_rec.is_active = true THEN
      RETURN jsonb_build_object(
        'valid', true,
        'is_coupon', false,
        'voucher_id', v_sc_rec.id,
        'token', v_sc_rec.token,
        'customer_id', v_sc_rec.customer_id,
        'original_amount', v_sc_rec.initial_amount,
        'remaining_balance', v_remaining,
        'available_credit', v_remaining,
        'status', 'active',
        'expires_at', v_sc_rec.expires_at
      );
    END IF;
  END IF;

  -- 4. Check in public.coupons (Allow promotional coupons entered in this same box)
  SELECT * INTO v_coup_rec
  FROM public.coupons
  WHERE UPPER(TRIM(code)) = v_clean_token
    AND is_active = true
  LIMIT 1;

  IF v_coup_rec.code IS NOT NULL THEN
    IF v_coup_rec.end_date IS NOT NULL AND v_coup_rec.end_date < now() THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Coupon code ' || v_clean_token || ' has expired',
        'token', v_clean_token
      );
    END IF;

    IF v_coup_rec.max_uses IS NOT NULL AND v_coup_rec.used_count >= v_coup_rec.max_uses THEN
      RETURN jsonb_build_object(
        'valid', false,
        'error', 'Coupon code ' || v_clean_token || ' has reached its maximum usage limit',
        'token', v_clean_token
      );
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'is_coupon', true,
      'coupon_code', v_coup_rec.code,
      'token', v_coup_rec.code,
      'discount_type', v_coup_rec.discount_type,
      'discount_value', v_coup_rec.discount_value,
      'min_cart_value', COALESCE(v_coup_rec.min_cart_value, 0),
      'max_discount', v_coup_rec.max_discount,
      'remaining_balance', v_coup_rec.discount_value,
      'available_credit', v_coup_rec.discount_value,
      'status', 'active'
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', false,
    'error', 'Voucher or Coupon ' || v_clean_token || ' not found',
    'token', v_clean_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_credit_voucher(text, uuid, text, uuid) TO authenticated, anon, service_role;

-- 9. Authoritative get_customer_store_credit RPC
CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Walk-in Customer';
  v_cust_phone text := '';
  v_norm_phone text := public.normalize_phone(_phone);
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_returns_sum numeric := 0;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, isolate to this specific voucher instrument
  IF v_clean_token != '' THEN
    SELECT 
      id, customer_id, customer_name, customer_phone,
      refund_amount, credit_used,
      GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
      expires_at
    INTO v_single_voucher
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_single_voucher.id IS NOT NULL THEN
      IF v_single_voucher.expires_at IS NOT NULL AND v_single_voucher.expires_at < now() THEN
        v_balance := 0;
      ELSE
        v_balance := v_single_voucher.remaining_balance;
      END IF;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := COALESCE(v_single_voucher.customer_name, 'Walk-in Customer');
      v_cust_phone := COALESCE(v_single_voucher.customer_phone, '');
      v_latest_token := v_clean_token;
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id
  ELSIF v_cust_id IS NOT NULL THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, COALESCE(phone, '')
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE id = v_cust_id;

    IF v_norm_phone = '' AND v_cust_phone != '' THEN
      v_norm_phone := public.normalize_phone(v_cust_phone);
    END IF;

  -- 3. Otherwise search by normalized phone
  ELSIF length(v_norm_phone) = 10 THEN
    SELECT id, COALESCE(store_credit_balance, store_credit, 0), name, phone
    INTO v_cust_id, v_balance, v_cust_name, v_cust_phone
    FROM public.pos_customers
    WHERE public.normalize_phone(phone) = v_norm_phone
    LIMIT 1;
  END IF;

  -- 4. Calculate active returns sum and latest token
  SELECT 
    COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0),
    COALESCE((
      SELECT credit_token 
      FROM public.offline_returns sub_r
      WHERE ((v_cust_id IS NOT NULL AND sub_r.customer_id = v_cust_id) 
             OR (length(v_norm_phone) = 10 AND public.normalize_phone(sub_r.customer_phone) = v_norm_phone))
        AND (sub_r.credit_token_status = 'ACTIVE' OR sub_r.credit_token_status IS NULL)
        AND (sub_r.expires_at IS NULL OR sub_r.expires_at >= now())
        AND sub_r.refund_amount > COALESCE(sub_r.credit_used, 0)
      ORDER BY sub_r.created_at DESC LIMIT 1
    ), '')
  INTO v_returns_sum, v_latest_token
  FROM public.offline_returns r
  WHERE ((v_cust_id IS NOT NULL AND r.customer_id = v_cust_id) 
         OR (length(v_norm_phone) = 10 AND public.normalize_phone(r.customer_phone) = v_norm_phone))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND r.refund_amount > COALESCE(r.credit_used, 0);

  IF v_clean_token = '' THEN
    v_balance := GREATEST(COALESCE(v_balance, 0), v_returns_sum);
    -- Sync customer store credit balance
    IF v_cust_id IS NOT NULL AND v_balance > 0 THEN
      UPDATE public.pos_customers
      SET store_credit_balance = v_balance, updated_at = now()
      WHERE id = v_cust_id AND COALESCE(store_credit_balance, 0) < v_balance;
    END IF;
  END IF;

  -- 5. Aggregate active unexpired returns JSON
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'return_number', r.return_number,
      'credit_token', r.credit_token,
      'refund_amount', r.refund_amount,
      'credit_used', r.credit_used,
      'credit_balance', GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)),
      'original_sale_id', r.original_sale_id,
      'original_sale_number', r.original_sale_number,
      'linked_sale_id', r.linked_sale_id,
      'created_at', r.created_at,
      'expires_at', r.expires_at
    ) ORDER BY r.created_at DESC
  ) INTO active_returns
  FROM public.offline_returns r
  WHERE ((v_cust_id IS NOT NULL AND r.customer_id = v_cust_id) 
         OR (length(v_norm_phone) = 10 AND public.normalize_phone(r.customer_phone) = v_norm_phone)
         OR (v_clean_token != '' AND UPPER(r.credit_token) = v_clean_token))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND (r.refund_amount > COALESCE(r.credit_used, 0));

  -- 6. Aggregate recent ledger history
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'amount', amount,
      'balance_before', balance_before,
      'balance_after', balance_after,
      'credit_token', credit_token,
      'source_return_id', source_return_id,
      'used_in_sale_id', used_in_sale_id,
      'notes', notes,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO recent_history
  FROM (
    SELECT *
    FROM public.store_credit_ledger
    WHERE (v_cust_id IS NOT NULL AND customer_id = v_cust_id)
       OR (length(v_norm_phone) = 10 AND public.normalize_phone(customer_phone) = v_norm_phone)
       OR (v_clean_token != '' AND UPPER(credit_token) = v_clean_token)
    ORDER BY created_at DESC
    LIMIT 15
  ) sub;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Walk-in Customer'),
    'customer_phone', COALESCE(v_cust_phone, ''),
    'available_credit', COALESCE(v_balance, 0),
    'credit_token', COALESCE(v_latest_token, v_clean_token),
    'active_returns', COALESCE(active_returns, '[]'::jsonb),
    'history', COALESCE(recent_history, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;

-- 10. Robust get_pos_customer_intel supporting canonical phone normalization
CREATE OR REPLACE FUNCTION public.get_pos_customer_intel(
  p_customer_id uuid DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  p_phone text DEFAULT '',
  _phone text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid := COALESCE(p_customer_id, _customer_id);
  v_phone text := COALESCE(NULLIF(p_phone, ''), _phone);
  v_norm_phone text := public.normalize_phone(v_phone);
  v_prof record;
  v_recent_sales jsonb;
  v_recent_orders jsonb;
  v_total_purchases integer;
  v_total_spend numeric;
  v_credit_balance numeric := 0;
  v_returns_sum numeric := 0;
BEGIN
  IF v_id IS NULL AND length(v_norm_phone) = 10 THEN
    SELECT id INTO v_id FROM public.pos_customers WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.profiles WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_id;
  IF v_prof.id IS NULL THEN
    SELECT 
      id, name AS full_name, phone, email, city, address, COALESCE(store_credit_balance, store_credit, 0) AS store_credit_balance
    INTO v_prof 
    FROM public.pos_customers WHERE id = v_id;
  END IF;

  IF v_prof.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate active returns credit
  SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
  INTO v_returns_sum
  FROM public.offline_returns r
  WHERE (r.customer_id = v_id OR (v_prof.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(v_prof.phone)))
    AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND r.refund_amount > COALESCE(r.credit_used, 0);

  v_credit_balance := GREATEST(COALESCE(v_prof.store_credit_balance, 0), v_returns_sum);

  -- Combined total purchases and spend
  SELECT 
    (COALESCE((SELECT COUNT(*) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT COUNT(*) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0)),
    (COALESCE((SELECT SUM(total) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT SUM(total) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0))
  INTO v_total_purchases, v_total_spend;

  -- Recent POS Sales
  SELECT jsonb_agg(sub) INTO v_recent_sales
  FROM (
    SELECT id, sale_number, total, payment_method, return_status, created_at
    FROM public.offline_sales
    WHERE customer_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  -- Recent Online Orders
  SELECT jsonb_agg(sub) INTO v_recent_orders
  FROM (
    SELECT id, order_number, total, payment_method, status, created_at
    FROM public.orders
    WHERE user_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'id', v_prof.id,
    'name', COALESCE(NULLIF(v_prof.full_name, ''), 'Guest Customer'),
    'phone', COALESCE(v_prof.phone, ''),
    'email', COALESCE(v_prof.email, ''),
    'city', COALESCE(v_prof.city, ''),
    'address', COALESCE(v_prof.address, ''),
    'total_purchases', v_total_purchases,
    'total_spend', v_total_spend,
    'store_credit_balance', v_credit_balance,
    'recentSales', COALESCE(v_recent_sales, '[]'::jsonb),
    'recentOrders', COALESCE(v_recent_orders, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customer_intel(uuid, uuid, text, text) TO authenticated, anon, service_role;


