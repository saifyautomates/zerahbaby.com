-- ==============================================================================
-- ZÉRAH BABY & KIDS — PRODUCTION-GRADE ONLINE RETURN + OPEN BOX DELIVERY SYSTEM
-- Migration: 20260928000051_online_returns_and_open_box.sql
-- ==============================================================================

-- 1. Extend order_status enum safely
DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'open_box_inspection';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'open_box_accepted';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'open_box_rejected';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'return_in_transit';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'return_received';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'refund_processing';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add Open Box columns to orders table
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS open_box_eligible boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS open_box_status text DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS open_box_inspected_at timestamptz,
ADD COLUMN IF NOT EXISTS open_box_notes text;

-- 3. Return Number Sequence
CREATE SEQUENCE IF NOT EXISTS public.online_return_seq START WITH 1;

-- 4. Online Returns Table
CREATE TABLE IF NOT EXISTS public.online_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number text UNIQUE NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  return_status text NOT NULL DEFAULT 'REQUESTED',
  refund_status text NOT NULL DEFAULT 'PENDING',
  reason_category text NOT NULL,
  reason_label text NOT NULL,
  customer_note text DEFAULT '',
  admin_note text DEFAULT '',
  qc_summary text DEFAULT '',
  return_shipping_fee numeric NOT NULL DEFAULT 0 CHECK (return_shipping_fee >= 0),
  eligible_refund_amount numeric NOT NULL DEFAULT 0 CHECK (eligible_refund_amount >= 0),
  final_refund_amount numeric NOT NULL DEFAULT 0 CHECK (final_refund_amount >= 0),
  currency text NOT NULL DEFAULT 'INR',
  refund_calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  razorpay_refund_id text,
  razorpay_refund_status text,
  shiprocket_return_order_id bigint,
  shiprocket_return_shipment_id bigint,
  shiprocket_return_awb text,
  shiprocket_return_courier text,
  shiprocket_return_status text,
  pickup_scheduled_at timestamptz,
  received_at timestamptz,
  qc_completed_at timestamptz,
  refund_initiated_at timestamptz,
  refund_completed_at timestamptz,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id)
);

-- 5. Online Return Items Table
CREATE TABLE IF NOT EXISTS public.online_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.online_returns(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  product_slug text NOT NULL DEFAULT '',
  product_name_snapshot text NOT NULL DEFAULT '',
  sku_snapshot text NOT NULL DEFAULT '',
  image_snapshot text,
  color_snapshot text,
  size_snapshot text,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_approved integer NOT NULL DEFAULT 0 CHECK (quantity_approved >= 0),
  quantity_received integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  historical_unit_price numeric NOT NULL DEFAULT 0,
  historical_paid_amount numeric NOT NULL DEFAULT 0,
  allocated_discount numeric NOT NULL DEFAULT 0,
  item_refund_amount numeric NOT NULL DEFAULT 0,
  qc_status text NOT NULL DEFAULT 'PENDING',
  qc_note text DEFAULT '',
  inventory_restored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_id, order_item_id)
);

