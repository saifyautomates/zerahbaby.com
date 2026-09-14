-- ==============================================================================
-- Migration: 20260928000230_strictly_enforce_delivered_orders_for_reviews.sql
-- Description:
-- 1. Restricts product review creation/updates strictly to customers who purchased
--    the product and had it DELIVERED ('delivered' or 'open_box_accepted').
-- 2. Guarantees public readability of all approved reviews so any customer can view them.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.validate_and_sanitize_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  is_admin boolean := false;
  has_purchased_and_delivered boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    is_admin := public.has_role(auth.uid(), 'admin') OR public.is_admin();
  END IF;

  -- Admin can approve or set flags freely
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- 1. Customers cannot self-approve reviews
  NEW.status := 'pending'::public.review_status;

  -- 2. Authoritative check: Must have purchased and had the product DELIVERED
  SELECT EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.user_id = NEW.user_id
      AND o.status IN ('delivered', 'open_box_accepted')
      AND (
        oi.product_id = NEW.product_id
        OR oi.product_slug = (SELECT slug FROM public.products WHERE id = NEW.product_id)
      )
  ) INTO has_purchased_and_delivered;

  IF NOT has_purchased_and_delivered THEN
    RAISE EXCEPTION 'Only customers who have purchased and received delivery of this product can submit a review.';
  END IF;

  NEW.verified_purchase := true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_review ON public.reviews;
CREATE TRIGGER trg_sanitize_review
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_and_sanitize_review();

-- Ensure approved reviews are publicly readable by everyone (anon and authenticated)
DROP POLICY IF EXISTS "approved reviews public read" ON public.reviews;
CREATE POLICY "approved reviews public read" ON public.reviews
  FOR SELECT TO public
  USING (
    status = 'approved'::public.review_status
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.is_admin()
  );
