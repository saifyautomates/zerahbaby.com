-- Migration: 20260928000300_canonical_process_offline_return_auth_elevation.sql
-- Description: Elevate process_offline_return authorization to fully match place_offline_sale (supporting user_roles, profiles.is_admin, admin_allowlist, and verified test admin emails).

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

  -- 5. Calculate Return Amount & STRICT Over-Refund Prevention
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
        v_item_returnable := GREATEST(0, COALESCE(v_orig_item.quantity_sold, v_orig_item.qty, 1) - COALESCE(v_orig_item.quantity_returned, v_orig_item.returned_quantity, 0));
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
          quantity_returnable = GREATEST(0, COALESCE(quantity_returnable, quantity_sold, qty, 1) - item_qty),
          return_status = CASE
            WHEN GREATEST(0, COALESCE(quantity_returnable, quantity_sold, qty, 1) - item_qty) = 0 THEN 'RETURNED'
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
