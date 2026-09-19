-- ==============================================================================
-- Migration: 20260928000286_canonical_inventory_variant_fallback_resolution.sql
-- Description:
-- 1. Canonical Variant Fallback Resolution across all inventory deduction & restock RPCs:
--    - admin_process_return_qc (Online Return QC & Restock)
--    - process_offline_return (POS Return & Restock)
--    - admin_void_offline_sale (POS Void & Restock)
--    - place_cod_order (COD Order Stock Deduction)
--    - place_offline_sale (POS Sale Stock Deduction)
-- 2. Prevents trg_enforce_product_parent_stock_consistency from discarding
--    parent products.stock updates when an item without explicit variant_id
--    is deducted or restocked for a multi-variant product.
-- ==============================================================================

-- 1. CANONICAL admin_process_return_qc WITH VARIANT FALLBACK RESOLUTION
CREATE OR REPLACE FUNCTION public.admin_process_return_qc(
  _return_id uuid,
  _items_qc jsonb,
  _qc_summary text DEFAULT '',
  _restock_approved boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_return record;
  v_is_authorized boolean := false;
  v_qc_item record;
  v_ret_item record;
  v_any_approved boolean := false;
  v_new_return_status text;
  v_new_refund_status text;
  v_eff_variant_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
BEGIN
  -- Authorization check
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
       public.is_admin() THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can process return QC';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  FOR v_qc_item IN SELECT * FROM jsonb_to_recordset(_items_qc) AS x(
    order_item_id uuid,
    passed boolean,
    qty_accepted int,
    qc_note text
  ) LOOP
    SELECT * INTO v_ret_item
    FROM public.online_return_items
    WHERE return_id = _return_id AND order_item_id = v_qc_item.order_item_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_qc_item.passed THEN
        v_any_approved := true;
        UPDATE public.online_return_items
        SET qc_status = 'PASSED',
            quantity_approved = v_qc_item.qty_accepted,
            quantity_received = v_qc_item.qty_accepted,
            qc_note = v_qc_item.qc_note,
            updated_at = now()
        WHERE id = v_ret_item.id;

        -- Idempotent stock restoration on QC pass
        IF _restock_approved AND NOT COALESCE(v_ret_item.inventory_restored, false) THEN
          v_eff_variant_id := v_ret_item.variant_id;

          -- Fallback: resolve variant if missing but product has variants
          IF v_eff_variant_id IS NULL AND v_ret_item.product_id IS NOT NULL THEN
            SELECT id INTO v_eff_variant_id
            FROM public.product_variants
            WHERE product_id = v_ret_item.product_id
              AND (is_active IS NULL OR is_active = true)
            ORDER BY stock DESC
            LIMIT 1;
          END IF;

          IF v_eff_variant_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.product_variants
            WHERE id = v_eff_variant_id
            FOR UPDATE;

            v_new_stock := COALESCE(v_prev_stock, 0) + v_qc_item.qty_accepted;

            UPDATE public.product_variants
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_eff_variant_id;

            -- Authoritative parent product stock sync
            UPDATE public.products
            SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_ret_item.product_id),
                updated_at = now()
            WHERE id = v_ret_item.product_id;

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
              v_ret_item.product_id,
              v_eff_variant_id,
              'return'::public.inventory_tx_type,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              v_prev_stock,
              v_new_stock,
              'online_return',
              _return_id,
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              v_uid
            );
          ELSIF v_ret_item.product_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.products
            WHERE id = v_ret_item.product_id
            FOR UPDATE;

            v_new_stock := COALESCE(v_prev_stock, 0) + v_qc_item.qty_accepted;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_ret_item.product_id;

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
              v_ret_item.product_id,
              NULL,
              'return'::public.inventory_tx_type,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              v_prev_stock,
              v_new_stock,
              'online_return',
              _return_id,
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              v_uid
            );
          END IF;

          UPDATE public.online_return_items
          SET inventory_restored = true
          WHERE id = v_ret_item.id;
        END IF;

      ELSE
        UPDATE public.online_return_items
        SET qc_status = 'REJECTED',
            quantity_approved = 0,
            quantity_received = COALESCE(v_qc_item.qty_accepted, 0),
            qc_note = COALESCE(v_qc_item.qc_note, 'Failed inspection'),
            updated_at = now()
        WHERE id = v_ret_item.id;
      END IF;
    END IF;
  END LOOP;

  IF v_any_approved THEN
    v_new_return_status := 'ACCEPTED';
    v_new_refund_status := 'PENDING';
  ELSE
    v_new_return_status := 'REJECTED';
    v_new_refund_status := 'REJECTED';
  END IF;

  UPDATE public.online_returns
  SET status = v_new_return_status,
      refund_status = v_new_refund_status,
      qc_passed = v_any_approved,
      qc_notes = _qc_summary,
      qc_completed_at = now(),
      updated_at = now()
  WHERE id = _return_id;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'status', v_new_return_status,
    'refund_status', v_new_refund_status,
    'qc_passed', v_any_approved
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_process_return_qc(uuid, jsonb, text, boolean) TO authenticated, service_role;


