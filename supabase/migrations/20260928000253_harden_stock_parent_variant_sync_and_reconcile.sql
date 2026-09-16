-- Migration: 20260928000253_harden_stock_parent_variant_sync_and_reconcile.sql
-- Description:
-- 1. Reconcile parent products.stock to mathematically match SUM(active variants) across all products.
-- 2. Consolidate duplicate unreferenced default variants on simple products (e.g. 'car').
-- 3. Resolve historical null variant_id on order items where product has variants.
-- 4. Create BEFORE UPDATE trigger on public.products to permanently prevent parent stock drift on multi-variant products.
-- 5. Harden finalize_paid_order and restore_stock_for_order with automatic variant resolution for items missing variant_id.

-- 1. RECONCILE HISTORICAL DATA DISCREPANCIES
UPDATE public.products p
SET stock = sub.total_stock,
    updated_at = now()
FROM (
  SELECT product_id, COALESCE(SUM(stock), 0) AS total_stock
  FROM public.product_variants
  WHERE is_active IS NULL OR is_active = true
  GROUP BY product_id
) sub
WHERE p.id = sub.product_id
  AND p.stock IS DISTINCT FROM sub.total_stock;

-- Consolidate duplicate unreferenced default variants for 'car'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE id = '735bcfc1-14a9-431f-9a43-a5aa2d6bb278'
  ) AND EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE id = 'fe2a0848-ee60-478f-b95c-060e40ac8d62'
  ) THEN
    -- Consolidate stock into primary variant
    UPDATE public.product_variants
    SET stock = 20, updated_at = now()
    WHERE id = '735bcfc1-14a9-431f-9a43-a5aa2d6bb278';

    -- Safely delete duplicate unreferenced variant
    DELETE FROM public.product_variants
    WHERE id = 'fe2a0848-ee60-478f-b95c-060e40ac8d62';
  END IF;
END $$;

-- Fix historical null variant_id order item for 'set'
UPDATE public.order_items
SET variant_id = '44a4eabb-6dc1-4e14-bd71-e6c46da43525'
WHERE id = 'c1ad8fba-787b-4654-919b-e939b5a51f0d'
  AND variant_id IS NULL;


-- 2. TRIGGER: ENFORCE PARENT STOCK INTEGRITY ON PRODUCTS
CREATE OR REPLACE FUNCTION public.fn_enforce_product_parent_stock_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_var_count integer;
  v_var_sum bigint;
BEGIN
  -- Check if product has active variants
  SELECT count(*), COALESCE(SUM(stock), 0)
  INTO v_var_count, v_var_sum
  FROM public.product_variants
  WHERE product_id = NEW.id
    AND (is_active IS NULL OR is_active = true);

  IF v_var_count > 1 THEN
    -- For multi-variant products, the sum of variants is authoritative.
    -- Overwrite NEW.stock with the actual sum of variants so parent stock NEVER drifts.
    NEW.stock := GREATEST(0::bigint, v_var_sum);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_product_parent_stock_consistency ON public.products;
CREATE TRIGGER trg_enforce_product_parent_stock_consistency
  BEFORE UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_product_parent_stock_consistency();


-- 3. HARDEN finalize_paid_order WITH AUTOMATIC VARIANT RESOLUTION
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text DEFAULT NULL,
  _razorpay_order_id text DEFAULT NULL,
  _razorpay_payment_id text DEFAULT NULL,
  _razorpay_signature text DEFAULT NULL,
  _verified_amount numeric DEFAULT NULL
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
  v_buying_price numeric;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_user_id uuid;
  v_cust_details jsonb;
  v_effective_variant_id uuid;
BEGIN
  -- 1. Idempotency Check: Already processed?
  SELECT id, order_number, invoice_no, total, payment_status, status INTO existing_order
  FROM public.orders
  WHERE (_razorpay_payment_id IS NOT NULL AND razorpay_payment_id = _razorpay_payment_id)
     OR (_razorpay_order_id IS NOT NULL AND razorpay_order_id = _razorpay_order_id AND payment_status = 'paid')
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

  IF session_rec.id IS NULL AND _razorpay_order_id IS NOT NULL THEN
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
    RAISE EXCEPTION 'Checkout session not found for session_id: %, rzp_order_id: %', _session_id, _razorpay_order_id;
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

  -- 3. Verify Amount with Paise-to-Rupees Normalization
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF session_rec.total > 0 AND _verified_amount >= (session_rec.total * 50) THEN
      _verified_amount := _verified_amount / 100.0;
    END IF;

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

  -- 5. Generate Order and Invoice numbers
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := 'ORD-' || to_char(now(), 'YYMMDD') || '-' || lpad(floor(random() * 90000 + 10000)::text, 5, '0');
  v_cust_details := session_rec.customer_details;
  v_user_id := session_rec.user_id;

  -- 6. Insert Order with initial status strictly 'placed'
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
    'placed'::public.order_status,
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
    'paid'::public.payment_status,
    jsonb_build_object(
      'signature', _razorpay_signature,
      'verified_amount', _verified_amount,
      'session_id', session_rec.id
    )
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully and payment verified', v_user_id);

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
      v_effective_variant_id,
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

    IF v_effective_variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_effective_variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = v_effective_variant_id;

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

  -- 8. Mark session as converted
  UPDATE public.checkout_sessions
  SET status = 'converted',
      order_id = new_order_id,
      updated_at = now()
  WHERE id = session_rec.id;

  -- Return canonical success response
  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'paid',
    'status', 'placed',
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric) TO anon, authenticated, service_role;


-- 4. HARDEN restore_stock_for_order WITH AUTOMATIC VARIANT RESOLUTION
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
  v_effective_variant_id uuid;
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
    v_effective_variant_id := item.variant_id;

    -- If variant_id is missing on the order item, check if product has variants
    IF v_effective_variant_id IS NULL AND item.product_id IS NOT NULL THEN
      SELECT id INTO v_effective_variant_id
      FROM public.product_variants
      WHERE product_id = item.product_id
        AND (is_active IS NULL OR is_active = true)
      ORDER BY stock DESC
      LIMIT 1;
    END IF;

    IF v_effective_variant_id IS NOT NULL THEN
      -- Lock variant row
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = v_effective_variant_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := COALESCE(v_prev_stock, 0) + v_item_qty;

        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = v_effective_variant_id;

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
          v_effective_variant_id,
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
      -- Standalone product without any variants
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
    'message', 'Stock successfully restored'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid, text, text) TO anon, authenticated, service_role;
