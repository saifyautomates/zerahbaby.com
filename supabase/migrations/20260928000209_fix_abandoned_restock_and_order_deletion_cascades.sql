-- ==============================================================================
-- Migration: 20260928000209_fix_abandoned_restock_and_order_deletion_cascades.sql
-- Description:
-- 1. Alter foreign keys on online_returns and online_return_items to ON DELETE CASCADE
--    so order deletions are never blocked by return child records.
-- 2. Harden restore_stock_for_order with COALESCE guards to prevent NULL stock corruption.
-- 3. Fix cancel_abandoned_order to use canonical restore_stock_for_order and eliminate
--    duplicate manual product/variant stock additions.
-- 4. Harden admin_delete_order to cleanly purge all child records across returns, shipments,
--    SMS logs, notifications, and payments.
-- 5. Harden place_order items loop to safely handle both 'qty' and 'quantity' JSON properties.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FOREIGN KEY CASCADE HARDENING FOR ONLINE RETURNS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- Update online_returns -> orders foreign key to CASCADE
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'online_returns_order_id_fkey'
      AND table_name = 'online_returns'
  ) THEN
    ALTER TABLE public.online_returns DROP CONSTRAINT online_returns_order_id_fkey;
  END IF;

  ALTER TABLE public.online_returns
    ADD CONSTRAINT online_returns_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

  -- Update online_return_items -> order_items foreign key to CASCADE
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'online_return_items_order_item_id_fkey'
      AND table_name = 'online_return_items'
  ) THEN
    ALTER TABLE public.online_return_items DROP CONSTRAINT online_return_items_order_item_id_fkey;
  END IF;

  ALTER TABLE public.online_return_items
    ADD CONSTRAINT online_return_items_order_item_id_fkey
    FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
END $$;

-- ------------------------------------------------------------------------------
-- 2. CANONICAL ORDER RESTOCK FUNCTION WITH STRICT COALESCE GUARDS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_stock_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'Order cancellation',
  p_reference_type text DEFAULT 'order'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  item record;
  v_prod record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_item_qty bigint;
  v_restocked_count integer := 0;
BEGIN
  -- Idempotency Guard: Check if inventory has already been restored for this order
  IF EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE reference_id = p_order_id
      AND reference_type = p_reference_type
      AND (type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type)
           OR transaction_type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type))
      AND quantity > 0
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_restored', true,
      'order_id', p_order_id,
      'message', 'Inventory was already restored previously'
    );
  END IF;

  -- Iterate through order items and restore exact variant quantities atomically
  FOR item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, 1));

    IF item.variant_id IS NOT NULL THEN
      -- Lock variant row
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = item.variant_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := COALESCE(v_prev_stock, 0) + v_item_qty;

        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.variant_id;

        -- Parent product stock is automatically updated by trg_sync_variant_to_product_stock!

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
          item.product_id,
          item.variant_id,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          v_item_qty,
          COALESCE(v_prev_stock, 0),
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    ELSIF item.product_id IS NOT NULL THEN
      -- Standalone product without explicit variant_id
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := COALESCE(v_prev_stock, 0) + v_item_qty;

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.product_id;

        -- Keep single default variant in sync if present
        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE product_id = item.product_id
          AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = item.product_id) <= 1);

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
          item.product_id,
          NULL,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          v_item_qty,
          COALESCE(v_prev_stock, 0),
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'restocked_items_count', v_restocked_count,
    'message', 'Inventory successfully restored'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid, text, text) TO authenticated, service_role, anon;

-- ------------------------------------------------------------------------------
-- 3. FIX CANCEL_ABANDONED_ORDER (ELIMINATE DOUBLE RESTOCKING & ADD IDEMPOTENCY)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_abandoned_order(order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
BEGIN
  -- Lock and fetch the order
  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;
  IF ord.id IS NULL THEN
    RETURN;
  END IF;

  -- Ensure ownership if authenticated
  IF uid IS NOT NULL AND ord.user_id IS NOT NULL AND ord.user_id != uid THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized to cancel this order';
    END IF;
  END IF;

  -- If already cancelled or completed, do nothing
  IF ord.status = 'cancelled'::public.order_status THEN
    RETURN;
  END IF;

  IF ord.payment_status = 'paid'::public.payment_status THEN
    RETURN;
  END IF;

  -- Only allow if it's placed/pending and online payment
  IF ord.status NOT IN ('placed'::public.order_status, 'pending'::public.order_status) OR ord.payment_method != 'online' THEN
    RETURN;
  END IF;

  -- 1. Canonical stock restoration (trigger safely handles parent product sync)
  PERFORM public.restore_stock_for_order(order_id, 'Stock restored due to abandoned payment', 'order');

  -- 2. Mark order as cancelled
  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      cancellation_reason = 'Payment abandoned or window closed',
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  -- 3. Log into order status history
  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled due to abandoned online payment',
    uid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid) TO authenticated, service_role, anon;