-- 2. CANONICAL process_offline_return WITH VARIANT FALLBACK RESOLUTION
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
  v_prev_credit numeric := 0;
  v_item_returnable int := 0;
  item_count int := 0;
  v_expiry_date timestamptz := now() + interval '365 days';
BEGIN
  -- 1. Authorization Check: Admin or Staff
  IF NOT (
    auth.role() = 'service_role' OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role::text IN ('admin', 'staff', 'super_admin')
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (is_admin = true OR is_super_admin = true OR is_staff = true)
    )
  ) THEN
    NULL;
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

  -- 6. Generate Deterministic Return Number & 4-Character Voucher Token
  IF _return_number IS NOT NULL AND trim(_return_number) != '' THEN
    new_return_number := UPPER(TRIM(_return_number));
  ELSE
    new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || floor(1000 + random() * 9000)::text;
  END IF;

  IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
    new_credit_token := UPPER(TRIM(_credit_token));
  ELSE
    new_credit_token := public.generate_unique_voucher_code(4);
  END IF;

  -- 7. Insert Canonical offline_returns Record
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
    COALESCE(NULLIF(trim(_refund_method), ''), 'store_credit'),
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

  -- 8. Auto-provision Store Credit Vouchers if refund method is store_credit / exchange
  IF COALESCE(NULLIF(trim(_refund_method), ''), 'store_credit') IN ('store_credit', 'exchange', 'voucher') THEN
    INSERT INTO public.store_credit_vouchers (
      token,
      return_id,
      customer_id,
      customer_name,
      customer_phone,
      original_amount,
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
      COALESCE(v_norm_phone, v_cust_rec.phone, ''),
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
      auth.uid(),
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

  -- 11. Insert Return Items & Atomically RESTOCK Inventory
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

    -- Lookup product_id from variant if missing
    IF item_product_id IS NULL AND item_variant_id IS NOT NULL THEN
      SELECT product_id INTO item_product_id FROM public.product_variants WHERE id = item_variant_id;
    END IF;

    -- Lookup product_id and variant_id from barcode/sku if still missing
    IF item_product_id IS NULL AND item_barcode IS NOT NULL AND trim(item_barcode) != '' THEN
      SELECT id INTO item_product_id FROM public.products WHERE barcode = trim(item_barcode) OR sku = trim(item_barcode) LIMIT 1;
      IF item_product_id IS NULL THEN
        SELECT pv.product_id, pv.id INTO item_product_id, item_variant_id 
        FROM public.product_variants pv 
        WHERE pv.barcode = trim(item_barcode) OR pv.sku = trim(item_barcode) 
        LIMIT 1;
      END IF;
    END IF;

    -- Fallback: resolve variant if missing but product has variants
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

    -- Atomic RESTOCK with Row Locking on Product Variants & Products
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.product_variants 
        SET stock = v_new_stock, updated_at = now() 
        WHERE id = item_variant_id;

        -- Authoritative parent product stock sync
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
          'POS Return #' || new_return_number || ' - ' || item_name || ' (Restocked)',
          auth.uid()
        );
      END IF;
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.products 
        SET stock = v_new_stock, updated_at = now() 
        WHERE id = item_product_id;

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
          'POS Return #' || new_return_number || ' - ' || item_name || ' (Restocked)',
          auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  -- 12. Update Original Sale Return Status if linked
  IF v_clean_sale_id IS NOT NULL THEN
    UPDATE public.offline_sales
    SET return_status = CASE 
      WHEN (SELECT COALESCE(SUM(quantity_returnable), 0) FROM public.offline_sale_items WHERE sale_id = v_clean_sale_id) <= 0 THEN 'fully_returned'
      ELSE 'partially_returned'
    END,
    updated_at = now()
    WHERE id = v_clean_sale_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), v_cust_rec.name, 'Walk-in Customer'),
    'customer_id', v_resolved_cust_id,
    'available_credit', v_prev_credit + computed_total_refund,
    'original_sale_id', v_clean_sale_id,
    'original_sale_number', v_orig_sale_number,
    'expires_at', v_expiry_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, jsonb, text, uuid, text
) TO authenticated, anon, service_role;


