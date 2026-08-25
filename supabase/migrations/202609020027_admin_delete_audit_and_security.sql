-- 1. Create audit log table for admin order deletions
CREATE TABLE IF NOT EXISTS public.admin_order_deletion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  order_number text,
  user_id uuid,
  customer_name text,
  customer_email text,
  total numeric,
  cancellation_reason text,
  deleted_by uuid NOT NULL REFERENCES auth.users(id),
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_order_deletion_logs_order_id
  ON public.admin_order_deletion_logs(order_id);

CREATE INDEX IF NOT EXISTS idx_admin_order_deletion_logs_deleted_by
  ON public.admin_order_deletion_logs(deleted_by);

-- Enable RLS on audit table (admins only)
ALTER TABLE public.admin_order_deletion_logs ENABLE ROW LEVEL SECURITY;

-- Drop policies before creating them to avoid errors
DROP POLICY IF EXISTS "admins read deletion logs" ON public.admin_order_deletion_logs;
CREATE POLICY "admins read deletion logs"
  ON public.admin_order_deletion_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "admins insert deletion logs" ON public.admin_order_deletion_logs;
CREATE POLICY "admins insert deletion logs"
  ON public.admin_order_deletion_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT ON public.admin_order_deletion_logs TO authenticated;
GRANT ALL ON public.admin_order_deletion_logs TO service_role;

-- Grant table-level DELETE permissions to authenticated users
GRANT DELETE ON public.orders TO authenticated;
GRANT DELETE ON public.order_items TO authenticated;
GRANT DELETE ON public.order_status_history TO authenticated;
GRANT DELETE ON public.payments TO authenticated;
GRANT DELETE ON public.coupon_usage TO authenticated;

-- RLS Policies for Admin Deletion
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'admins delete cancelled orders'
  ) THEN
    CREATE POLICY "admins delete cancelled orders"
      ON public.orders FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin') AND status = 'cancelled');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'admins delete order items'
  ) THEN
    CREATE POLICY "admins delete order items"
      ON public.order_items FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_status_history' AND policyname = 'admins delete order status history'
  ) THEN
    CREATE POLICY "admins delete order status history"
      ON public.order_status_history FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'admins delete payments'
  ) THEN
    CREATE POLICY "admins delete payments"
      ON public.payments FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'coupon_usage' AND policyname = 'admins delete coupon usage'
  ) THEN
    CREATE POLICY "admins delete coupon usage"
      ON public.coupon_usage FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Atomic RPC Function to delete a cancelled order
CREATE OR REPLACE FUNCTION public.delete_cancelled_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
BEGIN
  -- 1. Verify user is authenticated
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify user has admin privileges
  IF NOT public.has_role(v_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete orders' USING ERRCODE = '42501';
  END IF;

  -- 3. Lock and fetch target order
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  -- 4. Verify order exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  -- 5. Strict status check: only cancelled orders can ever be deleted
  IF v_order.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'This order cannot be deleted because it is no longer cancelled. Current status is %', v_order.status
      USING ERRCODE = '22023';
  END IF;

  -- 6. Insert audit record before deletion
  INSERT INTO public.admin_order_deletion_logs (
    order_id, order_number, user_id, customer_name,
    customer_email, total, cancellation_reason, deleted_by, deleted_at
  ) VALUES (
    v_order.id, v_order.order_number, v_order.user_id, v_order.full_name,
    v_order.email, v_order.total, v_order.cancellation_reason, v_admin_id, now()
  );

  -- 7. Clean up child records
  DELETE FROM public.coupon_usage WHERE order_id = _order_id;
  DELETE FROM public.order_items WHERE order_id = _order_id;
  DELETE FROM public.order_status_history WHERE order_id = _order_id;
  DELETE FROM public.payments WHERE order_id = _order_id;

  -- 8. Delete the cancelled order record
  DELETE FROM public.orders WHERE id = _order_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Cancelled order deleted successfully.',
    'order_id', _order_id
  );
END;
$$;

-- Secure RPC permissions
REVOKE ALL ON FUNCTION public.delete_cancelled_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cancelled_order(uuid) TO authenticated, service_role;

-- ============================================================
-- SECURITY FIX: Harden claim_admin and sync_admin_from_allowlist
-- ============================================================
-- 
-- ISSUE 1: claim_admin() allows any authenticated user to become 
-- admin if no admin exists — intended as first-boot only, but
-- can be called by any user who signs up before the owner.
--
-- FIX: Restrict claim_admin() so it only succeeds if the calling
-- user's email is on the admin_allowlist. This prevents race-condition
-- privilege escalation where a random user signs up before the owner.
--
-- ISSUE 2: sync_admin_from_allowlist() also grants admin to any
-- user if the user_roles table has no admins, without checking
-- the allowlist. Same race condition issue.
--
-- FIX: In the "no admin exists" branch, also verify the calling
-- user is on the admin_allowlist before granting.

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
  uid uuid := auth.uid();
  mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  -- Only grant if no admin exists yet
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN false; END IF;
  -- SECURITY: Only allow if the user's email is on the admin allowlist
  SELECT email INTO mail FROM auth.users WHERE id = uid;
  IF mail IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT email INTO mail FROM auth.users WHERE id = uid;

  -- SECURITY FIX: In the "no admin exists" branch, only grant admin
  -- if the user's email is on the allowlist (prevents first-user privilege escalation)
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;

  RETURN false;
END; $$;
