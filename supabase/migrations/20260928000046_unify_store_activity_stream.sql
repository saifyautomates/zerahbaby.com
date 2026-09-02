-- Migration: 20260928000046_unify_store_activity_stream.sql
-- Fix analytics_events permissions and provide unified store activity stream for Admin Dashboard

-- 1. Table Grants & RLS Policies for analytics_events
GRANT ALL ON public.analytics_events TO anon, authenticated, service_role;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anonymous inserts for analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "anyone can log events" ON public.analytics_events;
DROP POLICY IF EXISTS "own analytics insert" ON public.analytics_events;
DROP POLICY IF EXISTS "admins read analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "admins read events" ON public.analytics_events;
DROP POLICY IF EXISTS "public read analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "public insert analytics" ON public.analytics_events;

CREATE POLICY "public insert analytics"
  ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "public read analytics"
  ON public.analytics_events
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2. Secure RPC to record store activity (bypasses any client auth / JWT quirks)
CREATE OR REPLACE FUNCTION public.record_store_activity(
  _event_name text,
  _product_id uuid DEFAULT NULL,
  _order_id uuid DEFAULT NULL,
  _session_id text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user_id uuid;
BEGIN
  BEGIN
    v_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  INSERT INTO public.analytics_events (
    user_id,
    session_id,
    event_name,
    product_id,
    order_id,
    metadata,
    created_at
  )
  VALUES (
    v_user_id,
    COALESCE(_session_id, 'anon_session_' || substr(gen_random_uuid()::text, 1, 8)),
    _event_name,
    _product_id,
    _order_id,
    COALESCE(_metadata, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_store_activity(text, uuid, uuid, text, jsonb) TO anon, authenticated, service_role;

-- 3. Unified Store Activities RPC
-- Aggregates analytics_events, orders, offline_sales, and offline_returns into a single coherent feed
CREATE OR REPLACE FUNCTION public.get_unified_store_activities(_limit int DEFAULT 100)
RETURNS TABLE (
  id text,
  source text,
  event_type text,
  title text,
  subtitle text,
  product_name text,
  product_slug text,
  product_image text,
  customer_name text,
  amount numeric,
  created_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH combined AS (
    -- 1. Analytics Events (Browsing, Cart, Wishlist, Quick Buy)
    SELECT
      ae.id::text AS id,
      'analytics'::text AS source,
      CASE
        WHEN ae.event_name IN ('view_product', 'product_view') THEN 'view'
        WHEN ae.event_name IN ('add_to_cart', 'cart_add') THEN 'cart'
        WHEN ae.event_name IN ('remove_from_cart', 'cart_remove') THEN 'cart'
        WHEN ae.event_name IN ('buy_now', 'quick_buy') THEN 'checkout'
        WHEN ae.event_name = 'checkout_started' THEN 'checkout'
        WHEN ae.event_name IN ('wishlist_add', 'wishlist_remove') THEN 'wishlist'
        WHEN ae.event_name = 'page_view' THEN 'view'
        ELSE 'other'
      END AS event_type,
      CASE
        WHEN ae.event_name IN ('view_product', 'product_view') THEN
          COALESCE(p.name, 'A product') || ' viewed'
        WHEN ae.event_name IN ('add_to_cart', 'cart_add') THEN
          COALESCE(p.name, 'An item') || ' added to bag'
        WHEN ae.event_name IN ('remove_from_cart', 'cart_remove') THEN
          COALESCE(p.name, 'An item') || ' removed from bag'
        WHEN ae.event_name IN ('buy_now', 'quick_buy') THEN
          'Quick Buy initiated for ' || COALESCE(p.name, 'an item')
        WHEN ae.event_name = 'checkout_started' THEN
          'Checkout started'
        WHEN ae.event_name = 'wishlist_add' THEN
          COALESCE(p.name, 'An item') || ' saved to wishlist'
        WHEN ae.event_name = 'wishlist_remove' THEN
          COALESCE(p.name, 'An item') || ' removed from wishlist'
        WHEN ae.event_name = 'page_view' THEN
          'Page viewed: ' || COALESCE(ae.metadata->>'path', 'store')
        ELSE
          replace(ae.event_name, '_', ' ')
      END AS title,
      COALESCE(prof.full_name, 'Visitor') AS subtitle,
      p.name AS product_name,
      p.slug AS product_slug,
      p.image_url AS product_image,
      COALESCE(prof.full_name, 'Visitor') AS customer_name,
      COALESCE((ae.metadata->>'amount')::numeric, p.price, 0) AS amount,
      ae.created_at,
      ae.metadata
    FROM public.analytics_events ae
    LEFT JOIN public.products p ON p.id = ae.product_id
    LEFT JOIN public.profiles prof ON prof.id = ae.user_id

    UNION ALL

    -- 2. Online Orders
    SELECT
      o.id::text AS id,
      'online_order'::text AS source,
      'order'::text AS event_type,
      'Online Order #' || o.order_number || ' placed (' || COALESCE(o.payment_method, 'Online') || ')' AS title,
      COALESCE(o.customer_name, 'Online Customer') || ' • ₹' || round(o.total::numeric) AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      COALESCE(o.customer_name, 'Online Customer') AS customer_name,
      o.total::numeric AS amount,
      o.created_at,
      jsonb_build_object('order_number', o.order_number, 'status', o.status) AS metadata
    FROM public.orders o

    UNION ALL

    -- 3. Offline POS Sales
    SELECT
      s.id::text AS id,
      'pos_sale'::text AS source,
      'order'::text AS event_type,
      'Store Sale #' || s.sale_number || ' completed (' || COALESCE(s.payment_method, 'Cash') || ')' AS title,
      COALESCE(s.customer_name, 'Walk-in Customer') || ' • ₹' || round(s.total::numeric) AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      COALESCE(s.customer_name, 'Walk-in Customer') AS customer_name,
      s.total::numeric AS amount,
      s.created_at,
      jsonb_build_object('sale_number', s.sale_number, 'status', s.status, 'items_count', s.items_count) AS metadata
    FROM public.offline_sales s
    WHERE s.status = 'completed'

    UNION ALL

    -- 4. Store Returns & Exchange Credit Vouchers
    SELECT
      r.id::text AS id,
      'pos_return'::text AS source,
      'return'::text AS event_type,
      'Exchange Voucher #' || r.return_number || ' issued' AS title,
      'Credit: ₹' || round(r.refund_amount::numeric) || ' • Reason: ' || COALESCE(r.reason, 'Exchange') AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      'Store Customer'::text AS customer_name,
      r.refund_amount::numeric AS amount,
      r.created_at,
      jsonb_build_object('return_number', r.return_number, 'status', r.status) AS metadata
    FROM public.offline_returns r
    WHERE r.status = 'completed'
  )
  SELECT *
  FROM combined
  ORDER BY created_at DESC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_store_activities(int) TO anon, authenticated, service_role;
