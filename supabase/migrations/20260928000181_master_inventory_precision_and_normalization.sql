-- ==============================================================================
-- Migration: 20260928000181_master_inventory_precision_and_normalization.sql
-- Description:
-- 1. Purge 11 duplicate/phantom variants (e.g. 'Default' variants coexisting with
--    sized variants like 0-6M, 6-12M, EU 18, EU 20, or duplicate single-item variants)
--    that caused inventory inflation and stock discrepancies.
-- 2. Decouple and harden sync triggers:
--    - fn_sync_variant_to_product_stock: Computes parent products.stock strictly as
--      the SUM of active variants.
--    - fn_sync_product_to_variant_stock: ONLY syncs variant stock when var_count = 1.
--      Never mutates size/color variants when var_count > 1.
-- 3. Eliminate double-deduction and single-variant overwrite in place_offline_sale,
--    place_cod_order, and finalize_paid_order:
--    - When variant_id is present, decrement variant stock only; trigger maintains parent.
--    - When variant_id is NULL, decrement product stock.
-- 4. Re-architect restock in process_offline_return, admin_void_offline_sale, and
--    admin_adjust_inventory to use single authoritative mutation path.
-- 5. Standardize all public.inventory_transactions logging with both type and
--    transaction_type, note and notes, previous_quantity and new_quantity.
-- 6. Reconcile all 30 catalog products to exact, 100% mathematically correct stock.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- STEP 1: PURGE PHANTOM AND DUPLICATE VARIANTS
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  phantom_ids uuid[] := ARRAY[
    'e1000000-0000-4000-8000-000000000001'::uuid, -- fc-babyhug-organic-onesies-3pk (Default)
    'e1000000-0000-4000-8000-000000000002'::uuid, -- fc-carters-cotton-footie-sleepsuit (Default)
    'e1000000-0000-4000-8000-000000000003'::uuid, -- fc-pine-kids-denim-dungaree-set (Default)
    'e1000000-0000-4000-8000-000000000004'::uuid, -- fc-kookie-kids-floral-party-frock (Default)
    'e1000000-0000-4000-8000-000000000005'::uuid, -- fc-babyhug-pure-muslin-jhabla-5pk (Default)
    'e1000000-0000-4000-8000-000000000024'::uuid, -- fc-babyhug-prewalker-soft-sole-booties (Default)
    'e1000000-0000-4000-8000-000000000025'::uuid, -- fc-crocs-kids-classic-clogs (Default)
    'fd00ec64-b704-4928-95cc-905b4e220635'::uuid, -- romper (Default)
    '17a1fed0-bec4-4b96-8d84-7ed155a4616a'::uuid, -- tshirt (Default)
    '22222222-2222-4222-8222-333333333301'::uuid, -- wooden-rattle (Standard duplicate)
    '33333333-3333-4333-8333-444444444401'::uuid  -- baby-wash (200ml Bottle duplicate)
  ];
BEGIN
  -- Safe foreign-key nullification before variant deletion
  UPDATE public.order_items SET variant_id = NULL WHERE variant_id = ANY(phantom_ids);
  UPDATE public.offline_sale_items SET variant_id = NULL WHERE variant_id = ANY(phantom_ids);
  UPDATE public.offline_return_items SET variant_id = NULL WHERE variant_id = ANY(phantom_ids);
  UPDATE public.online_return_items SET variant_id = NULL WHERE variant_id = ANY(phantom_ids);
  UPDATE public.inventory_transactions SET variant_id = NULL WHERE variant_id = ANY(phantom_ids);

  DELETE FROM public.product_variants WHERE id = ANY(phantom_ids);
END $$;

-- ------------------------------------------------------------------------------
-- STEP 2: HARDEN TRIGGERS (SINGLE SOURCE OF MUTATION & LOOP-FREE SYNC)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod_id uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_total_stock bigint;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_total_stock
  FROM public.product_variants
  WHERE product_id = v_prod_id
    AND (is_active IS NULL OR is_active = true);

  UPDATE public.products
  SET stock = GREATEST(0::bigint, v_total_stock),
      updated_at = now()
  WHERE id = v_prod_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER INSERT OR UPDATE OF stock, is_active OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();