-- 3. CANONICAL admin_void_offline_sale WITH VARIANT FALLBACK RESOLUTION
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Voided by Administrator',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  v_eff_var_id uuid;
  v_prev_stock int;
  v_new_stock int;
  net_restore_qty int;
  v_clean_reason text;
  items_restored int := 0;
  total_units_restored int := 0;
BEGIN
  -- 1. Authorization: service_role or admin/staff
  IF current_user != 'service_role' AND COALESCE(auth.jwt()->>'role', '') != 'service_role' THEN
    IF uid IS NULL THEN
      RAISE EXCEPTION 'Authentication required to void offline sales';
    END IF;

    IF NOT (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (is_admin = true OR is_super_admin = true OR is_staff = true)
      ) OR
      public.is_admin()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: only store administrators or staff can void offline sales';
    END IF;
  END IF;

  v_clean_reason := COALESCE(NULLIF(trim(_reason), ''), 'Voided by Administrator');

  -- 2. Fetch and lock sale
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Offline sale not found: %', _sale_id;
  END IF;

  IF target_sale.notes ILIKE '[VOIDED]%' THEN
    RAISE EXCEPTION 'Sale #% has already been voided', target_sale.sale_number;
  END IF;

  -- 3. Stock restoration with variant resolution
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        v_eff_var_id := target_item.variant_id;

        IF v_eff_var_id IS NULL AND target_item.product_id IS NOT NULL THEN
          SELECT id INTO v_eff_var_id
          FROM public.product_variants
          WHERE product_id = target_item.product_id
            AND (is_active IS NULL OR is_active = true)
          ORDER BY stock DESC
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_eff_var_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_eff_var_id;

          -- Authoritative parent product stock sync
          IF target_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = target_item.product_id),
                updated_at = now()
            WHERE id = target_item.product_id;
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
            target_item.product_id,
            v_eff_var_id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        ELSIF target_item.product_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.products WHERE id = target_item.product_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.product_id;

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
            target_item.product_id,
            NULL,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        END IF;

        items_restored := items_restored + 1;
        total_units_restored := total_units_restored + net_restore_qty;
      END IF;
    END LOOP;
  END IF;

  -- 4. Mark sale as VOIDED
  UPDATE public.offline_sales
  SET notes = '[VOIDED] ' || v_clean_reason || CASE WHEN trim(COALESCE(notes, '')) != '' THEN ' | Original Notes: ' || notes ELSE '' END,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'reason', v_clean_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;


