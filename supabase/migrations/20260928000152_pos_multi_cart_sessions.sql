-- Migration: 20260928000152_pos_multi_cart_sessions.sql
-- Description: Multi-Customer POS / Multi-Cart active session persistence in Supabase
-- Author: Zérah Baby & Kids Engineering

-- 1. Create table for POS Cart Sessions
CREATE TABLE IF NOT EXISTS public.pos_cart_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number text NOT NULL UNIQUE,
  cashier_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL,
  customer_mode text NOT NULL DEFAULT 'walkin',
  customer_name text NOT NULL DEFAULT 'Walk-in Customer',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft', -- 'draft', 'held', 'payment_pending', 'completed', 'cancelled'
  discount_type text NOT NULL DEFAULT 'none', -- 'none', 'percentage', 'fixed'
  discount_value numeric NOT NULL DEFAULT 0,
  applied_coupon jsonb DEFAULT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  notes text NOT NULL DEFAULT '',
  store_credit_applied numeric NOT NULL DEFAULT 0,
  credit_token_input text NOT NULL DEFAULT '',
  subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  offline_sale_id uuid REFERENCES public.offline_sales(id) ON DELETE SET NULL,
  held_at timestamptz DEFAULT NULL,
  completed_at timestamptz DEFAULT NULL,
  cancelled_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create table for POS Session Line Items
CREATE TABLE IF NOT EXISTS public.pos_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.pos_cart_sessions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_slug text NOT NULL DEFAULT '',
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  image_url text DEFAULT NULL,
  price numeric NOT NULL DEFAULT 0,
  mrp numeric NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Indexes for high performance lookup
CREATE INDEX IF NOT EXISTS idx_pos_cart_sessions_status ON public.pos_cart_sessions(status);
CREATE INDEX IF NOT EXISTS idx_pos_cart_sessions_cashier ON public.pos_cart_sessions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_cart_sessions_created ON public.pos_cart_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_pos_session_items_session ON public.pos_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_pos_session_items_product ON public.pos_session_items(product_id);

-- 4. Enable RLS
ALTER TABLE public.pos_cart_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_session_items ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_cart_sessions TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_session_items TO authenticated, anon;
GRANT ALL ON public.pos_cart_sessions TO service_role;
GRANT ALL ON public.pos_session_items TO service_role;

-- RLS Policies
DROP POLICY IF EXISTS "pos_sessions_authorized_access" ON public.pos_cart_sessions;
CREATE POLICY "pos_sessions_authorized_access" ON public.pos_cart_sessions
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'pos_user')
    OR public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
    OR auth.role() = 'authenticated'
    OR auth.role() = 'anon' -- Allows local POS terminals during store hours
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'pos_user')
    OR public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
    OR auth.role() = 'authenticated'
    OR auth.role() = 'anon'
  );

DROP POLICY IF EXISTS "pos_session_items_authorized_access" ON public.pos_session_items;
CREATE POLICY "pos_session_items_authorized_access" ON public.pos_session_items
  FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'pos_user')
    OR public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
    OR auth.role() = 'authenticated'
    OR auth.role() = 'anon'
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'pos_user')
    OR public.has_role(auth.uid(), 'staff')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'owner')
    OR auth.role() = 'authenticated'
    OR auth.role() = 'anon'
  );