CREATE OR REPLACE FUNCTION public.fn_sync_product_to_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  var_count integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO var_count
  FROM public.product_variants
  WHERE product_id = NEW.id
    AND (is_active IS NULL OR is_active = true);

  -- ONLY synchronize when the product has exactly 1 active variant (e.g. single item products)
  -- NEVER overwrite variants when there are multiple size/color variants!
  IF var_count = 1 THEN
    UPDATE public.product_variants
    SET stock = GREATEST(0::bigint, NEW.stock),
        updated_at = now()
    WHERE product_id = NEW.id
      AND (is_active IS NULL OR is_active = true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_to_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_to_variant_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_variant_stock();

-- ------------------------------------------------------------------------------
-- STEP 3: CANONICAL place_cod_order (NO DOUBLE DEDUCTION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_cod_order(
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  ps_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_details jsonb;
  v_user_id uuid;
  v_buying_price numeric;
BEGIN
  -- 1. Fetch Payment Settings and verify COD is active
  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.cod_enabled = false THEN
    RAISE EXCEPTION 'Cash on Delivery is currently disabled.';
  END IF;

  -- 2. Fetch and Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found.';
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

  IF session_rec.payment_method != 'cod' THEN
    RAISE EXCEPTION 'Checkout session is not configured for Cash on Delivery.';
  END IF;

  -- 3. Verify min/max COD constraints
  IF ps_rec.cod_min_order_value > 0 AND session_rec.subtotal < ps_rec.cod_min_order_value THEN
    RAISE EXCEPTION 'Minimum order value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
  END IF;

  IF ps_rec.cod_max_order_value > 0 AND session_rec.subtotal > ps_rec.cod_max_order_value THEN
    RAISE EXCEPTION 'Maximum order value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
  END IF;

  -- 4. Inventory Lock & Verification for all items
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
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

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Canonical COD Order
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
    'processing'::public.order_status,
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
  VALUES (new_order_id, 'processing', 'COD Order placed and processing', v_user_id);

  -- 7. Insert Order Items & Deduct Stock Atomically (SINGLE-SOURCE MUTATION)
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
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_slug,
      qty,
      price,
      subtotal,
      sku_snapshot,
      color,
      size,
      barcode_snapshot,
      image_url_snapshot,
      image_url,
      product_name_snapshot,
      name,
      buying_price
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      COALESCE(item_rec.product_slug, ''),
      item_rec.qty,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      item_rec.product_name,
      COALESCE(v_buying_price, 0)
    );

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_rec.variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.variant_id;

      -- trg_sync_variant_to_product_stock atomically re-sums parent stock! No double deduction.

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
        item_rec.variant_id,
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

  -- 8. Mark Session as converted
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
    'status', 'processing'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_cod_order(text) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- STEP 4: CANONICAL finalize_paid_order (NO DOUBLE DEDUCTION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text,
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _razorpay_signature text,
  _verified_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  attempt_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  product_rec record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_cust_details jsonb;
  v_user_id uuid;
  v_buying_price numeric;
BEGIN
  -- 1. Idempotency Check
  SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
  FROM public.orders
  WHERE razorpay_payment_id = _razorpay_payment_id
     OR (razorpay_order_id = _razorpay_order_id AND payment_status = 'paid')
  LIMIT 1;

  IF existing_order.id IS NOT NULL THEN
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

  -- 2. Fetch and Lock Checkout Session
  IF _session_id IS NOT NULL AND trim(_session_id) != '' THEN
    SELECT * INTO session_rec
    FROM public.checkout_sessions
    WHERE session_id = _session_id OR id::text = _session_id
    FOR UPDATE;
  END IF;

  IF session_rec.id IS NULL THEN
    SELECT * INTO attempt_rec
    FROM public.payment_attempts
    WHERE razorpay_order_id = _razorpay_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF attempt_rec.id IS NOT NULL AND attempt_rec.session_id IS NOT NULL THEN
      SELECT * INTO session_rec
      FROM public.checkout_sessions
      WHERE session_id = attempt_rec.session_id OR id::text = attempt_rec.session_id
      FOR UPDATE;
    END IF;
  END IF;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for Razorpay Order ID: %', _razorpay_order_id;
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

  -- 3. Verify Amount
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF abs(session_rec.total - _verified_amount) > 0.05 THEN
      RAISE EXCEPTION 'Verified amount (₹%) does not match session total (₹%)', _verified_amount, session_rec.total;
    END IF;
  END IF;

  -- 4. Inventory Lock & Verification
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    qty int
  ) LOOP
    IF item_rec.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT * INTO variant_rec
      FROM public.product_variants
      WHERE id = item_rec.variant_id
      FOR UPDATE;

      IF variant_rec.id IS NULL THEN
        RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
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

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Order
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
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
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
    'processing'::public.order_status,
    COALESCE(session_rec.payment_method, 'online'),
    'paid'::public.payment_status,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
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

  -- Insert payment record
  INSERT INTO public.payments (
    order_id,
    provider,
    payment_id,
    order_reference,
    method,
    amount,
    status,
    metadata
  ) VALUES (
    new_order_id,
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    'online',
    session_rec.total,
    'success',
    jsonb_build_object(
      'signature', _razorpay_signature,
      'verified_amount', _verified_amount,
      'session_id', session_rec.id
    )
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'processing', 'Payment verified and order processing', v_user_id);

  -- 7. Insert Order Items & Deduct Stock Atomically (SINGLE-SOURCE MUTATION)
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
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      variant_id,
      product_slug,
      qty,
      price,
      subtotal,
      sku_snapshot,
      color,
      size,
      barcode_snapshot,
      image_url_snapshot,
      image_url,
      product_name_snapshot,
      name,
      buying_price
    ) VALUES (
      new_order_id,
      item_rec.product_id,
      item_rec.variant_id,
      COALESCE(item_rec.product_slug, ''),
      item_rec.qty,
      item_rec.price,
      (item_rec.price * item_rec.qty),
      COALESCE(item_rec.variant_sku, ''),
      item_rec.variant_color,
      item_rec.variant_size,
      item_rec.variant_barcode,
      item_rec.image_url,
      item_rec.image_url,
      item_rec.product_name,
      item_rec.product_name,
      COALESCE(v_buying_price, 0)
    );

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_rec.variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.variant_id;

      -- trg_sync_variant_to_product_stock atomically re-sums parent stock! No double deduction.

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
        item_rec.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -item_rec.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        new_order_id,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
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
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        'Online Order #' || new_order_number || ' - ' || item_rec.product_name,
        v_user_id
      );
    END IF;
  END LOOP;

  -- 8. Mark Session as converted
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
    'payment_status', 'paid',
    'status', 'processing'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- STEP 5: CANONICAL place_offline_sale (NO DOUBLE DEDUCTION & NO OVERWRITE)