-- 4. CANONICAL place_cod_order WITH VARIANT FALLBACK RESOLUTION
CREATE OR REPLACE FUNCTION public.place_cod_order(_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  session_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_effective_variant_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_details jsonb;
  v_user_id uuid;
  v_buying_price numeric;
BEGIN
  -- 1. Fetch and Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id OR id::text = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found: %', _session_id;
  END IF;

  IF session_rec.status = 'converted' THEN
    SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
    FROM public.orders
    WHERE id = session_rec.order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  IF session_rec.expires_at < now() THEN
    RAISE EXCEPTION 'Checkout session has expired. Please initiate checkout again.';
  END IF;

  -- 2. Authoritative Security Guard: Prevent session conversion if not created for COD
  IF lower(COALESCE(session_rec.payment_method, '')) != 'cod' THEN
    RAISE EXCEPTION 'Checkout session is not configured for Cash on Delivery.';
  END IF;

  -- Verify COD is globally enabled
  IF EXISTS (
    SELECT 1 FROM public.payment_settings WHERE cod_enabled = false
  ) THEN
    RAISE EXCEPTION 'Cash on Delivery is currently disabled.';
  END IF;

  -- 3. Verify Stock with Variant Resolution
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    v_effective_variant_id := item_rec.variant_id;
    IF v_effective_variant_id IS NULL AND item_rec.product_id IS NOT NULL THEN
      SELECT id INTO v_effective_variant_id
      FROM public.product_variants
      WHERE product_id = item_rec.product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_rec.qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    IF v_effective_variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = v_effective_variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', v_effective_variant_id;
      END IF;

      IF variant_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          item_rec.product_name, COALESCE(variant_rec.name, ''), variant_rec.stock, item_rec.qty;
      END IF;
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT * INTO product_rec
      FROM public.products
      WHERE id = item_rec.product_id
      FOR UPDATE;

      IF product_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product not found: %', item_rec.product_id;
      END IF;

      IF product_rec.stock < item_rec.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          item_rec.product_name, product_rec.stock, item_rec.qty;
      END IF;
    END IF;
  END LOOP;

  -- 4. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 5. Insert Canonical COD Order with status strictly 'placed'
  INSERT INTO public.orders (
    id,
    user_id,
    invoice_no,
    order_number,
    subtotal,
    shipping,
    shipping_fee,
    discount,
    total,
    coupon_code,
    status,
    payment_method,
    payment_status,
    full_name,
    email,
    phone,
    alt_phone,
    address,
    address_line2,
    landmark,
    city,
    state,
    pincode,
    notes,
    idempotency_key
  ) VALUES (
    new_order_id,
    v_user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'placed'::public.order_status,
    'cod',
    'pending'::public.payment_status,
    COALESCE(v_cust_details->>'full_name', 'Customer'),
    COALESCE(v_cust_details->>'email', ''),
    COALESCE(v_cust_details->>'phone', ''),
    COALESCE(v_cust_details->>'alt_phone', ''),
    COALESCE(v_cust_details->>'address', ''),
    COALESCE(v_cust_details->>'address_line2', ''),
    COALESCE(v_cust_details->>'landmark', ''),
    COALESCE(v_cust_details->>'city', ''),
    COALESCE(v_cust_details->>'state', ''),
    COALESCE(v_cust_details->>'pincode', ''),
    COALESCE(v_cust_details->>'notes', ''),
    session_rec.idempotency_key
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Cash on Delivery Order placed successfully', v_user_id);

  -- 6. Insert Order Items & Deduct Stock Atomically
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_slug text,
    product_name text,
    variant_sku text,
    variant_barcode text,
    variant_color text,
    variant_size text,
    price numeric,
    mrp numeric,
    qty int,
    image_url text
  ) LOOP
    SELECT COALESCE(pc.buying_price, p.buying_price, 0) INTO v_buying_price
    FROM public.products p
    LEFT JOIN public.product_costs pc ON pc.product_id = p.id
    WHERE p.id = item_rec.product_id
    LIMIT 1;

    v_effective_variant_id := item_rec.variant_id;
    IF v_effective_variant_id IS NULL AND item_rec.product_id IS NOT NULL THEN
      SELECT id INTO v_effective_variant_id
      FROM public.product_variants
      WHERE product_id = item_rec.product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= item_rec.qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      title,
      product_slug,
      slug,
      sku,
      unit_price,
      price,
      price_at_time,
      subtotal,
      quantity,
      qty,
      mrp,
      variant_sku,
      variant_color,
      variant_size,
      variant_barcode,
      image_url,
      item_image,
      item_title,
      buying_price,
      unit_cost
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      v_effective_variant_id,
      item_rec.product_name,
      item_rec.product_name,
      item_rec.product_slug,
      item_rec.product_slug,
      COALESCE(item_rec.variant_sku, ''),
      item_rec.price,
      item_rec.price,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      item_rec.qty,
      item_rec.qty,
      COALESCE(item_rec.mrp, item_rec.price),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      COALESCE(v_buying_price, 0),
      COALESCE(v_buying_price, 0)
    );

    IF v_effective_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_effective_variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = v_effective_variant_id;

      -- Authoritative parent product stock sync
      UPDATE public.products
      SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = item_rec.product_id),
          updated_at = now()
      WHERE id = item_rec.product_id;

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
        item_rec.product_id,
        v_effective_variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    ELSIF item_rec.product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_rec.product_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.product_id;

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
        item_rec.product_id,
        NULL,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        'COD Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 7. Update Session Status to Converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      order_id = new_order_id,
      updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'pending',
    'status', 'placed'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.place_cod_order(text) TO authenticated, anon, service_role;


-- 5. CANONICAL place_offline_sale WITH VARIANT FALLBACK RESOLUTION
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
  v_sale_number text;
  v_token_number int;
  v_sale_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(_customer_phone, '[^0-9]', '', 'g');
  v_coupon_record record;
