-- Migration: 20260928000236_fix_offline_return_items_columns.sql
-- Description: Ensure all alias columns (product_name, name, qty, quantity) exist on public.offline_return_items
-- and update process_offline_return RPC to guarantee zero column mismatches.

-- 1. Add all column variations to offline_return_items safely
ALTER TABLE public.offline_return_items
  ADD COLUMN IF NOT EXISTS name text DEFAULT 'Item',
  ADD COLUMN IF NOT EXISTS product_name text DEFAULT 'Item',
  ADD COLUMN IF NOT EXISTS qty integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS product_slug text DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_info text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sku text DEFAULT '',
  ADD COLUMN IF NOT EXISTS barcode text DEFAULT '',
  ADD COLUMN IF NOT EXISTS refund_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_sale_item_id uuid;

-- 2. Update process_offline_return RPC with full column synchronization
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
  v_resolved_cust_id uuid := _customer_id;
  v_clean_phone text := regexp_replace(COALESCE(_customer_phone, ''), '[^0-9]', '', 'g');
  v_clean_sale_id uuid;
  v_orig_sale_number text := NULL;
  v_expiry_date timestamptz := now() + interval '7 days';
  v_reason_text text := COALESCE(NULLIF(trim(_return_reason), ''), 'Customer Return');
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
  WHILE EXISTS (SELECT 1 FROM public.offline_returns WHERE credit_token = new_credit_token AND (status = 'active' OR credit_token_status = 'ACTIVE'))
     OR EXISTS (SELECT 1 FROM public.store_credit_vouchers WHERE upper(token) = new_credit_token AND is_active = true)
  LOOP
    new_credit_token := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 4));
  END LOOP;

  -- 7. Insert into offline_returns with all alias columns populated safely
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
    credit_token_status,
    status,
    refund_status,
    reason,
    return_reason,
    notes,
    created_by,
    idempotency_key,
    credit_expires_at,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    v_clean_sale_id,
    v_orig_sale_number,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(v_clean_phone, ''),
    COALESCE(trim(_customer_email), ''),
    _refund_method,
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    'completed',
    'completed',
    v_reason_text,
    v_reason_text,
    COALESCE(_notes, ''),
    uid,
    NULLIF(trim(_idempotency_key), ''),
    v_expiry_date,
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
    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;
    item_qty := COALESCE((elem->>'quantity')::int, (elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Returned Item');
    item_sku := elem->>'sku';
    item_barcode := elem->>'barcode';
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := elem->>'variant_info';

    INSERT INTO public.offline_return_items (
      return_id,
      original_sale_item_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      variant_info,
      sku,
      barcode,
      qty,
      quantity,
      refund_price,
      mrp,
      created_at
    ) VALUES (
      new_return_id,
      item_orig_sale_item_id,
      item_product_id,
      item_variant_id,
      item_slug,
      item_name,
      item_name,
      item_variant_info,
      item_sku,
      item_barcode,
      item_qty,
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

-- 3. Maintain permissions
REVOKE EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, service_role;

-- 4. Reload schema cache
NOTIFY pgrst, 'reload schema';
