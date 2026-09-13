-- ==============================================================================
-- Migration: 20260928000206_bidirectional_trigger_sync_and_payment_status.sql
-- Description:
-- 1. Replace fragile pg_trigger_depth() checks in fn_sync_variant_to_product_stock
--    and fn_sync_product_to_variant_stock with value-change guards (IS DISTINCT FROM).
--    This allows nested triggers (e.g. order cancellations, returns, refunds, bulk actions)
--    to successfully propagate stock updates without infinite recursion.
-- 2. Cast payment_status properly in place_order to match public.payment_status enum.
-- 3. Reconcile public.product_variants to authoritative public.products stock (10 for cord).
-- ==============================================================================

-- 1. Variant -> Product Sync Trigger (No trigger depth block, guard with IS DISTINCT FROM)
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod_id uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_total_stock bigint;
  v_curr_stock bigint;
  v_curr_is_active boolean;
  v_curr_status public.product_status;
BEGIN
  IF v_prod_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Compute true sum of active variants
  SELECT COALESCE(SUM(stock), 0) INTO v_total_stock
  FROM public.product_variants
  WHERE product_id = v_prod_id
    AND (is_active IS NULL OR is_active = true);

  -- Fetch current parent product state
  SELECT stock, is_active, status
  INTO v_curr_stock, v_curr_is_active, v_curr_status
  FROM public.products
  WHERE id = v_prod_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only perform update if parent values actually differ to avoid unnecessary loops
  IF v_curr_stock IS DISTINCT FROM GREATEST(0::bigint, v_total_stock)
     OR (v_total_stock <= 0 AND v_curr_is_active = true)
     OR (v_total_stock > 0 AND v_curr_status = 'archived'::public.product_status) THEN

    UPDATE public.products
    SET stock = GREATEST(0::bigint, v_total_stock),
        is_active = CASE
          WHEN v_total_stock <= 0 THEN false
          WHEN is_active = false AND status = 'archived'::public.product_status THEN true
          ELSE is_active
        END,
        status = CASE
          WHEN v_total_stock <= 0 THEN 'archived'::public.product_status
          WHEN status = 'archived'::public.product_status AND v_total_stock > 0 THEN 'active'::public.product_status
          ELSE status
        END,
        updated_at = now()
    WHERE id = v_prod_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER INSERT OR UPDATE OF stock, is_active OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();

-- 2. Product -> Variant Sync Trigger for Single-Variant Products
CREATE OR REPLACE FUNCTION public.fn_sync_product_to_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  var_count integer;
  v_single_var_id uuid;
  v_single_var_stock bigint;
BEGIN
  IF NEW.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO var_count
  FROM public.product_variants
  WHERE product_id = NEW.id
    AND (is_active IS NULL OR is_active = true);

  -- Only synchronize if single variant and stock actually changed
  IF var_count = 1 THEN
    SELECT id, stock INTO v_single_var_id, v_single_var_stock
    FROM public.product_variants
    WHERE product_id = NEW.id
      AND (is_active IS NULL OR is_active = true)
    LIMIT 1;

    IF v_single_var_id IS NOT NULL AND v_single_var_stock IS DISTINCT FROM GREATEST(0::bigint, NEW.stock) THEN
      UPDATE public.product_variants
      SET stock = GREATEST(0::bigint, NEW.stock),
          updated_at = now()
      WHERE id = v_single_var_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_to_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_to_variant_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_variant_stock();

