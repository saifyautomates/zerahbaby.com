-- ============================================================
-- ZERAH BABY — AUDIT SECURITY FIXES
-- ============================================================

-- 1. REVOKE DIRECT INSERTS ON ORDERS, ORDER_ITEMS AND COUPON_USAGE
-- Customers must ONLY use the `place_order` RPC which does server-side validation.
DROP POLICY IF EXISTS "own orders insert" ON public.orders;
DROP POLICY IF EXISTS "own order items insert" ON public.order_items;
DROP POLICY IF EXISTS "own coupon usage insert" ON public.coupon_usage;

-- 2. SECURE REVIEWS
-- Customers should not be able to auto-approve their own reviews.
-- Ensure that any review inserted or updated by a non-admin is set to 'pending'
-- and 'verified_purchase' cannot be manipulated by them.
CREATE OR REPLACE FUNCTION public.force_review_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.status = 'pending';
    -- Preserve old verified_purchase state if update, else default to false
    IF TG_OP = 'UPDATE' THEN
      NEW.verified_purchase = OLD.verified_purchase;
    ELSE
      NEW.verified_purchase = false;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS reviews_force_pending ON public.reviews;
CREATE TRIGGER reviews_force_pending 
  BEFORE INSERT OR UPDATE ON public.reviews 
  FOR EACH ROW 
  EXECUTE FUNCTION public.force_review_pending();

-- 3. SECURE PROFILE UPDATES
-- While role is properly managed in `user_roles`, we should ensure
-- users can't falsely set `role = 'admin'` on their `profiles` table which might
-- trick frontend logic into showing admin panels (even if API requests fail).
CREATE OR REPLACE FUNCTION public.force_profile_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.role = OLD.role;
    ELSE
      NEW.role = 'customer';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_force_role ON public.profiles;
CREATE TRIGGER profiles_force_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.force_profile_role();
