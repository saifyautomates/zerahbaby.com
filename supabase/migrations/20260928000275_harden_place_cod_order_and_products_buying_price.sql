-- ==============================================================================
-- Migration: 20260928000275_harden_place_cod_order_and_products_buying_price.sql
-- Description:
-- 1. Add buying_price and cost_price to public.products to prevent missing column errors.
-- 2. Harden place_cod_order to strictly enforce payment_method = 'cod' and check
--    payment_settings.cod_enabled, preventing session hijacking or bypassing payment.
-- ==============================================================================

-- 1. Table: products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS buying_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;

UPDATE public.products p
SET buying_price = COALESCE(pc.buying_price, 0),
    cost_price = COALESCE(pc.cost_price, pc.buying_price, 0)
FROM public.product_costs pc
WHERE pc.product_id = p.id;

-- 2. Function: place_cod_order
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

  -- 3. Verify Stock
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
      item_rec.variant_id,
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

    IF item_rec.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = item_rec.variant_id FOR UPDATE;
      v_new_stock := GREATEST(0::bigint, v_prev_stock - item_rec.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = item_rec.variant_id;

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

  -- 7. Atomically deduct store credit voucher if one was applied
  IF session_rec.coupon_code IS NOT NULL AND session_rec.discount > 0 THEN
    UPDATE public.offline_returns
    SET credit_used = COALESCE(credit_used, 0) + session_rec.discount,
        credit_balance = GREATEST(0, refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)),
        credit_token_status = CASE WHEN (refund_amount - (COALESCE(credit_used, 0) + session_rec.discount)) <= 0 THEN 'CONSUMED' ELSE 'PARTIALLY_USED' END,
        updated_at = now()
    WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.pos_exchange_vouchers
    SET remaining_balance = GREATEST(0, remaining_balance - session_rec.discount),
        status = CASE WHEN remaining_balance - session_rec.discount <= 0 THEN 'redeemed' ELSE 'active' END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));

    UPDATE public.store_credit_vouchers
    SET current_balance = GREATEST(0, current_balance - session_rec.discount),
        is_active = (current_balance - session_rec.discount > 0),
        redeemed_at = CASE WHEN current_balance - session_rec.discount <= 0 THEN now() ELSE redeemed_at END,
        updated_at = now()
    WHERE UPPER(TRIM(token)) = UPPER(TRIM(session_rec.coupon_code));
  END IF;

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
    'status', 'placed'
  );
END;
$function$;
