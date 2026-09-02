-- ==============================================================================
-- Migration: 20260928000003_harden_inventory_master_engine.sql
-- Description:
-- 1. Enforce non-negative check constraint on product_variants.stock
-- 2. Upgrade place_order RPC with row-locking (FOR UPDATE), idempotency key,
--    atomic variant + parent stock deduction, and complete inventory transaction ledger
-- 3. Upgrade restore_stock_on_cancel trigger function to atomically restore both
--    variant stock and parent stock, logging previous_quantity and new_quantity
-- 4. Create canonical admin_adjust_inventory RPC with full ledger audit logging
-- ==============================================================================

-- 1. Enforce Non-Negative Check Constraint on product_variants
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_stock_check'
  ) THEN
    ALTER TABLE public.product_variants
    ADD CONSTRAINT product_variants_stock_check CHECK (stock >= 0);
  END IF;
END $$;

-- 2. Ensure idempotency_key column exists on orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON public.orders(idempotency_key);

-- 3. Canonical place_order RPC with Row Locking & Idempotency
CREATE OR REPLACE FUNCTION public.place_order(
  _full_name text,
  _email text,
  _phone text,
  _alt_phone text DEFAULT '',
  _address text DEFAULT '',
  _address_line2 text DEFAULT '',
  _landmark text DEFAULT '',
  _city text DEFAULT '',
  _state text DEFAULT '',
  _pincode text DEFAULT '',
  _payment_method text DEFAULT 'cod',
  _notes text DEFAULT '',
  _coupon_code text DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  computed_subtotal numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  item record;
  variant record;
  coupon_result jsonb;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  
  _fd_enabled text;
  _fd_threshold text;
  _fd_charge text;
  is_fd_enabled boolean := true;
  fd_threshold numeric := 999;
  std_shipping numeric := 79;
  item_image text;
  v_initial_payment_status public.payment_status := 'pending'::public.payment_status;
  v_prev_stock int;
  v_new_stock int;
  v_clean_idem text;
  existing_order record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;

  -- 1. Idempotency Check (prevent duplicate submissions)
  v_clean_idem := COALESCE(NULLIF(trim(_idempotency_key), ''), NULL);
  IF v_clean_idem IS NOT NULL THEN
    SELECT id, invoice_no, order_number, total
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
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Free delivery configuration
  SELECT value INTO _fd_enabled FROM public.site_settings WHERE key = 'free_delivery_enabled';
  SELECT value INTO _fd_threshold FROM public.site_settings WHERE key = 'free_delivery_threshold';
  SELECT value INTO _fd_charge FROM public.site_settings WHERE key = 'standard_shipping_charge';

  IF _fd_enabled IS NOT NULL AND _fd_enabled = 'false' THEN
    is_fd_enabled := false;
  END IF;

  IF _fd_threshold IS NOT NULL AND _fd_threshold ~ '^[0-9]+(\.[0-9]+)?$' THEN
    fd_threshold := _fd_threshold::numeric;
  END IF;

  IF _fd_charge IS NOT NULL AND _fd_charge ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := _fd_charge::numeric;
  END IF;

  -- 3. Pessimistic Row Locking & Validation
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.stock,
           p.name AS product_name, p.slug AS product_slug, p.is_active, p.sales_channel
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v;

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Variant ID % not found', item.variant_id;
    END IF;

    IF NOT variant.is_active THEN
      RAISE EXCEPTION 'Product "%" is archived and cannot be purchased', variant.product_name;
    END IF;

    IF variant.sales_channel = 'OFFLINE_ONLY' THEN
      RAISE EXCEPTION 'Product "%" is only available at our physical store', variant.product_name;
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%". Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    IF item.qty <= 0 OR item.qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for "%": %', variant.product_name, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
  END LOOP;

  IF computed_subtotal = 0 THEN
    RAISE EXCEPTION 'Order subtotal cannot be zero';
  END IF;

  -- 4. Validate coupon
  IF _coupon_code IS NOT NULL AND _coupon_code <> '' THEN
    BEGIN
      coupon_result := public.validate_coupon(_coupon_code, uid, computed_subtotal);
      IF (coupon_result->>'valid')::boolean THEN
        computed_discount := (coupon_result->>'discount')::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      computed_discount := 0;
    END;
  END IF;

  -- 5. Compute shipping
  IF is_fd_enabled AND computed_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := GREATEST(0, computed_subtotal + shipping - computed_discount);

  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  IF _payment_method = 'paid' OR _payment_method = 'online_paid' THEN
    v_initial_payment_status := 'paid'::public.payment_status;
  ELSE
    v_initial_payment_status := 'pending'::public.payment_status;
  END IF;

  -- 6. Insert Order Record
  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping, discount, total, coupon_code, status, payment_method, payment_status,
    full_name, email, phone, alt_phone, address, address_line2, landmark, city, state, pincode, notes, idempotency_key
  ) VALUES (
    new_order_id, uid, new_invoice, new_order_number, computed_subtotal, shipping, computed_discount, computed_total, _coupon_code, 'placed'::public.order_status, _payment_method, 
    v_initial_payment_status,
    _full_name, _email, _phone, _alt_phone, _address, _address_line2, _landmark, _city, _state, _pincode,
    CASE WHEN v_clean_idem IS NOT NULL THEN COALESCE(_notes, '') || ' [idem:' || v_clean_idem || ']' ELSE _notes END,
    v_clean_idem
  );

  INSERT INTO public.order_status_history (order_id, status, notes, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed successfully', uid);

  -- 7. Insert Items, Deduct Stock & Record Complete Inventory Ledger
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, qty int) LOOP
    SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku,
           v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
           v.name AS variant_name, v.image_url AS variant_image, v.stock AS v_stock,
           p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
    INTO variant
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item.variant_id
    FOR UPDATE OF v, p;

    item_image := variant.variant_image;
    IF item_image IS NULL AND variant.variant_color IS NOT NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND color = variant.variant_color
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;
    IF item_image IS NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, quantity, price, price_at_time, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, item.qty, item.qty, variant.price, variant.price, (variant.price * item.qty), variant.variant_sku,
      variant.variant_color, variant.variant_size, variant.variant_barcode, item_image, item_image, variant.product_name, variant.product_name
    );

    v_prev_stock := variant.p_stock;
    v_new_stock := GREATEST(0, variant.p_stock - item.qty);

    -- Atomic decrement on variant
    UPDATE public.product_variants
    SET stock = GREATEST(0, stock - item.qty)
    WHERE id = variant.variant_id;

    -- Atomic decrement on parent product
    UPDATE public.products
    SET stock = v_new_stock
    WHERE id = variant.p_id;

    -- Complete inventory ledger recording
    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity,
      reference_type, reference_id, note, created_by
    ) VALUES (
      variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, -item.qty,
      v_prev_stock, v_new_stock,
      'order', new_order_id, 'Online Order ' || new_invoice, uid
    );
  END LOOP;

  -- 8. Clean up user's cart in database
  DELETE FROM public.cart_items WHERE user_id = uid;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'invoice_no', new_invoice,
    'order_number', new_order_number,
    'total', computed_total,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text) TO authenticated, service_role;