-- 6. Online Return Events Table (Audit Trail)
CREATE TABLE IF NOT EXISTS public.online_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.online_returns(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  note text NOT NULL DEFAULT '',
  actor_id uuid REFERENCES auth.users(id),
  actor_role text NOT NULL DEFAULT 'customer',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Open Box Delivery Events Table
CREATE TABLE IF NOT EXISTS public.open_box_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('ACCEPTED', 'REJECTED')),
  rejection_reason text,
  rejection_notes text,
  actor_id uuid REFERENCES auth.users(id),
  linked_return_id uuid REFERENCES public.online_returns(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Indexes for High-Performance Queries & Lookups
CREATE INDEX IF NOT EXISTS idx_online_returns_user ON public.online_returns(user_id);
CREATE INDEX IF NOT EXISTS idx_online_returns_order ON public.online_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_online_returns_status ON public.online_returns(return_status);
CREATE INDEX IF NOT EXISTS idx_online_returns_refund_status ON public.online_returns(refund_status);
CREATE INDEX IF NOT EXISTS idx_online_returns_created_at ON public.online_returns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_returns_awb ON public.online_returns(shiprocket_return_awb);
CREATE INDEX IF NOT EXISTS idx_online_returns_idempotency ON public.online_returns(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_online_return_items_return ON public.online_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_online_return_items_order_item ON public.online_return_items(order_item_id);
CREATE INDEX IF NOT EXISTS idx_online_return_items_product ON public.online_return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_online_return_items_variant ON public.online_return_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_online_return_events_return ON public.online_return_events(return_id);
CREATE INDEX IF NOT EXISTS idx_open_box_events_order ON public.open_box_events(order_id);

-- 9. Enable Row Level Security (RLS)
ALTER TABLE public.online_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_return_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_box_events ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT ON public.online_returns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.online_returns TO service_role;

GRANT SELECT ON public.online_return_items TO authenticated;
GRANT ALL ON public.online_return_items TO service_role;

GRANT SELECT ON public.online_return_events TO authenticated;
GRANT ALL ON public.online_return_events TO service_role;

GRANT SELECT ON public.open_box_events TO authenticated;
GRANT ALL ON public.open_box_events TO service_role;

-- Policies for online_returns
DROP POLICY IF EXISTS "users read own online returns" ON public.online_returns;
CREATE POLICY "users read own online returns" ON public.online_returns
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "users insert own online returns" ON public.online_returns;
CREATE POLICY "users insert own online returns" ON public.online_returns
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins update online returns" ON public.online_returns;
CREATE POLICY "admins update online returns" ON public.online_returns
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Policies for online_return_items
DROP POLICY IF EXISTS "users read own online return items" ON public.online_return_items;
CREATE POLICY "users read own online return items" ON public.online_return_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.online_returns r
      WHERE r.id = online_return_items.return_id
        AND (r.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Policies for online_return_events
DROP POLICY IF EXISTS "users read own online return events" ON public.online_return_events;
CREATE POLICY "users read own online return events" ON public.online_return_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.online_returns r
      WHERE r.id = online_return_events.return_id
        AND (r.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Policies for open_box_events
DROP POLICY IF EXISTS "users read own open box events" ON public.open_box_events;
CREATE POLICY "users read own open box events" ON public.open_box_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = open_box_events.order_id
        AND (o.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- 10. Default Site Settings for Online Returns & Open Box
INSERT INTO public.site_settings (key, value)
VALUES 
  ('online_return_window_days', '7'::jsonb),
  ('online_return_shipping_fee', '{"amount": 70, "currency": "INR", "is_enabled": true}'::jsonb),
  ('open_box_delivery_policy', '{"enabled": true, "eligible_threshold": 0, "description": "Inspect upon delivery before OTP/acceptance"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 11. CANONICAL RPCs

-- A. Helper: Generate Online Return Number
CREATE OR REPLACE FUNCTION public.generate_online_return_number()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq bigint;
  v_date text;
BEGIN
  v_seq := nextval('public.online_return_seq');
  v_date := to_char(now(), 'YYMM');
  RETURN 'ORET-' || v_date || '-' || lpad(v_seq::text, 5, '0');
END;
$$;

-- B. RPC: calculate_online_return_refund
CREATE OR REPLACE FUNCTION public.calculate_online_return_refund(
  _order_id uuid,
  _items jsonb,
  _reason_category text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order record;
  v_item record;
  v_order_item record;
  v_already_returned integer;
  v_item_refund numeric := 0;
  v_total_item_refund numeric := 0;
  v_return_shipping_fee numeric := 70;
  v_fee_setting jsonb;
  v_final_refund numeric := 0;
  v_items_breakdown jsonb := '[]'::jsonb;
  v_discount_ratio numeric := 0;
  v_item_discount numeric := 0;
  v_net_item_price numeric := 0;
  v_max_qty integer := 0;
  v_window_days integer := 7;
  v_delivery_time timestamptz;
  v_is_eligible boolean := true;
  v_ineligible_reason text := NULL;
BEGIN
  -- 1. Fetch order
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  -- 2. Validate return window
  SELECT COALESCE(NULLIF(value::text, '')::integer, 7) INTO v_window_days
  FROM public.site_settings WHERE key = 'online_return_window_days';

  v_delivery_time := COALESCE(v_order.updated_at, v_order.created_at);
  IF v_order.status != 'delivered' AND v_order.status != 'open_box_inspection' AND v_order.status != 'open_box_rejected' THEN
    v_is_eligible := false;
    v_ineligible_reason := 'Only delivered orders are eligible for return.';
  ELSIF (now() - v_delivery_time) > (v_window_days || ' days')::interval THEN
    v_is_eligible := false;
    v_ineligible_reason := 'Return window of ' || v_window_days || ' days has expired.';
  END IF;

  -- 3. Compute discount ratio if original order had coupons/discounts
  IF v_order.subtotal > 0 AND v_order.discount > 0 THEN
    v_discount_ratio := v_order.discount / v_order.subtotal;
  ELSE
    v_discount_ratio := 0;
  END IF;

  -- 4. Calculate return shipping fee
  SELECT value INTO v_fee_setting FROM public.site_settings WHERE key = 'online_return_shipping_fee';
  IF v_fee_setting IS NOT NULL AND (v_fee_setting->>'is_enabled')::boolean = true THEN
    v_return_shipping_fee := COALESCE((v_fee_setting->>'amount')::numeric, 70);
  ELSE
    v_return_shipping_fee := 0;
  END IF;

  -- If reason is defect, wrong item, damaged, or open box rejection, return fee is waived (0)
  IF _reason_category IN ('DEFECTIVE', 'WRONG_ITEM', 'DAMAGED_IN_TRANSIT', 'OPEN_BOX_REJECTED') THEN
    v_return_shipping_fee := 0;
  END IF;

  -- 5. Process each item in items array
  FOR v_item IN SELECT * FROM jsonb_to_recordset(_items) AS x(order_item_id uuid, qty int) LOOP
    SELECT * INTO v_order_item FROM public.order_items WHERE id = v_item.order_item_id AND order_id = _order_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid order item: ' || v_item.order_item_id);
    END IF;

    -- Calculate already returned or requested quantity
    SELECT COALESCE(SUM(ori.quantity_requested), 0) INTO v_already_returned
    FROM public.online_return_items ori
    JOIN public.online_returns r ON r.id = ori.return_id
    WHERE ori.order_item_id = v_item.order_item_id
      AND r.return_status NOT IN ('CANCELLED', 'QC_REJECTED');

    v_max_qty := GREATEST(0, v_order_item.qty - v_already_returned);

    IF v_item.qty <= 0 OR v_item.qty > v_max_qty THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Quantity requested (' || v_item.qty || ') exceeds returnable quantity (' || v_max_qty || ') for ' || v_order_item.name
      );
    END IF;

    -- Prorate discount if applicable to derive canonical refund per item
    v_item_discount := round((v_order_item.price * v_item.qty * v_discount_ratio), 2);
    v_net_item_price := (v_order_item.price * v_item.qty) - v_item_discount;
    v_total_item_refund := v_total_item_refund + v_net_item_price;

    v_items_breakdown := v_items_breakdown || jsonb_build_object(
      'order_item_id', v_order_item.id,
      'product_id', v_order_item.product_id,
      'variant_id', v_order_item.variant_id,
      'product_name', COALESCE(v_order_item.product_name_snapshot, v_order_item.name),
      'sku', COALESCE(v_order_item.sku_snapshot, ''),
      'color', v_order_item.color,
      'size', v_order_item.size,
      'image_url', COALESCE(v_order_item.image_url_snapshot, v_order_item.image_url),
      'original_unit_price', v_order_item.price,
      'qty_requested', v_item.qty,
      'max_returnable_qty', v_max_qty,
      'allocated_discount', v_item_discount,
      'item_refund_amount', v_net_item_price
    );
  END LOOP;

  v_final_refund := GREATEST(0, v_total_item_refund - v_return_shipping_fee);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'is_eligible', v_is_eligible,
    'ineligible_reason', v_ineligible_reason,
    'eligible_refund_amount', v_total_item_refund,
    'return_shipping_fee', v_return_shipping_fee,
    'final_refund_amount', v_final_refund,
    'currency', 'INR',
    'items', v_items_breakdown
  );
END;
$$;

-- C. RPC: request_online_return
CREATE OR REPLACE FUNCTION public.request_online_return(
  _order_id uuid,
  _items jsonb,
  _reason_category text,
  _reason_label text,
  _customer_note text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_order record;
  v_calc jsonb;
  v_return_id uuid;
  v_return_number text;
  v_existing_return record;
  v_item record;
  v_calc_item jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to initiate return';
  END IF;

  -- 1. Idempotency Check
  IF _idempotency_key IS NOT NULL AND trim(_idempotency_key) != '' THEN
    SELECT * INTO v_existing_return
    FROM public.online_returns
    WHERE idempotency_key = trim(_idempotency_key);

    IF v_existing_return.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'return_id', v_existing_return.id,
        'return_number', v_existing_return.return_number,
        'status', v_existing_return.return_status,
        'final_refund_amount', v_existing_return.final_refund_amount,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 2. Lock Order row FOR UPDATE
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify ownership (unless admin)
  IF v_order.user_id != v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: You can only return orders placed by your account';
  END IF;

  -- 3. Calculate refund and validate constraints
  v_calc := public.calculate_online_return_refund(_order_id, _items, _reason_category);

  IF (v_calc->>'success')::boolean != true THEN
    RAISE EXCEPTION '%', (v_calc->>'error');
  END IF;

  IF (v_calc->>'is_eligible')::boolean != true THEN
    RAISE EXCEPTION '%', COALESCE(v_calc->>'ineligible_reason', 'Order is not eligible for return');
  END IF;

  -- 4. Create online_returns record
  v_return_id := gen_random_uuid();
  v_return_number := public.generate_online_return_number();

  INSERT INTO public.online_returns (
    id,
    return_number,
    order_id,
    user_id,
    return_status,
    refund_status,
    reason_category,
    reason_label,
    customer_note,
    return_shipping_fee,
    eligible_refund_amount,
    final_refund_amount,
    currency,
    refund_calculation_snapshot,
    idempotency_key,
    created_by
  ) VALUES (
    v_return_id,
    v_return_number,
    _order_id,
    v_order.user_id,
    'REQUESTED',
    'PENDING',
    _reason_category,
    _reason_label,
    _customer_note,
    (v_calc->>'return_shipping_fee')::numeric,
    (v_calc->>'eligible_refund_amount')::numeric,
    (v_calc->>'final_refund_amount')::numeric,
    'INR',
    v_calc,
    NULLIF(trim(_idempotency_key), ''),
    v_uid
  );

  -- 5. Insert line items
  FOR v_calc_item IN SELECT * FROM jsonb_array_elements(v_calc->'items') LOOP
    INSERT INTO public.online_return_items (
      return_id,
      order_item_id,
      product_id,
      variant_id,
      product_name_snapshot,
      sku_snapshot,
      color_snapshot,
      size_snapshot,
      image_snapshot,
      quantity_requested,
      historical_unit_price,
      historical_paid_amount,
      allocated_discount,
      item_refund_amount,
      qc_status
    ) VALUES (
      v_return_id,
      (v_calc_item->>'order_item_id')::uuid,
      (v_calc_item->>'product_id')::uuid,
      (v_calc_item->>'variant_id')::uuid,
      v_calc_item->>'product_name',
      v_calc_item->>'sku',
      v_calc_item->>'color',
      v_calc_item->>'size',
      v_calc_item->>'image_url',
      (v_calc_item->>'qty_requested')::integer,
      (v_calc_item->>'original_unit_price')::numeric,
      (v_calc_item->>'original_unit_price')::numeric * (v_calc_item->>'qty_requested')::integer,
      (v_calc_item->>'allocated_discount')::numeric,
      (v_calc_item->>'item_refund_amount')::numeric,
      'PENDING'
    );
  END LOOP;

  -- 6. Insert audit event
  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    v_return_id,
    'RETURN_REQUESTED',
    NULL,
    'REQUESTED',
    'Customer requested online return: ' || _reason_label,
    v_uid,
    CASE WHEN public.has_role(v_uid, 'admin') THEN 'admin' ELSE 'customer' END,
    jsonb_build_object('reason', _reason_category, 'refund_amount', v_calc->>'final_refund_amount')
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'status', 'REQUESTED',
    'eligible_refund_amount', v_calc->>'eligible_refund_amount',
    'return_shipping_fee', v_calc->>'return_shipping_fee',
    'final_refund_amount', v_calc->>'final_refund_amount',
    'duplicate', false
  );
END;
$$;

-- D. RPC: admin_update_online_return_status
CREATE OR REPLACE FUNCTION public.admin_update_online_return_status(
  _return_id uuid,
  _new_status text,
  _admin_note text DEFAULT '',
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_old_status text;
BEGIN
  v_uid := auth.uid();
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can update return statuses';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  v_old_status := v_return.return_status;

  UPDATE public.online_returns
  SET return_status = _new_status,
      admin_note = CASE WHEN _admin_note != '' THEN _admin_note ELSE admin_note END,
      received_at = CASE WHEN _new_status = 'RECEIVED' AND received_at IS NULL THEN now() ELSE received_at END,
      pickup_scheduled_at = CASE WHEN _new_status = 'PICKUP_SCHEDULED' AND pickup_scheduled_at IS NULL THEN now() ELSE pickup_scheduled_at END,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = _return_id;

  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    _return_id,
    'STATUS_UPDATE',
    v_old_status,
    _new_status,
    _admin_note,
    v_uid,
    'admin',
    _metadata
  );

  RETURN jsonb_build_object('success', true, 'return_id', _return_id, 'old_status', v_old_status, 'new_status', _new_status);
END;
$$;

-- E. RPC: admin_process_return_qc (Atomic Inspection & Idempotent Stock Restoration)
CREATE OR REPLACE FUNCTION public.admin_process_return_qc(
  _return_id uuid,
  _items_qc jsonb,
  _qc_summary text DEFAULT '',
  _restock_approved boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_qc_item record;
  v_ret_item record;
  v_any_approved boolean := false;
  v_all_rejected boolean := true;
  v_new_return_status text;
  v_new_refund_status text;
  v_variant record;
  v_prod record;
BEGIN
  v_uid := auth.uid();
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can process return QC';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  -- Loop through each item's QC assessment
  FOR v_qc_item IN SELECT * FROM jsonb_to_recordset(_items_qc) AS x(
    order_item_id uuid,
    passed boolean,
    qty_accepted int,
    qc_note text
  ) LOOP
    SELECT * INTO v_ret_item
    FROM public.online_return_items
    WHERE return_id = _return_id AND order_item_id = v_qc_item.order_item_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_qc_item.passed AND v_qc_item.qty_accepted > 0 THEN
        v_any_approved := true;
        v_all_rejected := false;

        UPDATE public.online_return_items
        SET qc_status = 'APPROVED',
            quantity_approved = v_qc_item.qty_accepted,
            quantity_received = v_qc_item.qty_accepted,
            qc_note = COALESCE(v_qc_item.qc_note, ''),
            updated_at = now()
        WHERE id = v_ret_item.id;

        -- Idempotently restore inventory if requested and not yet restored
        IF _restock_approved AND NOT v_ret_item.inventory_restored THEN
          IF v_ret_item.variant_id IS NOT NULL THEN
            SELECT * INTO v_variant FROM public.product_variants WHERE id = v_ret_item.variant_id FOR UPDATE;
            IF FOUND THEN
              UPDATE public.product_variants
              SET stock = stock + v_qc_item.qty_accepted
              WHERE id = v_ret_item.variant_id;
            END IF;
          END IF;

          IF v_ret_item.product_id IS NOT NULL THEN
            SELECT * INTO v_prod FROM public.products WHERE id = v_ret_item.product_id FOR UPDATE;
            IF FOUND THEN
              UPDATE public.products
              SET stock = stock + v_qc_item.qty_accepted
              WHERE id = v_ret_item.product_id;
            END IF;

            -- Record authoritative inventory transaction
            INSERT INTO public.inventory_transactions (
              product_id,
              variant_id,
              type,
              quantity,
              reference_type,
              reference_id,
              note,
              created_by
            ) VALUES (
              v_ret_item.product_id,
              v_ret_item.variant_id,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              'online_return',
              _return_id,
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              v_uid
            );
          END IF;

          UPDATE public.online_return_items
          SET inventory_restored = true
          WHERE id = v_ret_item.id;
        END IF;

      ELSE
        UPDATE public.online_return_items
        SET qc_status = 'REJECTED',
            quantity_approved = 0,
            quantity_received = COALESCE(v_qc_item.qty_accepted, 0),
            qc_note = COALESCE(v_qc_item.qc_note, 'Failed inspection'),
            updated_at = now()
        WHERE id = v_ret_item.id;
      END IF;
    END IF;
  END LOOP;

  IF v_any_approved THEN
    v_new_return_status := 'QC_APPROVED';
    v_new_refund_status := 'PENDING';
  ELSE
    v_new_return_status := 'QC_REJECTED';
    v_new_refund_status := 'NOT_APPLICABLE';
  END IF;

  UPDATE public.online_returns
  SET return_status = v_new_return_status,
      refund_status = v_new_refund_status,
      qc_summary = _qc_summary,
      qc_completed_at = now(),
      updated_at = now(),
      updated_by = v_uid
  WHERE id = _return_id;

  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    _return_id,
    'QC_COMPLETED',
    v_return.return_status,
    v_new_return_status,
    'Quality check completed: ' || _qc_summary,
    v_uid,
    'admin',
    jsonb_build_object('refund_status', v_new_refund_status, 'restocked', _restock_approved)
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_status', v_new_return_status,
    'refund_status', v_new_refund_status
  );
END;
$$;

-- F. RPC: admin_record_online_refund
CREATE OR REPLACE FUNCTION public.admin_record_online_refund(
  _return_id uuid,
  _refund_amount numeric,
  _refund_method text DEFAULT 'razorpay',
  _gateway_refund_id text DEFAULT NULL,
  _notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
BEGIN
  v_uid := auth.uid();
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only store admins can record refunds';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  UPDATE public.online_returns
  SET refund_status = 'PROCESSED',
      return_status = 'COMPLETED',
      final_refund_amount = _refund_amount,
      razorpay_refund_id = COALESCE(_gateway_refund_id, razorpay_refund_id),
      razorpay_refund_status = 'PROCESSED',
      refund_completed_at = now(),
      admin_note = CASE WHEN _notes != '' THEN admin_note || ' | ' || _notes ELSE admin_note END,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = _return_id;

  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    _return_id,
    'REFUND_PROCESSED',
    v_return.refund_status,
    'PROCESSED',
    'Refund completed: ₹' || _refund_amount || ' via ' || _refund_method,
    v_uid,
    'admin',
    jsonb_build_object('refund_id', _gateway_refund_id, 'amount', _refund_amount, 'method', _refund_method)
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_status', 'COMPLETED',
    'refund_status', 'PROCESSED'
  );
END;
$$;

-- G. RPC: process_open_box_delivery
CREATE OR REPLACE FUNCTION public.process_open_box_delivery(
  _order_id uuid,
  _decision text,
  _rejection_reason text DEFAULT '',
  _rejection_notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_order record;
  v_linked_return_id uuid := NULL;
  v_existing_event record;
  v_item record;
  v_calc jsonb;
  v_items_json jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();

  IF _decision NOT IN ('ACCEPTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid decision: Must be ACCEPTED or REJECTED';
  END IF;

  -- 1. Idempotency Check
  SELECT * INTO v_existing_event
  FROM public.open_box_events
  WHERE order_id = _order_id;

  IF v_existing_event.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', _order_id,
      'decision', v_existing_event.decision,
      'duplicate', true
    );
  END IF;

  -- 2. Lock Order
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ownership / admin check
  IF v_uid IS NOT NULL AND v_order.user_id != v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _decision = 'ACCEPTED' THEN
    UPDATE public.orders
    SET open_box_status = 'ACCEPTED',
        open_box_inspected_at = now(),
        open_box_notes = _rejection_notes,
        status = 'delivered'::public.order_status,
        updated_at = now()
    WHERE id = _order_id;

    INSERT INTO public.open_box_events (
      order_id,
      decision,
      actor_id,
      metadata
    ) VALUES (
      _order_id,
      'ACCEPTED',
      v_uid,
      jsonb_build_object('timestamp', now())
    );

    INSERT INTO public.order_status_history (
      order_id,
      old_status,
      new_status,
      note,
      changed_by
    ) VALUES (
      _order_id,
      v_order.status,
      'delivered',
      'Open Box Delivery Accepted by Customer after verification',
      v_uid
    );

  ELSIF _decision = 'REJECTED' THEN
    UPDATE public.orders
    SET open_box_status = 'REJECTED',
        open_box_inspected_at = now(),
        open_box_notes = _rejection_reason || ': ' || _rejection_notes,
        status = 'open_box_rejected'::public.order_status,
        updated_at = now()
    WHERE id = _order_id;

    -- Build all items for return
    FOR v_item IN SELECT id, qty FROM public.order_items WHERE order_id = _order_id LOOP
      v_items_json := v_items_json || jsonb_build_object('order_item_id', v_item.id, 'qty', v_item.qty);
    END LOOP;

    -- Create linked online return record automatically with fee waived
    SELECT (res->>'return_id')::uuid INTO v_linked_return_id
    FROM (
      SELECT public.request_online_return(
        _order_id,
        v_items_json,
        'OPEN_BOX_REJECTED',
        'Open Box Rejection: ' || _rejection_reason,
        _rejection_notes,
        _idempotency_key
      ) AS res
    ) t;

    -- Transition directly to RECEIVED / QC_PENDING since courier brings it straight back
    IF v_linked_return_id IS NOT NULL THEN
      UPDATE public.online_returns
      SET return_status = 'RECEIVED',
          received_at = now()
      WHERE id = v_linked_return_id;
    END IF;

    INSERT INTO public.open_box_events (
      order_id,
      decision,
      rejection_reason,
      rejection_notes,
      actor_id,
      linked_return_id,
      metadata
    ) VALUES (
      _order_id,
      'REJECTED',
      _rejection_reason,
      _rejection_notes,
      v_uid,
      v_linked_return_id,
      jsonb_build_object('return_id', v_linked_return_id, 'reason', _rejection_reason)
    );

    INSERT INTO public.order_status_history (
      order_id,
      old_status,
      new_status,
      note,
      changed_by
    ) VALUES (
      _order_id,
      v_order.status,
      'open_box_rejected',
      'Open Box Delivery Rejected: ' || _rejection_reason,
      v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'decision', _decision,
    'linked_return_id', v_linked_return_id
  );
END;
$$;

-- 12. Execute Permissions on RPCs
GRANT EXECUTE ON FUNCTION public.generate_online_return_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_online_return_refund(uuid, jsonb, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_online_return(uuid, jsonb, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_online_return_status(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_process_return_qc(uuid, jsonb, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_online_refund(uuid, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_open_box_delivery(uuid, text, text, text, text) TO authenticated, service_role;

-- 13. Enable Realtime on online_returns and open_box_events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'online_returns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.online_returns;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'online_return_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.online_return_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'online_return_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.online_return_events;
  END IF;
END $$;