-- 5. Canonical RPC to save entire POS session and its items atomically
CREATE OR REPLACE FUNCTION public.save_pos_session_full(
  p_session jsonb,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session_id uuid;
  v_session_number text;
  v_item jsonb;
  v_result jsonb;
BEGIN
  -- Extract or generate ID
  IF (p_session->>'id') IS NOT NULL AND (p_session->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_session_id := (p_session->>'id')::uuid;
  ELSE
    v_session_id := gen_random_uuid();
  END IF;

  v_session_number := COALESCE(p_session->>'session_number', 'POS-' || upper(substr(md5(random()::text), 1, 6)));

  -- Upsert session
  INSERT INTO public.pos_cart_sessions (
    id,
    session_number,
    cashier_id,
    customer_id,
    customer_mode,
    customer_name,
    customer_phone,
    customer_email,
    status,
    discount_type,
    discount_value,
    applied_coupon,
    payment_method,
    notes,
    store_credit_applied,
    credit_token_input,
    subtotal,
    discount_total,
    total,
    held_at,
    completed_at,
    cancelled_at,
    updated_at
  ) VALUES (
    v_session_id,
    v_session_number,
    CASE WHEN (p_session->>'cashier_id') IS NOT NULL AND (p_session->>'cashier_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_session->>'cashier_id')::uuid ELSE auth.uid() END,
    CASE WHEN (p_session->>'customer_id') IS NOT NULL AND (p_session->>'customer_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_session->>'customer_id')::uuid ELSE NULL END,
    COALESCE(p_session->>'customer_mode', 'walkin'),
    COALESCE(p_session->>'customer_name', 'Walk-in Customer'),
    COALESCE(p_session->>'customer_phone', ''),
    COALESCE(p_session->>'customer_email', ''),
    COALESCE(p_session->>'status', 'draft'),
    COALESCE(p_session->>'discount_type', 'none'),
    COALESCE((p_session->>'discount_value')::numeric, 0),
    p_session->'applied_coupon',
    COALESCE(p_session->>'payment_method', 'cash'),
    COALESCE(p_session->>'notes', ''),
    COALESCE((p_session->>'store_credit_applied')::numeric, 0),
    COALESCE(p_session->>'credit_token_input', ''),
    COALESCE((p_session->>'subtotal')::numeric, 0),
    COALESCE((p_session->>'discount_total')::numeric, 0),
    COALESCE((p_session->>'total')::numeric, 0),
    CASE WHEN (p_session->>'status') = 'held' THEN now() ELSE NULL END,
    CASE WHEN (p_session->>'status') = 'completed' THEN now() ELSE NULL END,
    CASE WHEN (p_session->>'status') = 'cancelled' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    customer_mode = EXCLUDED.customer_mode,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    customer_email = EXCLUDED.customer_email,
    status = EXCLUDED.status,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    applied_coupon = EXCLUDED.applied_coupon,
    payment_method = EXCLUDED.payment_method,
    notes = EXCLUDED.notes,
    store_credit_applied = EXCLUDED.store_credit_applied,
    credit_token_input = EXCLUDED.credit_token_input,
    subtotal = EXCLUDED.subtotal,
    discount_total = EXCLUDED.discount_total,
    total = EXCLUDED.total,
    held_at = CASE WHEN EXCLUDED.status = 'held' AND pos_cart_sessions.held_at IS NULL THEN now() ELSE pos_cart_sessions.held_at END,
    completed_at = CASE WHEN EXCLUDED.status = 'completed' AND pos_cart_sessions.completed_at IS NULL THEN now() ELSE pos_cart_sessions.completed_at END,
    cancelled_at = CASE WHEN EXCLUDED.status = 'cancelled' AND pos_cart_sessions.cancelled_at IS NULL THEN now() ELSE pos_cart_sessions.cancelled_at END,
    updated_at = now();

  -- Replace session items
  DELETE FROM public.pos_session_items WHERE session_id = v_session_id;

  IF jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.pos_session_items (
        session_id,
        product_id,
        variant_id,
        product_slug,
        name,
        sku,
        barcode,
        brand,
        category,
        image_url,
        price,
        mrp,
        stock,
        qty,
        subtotal,
        is_custom
      ) VALUES (
        v_session_id,
        CASE WHEN (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_item->>'product_id')::uuid ELSE NULL END,
        CASE WHEN (v_item->>'variant_id') IS NOT NULL AND (v_item->>'variant_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_item->>'variant_id')::uuid ELSE NULL END,
        COALESCE(v_item->>'slug', v_item->>'product_slug', ''),
        COALESCE(v_item->>'name', 'Item'),
        COALESCE(v_item->>'sku', ''),
        COALESCE(v_item->>'barcode', ''),
        COALESCE(v_item->>'brand', ''),
        COALESCE(v_item->>'category', ''),
        v_item->>'image_url',
        COALESCE((v_item->>'price')::numeric, 0),
        COALESCE((v_item->>'mrp')::numeric, 0),
        COALESCE((v_item->>'stock')::int, 0),
        GREATEST(1, COALESCE((v_item->>'qty')::int, 1)),
        COALESCE((v_item->>'subtotal')::numeric, (COALESCE((v_item->>'price')::numeric, 0) * GREATEST(1, COALESCE((v_item->>'qty')::int, 1)))),
        COALESCE((v_item->>'isCustom')::boolean, (v_item->>'is_custom')::boolean, false)
      );
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'session_number', s.session_number,
    'status', s.status,
    'customer_name', s.customer_name,
    'total', s.total,
    'updated_at', s.updated_at
  ) INTO v_result
  FROM public.pos_cart_sessions s
  WHERE s.id = v_session_id;

  RETURN v_result;
END;
$$;

-- 6. Canonical RPC to fetch all active sessions with their nested items
CREATE OR REPLACE FUNCTION public.get_active_pos_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'session_number', s.session_number,
        'cashier_id', s.cashier_id,
        'customer_id', s.customer_id,
        'customer_mode', s.customer_mode,
        'customer_name', s.customer_name,
        'customer_phone', s.customer_phone,
        'customer_email', s.customer_email,
        'status', s.status,
        'discount_type', s.discount_type,
        'discount_value', s.discount_value,
        'applied_coupon', s.applied_coupon,
        'payment_method', s.payment_method,
        'notes', s.notes,
        'store_credit_applied', s.store_credit_applied,
        'credit_token_input', s.credit_token_input,
        'subtotal', s.subtotal,
        'discount_total', s.discount_total,
        'total', s.total,
        'held_at', s.held_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at,
        'items', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'product_id', i.product_id,
                'variant_id', i.variant_id,
                'slug', i.product_slug,
                'name', i.name,
                'sku', i.sku,
                'barcode', i.barcode,
                'brand', i.brand,
                'category', i.category,
                'image_url', i.image_url,
                'price', i.price,
                'mrp', i.mrp,
                'stock', i.stock,
                'qty', i.qty,
                'subtotal', i.subtotal,
                'isCustom', i.is_custom
              ) ORDER BY i.created_at ASC
            )
            FROM public.pos_session_items i
            WHERE i.session_id = s.id
          ),
          '[]'::jsonb
        )
      ) ORDER BY s.created_at ASC
    ),
    '[]'::jsonb
  ) INTO v_sessions
  FROM public.pos_cart_sessions s
  WHERE s.status IN ('draft', 'held', 'payment_pending');

  RETURN v_sessions;
END;
$$;

-- 7. Canonical RPC to close or cancel an active session
CREATE OR REPLACE FUNCTION public.close_pos_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.pos_cart_sessions
  SET status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_session_id;
END;
$$;

-- Grant RPC executions
GRANT EXECUTE ON FUNCTION public.save_pos_session_full(jsonb, jsonb) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_pos_sessions() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_pos_session(uuid) TO authenticated, anon, service_role;
