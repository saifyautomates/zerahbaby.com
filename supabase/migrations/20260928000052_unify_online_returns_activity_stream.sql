-- Migration: 20260928000052_unify_online_returns_activity_stream.sql
-- Update get_unified_store_activities to include Online Returns in the live dashboard activity feed

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
      (
        SELECT pi.public_url
        FROM public.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC NULLS LAST, pi.sort_order ASC NULLS LAST
        LIMIT 1
      ) AS product_image,
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
      'Online Order ' || COALESCE(o.invoice_no, '#' || substr(o.id::text, 1, 8)) || ' placed (' || COALESCE(o.payment_method, 'Online') || ')' AS title,
      COALESCE(o.full_name, 'Online Customer') || ' • ₹' || round(o.total::numeric) AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      COALESCE(o.full_name, 'Online Customer') AS customer_name,
      o.total::numeric AS amount,
      o.created_at,
      jsonb_build_object('order_id', o.id, 'invoice_no', o.invoice_no, 'status', o.status) AS metadata
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
      jsonb_build_object('sale_number', s.sale_number, 'payment_method', s.payment_method) AS metadata
    FROM public.offline_sales s

    UNION ALL

    -- 4. Store Returns & Exchange Credit Vouchers
    SELECT
      r.id::text AS id,
      'pos_return'::text AS source,
      'return'::text AS event_type,
      'Exchange Voucher #' || r.return_number || ' issued' AS title,
      'Credit: ₹' || round(r.refund_amount::numeric) || ' • ' || COALESCE(r.return_reason, 'Exchange') AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      COALESCE(r.customer_name, 'Store Customer') AS customer_name,
      r.refund_amount::numeric AS amount,
      r.created_at,
      jsonb_build_object('return_number', r.return_number, 'status', r.status) AS metadata
    FROM public.offline_returns r

    UNION ALL

    -- 5. Online Returns
    SELECT
      ret.id::text AS id,
      'online_return'::text AS source,
      'return'::text AS event_type,
      'Online Return #' || ret.return_number || ' ' || replace(ret.return_status, '_', ' ') AS title,
      COALESCE(prof.full_name, 'Online Customer') || ' • Refund ₹' || round(ret.final_refund_amount::numeric) || ' • ' || ret.reason_label AS subtitle,
      NULL::text AS product_name,
      NULL::text AS product_slug,
      NULL::text AS product_image,
      COALESCE(prof.full_name, 'Online Customer') AS customer_name,
      ret.final_refund_amount::numeric AS amount,
      ret.created_at,
      jsonb_build_object('return_number', ret.return_number, 'return_status', ret.return_status, 'refund_status', ret.refund_status) AS metadata
    FROM public.online_returns ret
    LEFT JOIN public.profiles prof ON prof.id = ret.user_id
  )
  SELECT *
  FROM combined
  ORDER BY created_at DESC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unified_store_activities(int) TO authenticated, anon, service_role;