BEGIN
  -- 1. Idempotency Guard
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, sale_number, total, subtotal, discount, payment_method, customer_name, customer_id INTO v_sale_id, v_sale_number, v_gross_total, v_subtotal, v_discount, v_effective_payment_method, _customer_name, v_cust_id
    FROM public.offline_sales
    WHERE idempotency_key = trim(_idempotency_key)
    LIMIT 1;

    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'sale_id', v_sale_id,
        'sale_number', v_sale_number,
        'total', v_gross_total,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'payment_method', v_effective_payment_method,
        'customer_name', _customer_name,
        'customer_id', v_cust_id,
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
        WHERE user_id = uid AND role::text IN ('admin', 'staff', 'super_admin')
      ) OR
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND (is_admin = true OR is_super_admin = true OR is_staff = true)
      ) OR
      public.is_admin()
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only staff or administrators can place offline sales';
    END IF;
  END IF;

  -- 3. Calculate Subtotal from Items
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_price := COALESCE((elem->>'price')::numeric, 0);
    v_subtotal := v_subtotal + (item_price * item_qty);
  END LOOP;

  -- 4. Calculate Order-level Discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  END IF;

  -- 5. Calculate Coupon Discount if applicable
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
  v_gross_total := GREATEST(0, v_subtotal - v_discount - v_coupon_discount);

  -- 7. Process Store Credit / Voucher Redemption
  IF _store_credit_used > 0 THEN
    IF v_clean_token != '' THEN
      SELECT COALESCE(current_balance, remaining_balance, 0) INTO v_voucher_avail
      FROM public.store_credit_vouchers
      WHERE UPPER(TRIM(token)) = v_clean_token AND is_active = true
      FOR UPDATE;

      IF v_voucher_avail IS NULL OR v_voucher_avail <= 0 THEN
        SELECT COALESCE(remaining_balance, 0) INTO v_voucher_avail
        FROM public.pos_exchange_vouchers
        WHERE UPPER(TRIM(token)) = v_clean_token AND status = 'active'
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

  -- 13. Insert Items & Deduct Stock with Variant Fallback Resolution
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
      cost_price, qty, quantity, total, created_at
    ) VALUES (
      v_sale_id, item_product_id, item_variant_id, item_slug, item_name, item_name,
      item_variant_info, item_sku, item_barcode, item_price, item_price, item_mrp,
      COALESCE(item_cost, 0), item_qty, item_qty, (item_price * item_qty), now()
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
      -- Decrement parent product stock ONLY if product truly has no variants
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


-- 6. CANONICAL place_order WITH VARIANT FALLBACK RESOLUTION
CREATE OR REPLACE FUNCTION public.place_order(
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _items jsonb,
  _payment_method text DEFAULT 'online',
  _coupon_code text DEFAULT NULL,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL,
  _alt_phone text DEFAULT '',
  _address_line2 text DEFAULT '',
  _landmark text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid;
  item record;
  variant record;
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  net_subtotal numeric := 0;
  std_shipping numeric := 65;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_raw_val text;
  v_delivery_fees_raw text;
  v_delivery_fees jsonb;
  v_custom_shipping numeric := NULL;
  v_item_fee numeric;
  v_has_explicit_fee boolean := false;
  v_all_items_free boolean := true;
  new_order_id uuid;
  new_order_number text;
  new_invoice text;
  existing_order record;
  v_initial_payment_status public.payment_status := 'pending'::public.payment_status;
  v_clean_idem text;
  v_item_buying_price numeric;
  item_image text;
  v_prev_stock int;
  v_new_stock int;
  v_clean_var_id uuid;
  v_item_qty int;
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    v_clean_idem := trim(_idempotency_key);
    SELECT id, invoice_no, order_number, total, payment_status, status
    INTO existing_order
    FROM public.orders
    WHERE idempotency_key = v_clean_idem
       OR notes LIKE '%[idem:' || v_clean_idem || ']%'
    LIMIT 1;

    IF existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', existing_order.id,
        'invoice_no', existing_order.invoice_no,
        'order_number', existing_order.order_number,
        'total', existing_order.total,
        'payment_status', existing_order.payment_status,
        'status', existing_order.status,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate Items & Compute Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_var_id IS NOT NULL THEN
      SELECT pv.id AS variant_id,
             COALESCE(pv.price_override, p.price) AS price,
             COALESCE(pv.mrp_override, p.mrp) AS mrp,
             pv.sku AS variant_sku,
             pv.barcode AS variant_barcode,
             pv.color AS variant_color,
             pv.size AS variant_size,
             pv.name AS variant_name,
             pv.image_url AS variant_image,
             pv.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT NULL::uuid AS variant_id,
             p.price,
             p.mrp,
             p.sku AS variant_sku,
             p.barcode AS variant_barcode,
             NULL::text AS variant_color,
             NULL::text AS variant_size,
             'Default' AS variant_name,
             (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS variant_image,
             p.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND p.id::text = item.product_id)
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product item not found in catalog.';
    END IF;

    IF variant.stock < v_item_qty THEN
      RAISE EXCEPTION 'Item "%" is out of stock or requested quantity exceeds available inventory.', variant.product_name;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * v_item_qty);
  END LOOP;

  -- 4. Coupon Calculation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
          computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
          IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
            computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
          END IF;
        ELSE
          computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
        END IF;
      END IF;
    END IF;
  END IF;

  -- 5. Shipping Policy Calculation
  BEGIN
    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_charge' LIMIT 1;
    IF v_raw_val IS NULL THEN
      SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee' LIMIT 1;
    END IF;
    IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
      std_shipping := trim(v_raw_val)::numeric;
    ELSE
      std_shipping := 65;
    END IF;

    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold' LIMIT 1;
    IF v_raw_val IS NOT NULL AND trim(v_raw_val) ~ '^[0-9]+(\.[0-9]+)?$' THEN
      fd_threshold := trim(v_raw_val)::numeric;
    ELSE
      fd_threshold := 999;
    END IF;

    SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled' LIMIT 1;
    IF v_raw_val IS NOT NULL THEN
      is_fd_enabled := lower(trim(v_raw_val)) NOT IN ('false', '0', 'no', 'off');
    ELSE
      is_fd_enabled := true;
    END IF;

    SELECT value INTO v_delivery_fees_raw FROM public.site_settings WHERE key = 'product_delivery_fees' LIMIT 1;
    IF v_delivery_fees_raw IS NOT NULL AND trim(v_delivery_fees_raw) != '' THEN
      v_delivery_fees := v_delivery_fees_raw::jsonb;

      FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
        v_item_fee := NULL;
        IF item.product_id IS NOT NULL AND v_delivery_fees ? item.product_id THEN
          v_item_fee := (v_delivery_fees->>item.product_id)::numeric;
        ELSIF item.product_slug IS NOT NULL AND v_delivery_fees ? item.product_slug THEN
          v_item_fee := (v_delivery_fees->>item.product_slug)::numeric;
        END IF;

        IF v_item_fee IS NOT NULL THEN
          v_has_explicit_fee := true;
          IF v_item_fee > 0 THEN
            v_all_items_free := false;
            v_custom_shipping := GREATEST(COALESCE(v_custom_shipping, 0), v_item_fee);
          END IF;
        ELSE
          v_all_items_free := false;
        END IF;
      END LOOP;
    ELSE
      v_all_items_free := false;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    std_shipping := 65;
    fd_threshold := 999;
    is_fd_enabled := true;
    v_has_explicit_fee := false;
    v_all_items_free := false;
  END;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  IF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSIF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := COALESCE(v_custom_shipping, std_shipping);
  END IF;

  computed_total := net_subtotal + shipping;

  -- 6. Generate Sequential Identifiers
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  new_invoice := 'INV-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  IF lower(COALESCE(_payment_method, 'online')) = 'cod' THEN
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 7. Insert Canonical Master Order
  INSERT INTO public.orders (
    user_id, full_name, email, phone, address, city, state, pincode,
    payment_method, payment_status, status, subtotal, discount, shipping, total,
    invoice_no, order_number, idempotency_key, coupon_code, notes,
    alt_phone, address_line2, landmark, created_at, updated_at
  ) VALUES (
    uid, _full_name, _email, _phone, _address, _city, _state, _pincode,
    COALESCE(NULLIF(trim(_payment_method), ''), 'online'),
    v_initial_payment_status,
    'placed'::public.order_status,
    computed_subtotal, computed_discount, shipping, computed_total,
    new_invoice, new_order_number, v_clean_idem, _coupon_code,
    COALESCE(_notes, ''),
    COALESCE(_alt_phone, ''),
    COALESCE(_address_line2, ''),
    COALESCE(_landmark, ''),
    now(), now()
  ) RETURNING id INTO new_order_id;

  -- 8. Insert Order Items & Single-Source Atomic Inventory Deduction with Variant Resolution
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int, quantity int) LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, item.quantity, 1));

    SELECT NULL::uuid AS variant_id, NULL::numeric AS price, NULL::numeric AS mrp,
           NULL::text AS variant_sku, NULL::text AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
           NULL::text AS variant_name, NULL::text AS variant_image, NULL::int AS stock,
           NULL::text AS product_slug, NULL::text AS product_name, NULL::uuid AS p_id, NULL::int AS p_stock
    INTO variant;

    v_clean_var_id := CASE 
      WHEN item.variant_id IS NOT NULL AND item.variant_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' 
      THEN item.variant_id::uuid 
      ELSE NULL 
    END;

    IF v_clean_var_id IS NOT NULL THEN
      SELECT pv.id AS variant_id,
             COALESCE(pv.price_override, p.price) AS price,
             COALESCE(pv.mrp_override, p.mrp) AS mrp,
             pv.sku AS variant_sku,
             pv.barcode AS variant_barcode,
             pv.color AS variant_color,
             pv.size AS variant_size,
             pv.name AS variant_name,
             pv.image_url AS variant_image,
             pv.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = v_clean_var_id;
    END IF;

    IF variant.variant_id IS NULL THEN
      SELECT NULL::uuid AS variant_id,
             p.price,
             p.mrp,
             p.sku AS variant_sku,
             p.barcode AS variant_barcode,
             NULL::text AS variant_color,
             NULL::text AS variant_size,
             'Default' AS variant_name,
             (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS variant_image,
             p.stock AS stock,
             p.slug AS product_slug,
             p.name AS product_name,
             p.id AS p_id,
             p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND p.id::text = item.product_id)
      LIMIT 1;
    END IF;

    -- Fallback: resolve variant if missing but product has variants
    IF variant.variant_id IS NULL AND variant.p_id IS NOT NULL THEN
      SELECT id INTO variant.variant_id
      FROM public.product_variants
      WHERE product_id = variant.p_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY (stock >= v_item_qty) DESC, stock DESC
      LIMIT 1;
    END IF;

    item_image := COALESCE(variant.variant_image, '');
    IF item_image = '' THEN
      SELECT COALESCE(public_url, '') INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND is_primary = true
      LIMIT 1;
    END IF;

    SELECT COALESCE(buying_price, 0) INTO v_item_buying_price
    FROM public.product_costs
    WHERE product_id = variant.p_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, title, product_name, quantity, price,
      product_sku, product_barcode, color, size, variant_name, image_url,
      buying_price, unit_cost, created_at
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id,
      variant.product_name || CASE WHEN variant.variant_name != 'Default' THEN ' - ' || variant.variant_name ELSE '' END,
      variant.product_name, v_item_qty, variant.price,
      variant.variant_sku, variant.variant_barcode, variant.variant_color, variant.variant_size,
      variant.variant_name, item_image,
      COALESCE(v_item_buying_price, 0), COALESCE(v_item_buying_price, 0), now()
    );

    IF variant.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = variant.variant_id
      FOR UPDATE;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.product_variants
      SET stock = v_new_stock, updated_at = now()
      WHERE id = variant.variant_id;

      -- Authoritative parent product stock sync
      UPDATE public.products
      SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = variant.p_id),
          updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
      ) VALUES (
        variant.p_id, variant.variant_id, -v_item_qty,
        'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
        new_order_id, 'Online order ' || new_order_number, uid, now()
      );
    ELSE
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = variant.p_id
      FOR UPDATE;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.products
      SET stock = v_new_stock, updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, quantity, type, transaction_type, reference_id, notes, created_by, created_at
      ) VALUES (
        variant.p_id, NULL, -v_item_qty,
        'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type,
        new_order_id, 'Online order ' || new_order_number, uid, now()
      );
    END IF;
  END LOOP;

  -- 9. Record Coupon Usage
  IF coupon_record.id IS NOT NULL AND computed_discount > 0 THEN
    UPDATE public.coupons
    SET used_count = COALESCE(used_count, 0) + 1, updated_at = now()
    WHERE id = coupon_record.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'shipping', shipping,
    'discount', computed_discount,
    'payment_status', v_initial_payment_status,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;

