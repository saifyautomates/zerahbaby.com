-- Fix app_role enum and POS/Return RPC auth checks
-- Date: 2026-09-02

-- 1. Ensure 'pos' is safely recognized in app_role enum if present
DO $$
BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pos';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 2. Update process_offline_return to use canonical 'admin' and 'staff' role checks
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'cash',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  computed_total_refund numeric := 0;
  item record;
  prod record;
  v_rec record;
  new_return_id uuid;
  new_return_number text;
  item_count int := 0;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  -- 1. Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'staff') THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can process returns';
  END IF;

  -- 2. Idempotency check (prevent duplicate return submissions)
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, return_number, refund_amount INTO new_return_id, new_return_number, computed_total_refund
    FROM public.offline_returns
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
    LIMIT 1;
    IF new_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'return_id', new_return_id,
        'return_number', new_return_number,
        'refund_amount', computed_total_refund,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate items exist
  SELECT count(*) INTO item_count
  FROM jsonb_array_elements(_items);
  IF item_count = 0 THEN
    RAISE EXCEPTION 'Return cart must have at least one product';
  END IF;

  -- 4. Validate and compute total refund
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.qty IS NULL OR item.qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be at least 1';
    END IF;
    IF item.refund_price IS NULL OR item.refund_price < 0 THEN
      RAISE EXCEPTION 'Refund price cannot be negative';
    END IF;

    computed_total_refund := computed_total_refund + (item.refund_price * item.qty);
  END LOOP;

  -- 5. Generate unique return reference
  new_return_id := gen_random_uuid();
  new_return_number := public.generate_pos_return_number();

  -- 6. Insert offline return record
  INSERT INTO public.offline_returns (
    id,
    return_number,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    refund_amount,
    refund_method,
    refund_status,
    return_reason,
    notes,
    status,
    created_by
  ) VALUES (
    new_return_id,
    new_return_number,
    COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    COALESCE(trim(_customer_phone), ''),
    COALESCE(trim(_customer_email), ''),
    _customer_id,
    computed_total_refund,
    COALESCE(_refund_method, 'cash'),
    COALESCE(_refund_status, 'completed'),
    COALESCE(NULLIF(trim(_return_reason), ''), 'Customer changed mind'),
    CASE
      WHEN _idempotency_key IS NOT NULL AND _idempotency_key != ''
      THEN _notes || ' [idem:' || _idempotency_key || ']'
      ELSE _notes
    END,
    'completed',
    uid
  );

  -- 7. Process items: lock products, increase inventory, and log inventory transactions
  FOR item IN
    SELECT * FROM jsonb_to_recordset(_items)
    AS x(product_id uuid, product_slug text, qty int, refund_price numeric, name text, sku text, barcode text, variant_info text, mrp numeric)
  LOOP
    IF item.product_id IS NOT NULL THEN
      SELECT id, slug, stock, name, sku, barcode, is_active
      INTO prod
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        v_prev_stock := prod.stock;
        v_new_stock := prod.stock + item.qty;

        -- Atomic stock increment on parent product
        UPDATE public.products
        SET stock = v_new_stock
        WHERE id = prod.id;

        -- Atomic stock increment on matching variant or default variant
        SELECT id, stock INTO v_rec
        FROM public.product_variants
        WHERE product_id = prod.id
          AND (sku ILIKE item.sku OR barcode = item.barcode OR name = 'Default')
        ORDER BY (sku ILIKE item.sku) DESC, (barcode = item.barcode) DESC, (name = 'Default') DESC
        LIMIT 1
        FOR UPDATE;

        IF v_rec.id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + item.qty
          WHERE id = v_rec.id;
        END IF;

        -- Record auditable inventory transaction
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
          v_rec.id,
          'return'::public.inventory_tx_type,
          item.qty,
          v_prev_stock,
          v_new_stock,
          'offline_return',
          new_return_id,
          'POS Return ' || new_return_number || ': ' || COALESCE(_return_reason, 'Restock'),
          uid
        );
      END IF;
    END IF;

    -- Insert return item record
    INSERT INTO public.offline_return_items (
      return_id,
      product_id,
      product_slug,
      name,
      sku,
      barcode,
      variant_info,
      qty,
      unit_mrp,
      refund_price
    ) VALUES (
      new_return_id,
      item.product_id,
      item.product_slug,
      item.name,
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      item.variant_info,
      item.qty,
      item.mrp,
      item.refund_price
    );
  END LOOP;

  -- 8. Return response
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'items_count', item_count,
    'status', 'completed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, jsonb, text) TO authenticated, service_role;

