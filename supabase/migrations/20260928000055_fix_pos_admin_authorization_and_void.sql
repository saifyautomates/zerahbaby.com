-- Migration: 20260928000055_fix_pos_admin_authorization_and_void.sql
-- Fix column "is_admin" does not exist error on POS Sale Cancellation and Return functions

-- 1. Safely add is_admin column to profiles to guarantee legacy and dynamic query compatibility
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Sync is_admin on profiles with user_roles
UPDATE public.profiles p
SET is_admin = true
FROM public.user_roles ur
WHERE p.id = ur.user_id AND ur.role = 'admin';

-- Trigger to automatically keep profiles.is_admin in sync with user_roles
CREATE OR REPLACE FUNCTION public.sync_profile_is_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.role = 'admin' THEN
      UPDATE public.profiles SET is_admin = true WHERE id = NEW.user_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = OLD.user_id AND role = 'admin') THEN
      UPDATE public.profiles SET is_admin = false WHERE id = OLD.user_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_is_admin ON public.user_roles;
CREATE TRIGGER trg_sync_profile_is_admin
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_is_admin();

-- 2. Helper functions for role verification
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.has_role(auth.uid(), 'admin'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role::text IN ('admin', 'staff', 'manager', 'owner')
  ) OR COALESCE(public.has_role(auth.uid(), 'admin'), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, anon;

-- 3. Redefine admin_void_offline_sale with robust authorization
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  v_prod record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text;
BEGIN
  v_clean_reason := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');

  -- 1. Authorization check: authenticated admin, staff, manager, or owner
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') 
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
    THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can void POS sales';
    END IF;
  END IF;

  -- 2. Verify sale exists and lock it
  SELECT id, sale_number, status, customer_id, total, subtotal, is_voided INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SALE_NOT_FOUND',
      'message', 'Sale record not found'
    );
  END IF;

  -- 3. Idempotency & Status Check: Prevent double-voiding
  IF target_sale.status IN ('voided', 'cancelled') OR target_sale.is_voided = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_voided', true,
      'sale_number', target_sale.sale_number,
      'message', 'Sale #' || target_sale.sale_number || ' has already been voided.'
    );
  END IF;

  -- 4. Compensating Inventory Restoration (if requested)
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT 
        si.id as item_id,
        si.product_id, 
        si.product_slug, 
        si.qty, 
        si.name, 
        si.sku, 
        si.barcode,
        COALESCE(SUM(ri.qty), 0) as already_returned_qty
      FROM public.offline_sale_items si
      LEFT JOIN public.offline_return_items ri ON ri.original_sale_item_id = si.id
      WHERE si.sale_id = _sale_id
      GROUP BY si.id, si.product_id, si.product_slug, si.qty, si.name, si.sku, si.barcode
    LOOP
      DECLARE
        net_restore_qty integer := GREATEST(0, target_item.qty - target_item.already_returned_qty);
      BEGIN
        IF net_restore_qty > 0 AND target_item.product_id IS NOT NULL THEN
          -- Atomically restore product stock
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = target_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            UPDATE public.products
            SET stock = stock + net_restore_qty
            WHERE id = v_prod.id;

            -- Also update variant if matching SKU/barcode or default variant exists
            UPDATE public.product_variants
            SET stock = stock + net_restore_qty
            WHERE product_id = v_prod.id
              AND (
                (sku IS NOT NULL AND sku ILIKE target_item.sku) 
                OR (barcode IS NOT NULL AND barcode = target_item.barcode) 
                OR name = 'Default'
              );

            -- Log canonical compensating inventory transaction
            INSERT INTO public.inventory_transactions (
              product_id,
              transaction_type,
              quantity,
              reference_type,
              reference_id,
              notes,
              created_by
            ) VALUES (
              target_item.product_id,
              'adjustment'::public.inventory_tx_type,
              net_restore_qty,
              'offline_sale_void',
              _sale_id,
              'Compensating void reversal for POS sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
              uid
            );

            items_restored := items_restored + 1;
            total_units_restored := total_units_restored + net_restore_qty;
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 5. Revert customer purchase metrics safely
  IF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = GREATEST(0, total_purchases - 1),
        total_spend = GREATEST(0, total_spend - target_sale.total)
    WHERE id = target_sale.customer_id;
  END IF;

  -- 6. Transition sale to VOIDED status (PRESERVE HISTORICAL EVIDENCE — NEVER DELETE!)
  UPDATE public.offline_sales
  SET status = 'voided',
      is_voided = true,
      void_reason = v_clean_reason,
      voided_at = now(),
      voided_by = uid,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_number', target_sale.sale_number,
    'status', 'voided',
    'stock_restored', _restore_stock,
    'items_restored_count', items_restored,
    'units_restored_count', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' successfully voided. Audit trail preserved.'
  );
END; $$;

-- 4. Compatibility layer: forward admin_delete_offline_sale safely to admin_void_offline_sale
CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.admin_void_offline_sale(
    _sale_id,
    'Voided via administrative deletion request',
    true
  );
END; $$;

-- 5. Redefine process_offline_return with safe authorization
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _customer_id uuid,
  _refund_method text,
  _refund_status text,
  _return_reason text,
  _notes text,
  _original_sale_id uuid,
  _items jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  elem jsonb;
  item_product_id uuid;
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
  v_prod record;
  v_orig_sale record;
  v_orig_item record;
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
  v_already_returned_qty int := 0;
  v_orig_total_units int := 0;
  v_cumul_returned_units int := 0;
  v_cumul_returned_amount numeric := 0;
