-- =====================================================================
-- Migration: Secure Admin-Only Delete Cancelled Order
-- Table: admin_order_deletion_logs
-- RPC: delete_cancelled_order(_order_id uuid)
-- =====================================================================

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

CREATE POLICY "admins read deletion logs"
  ON public.admin_order_deletion_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert deletion logs"
  ON public.admin_order_deletion_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT ON public.admin_order_deletion_logs TO authenticated;
GRANT ALL ON public.admin_order_deletion_logs TO service_role;

-- 2. RLS policy for direct order deletion (restricted to cancelled orders by admins)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'orders' AND policyname = 'admins delete cancelled orders'
  ) THEN
    CREATE POLICY "admins delete cancelled orders"
      ON public.orders
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin') AND status = 'cancelled');
  END IF;
END $$;

-- 3. Atomic RPC Function to delete a cancelled order
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

  -- 3. Atomically lock and fetch target order from database
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
    order_id,
    order_number,
    user_id,
    customer_name,
    customer_email,
    total,
    cancellation_reason,
    deleted_by,
    deleted_at
  ) VALUES (
    v_order.id,
    v_order.order_number,
    v_order.user_id,
    v_order.full_name,
    v_order.email,
    v_order.total,
    v_order.cancellation_reason,
    v_admin_id,
    now()
  );

  -- 7. Clean up coupon usage (if any) to prevent FK constraint blocks
  DELETE FROM public.coupon_usage WHERE order_id = _order_id;

  -- 8. Clean up dependent records explicitly
  DELETE FROM public.order_items WHERE order_id = _order_id;
  DELETE FROM public.order_status_history WHERE order_id = _order_id;
  DELETE FROM public.payments WHERE order_id = _order_id;

  -- 9. Delete the cancelled order record
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
