-- =====================================================================
-- Migration: Enable Admin Deletion of Cancelled Orders & Dependent Child Tables
-- Grants permissions and provides both RLS policies and atomic RPC
-- =====================================================================

-- 1. Grant table-level DELETE permissions to authenticated users (restricted by RLS)
GRANT DELETE ON public.orders TO authenticated;
GRANT DELETE ON public.order_items TO authenticated;
GRANT DELETE ON public.order_status_history TO authenticated;
GRANT DELETE ON public.payments TO authenticated;
GRANT DELETE ON public.coupon_usage TO authenticated;

-- 2. RLS Policies for Admin Deletion
DO $$
BEGIN
  -- orders table: admin delete only if status is cancelled
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'admins delete cancelled orders'
  ) THEN
    CREATE POLICY "admins delete cancelled orders"
      ON public.orders
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin') AND status = 'cancelled');
  END IF;

  -- order_items table: admin delete
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'admins delete order items'
  ) THEN
    CREATE POLICY "admins delete order items"
      ON public.order_items
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- order_status_history table: admin delete
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'order_status_history' AND policyname = 'admins delete order status history'
  ) THEN
    CREATE POLICY "admins delete order status history"
      ON public.order_status_history
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- payments table: admin delete
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'admins delete payments'
  ) THEN
    CREATE POLICY "admins delete payments"
      ON public.payments
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  -- coupon_usage table: admin delete
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'coupon_usage' AND policyname = 'admins delete coupon usage'
  ) THEN
    CREATE POLICY "admins delete coupon usage"
      ON public.coupon_usage
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 3. Ensure RPC Function delete_cancelled_order exists
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

  -- 6. Clean up child records
  DELETE FROM public.coupon_usage WHERE order_id = _order_id;
  DELETE FROM public.order_items WHERE order_id = _order_id;
  DELETE FROM public.order_status_history WHERE order_id = _order_id;
  DELETE FROM public.payments WHERE order_id = _order_id;

  -- 7. Delete the cancelled order record
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