-- ------------------------------------------------------------------------------
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
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale_number text;
  v_existing_sale record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_coupon_discount numeric := 0;
  v_gross_total numeric := 0;
  v_payable_total numeric := 0;
  v_effective_payment_method text;
  v_item record;
  v_prev_stock int;
  v_new_stock int;
  v_var_prev_stock int;
  v_var_new_stock int;
  v_total_units int := 0;
  v_clean_phone text;
  v_cust_id uuid := _customer_id;
  v_curr_balance numeric := 0;
  v_new_balance numeric := 0;
  v_voucher_record record;
  v_voucher_used numeric := 0;
  v_voucher_token text := NULL;
  v_applied_coupon record;
  v_item_price numeric;
  v_line_gross numeric;
  v_alloc_bill numeric;
  v_alloc_coupon numeric;
  v_final_unit_paid numeric;
BEGIN
  -- 1. Strict Staff/Admin Authorization check
  IF uid IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can place POS sales';
  END IF;

  -- 2. Input Sanitation
  v_clean_phone := regexp_replace(COALESCE(_customer_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) > 10 AND starts_with(v_clean_phone, '91') THEN
    v_clean_phone := substring(v_clean_phone from 3);
  END IF;

  -- 3. Idempotency Check
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

  -- 4. Validate items array
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot complete sale with empty items';
  END IF;

  -- 5. Calculate subtotal & validate prices and quantities
  v_subtotal := 0;
  v_total_units := 0;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF COALESCE(v_item.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Quantity for item % must be greater than 0', COALESCE(v_item.name, 'item');
    END IF;

    -- Canonical Server-Side Price Verification
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    IF v_item_price IS NULL OR v_item_price < 0 THEN
      RAISE EXCEPTION 'Price for item % cannot be negative', COALESCE(v_item.name, 'item');
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item.qty);
    v_total_units := v_total_units + v_item.qty;
  END LOOP;

  -- 6. Apply Coupon Code if provided
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO v_applied_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (expires_at IS NULL OR expires_at >= now())
    LIMIT 1;

    IF v_applied_coupon.id IS NOT NULL THEN
      IF v_applied_coupon.min_order_amount IS NULL OR v_subtotal >= v_applied_coupon.min_order_amount THEN
        IF v_applied_coupon.discount_type = 'percentage' THEN
          v_coupon_discount := ROUND((v_subtotal * v_applied_coupon.discount_value) / 100, 2);
          IF v_applied_coupon.max_discount_amount IS NOT NULL AND v_coupon_discount > v_applied_coupon.max_discount_amount THEN
            v_coupon_discount := v_applied_coupon.max_discount_amount;
          END IF;
        ELSE
          v_coupon_discount := LEAST(v_subtotal, v_applied_coupon.discount_value);
        END IF;

        UPDATE public.coupons
        SET used_count = COALESCE(used_count, 0) + 1
        WHERE id = v_applied_coupon.id;
      END IF;
    END IF;
  END IF;

  -- 7. Calculate manual cashier discount
  IF _discount_type = 'percentage' AND _discount_value > 0 THEN
    v_discount := ROUND((v_subtotal * LEAST(_discount_value, 100)) / 100, 2);
  ELSIF _discount_type = 'flat' AND _discount_value > 0 THEN
    v_discount := LEAST(_discount_value, v_subtotal);
  ELSE
    v_discount := 0;
  END IF;

  v_discount := LEAST(v_subtotal, v_discount + v_coupon_discount);
  v_gross_total := GREATEST(0, v_subtotal - v_discount);

  -- 8. Validate and handle Store Credit / Voucher Redemption
  IF _store_credit_used > 0 OR (_credit_token IS NOT NULL AND trim(_credit_token) != '') THEN
    IF _credit_token IS NOT NULL AND trim(_credit_token) != '' THEN
      SELECT * INTO v_voucher_record
      FROM public.store_credit_vouchers
      WHERE UPPER(token) = UPPER(trim(_credit_token))
      FOR UPDATE;

      IF v_voucher_record.id IS NULL THEN
        RAISE EXCEPTION 'Store credit voucher % not found', trim(_credit_token);
      END IF;

      IF v_voucher_record.is_active = false OR v_voucher_record.current_balance <= 0 THEN
        RAISE EXCEPTION 'Store credit voucher % has already been fully redeemed or is inactive', trim(_credit_token);
      END IF;

      IF v_voucher_record.expires_at IS NOT NULL AND v_voucher_record.expires_at < now() THEN
        RAISE EXCEPTION 'Store credit voucher % expired on %', trim(_credit_token), v_voucher_record.expires_at;
      END IF;

      v_voucher_used := LEAST(_store_credit_used, v_voucher_record.current_balance, v_gross_total);
      IF v_voucher_used <= 0 THEN
        v_voucher_used := LEAST(v_voucher_record.current_balance, v_gross_total);
      END IF;
      v_voucher_token := v_voucher_record.token;

      UPDATE public.store_credit_vouchers
      SET current_balance = current_balance - v_voucher_used,
          is_active = (current_balance - v_voucher_used > 0),
          redeemed_at = CASE WHEN (current_balance - v_voucher_used) <= 0 THEN now() ELSE redeemed_at END,
          updated_at = now()
      WHERE id = v_voucher_record.id;
    END IF;
  END IF;

  v_payable_total := GREATEST(0, v_gross_total - v_voucher_used);

  -- 9. Determine effective payment method
  IF v_payable_total = 0 AND v_voucher_used > 0 THEN
    v_effective_payment_method := 'store_credit';
  ELSE
    v_effective_payment_method := COALESCE(NULLIF(_payment_method, ''), 'cash');
  END IF;

  -- 10. Generate sequential POS Sale Number
  v_sale_number := 'POS-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 11. Customer Link / Upsert
  IF v_cust_id IS NULL AND v_clean_phone != '' THEN
    SELECT id INTO v_cust_id
    FROM public.pos_customers
    WHERE regexp_replace(phone, '\D', '', 'g') LIKE '%' || v_clean_phone || '%'
    LIMIT 1;

    IF v_cust_id IS NULL THEN
      INSERT INTO public.pos_customers (
        name,
        phone,
        email,
        total_spent,
        total_spend,
        visits_count,
        total_visits,
        total_purchases,
        last_visit,
        last_visit_date,
        created_at,
        updated_at
      ) VALUES (
        COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
        v_clean_phone,
        COALESCE(trim(_customer_email), ''),
        v_gross_total,
        v_gross_total,
        1,
        1,
        1,
        now(),
        now(),
        now(),
        now()
      ) RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.pos_customers
      SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
          total_spend = COALESCE(total_spend, 0) + v_gross_total,
          visits_count = COALESCE(visits_count, 0) + 1,
          total_visits = COALESCE(total_visits, 0) + 1,
          total_purchases = COALESCE(total_purchases, 0) + 1,
          last_visit = now(),
          last_visit_date = now(),
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  ELSIF v_cust_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = COALESCE(total_spent, 0) + v_gross_total,
        total_spend = COALESCE(total_spend, 0) + v_gross_total,
        visits_count = COALESCE(visits_count, 0) + 1,
        total_visits = COALESCE(total_visits, 0) + 1,
        total_purchases = COALESCE(total_purchases, 0) + 1,
        last_visit = now(),
        last_visit_date = now(),
        updated_at = now()
    WHERE id = v_cust_id;
  END IF;

  -- 12. Insert Master POS Sale Record
  INSERT INTO public.offline_sales (
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    total,
    payment_method,
    notes,
    idempotency_key,
    store_credit_used,
    credit_token_used,
    coupon_code,
    cashier_id,
    created_at,
    updated_at
  ) VALUES (
    v_sale_number,
    v_cust_id,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    v_subtotal,
    v_discount,
    v_gross_total,
    v_effective_payment_method,
    _notes,
    _idempotency_key,
    v_voucher_used,
    v_voucher_token,
    _coupon_code,
    uid,
    now(),
    now()
  ) RETURNING id INTO v_sale_id;

  -- 13. Process Items & Single-Source Inventory Mutation
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    product_id uuid,
    variant_id uuid,
    product_slug text,
    slug text,
    price numeric,
    custom_price numeric,
    qty int,
    name text,
    sku text,
    barcode text,
    mrp numeric,
    cost_price numeric,
    variant_info text
  ) LOOP
    IF v_item.custom_price IS NOT NULL AND v_item.custom_price >= 0 THEN
      v_item_price := v_item.custom_price;
    ELSIF v_item.price IS NOT NULL AND v_item.price >= 0 THEN
      v_item_price := v_item.price;
    ELSIF v_item.variant_id IS NOT NULL THEN
      SELECT COALESCE(price_override, 0) INTO v_item_price FROM public.product_variants WHERE id = v_item.variant_id;
      IF v_item_price IS NULL OR v_item_price <= 0 THEN
        IF v_item.product_id IS NOT NULL THEN
          SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
        END IF;
      END IF;
    ELSIF v_item.product_id IS NOT NULL THEN
      SELECT COALESCE(price, 0) INTO v_item_price FROM public.products WHERE id = v_item.product_id;
    ELSE
      v_item_price := COALESCE(v_item.price, 0);
    END IF;

    v_line_gross := v_item_price * COALESCE(v_item.qty, 1);

    v_alloc_bill := CASE
      WHEN v_subtotal > 0 AND (v_discount - v_coupon_discount) > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * (v_discount - v_coupon_discount)) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_alloc_coupon := CASE
      WHEN v_subtotal > 0 AND v_coupon_discount > 0 THEN 
        ROUND(((v_line_gross / v_subtotal) * v_coupon_discount) / COALESCE(v_item.qty, 1), 4)
      ELSE 0
    END;

    v_final_unit_paid := GREATEST(0, ROUND(v_item_price - v_alloc_bill - v_alloc_coupon, 4));

    -- Insert into offline_sale_items
    INSERT INTO public.offline_sale_items (
      sale_id,
      product_id,
      variant_id,
      product_slug,
      name,
      product_name,
      sku,
      barcode,
      price,
      mrp,
      cost_price,
      variant_info,
      qty,
      quantity,
      subtotal,
      unit_mrp,
      unit_selling_price,
      line_gross_amount,
      allocated_bill_discount,
      allocated_coupon_discount,
      final_unit_paid_price,
      quantity_sold,
      quantity_returned,
      created_at
    ) VALUES (
      v_sale_id,
      v_item.product_id,
      v_item.variant_id,
      COALESCE(v_item.product_slug, v_item.slug, ''),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.name, 'Item'),
      COALESCE(v_item.sku, ''),
      COALESCE(v_item.barcode, ''),
      v_item_price,
      COALESCE(v_item.mrp, v_item_price, 0),
      COALESCE(v_item.cost_price, 0),
      COALESCE(v_item.variant_info, ''),
      COALESCE(v_item.qty, 1),
      COALESCE(v_item.qty, 1),
      v_item_price * COALESCE(v_item.qty, 1),
      COALESCE(v_item.mrp, v_item_price, 0),
      v_item_price,
      v_line_gross,
      v_alloc_bill,
      v_alloc_coupon,
      v_final_unit_paid,
      COALESCE(v_item.qty, 1),
      0,
      now()
    );

    -- SINGLE-SOURCE INVENTORY DEDUCTION:
    IF v_item.variant_id IS NOT NULL THEN
      SELECT stock INTO v_var_prev_stock FROM public.product_variants WHERE id = v_item.variant_id FOR UPDATE;
      v_var_new_stock := GREATEST(0, COALESCE(v_var_prev_stock, 0) - v_item.qty);

      UPDATE public.product_variants
      SET stock = v_var_new_stock,
          updated_at = now()
      WHERE id = v_item.variant_id;

      -- trg_sync_variant_to_product_stock atomically updates products.stock!
      -- DO NOT update products.stock here (prevents double-deduction and single-variant overwrite).

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
        v_item.product_id,
        v_item.variant_id,
        'sale'::public.inventory_tx_type,
        'sale'::public.inventory_tx_type,
        -v_item.qty,
        v_var_prev_stock,
        v_var_new_stock,
        'offline_sale',
        v_sale_id,
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item') || COALESCE(' (' || NULLIF(v_item.variant_info, '') || ')', ''),
        uid
      );
    ELSE
      IF v_item.product_id IS NOT NULL THEN
        SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
        v_new_stock := GREATEST(0, COALESCE(v_prev_stock, 0) - v_item.qty);

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_item.product_id;

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
          v_item.product_id,
          NULL,
          'sale'::public.inventory_tx_type,
          'sale'::public.inventory_tx_type,
          -v_item.qty,
          v_prev_stock,
          v_new_stock,
          'offline_sale',
          v_sale_id,
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          'POS Sale #' || v_sale_number || ' - ' || COALESCE(v_item.name, 'Item'),
          uid
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_discount', v_coupon_discount,
    'gross_total', v_gross_total,
    'total', v_gross_total,
    'payable_total', v_payable_total,
    'store_credit_used', v_voucher_used,
    'credit_token_used', v_voucher_token,
    'payment_method', v_effective_payment_method,
    'customer_id', v_cust_id,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', v_total_units
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, text, text, text, numeric, uuid, jsonb, text, numeric, text, text) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- STEP 6: CANONICAL process_offline_return (NO DOUBLE RESTOCK)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _sale_id uuid,
  _items jsonb,
  _refund_method text DEFAULT 'store_credit',
  _reason text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  orig_sale record;
  new_return_id uuid;
  new_return_number text;
  elem jsonb;
  item_orig_sale_item_id uuid;
  item_product_id uuid;
  item_variant_id uuid;
  item_name text;
  item_sku text;
  item_barcode text;
  item_qty integer;
  item_refund_price numeric;
  item_mrp numeric;
  item_slug text;
  item_variant_info text;
  v_refund_subtotal numeric := 0;
  v_voucher_id uuid;
  v_voucher_token text;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  -- 1. Authorization
  IF uid IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'staff', 'manager', 'owner', 'pos_user')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
    )
    AND NOT public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated administrators or store staff can process returns';
  END IF;

  -- 2. Validate original sale
  SELECT * INTO orig_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF orig_sale.id IS NULL THEN
    RAISE EXCEPTION 'Original sale record % not found', _sale_id;
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Cannot process return with no items specified';
  END IF;

  -- 3. Calculate refund total
  v_refund_subtotal := 0;
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_refund_subtotal := v_refund_subtotal + (
      COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0) *
      COALESCE((elem->>'qty')::integer, (elem->>'quantity')::integer, 1)
    );
  END LOOP;

  IF v_refund_subtotal < 0 THEN
    RAISE EXCEPTION 'Total refund amount cannot be negative';
  END IF;

  new_return_number := 'RET-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');

  -- 4. Insert Return Master Record
  INSERT INTO public.offline_returns (
    original_sale_id,
    return_number,
    cashier_id,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    refund_subtotal,
    refund_total,
    refund_method,
    reason,
    idempotency_key,
    created_at,
    updated_at
  ) VALUES (
    _sale_id,
    new_return_number,
    uid,
    orig_sale.customer_id,
    orig_sale.customer_name,
    orig_sale.customer_phone,
    orig_sale.customer_email,
    v_refund_subtotal,
    v_refund_subtotal,
    _refund_method,
    _reason,
    _idempotency_key,
    now(),
    now()
  ) RETURNING id INTO new_return_id;

  -- 5. Process Return Items & Restock Atomically
  FOR elem IN SELECT * FROM jsonb_array_elements(_items) LOOP
    item_product_id := (elem->>'product_id')::uuid;
    BEGIN
      item_variant_id := (elem->>'variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_variant_id := NULL;
    END;

    item_name := COALESCE(elem->>'name', elem->>'product_name', 'Item');
    item_sku := COALESCE(elem->>'sku', '');
    item_barcode := COALESCE(elem->>'barcode', '');
    item_qty := COALESCE((elem->>'qty')::integer, (elem->>'quantity')::integer, 1);
    item_refund_price := COALESCE((elem->>'refund_price')::numeric, (elem->>'price')::numeric, 0);
    item_mrp := COALESCE((elem->>'mrp')::numeric, item_refund_price);
    item_slug := COALESCE(elem->>'product_slug', elem->>'slug', '');
    item_variant_info := COALESCE(elem->>'variant_info', '');

    BEGIN
      item_orig_sale_item_id := (elem->>'original_sale_item_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      item_orig_sale_item_id := NULL;
    END;

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
      item_orig_sale_item_id,
      now()
    );

    -- Single-Source Restock:
    IF item_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_variant_id FOR UPDATE;
      v_new_stock := COALESCE(v_prev_stock, 0) + item_qty;

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_variant_id;

      -- trg_sync_variant_to_product_stock automatically updates products.stock!

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
    ELSIF item_product_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = item_product_id FOR UPDATE;
      IF v_prev_stock IS NOT NULL THEN
        v_new_stock := v_prev_stock + item_qty;
        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
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

  -- 6. Issue Store Credit Voucher if refund method is store_credit
  IF _refund_method = 'store_credit' AND v_refund_subtotal > 0 THEN
    v_voucher_token := 'SC-' || upper(substring(md5(random()::text) from 1 for 6));

    INSERT INTO public.store_credit_vouchers (
      token,
      customer_id,
      customer_phone,
      initial_amount,
      current_balance,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      v_voucher_token,
      orig_sale.customer_id,
      orig_sale.customer_phone,
      v_refund_subtotal,
      v_refund_subtotal,
      true,
      now(),
      now()
    ) RETURNING id INTO v_voucher_id;

    UPDATE public.offline_returns
    SET credit_token_issued = v_voucher_token
    WHERE id = new_return_id;
  END IF;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_subtotal', v_refund_subtotal,
    'refund_total', v_refund_subtotal,
    'refund_method', _refund_method,
    'credit_token_issued', v_voucher_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(uuid, jsonb, text, text, text) TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- STEP 7: CANONICAL admin_adjust_inventory (SINGLE-SOURCE MUTATION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_inventory(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _new_stock integer DEFAULT NULL,
  _adjustment_delta integer DEFAULT NULL,
  _reason text DEFAULT 'Manual adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prod record;
  variant record;
  v_prev_stock int;
  v_final_stock int;
  v_delta int;
  v_adj_reason text;
BEGIN
  -- 1. Authorization check
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can adjust inventory';
  END IF;

  -- 2. Lock and fetch parent product
  SELECT id, name, slug, stock, is_active
  INTO prod
  FROM public.products
  WHERE id = _product_id
  FOR UPDATE;

  IF prod.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_adj_reason := COALESCE(NULLIF(trim(_reason), ''), 'Manual stock adjustment');

  -- 3. Determine previous stock and compute target final stock
  IF _variant_id IS NOT NULL THEN
    SELECT id, name, stock
    INTO variant
    FROM public.product_variants
    WHERE id = _variant_id AND product_id = prod.id
    FOR UPDATE;

    IF variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product';
    END IF;
    v_prev_stock := COALESCE(variant.stock, 0);
  ELSE
    v_prev_stock := COALESCE(prod.stock, 0);
  END IF;

  -- 4. Calculate target stock
  IF _new_stock IS NOT NULL THEN
    IF _new_stock < 0 THEN
      RAISE EXCEPTION 'Stock level cannot be negative';
    END IF;
    v_final_stock := _new_stock;
    v_delta := _new_stock - v_prev_stock;
  ELSIF _adjustment_delta IS NOT NULL THEN
    IF (v_prev_stock + _adjustment_delta) < 0 THEN
      RAISE EXCEPTION 'Adjustment would result in negative stock';
    END IF;
    v_final_stock := v_prev_stock + _adjustment_delta;
    v_delta := _adjustment_delta;
  ELSE
    RAISE EXCEPTION 'Either _new_stock or _adjustment_delta must be provided';
  END IF;

  -- 5. Apply single-source updates
  IF _variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = variant.id;
    -- trg_sync_variant_to_product_stock automatically updates parent product stock!
  ELSE
    UPDATE public.products
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = prod.id;
    -- trg_sync_product_to_variant_stock automatically keeps single variant in sync!
  END IF;

  -- 6. Log auditable inventory transaction
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
    prod.id,
    _variant_id,
    'adjustment'::public.inventory_tx_type,
    'adjustment'::public.inventory_tx_type,
    v_delta,
    v_prev_stock,
    v_final_stock,
    'admin_manual_adjustment',
    COALESCE(_variant_id, prod.id),
    v_adj_reason,
    v_adj_reason,
    uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', prod.id,
    'variant_id', _variant_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_final_stock,
    'delta', v_delta,
    'reason', v_adj_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory(uuid, uuid, integer, integer, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- STEP 8: CANONICAL admin_void_offline_sale (SINGLE-SOURCE RESTORATION)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Administrative void',
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
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');
  v_prev_stock int;
  v_new_stock int;
  net_restore_qty int;
BEGIN
  -- 1. Strict Authorization Check
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  END IF;

  -- 2. Row lock target sale and verify existence
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found with id: %', _sale_id;
  END IF;

  IF target_sale.notes ILIKE '[VOIDED]%' THEN
    RAISE EXCEPTION 'Sale #% has already been voided', target_sale.sale_number;
  END IF;

  -- 3. Stock restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        IF target_item.variant_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = target_item.variant_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.variant_id;

          -- trg_sync_variant_to_product_stock atomically updates products.stock!

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
            target_item.variant_id,
            'void'::public.inventory_tx_type,
            'void'::public.inventory_tx_type,
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
            'void'::public.inventory_tx_type,
            'void'::public.inventory_tx_type,
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
    'voided_by', uid,
    'stock_restored', _restore_stock,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'reason', v_clean_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- STEP 9: NORMALIZE AND RECONCILE ALL CATALOG PRODUCTS
-- ------------------------------------------------------------------------------
UPDATE public.products p
SET stock = COALESCE(
  (
    SELECT SUM(v.stock)
    FROM public.product_variants v
    WHERE v.product_id = p.id
      AND (v.is_active IS NULL OR v.is_active = true)
  ),
  p.stock
),
updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.product_variants v
  WHERE v.product_id = p.id
);
