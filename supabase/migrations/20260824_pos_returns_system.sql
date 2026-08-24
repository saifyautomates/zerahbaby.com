-- ============================================================
-- ZERAH BABY & KIDS — OFFLINE POS RETURNS SYSTEM MIGRATION
-- Production-grade schema & atomic RPC function
-- ============================================================

-- 1. Sequential sequence for POS return numbers (RET-YYMM-NNNNN)
CREATE SEQUENCE IF NOT EXISTS public.pos_return_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_pos_return_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  seq_val bigint;
  prefix text;
BEGIN
  seq_val := nextval('public.pos_return_seq');
  prefix := 'RET-' || to_char(now(), 'YYMM') || '-';
  RETURN prefix || lpad(seq_val::text, 5, '0');
END; $$;

-- 2. OFFLINE RETURNS TABLE
CREATE TABLE IF NOT EXISTS public.offline_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text UNIQUE NOT NULL,
  customer_name text NOT NULL DEFAULT 'Walk-in Customer',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL,
  refund_amount numeric NOT NULL DEFAULT 0,
  refund_method text NOT NULL DEFAULT 'cash',
  refund_status text NOT NULL DEFAULT 'completed',
  return_reason text NOT NULL DEFAULT 'Customer changed mind',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed',
  created_by uuid REFERENCES auth.users(id),
  owner_notification_status text DEFAULT 'pending',
  owner_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_returns_created_at ON public.offline_returns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_returns_customer_id ON public.offline_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_offline_returns_return_number ON public.offline_returns(return_number);

GRANT SELECT, INSERT, UPDATE ON public.offline_returns TO authenticated;
GRANT ALL ON public.offline_returns TO service_role;
ALTER TABLE public.offline_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage offline returns" ON public.offline_returns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER offline_returns_touch
  BEFORE UPDATE ON public.offline_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. OFFLINE RETURN ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.offline_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.offline_returns(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  variant_info text NOT NULL DEFAULT '',
  refund_price numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  mrp_snapshot numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_return_items_return ON public.offline_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_offline_return_items_product ON public.offline_return_items(product_id);

GRANT SELECT, INSERT, UPDATE ON public.offline_return_items TO authenticated;
GRANT ALL ON public.offline_return_items TO service_role;
ALTER TABLE public.offline_return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage offline return items" ON public.offline_return_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. ATOMIC RPC: PROCESS OFFLINE RETURN
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
  new_return_id uuid;
  new_return_number text;
  item_count int := 0;
BEGIN
  -- 1. Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Only authorized administrators can process returns';
  END IF;

  -- 2. Idempotency check (prevent double restocking on accidental double submit)
  IF _idempotency_key IS NOT NULL AND _idempotency_key != '' THEN
    SELECT id, return_number, refund_amount INTO new_return_id, new_return_number, computed_total_refund
    FROM public.offline_returns
    WHERE notes LIKE '%[idem:' || _idempotency_key || ']%'
    AND created_by = uid
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
    -- If product is in DB, lock row, update stock, and log inventory transaction
    IF item.product_id IS NOT NULL THEN
      SELECT id, slug, stock, name, sku, barcode, is_active
      INTO prod
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF prod.id IS NOT NULL THEN
        -- Atomic stock increment
        UPDATE public.products
        SET stock = stock + item.qty
        WHERE id = prod.id;

        -- Record inventory transaction
        INSERT INTO public.inventory_transactions (
          product_id,
          type,
          quantity,
          reference_type,
          reference_id,
          note,
          created_by
        ) VALUES (
          prod.id,
          'return'::public.inventory_tx_type,
          item.qty,
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
      COALESCE(item.name, 'Product'),
      COALESCE(item.sku, ''),
      COALESCE(item.barcode, ''),
      COALESCE(item.variant_info, ''),
      item.refund_price,
      item.qty,
      (item.refund_price * item.qty),
      COALESCE(item.mrp, item.refund_price)
    );
  END LOOP;

  -- 8. Return success payload
  RETURN jsonb_build_object(
    'return_id', new_return_id,
    'return_number', new_return_number,
    'refund_amount', computed_total_refund,
    'refund_method', _refund_method,
    'customer_name', COALESCE(NULLIF(trim(_customer_name), ''), 'Walk-in Customer'),
    'items_count', item_count,
    'duplicate', false
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.process_offline_return FROM anon;
GRANT EXECUTE ON FUNCTION public.process_offline_return TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_offline_return TO service_role;
