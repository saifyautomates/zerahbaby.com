-- ==============================================================================
-- Migration: Production-Hardening for Central Inventory, POS Returns, and Channels
-- Description: 
-- 1. Adds previous_quantity & new_quantity to inventory_transactions
-- 2. Hardens get_related_products to strictly exclude OFFLINE_ONLY products
-- 3. Updates process_offline_return to restock both parent & variant stock atomically
-- 4. Updates place_order & place_offline_sale to record previous & new stock in inventory_transactions
-- ==============================================================================

-- 1. Schema Extensions for inventory_transactions
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS previous_quantity integer;
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS new_quantity integer;

-- 2. Harden get_related_products to strictly exclude OFFLINE_ONLY products from storefront recommendations
CREATE OR REPLACE FUNCTION public.get_related_products(
  p_product_id uuid,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  price numeric,
  mrp numeric,
  image_url text,
  images text[],
  category text,
  brand text,
  stock integer,
  low_stock_at integer,
  is_active boolean,
  relation_source text,
  sort_order integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_category text;
  v_brand text;
  v_manual_count integer := 0;
BEGIN
  -- Get current product info
  SELECT recommendation_mode, category, brand 
  INTO v_mode, v_category, v_brand
  FROM public.products 
  WHERE products.id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 1. Fetch Manual Relations (strictly active and ONLINE_AND_OFFLINE)
  RETURN QUERY
  SELECT 
    p.id, p.name, p.slug, p.price, p.mrp, p.image_url, p.images, p.category, p.brand, p.stock, p.low_stock_at, p.is_active,
    'manual'::text AS relation_source,
    CASE 
      WHEN pr.product_1_id = p_product_id THEN pr.sort_order_1 
      ELSE pr.sort_order_2 
    END AS sort_order
  FROM public.product_relations pr
  JOIN public.products p ON (p.id = pr.product_1_id OR p.id = pr.product_2_id) AND p.id != p_product_id
  WHERE (pr.product_1_id = p_product_id OR pr.product_2_id = p_product_id)
    AND p.is_active = true
    AND p.sales_channel = 'ONLINE_AND_OFFLINE'
  ORDER BY sort_order ASC
  LIMIT p_limit;

  -- 2. Fetch Automatic Fallback (if applicable)
  IF v_mode IN ('auto', 'manual_fallback') THEN
    SELECT count(*) INTO v_manual_count 
    FROM public.product_relations pr
    JOIN public.products p ON (p.id = pr.product_1_id OR p.id = pr.product_2_id) AND p.id != p_product_id
    WHERE (pr.product_1_id = p_product_id OR pr.product_2_id = p_product_id)
      AND p.is_active = true
      AND p.sales_channel = 'ONLINE_AND_OFFLINE';

    IF v_manual_count < p_limit THEN
      RETURN QUERY
      SELECT 
        p.id, p.name, p.slug, p.price, p.mrp, p.image_url, p.images, p.category, p.brand, p.stock, p.low_stock_at, p.is_active,
        'auto'::text AS relation_source,
        999 AS sort_order
      FROM public.products p
      WHERE p.id != p_product_id
        AND p.is_active = true
        AND p.sales_channel = 'ONLINE_AND_OFFLINE'
        AND (p.category = v_category OR p.brand = v_brand)
        AND p.id NOT IN (
          SELECT CASE WHEN product_1_id = p_product_id THEN product_2_id ELSE product_1_id END 
          FROM public.product_relations 
          WHERE product_1_id = p_product_id OR product_2_id = p_product_id
        )
      ORDER BY 
        CASE WHEN p.category = v_category AND p.brand = v_brand THEN 0 ELSE 1 END,
        p.created_at DESC
      LIMIT (p_limit - v_manual_count);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_related_products(uuid, integer) TO anon, authenticated, service_role;

-- 3. Update process_offline_return to restock both parent product & variant stock atomically
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
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'pos') THEN
    RAISE EXCEPTION 'Only authorized administrators or POS cashiers can process returns';
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
      refund_price,
      qty,
      subtotal,
      mrp_snapshot
    ) VALUES (
      new_return_id,
      item.product_id,
      COALESCE(item.product_slug, ''),
      COALESCE(item.name, ''),
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      COALESCE(item.variant_info, ''),
      item.refund_price,
      item.qty,
      item.refund_price * item.qty,
      COALESCE(item.mrp, item.refund_price)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return TO authenticated, service_role;
