-- ==============================================================================
-- Migration: 20260928000114_fix_get_related_products_and_reviews_rpc.sql
-- Description:
-- 1. Fix get_related_products: Qualify table columns (p.category, p.brand) to eliminate
--    PL/pgSQL error 42702 (ambiguous column reference colliding with RETURNS TABLE).
-- 2. Create get_approved_product_reviews(p_product_id uuid): Security Definer RPC
--    allowing anon visitors to read approved reviews with reviewer display name without
--    violating profiles table RLS (error 42501).
-- 3. Harden cancel_abandoned_order authorization: Prevent unauthenticated callers
--    from cancelling orders placed by authenticated users.
-- ==============================================================================

-- 1. Fix get_related_products (Resolve Ambiguous Column References)
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
  -- Explicitly qualify with table alias 'p.' to avoid collision with return parameters
  SELECT p.recommendation_mode, p.category, p.brand 
  INTO v_mode, v_category, v_brand
  FROM public.products p
  WHERE p.id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 1. Fetch Manual Relations (strictly active and ONLINE_AND_OFFLINE)
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.slug,
    p.price,
    p.mrp,
    (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_url,
    COALESCE((SELECT array_agg(pi.public_url ORDER BY pi.sort_order ASC) FROM public.product_images pi WHERE pi.product_id = p.id), '{}'::text[]) AS images,
    p.category,
    p.brand,
    p.stock,
    p.low_stock_at,
    p.is_active,
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
        p.id,
        p.name,
        p.slug,
        p.price,
        p.mrp,
        (SELECT pi.public_url FROM public.product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS image_url,
        COALESCE((SELECT array_agg(pi.public_url ORDER BY pi.sort_order ASC) FROM public.product_images pi WHERE pi.product_id = p.id), '{}'::text[]) AS images,
        p.category,
        p.brand,
        p.stock,
        p.low_stock_at,
        p.is_active,
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


-- 2. Create get_approved_product_reviews (Safe Public Reviews Reader)
CREATE OR REPLACE FUNCTION public.get_approved_product_reviews(p_product_id uuid)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  user_id uuid,
  order_id uuid,
  rating integer,
  title text,
  comment text,
  images text[],
  verified_purchase boolean,
  status public.review_status,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.product_id,
    r.user_id,
    r.order_id,
    r.rating,
    r.title,
    r.comment,
    r.images,
    r.verified_purchase,
    r.status,
    r.created_at,
    r.updated_at,
    COALESCE(NULLIF(TRIM(p.full_name), ''), 'Verified Customer')::text AS user_name
  FROM public.reviews r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.product_id = p_product_id
    AND r.status = 'approved'
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_approved_product_reviews(uuid) TO anon, authenticated, service_role;


-- 3. Harden cancel_abandoned_order Authorization & Parameter Overloads
DROP FUNCTION IF EXISTS public.cancel_abandoned_order(uuid);

CREATE OR REPLACE FUNCTION public.cancel_abandoned_order(order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  item record;
  variant record;
BEGIN
  -- Fetch the order
  SELECT * INTO ord FROM public.orders WHERE id = order_id;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ensure ownership: If order was placed by an authenticated user, caller must be that user
  IF ord.user_id IS NOT NULL AND (uid IS NULL OR ord.user_id != uid) THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  -- Only allow if it's placed/pending and online payment
  IF ord.status NOT IN ('placed', 'pending') OR ord.payment_method != 'online' THEN
    RAISE EXCEPTION 'Order cannot be cancelled. Status: %, Payment: %', ord.status, ord.payment_method;
  END IF;

  -- If payment was already completed, do not allow abandoned cancellation
  IF ord.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Cannot cancel order with completed payment';
  END IF;

  -- 1. Atomically restore stock for all items
  FOR item IN SELECT * FROM public.order_items WHERE public.order_items.order_id = cancel_abandoned_order.order_id LOOP
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id
      FOR UPDATE OF v, p;
    ELSE
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1
      FOR UPDATE OF v, p;
    END IF;

    IF variant.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock + item.qty
      WHERE id = variant.variant_id;

      UPDATE public.products
      SET stock = stock + item.qty
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'adjustment'::public.inventory_tx_type, item.qty, variant.p_stock, variant.p_stock + item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
      );
    END IF;
  END LOOP;

  -- 2. Restore coupon use count if applied
  IF ord.coupon_code IS NOT NULL AND trim(ord.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = GREATEST(0, used_count - 1)
    WHERE UPPER(code) = UPPER(trim(ord.coupon_code));
  END IF;

  -- 3. Update status to cancelled
  UPDATE public.orders
  SET
    status = 'cancelled',
    payment_status = 'failed',
    cancellation_reason = 'Payment abandoned or window closed',
    cancelled_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (order_id, 'cancelled', 'Order cancelled due to abandoned payment window', uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid) TO authenticated, anon;