-- 3. Fix place_order to use payment_status enum
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
BEGIN
  -- 1. Identify User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT id, order_number, invoice_no, total, payment_status, status
    INTO existing_order
    FROM public.orders
    WHERE idempotency_key = v_clean_idem
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

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

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

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT NULL::uuid AS variant_id, p.price AS price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL AS variant_color, NULL AS variant_size,
             p.name AS variant_name, NULL AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      RAISE EXCEPTION 'Product not found for item: %', COALESCE(item.variant_id, item.product_slug, item.product_id, 'unknown');
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
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

  -- 5. Shipping Calculation
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_min_order';
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    fd_threshold := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'shipping_fee';
  IF v_raw_val IS NOT NULL AND v_raw_val ~ '^[0-9]+(\.[0-9]+)?$' THEN
    std_shipping := v_raw_val::numeric;
  END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_enabled';
  IF v_raw_val IS NOT NULL THEN
    is_fd_enabled := (v_raw_val = 'true');
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);
  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  computed_total := net_subtotal + shipping;

  -- 6. Insert Order
  new_order_id := gen_random_uuid();
  new_order_number := 'ZK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(new_order_id::text, 1, 6));
  new_invoice := 'INV-' || to_char(now(), 'YYMM') || '-' || upper(substring(new_order_id::text, 1, 5));

  INSERT INTO public.orders (
    id, order_number, invoice_no, user_id, full_name, email, phone, alt_phone,
    address, address_line2, landmark, city, state, pincode,
    subtotal, discount, shipping, total, payment_method, payment_status,
    status, notes, coupon_code, idempotency_key
  ) VALUES (
    new_order_id, new_order_number, new_invoice, uid, trim(_full_name), trim(_email), trim(_phone), NULLIF(trim(_alt_phone), ''),
    trim(_address), NULLIF(trim(_address_line2), ''), NULLIF(trim(_landmark), ''), trim(_city), trim(_state), trim(_pincode),
    computed_subtotal, computed_discount, shipping, computed_total, lower(trim(_payment_method)), v_initial_payment_status,
    'placed', NULLIF(trim(_notes), ''), _coupon_code, v_clean_idem
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed via online checkout', uid);

  -- 7. Insert Items & Decrement Inventory (SINGLE-SOURCE MUTATION WITH FOR UPDATE LOCKS)
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id text, product_slug text, product_id text, qty int) LOOP
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

    IF variant.variant_id IS NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
      LIMIT 1;
    END IF;

    IF variant.p_id IS NULL THEN
      SELECT NULL::uuid AS variant_id, p.price AS price, COALESCE(p.mrp, p.price) AS mrp,
             p.sku AS variant_sku, p.barcode AS variant_barcode, NULL AS variant_color, NULL AS variant_size,
             p.name AS variant_name, NULL AS variant_image, p.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.products p
      WHERE (item.product_slug IS NOT NULL AND item.product_slug != '' AND (p.slug = item.product_slug OR p.id::text = item.product_slug))
         OR (item.product_id IS NOT NULL AND item.product_id != '' AND (p.id::text = item.product_id OR p.slug = item.product_id))
         OR (item.variant_id IS NOT NULL AND item.variant_id != '' AND (p.id::text = item.variant_id OR p.slug = item.variant_id))
      LIMIT 1;
    END IF;

    SELECT buying_price INTO v_item_buying_price
    FROM public.product_costs
    WHERE product_id = variant.p_id
    LIMIT 1;

    item_image := variant.variant_image;
    IF item_image IS NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, variant.p_id, variant.variant_id, variant.product_slug, item.qty, variant.price, (variant.price * item.qty), variant.variant_sku,
      variant.variant_color, variant.variant_size, variant.variant_barcode, item_image, item_image, variant.product_name, variant.product_name, COALESCE(v_item_buying_price, 0)
    );

    -- STRICT SINGLE-SOURCE ATOMIC INVENTORY DEDUCTION (ZERO DOUBLE-DEDUCTION)
    IF variant.variant_id IS NOT NULL THEN
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = variant.variant_id
      FOR UPDATE;

      IF v_prev_stock IS NULL OR v_prev_stock < item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (%). Available: %, Requested: %',
          variant.product_name, COALESCE(variant.variant_name, 'Default'), COALESCE(v_prev_stock, 0), item.qty;
      END IF;

      v_new_stock := GREATEST(0, v_prev_stock - item.qty);

      UPDATE public.product_variants
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = variant.variant_id;

      -- trg_sync_variant_to_product_stock automatically synchronizes public.products.stock!

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, transaction_type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, notes, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        uid
      );
    ELSE
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = variant.p_id
      FOR UPDATE;

      IF v_prev_stock IS NULL OR v_prev_stock < item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %',
          variant.product_name, COALESCE(v_prev_stock, 0), item.qty;
      END IF;

      v_new_stock := GREATEST(0, v_prev_stock - item.qty);

      UPDATE public.products
      SET stock = v_new_stock,
          updated_at = now()
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, transaction_type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, notes, created_by
      ) VALUES (
        variant.p_id, NULL, 'sale'::public.inventory_tx_type, 'sale'::public.inventory_tx_type, -item.qty, v_prev_stock, v_new_stock, 'order', new_order_id,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        'Order ' || new_order_number || ' - ' || variant.product_name,
        uid
      );
    END IF;
  END LOOP;

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

GRANT EXECUTE ON FUNCTION public.place_order TO anon, authenticated, service_role;

-- 4. Reconcile cord variant to 10 (matching parent product authoritative state)
UPDATE public.product_variants
SET stock = 10,
    updated_at = now()
WHERE product_id = 'fcf333bb-55ce-4dfe-95ff-48bd0f2bc606';

UPDATE public.products
SET stock = 10,
    updated_at = now()
WHERE id = 'fcf333bb-55ce-4dfe-95ff-48bd0f2bc606';

NOTIFY pgrst, 'reload schema';
