-- ============================================================
-- FIX: Review Status Privilege Escalation (IDOR)
-- ============================================================
-- The previous RLS policy for "own review update" allowed users
-- to update ANY column of their own review, including changing
-- the 'status' column from 'pending' or 'rejected' to 'approved'.
-- This effectively bypassed admin moderation.
-- 
-- This patch implements a database trigger that forces any
-- non-admin update to a review back into 'pending' status, 
-- completely securing the moderation workflow while allowing
-- users to freely edit their review text.

CREATE OR REPLACE FUNCTION public.force_review_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the user is NOT an admin, and they are modifying the review,
  -- always enforce the status to 'pending'. This requires re-moderation
  -- and prevents malicious status escalation.
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.status = 'pending';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_force_review_pending ON public.reviews;
CREATE TRIGGER trigger_force_review_pending
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.force_review_pending();