-- ------------------------------------------------------------------------------
-- 4. HARDEN ADMIN_DELETE_ORDER (ZERO FOREIGN KEY LOCKOUT GUARANTEE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_order(
  _order_id uuid,
  _force boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_ret_ids uuid[];
BEGIN
  -- Lock and fetch target order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Order already deleted or does not exist.',
      'order_id', _order_id
    );
  END IF;

  -- If order is not cancelled and force is false, reject
  IF v_order.status != 'cancelled' AND NOT _force THEN
    RAISE EXCEPTION 'This order cannot be deleted because it is not cancelled. Current status is %', v_order.status
      USING ERRCODE = '22023';
  END IF;

  -- If deleting an active (non-cancelled) order, restore stock first so inventory is never lost
  IF v_order.status != 'cancelled' THEN
    PERFORM public.restore_stock_for_order(
      _order_id,
      'Restock prior to permanent order deletion (was status: ' || v_order.status || ')',
      'order'
    );
  END IF;

  -- Insert audit log if audit table exists
  BEGIN
    INSERT INTO public.admin_order_deletion_logs (
      order_id, order_number, user_id, customer_name,
      customer_email, total, cancellation_reason, deleted_by, deleted_at
    ) VALUES (
      v_order.id, v_order.order_number, v_order.user_id, v_order.full_name,
      v_order.email, v_order.total, COALESCE(v_order.cancellation_reason, 'Deleted by admin'),
      v_admin_id, now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Table or columns might vary; continue with order deletion
  END;

  -- 1. Delete online returns and their child items
  BEGIN
    SELECT array_agg(id) INTO v_ret_ids FROM public.online_returns WHERE order_id = _order_id;
    IF v_ret_ids IS NOT NULL AND array_length(v_ret_ids, 1) > 0 THEN
      DELETE FROM public.online_return_items WHERE return_id = ANY(v_ret_ids);
      DELETE FROM public.online_returns WHERE id = ANY(v_ret_ids);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Tables might not exist in some environments
  END;

  -- 2. Delete shipments and labels
  BEGIN
    DELETE FROM public.shipment_labels WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.order_shipments WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.shiprocket_shipments WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 3. Delete notification and tracking logs
  BEGIN
    DELETE FROM public.order_notifications WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.sales_sms_logs WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.shipping_events WHERE order_id = _order_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 4. Delete financial child records
  DELETE FROM public.coupon_usage WHERE order_id = _order_id;
  DELETE FROM public.order_items WHERE order_id = _order_id;
  DELETE FROM public.order_status_history WHERE order_id = _order_id;
  DELETE FROM public.payments WHERE order_id = _order_id;

  -- 5. Delete the target order
  DELETE FROM public.orders WHERE id = _order_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Order deleted successfully.',
    'order_id', _order_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_order(uuid, boolean) TO authenticated, service_role, anon;

-- Re-point delete_cancelled_order compatibility wrapper
CREATE OR REPLACE FUNCTION public.delete_cancelled_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.admin_delete_order(_order_id, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_cancelled_order(uuid) TO authenticated, service_role, anon;

-- ------------------------------------------------------------------------------
-- 5. HARDEN PLACE_ORDER TO ACCEPT BOTH 'qty' AND 'quantity' JSON PROPERTIES
-- ------------------------------------------------------------------------------
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
  std_shipping numeric := 79;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_raw_val text;
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
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_var_id;
    END IF;

    IF variant.p_id IS NULL AND item.product_id IS NOT NULL AND item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT NULL::uuid AS variant_id, p.price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
             'Default'::text AS variant_name, p.image AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE p.id = item.product_id::uuid;
    END IF;

    IF variant.p_id IS NULL AND item.product_slug IS NOT NULL AND item.product_slug != '' THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      LEFT JOIN public.product_variants v ON v.product_id = p.id
      WHERE p.slug = item.product_slug
         OR p.id::text = item.product_slug
      ORDER BY (v.stock > 0) DESC NULLS LAST, v.id NULLS LAST
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      LEFT JOIN public.product_variants v ON v.product_id = p.id
      WHERE (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product not found for item: %', COALESCE(item.variant_id, item.product_slug, item.product_id, 'unknown');
    END IF;

    IF variant.stock < v_item_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, v_item_qty;
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
    SELECT value INTO v_raw_val FROM public.store_settings WHERE key = 'shipping_standard_charge';
    IF v_raw_val IS NOT NULL THEN std_shipping := (v_raw_val::numeric); END IF;

    SELECT value INTO v_raw_val FROM public.store_settings WHERE key = 'free_shipping_threshold';
    IF v_raw_val IS NOT NULL THEN fd_threshold := (v_raw_val::numeric); END IF;

    SELECT value INTO v_raw_val FROM public.store_settings WHERE key = 'free_delivery_enabled';
    IF v_raw_val IS NOT NULL THEN is_fd_enabled := (v_raw_val::boolean); END IF;
  EXCEPTION WHEN OTHERS THEN
    std_shipping := 79;
    fd_threshold := 999;
    is_fd_enabled := true;
  END;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);
  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
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

  -- 8. Insert Order Items & Single-Source Atomic Inventory Deduction
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
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = v_clean_var_id;
    END IF;

    IF variant.p_id IS NULL AND item.product_id IS NOT NULL AND item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT NULL::uuid AS variant_id, p.price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL::text AS variant_color, NULL::text AS variant_size,
             'Default'::text AS variant_name, p.image AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE p.id = item.product_id::uuid;
    END IF;

    IF variant.p_id IS NULL AND item.product_slug IS NOT NULL AND item.product_slug != '' THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      LEFT JOIN public.product_variants v ON v.product_id = p.id
      WHERE p.slug = item.product_slug
         OR p.id::text = item.product_slug
      ORDER BY (v.stock > 0) DESC NULLS LAST, v.id NULLS LAST
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      LEFT JOIN public.product_variants v ON v.product_id = p.id
      WHERE (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    -- Fetch buying price
    v_item_buying_price := 0;
    SELECT COALESCE(buying_price, 0) INTO v_item_buying_price FROM public.products WHERE id = variant.p_id;

    item_image := COALESCE(variant.variant_image, (SELECT image FROM public.products WHERE id = variant.p_id));

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, v_item_qty, variant.price, (variant.price * v_item_qty), variant.variant_sku,
      variant.variant_color, variant.variant_size, variant.variant_barcode, item_image, item_image, variant.product_name, variant.product_name, COALESCE(v_item_buying_price, 0)
    );

    -- STRICT SINGLE-SOURCE ATOMIC INVENTORY DEDUCTION (ZERO DOUBLE-DEDUCTION)
    IF variant.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = variant.variant_id
      FOR UPDATE;

      IF v_prev_stock IS NULL OR v_prev_stock < v_item_qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          variant.product_name, COALESCE(variant.variant_name, 'Default'), COALESCE(v_prev_stock, 0), v_item_qty;
      END IF;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = variant.variant_id;

      -- trg_sync_variant_to_product_stock automatically synchronizes public.products.stock!

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, transaction_type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, notes, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type, -v_item_qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        uid
      );
    ELSE
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = variant.p_id
      FOR UPDATE;

      IF v_prev_stock IS NULL OR v_prev_stock < v_item_qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          variant.product_name, COALESCE(v_prev_stock, 0), v_item_qty;
      END IF;

      v_new_stock := GREATEST(0, v_prev_stock - v_item_qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, transaction_type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, notes, created_by
      ) VALUES (
        variant.p_id, NULL, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type, -v_item_qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        uid
      );
    END IF;
  END LOOP;

  -- 9. Increment Coupon Usage
  IF coupon_record.id IS NOT NULL AND computed_discount > 0 THEN
    UPDATE public.coupons
    SET used_count = COALESCE(used_count, 0) + 1,
        updated_at = now()
    WHERE id = coupon_record.id;

    IF uid IS NOT NULL THEN
      INSERT INTO public.coupon_usage (coupon_id, user_id, order_id)
      VALUES (coupon_record.id, uid, new_order_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- 10. Log Initial Status History
  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    new_order_id,
    'none',
    'placed',
    'Order created via Storefront Checkout',
    uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'total', computed_total,
    'payment_status', v_initial_payment_status,
    'status', 'placed',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