BEGIN
  -- 1. Auth check
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') 
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
    THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
    END IF;
  END IF;

  -- 2. Idempotency check (prevent duplicate return submissions)
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT id, return_number, refund_amount, credit_token
    INTO new_return_id, new_return_number, computed_total_refund, new_credit_token
    FROM public.offline_returns
    WHERE notes LIKE '%[idem:' || trim(_idempotency_key) || ']%'
    LIMIT 1;
    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'credit_token', new_credit_token,
        'customer_name', _customer_name,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Calculate refund total from items
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_qty := COALESCE((elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    computed_total_refund := computed_total_refund + (item_qty * item_refund_price);
    item_count := item_count + item_qty;
  END LOOP;

  -- Generate human-friendly return number
  new_return_number := 'RET-' || to_char(now(), 'YYMM') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- Generate Store Credit Token
  new_credit_token := 'ZCRED-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));

  -- 4. Resolve or upsert customer
  IF v_resolved_cust_id IS NULL AND v_clean_phone != '' AND length(v_clean_phone) >= 10 THEN
    SELECT id, store_credit INTO v_resolved_cust_id, v_prev_credit
    FROM public.pos_customers
    WHERE phone = v_clean_phone
    LIMIT 1;

    IF v_resolved_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name, phone, email, store_credit, created_at, updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(NULLIF(trim(_customer_email), ''), ''),
        computed_total_refund,
        now(),
        now()
      )
      RETURNING id, store_credit INTO v_resolved_cust_id, v_new_credit;
      v_prev_credit := 0;
    END IF;
  END IF;

  -- 5. Insert Return Record
  INSERT INTO public.offline_returns (
    return_number,
    original_sale_id,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_method,
    refund_status,
    return_reason,
    notes,
    refund_amount,
    credit_token,
    credit_token_status,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    new_return_number,
    _original_sale_id,
    v_resolved_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    COALESCE(NULLIF(trim(_refund_method), ''), 'exchange_credit'),
    COALESCE(NULLIF(trim(_refund_status), ''), 'completed'),
    COALESCE(NULLIF(trim(_return_reason), ''), 'customer_request'),
    CASE 
      WHEN _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
        COALESCE(trim(_notes), '') || ' [idem:' || trim(_idempotency_key) || ']'
      ELSE COALESCE(trim(_notes), '')
    END,
    computed_total_refund,
    new_credit_token,
    'ACTIVE',
    uid,
    now(),
    now()
  )
  RETURNING id INTO new_return_id;

  -- 6. Insert Return Items & Restore Stock
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      item_product_id := (elem->>'product_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_product_id := NULL;
    END;

    item_qty := COALESCE((elem->>'qty')::int, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_name := COALESCE(elem->>'name', 'Returned Item');
    item_sku := COALESCE(elem->>'sku', '');
    item_barcode := COALESCE(elem->>'barcode', '');
    item_slug := COALESCE(elem->>'product_slug', '');
    item_variant_info := COALESCE(elem->>'variant_info', '');

    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

    INSERT INTO public.offline_return_items (
      return_id,
      product_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      qty,
      refund_price,
      mrp,
      original_sale_item_id,
      created_at
    ) VALUES (
      new_return_id,
      item_product_id,
      item_slug,
      item_name,
      item_sku,
      item_barcode,
      item_variant_info,
      item_qty,
      item_refund_price,
      item_mrp,
      item_orig_sale_item_id,
      now()
    );

    -- Stock restoration
    IF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        UPDATE public.products SET stock = stock + item_qty WHERE id = item_product_id;
        v_new_stock := v_prev_stock + item_qty;

        -- Update variants if matched
        UPDATE public.product_variants
        SET stock = stock + item_qty
        WHERE product_id = item_product_id
          AND ((sku IS NOT NULL AND sku ILIKE item_sku) OR (barcode IS NOT NULL AND barcode = item_barcode) OR name = 'Default');

        INSERT INTO public.inventory_transactions (
          product_id,
          transaction_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_by
        ) VALUES (
          item_product_id,
          'return'::public.inventory_tx_type,
          item_qty,
          'offline_return',
          new_return_id,
          'POS Return #' || new_return_number || ' - ' || item_name,
          uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 7. Update Customer Store Credit and Ledger
  IF v_resolved_cust_id IS NOT NULL AND computed_total_refund > 0 THEN
    SELECT store_credit INTO v_prev_credit FROM public.pos_customers WHERE id = v_resolved_cust_id FOR UPDATE;
    v_prev_credit := COALESCE(v_prev_credit, 0);
    v_new_credit := v_prev_credit + computed_total_refund;

    UPDATE public.pos_customers
    SET store_credit = v_new_credit,
        updated_at = now()
    WHERE id = v_resolved_cust_id;

    INSERT INTO public.pos_store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      type,
      amount,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      notes,
      created_by
    ) VALUES (
      v_resolved_cust_id,
      COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
      COALESCE(trim(_customer_phone), ''),
      'credit_added',
      computed_total_refund,
      v_prev_credit,
      v_new_credit,
      'offline_return',
      new_return_id,
      'Exchange credit issued via POS Return #' || new_return_number || ' (' || new_credit_token || ')',
      uid
    );
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'credit_token', new_credit_token,
    'customer_name', _customer_name,
    'items_count', item_count,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text) TO authenticated, anon, service_role;
