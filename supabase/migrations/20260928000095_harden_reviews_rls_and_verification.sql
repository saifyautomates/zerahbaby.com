-- ==============================================================================
-- Migration: 20260928000095_harden_reviews_rls_and_verification.sql
-- Description:
-- Prevents customers from self-approving their own reviews or spoofing
-- verified purchase badges. Forces non-admin review creation/updates to 'pending'
-- and authoritatively verifies verified_purchase against the user's paid orders.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.validate_and_sanitize_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  is_admin boolean := false;
  has_purchased boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    is_admin := public.has_role(auth.uid(), 'admin');
  END IF;

  -- Admin can approve or set flags freely
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- 1. Customers cannot self-approve reviews
  NEW.status := 'pending'::public.review_status;

  -- 2. Authoritative check for verified purchase
  SELECT EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.user_id = NEW.user_id
      AND o.payment_status = 'paid'
      AND (
        oi.product_id = NEW.product_id
        OR oi.product_slug = (SELECT slug FROM public.products WHERE id = NEW.product_id)
      )
  ) INTO has_purchased;

  NEW.verified_purchase := has_purchased;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_review ON public.reviews;
CREATE TRIGGER trg_sanitize_review
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_and_sanitize_review();