-- 4. Hardened restore_stock_on_cancel() Trigger Function
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item record;
  v_prod record;
  v_var record;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  -- Check if status transitioned to cancelled/returned or payment_status to failed
  IF (NEW.status IN ('cancelled', 'returned') AND OLD.status NOT IN ('cancelled', 'returned')) OR 
     (NEW.payment_status = 'failed' AND OLD.payment_status != 'failed') THEN
    
    -- Idempotency check: Ensure we haven't already restored stock for this order
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_transactions 
      WHERE reference_id = NEW.id 
        AND reference_type = 'order'
        AND (type = 'adjustment' OR note LIKE '%Stock restored%')
    ) THEN
      
      -- Restore stock for each item
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        -- 1. Restore specific variant stock if variant_id exists
        IF item.variant_id IS NOT NULL THEN
          SELECT id, stock INTO v_var
          FROM public.product_variants
          WHERE id = item.variant_id
          FOR UPDATE;

          IF v_var.id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = stock + item.qty
            WHERE id = v_var.id;
          END IF;
        END IF;

        -- 2. Restore parent product stock
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = item.product_id OR slug = item.product_slug
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          v_prev_stock := v_prod.stock;
          v_new_stock := v_prod.stock + item.qty;

          UPDATE public.products 
          SET stock = v_new_stock
          WHERE id = v_prod.id;

          -- If no variant_id was specified on item, also ensure single/Default variant is restored
          IF item.variant_id IS NULL THEN
            UPDATE public.product_variants
            SET stock = stock + item.qty
            WHERE product_id = v_prod.id
              AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = v_prod.id) <= 1);
          END IF;

          -- 3. Log inventory transaction with full audit trail
          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, created_by
          ) VALUES (
            v_prod.id, item.variant_id, 'adjustment'::public.inventory_tx_type, item.qty,
            v_prev_stock, v_new_stock, 'order', NEW.id,
            'Stock restored due to order cancellation/failure',
            COALESCE(auth.uid(), NEW.user_id)
          );
        END IF;
      END LOOP;

    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure trigger is active
DROP TRIGGER IF EXISTS orders_restore_stock_trigger ON public.orders;
CREATE TRIGGER orders_restore_stock_trigger
AFTER UPDATE OF status, payment_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.restore_stock_on_cancel();


-- 5. Canonical admin_adjust_inventory RPC for Authorized Manual Adjustments
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
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'staff') THEN
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

  v_prev_stock := prod.stock;
  v_adj_reason := COALESCE(NULLIF(trim(_reason), ''), 'Manual stock adjustment');

  -- 3. Compute new stock level
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

  -- 4. If variant specified, lock and adjust variant
  IF _variant_id IS NOT NULL THEN
    SELECT id, name, stock
    INTO variant
    FROM public.product_variants
    WHERE id = _variant_id AND product_id = prod.id
    FOR UPDATE;

    IF variant.id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = GREATEST(0, stock + v_delta)
      WHERE id = variant.id;
    END IF;
  ELSE
    -- If single/default variant, keep it in sync
    UPDATE public.product_variants
    SET stock = v_final_stock
    WHERE product_id = prod.id
      AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = prod.id) <= 1);
  END IF;

  -- 5. Update parent product stock
  UPDATE public.products
  SET stock = v_final_stock
  WHERE id = prod.id;

  -- 6. Log auditable inventory transaction
  INSERT INTO public.inventory_transactions (
    product_id,
    variant_id,
    type,
    quantity,
    previous_quantity,
    new_quantity,
    reference_type,
    reference_id,
    note,
    created_by
  ) VALUES (
    prod.id,
    _variant_id,
    'adjustment'::public.inventory_tx_type,
    v_delta,
    v_prev_stock,
    v_final_stock,
    'manual_adjustment',
    prod.id,
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

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory TO authenticated, service_role;