-- 3. Update place_offline_sale to use canonical 'admin' and 'staff' role checks
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _payment_method text DEFAULT 'cash',
  _discount_type text DEFAULT 'percentage',
  _discount_value numeric DEFAULT 0,
  _notes text DEFAULT '',
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  item record;
  variant record;
  new_sale_id uuid;
  new_receipt_number text;
  sale_subtotal numeric := 0;
  final_discount_amount numeric := 0;
  final_total numeric := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'staff') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id INTO new_sale_id FROM public.offline_sales WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id, 'duplicate', true);
    END IF;
  END IF;

  new_sale_id := gen_random_uuid();
  new_receipt_number := public.generate_pos_sale_number();

  INSERT INTO public.offline_sales (
    id, receipt_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
    subtotal, discount_type, discount_value, discount_amount, total_amount, payment_method, notes, idempotency_key
  ) VALUES (
    new_sale_id, new_receipt_number, uid, _customer_id, _customer_name, _customer_phone, _customer_email,
    0, _discount_type, _discount_value, 0, 0, _payment_method, _notes, _idempotency_key
  );

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(
    variant_id uuid,
    product_id uuid,
    product_name text,
    sku text,
    barcode text,
    quantity int,
    unit_price numeric,
    item_type text,
    notes text
  )
  LOOP
    IF item.quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than 0'; END IF;
    IF item.unit_price < 0 THEN RAISE EXCEPTION 'Price cannot be negative'; END IF;

    sale_subtotal := sale_subtotal + (item.quantity * item.unit_price);

    IF COALESCE(item.item_type, 'catalog') = 'catalog' AND item.variant_id IS NOT NULL THEN
      SELECT * INTO variant FROM public.product_variants WHERE id = item.variant_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variant % not found', item.variant_id; END IF;
      IF variant.stock < item.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for SKU % (Available: %, Requested: %)', variant.sku, variant.stock, item.quantity;
      END IF;

      UPDATE public.product_variants SET stock = stock - item.quantity WHERE id = variant.id;
      UPDATE public.products SET stock = stock - item.quantity WHERE id = variant.product_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, created_by
      ) VALUES (
        variant.product_id, variant.id, 'offline_sale', item.quantity, variant.stock, variant.stock - item.quantity, 'pos_receipt', new_sale_id, uid
      );
    END IF;

    INSERT INTO public.offline_sale_items (
      sale_id, variant_id, product_id, product_name, sku, barcode, quantity, unit_price, total_price, item_type, notes
    ) VALUES (
      new_sale_id, item.variant_id, item.product_id, item.product_name, item.sku, item.barcode,
      item.quantity, item.unit_price, (item.quantity * item.unit_price), COALESCE(item.item_type, 'catalog'), item.notes
    );
  END LOOP;

  IF _discount_type = 'percentage' THEN
    final_discount_amount := round((sale_subtotal * (_discount_value / 100.0)), 2);
  ELSE
    final_discount_amount := LEAST(sale_subtotal, _discount_value);
  END IF;

  final_total := GREATEST(0, sale_subtotal - final_discount_amount);

  UPDATE public.offline_sales
  SET subtotal = sale_subtotal,
      discount_amount = final_discount_amount,
      total_amount = final_total
  WHERE id = new_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', new_sale_id,
    'receipt_number', new_receipt_number,
    'total', final_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_offline_sale(text, text, text, uuid, text, text, numeric, text, jsonb, text) TO authenticated, service_role;
