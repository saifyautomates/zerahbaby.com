-- Migration: 20260928000123_add_delete_cancelled_orders_bulk_rpc.sql
-- Description: Adds atomic bulk deletion RPC for cancelled orders with security, audit logs, and child table cleanup.

CREATE OR REPLACE FUNCTION public.delete_cancelled_orders_bulk(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_id uuid;
  v_deleted_count int := 0;
BEGIN
  -- 1. Verify user is authenticated
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 2. Verify user has admin privileges
  IF NOT public.has_role(v_admin_id, 'admin') AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete orders' USING ERRCODE = '42501';
  END IF;

  -- 3. Iterate and safely delete only orders that are cancelled
  FOREACH v_id IN ARRAY _order_ids LOOP
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = v_id
    FOR UPDATE;

    IF FOUND AND v_order.status = 'cancelled' THEN
      -- Log audit trail for each deleted order
      INSERT INTO public.admin_order_deletion_logs (
        order_id, order_number, user_id, customer_name,
        customer_email, total, cancellation_reason, deleted_by, deleted_at
      ) VALUES (
        v_order.id, v_order.order_number, v_order.user_id, v_order.full_name,
        v_order.email, v_order.total, v_order.cancellation_reason, v_admin_id, now()
      );

      -- Clean up child records
      DELETE FROM public.coupon_usage WHERE order_id = v_id;
      DELETE FROM public.order_items WHERE order_id = v_id;
      DELETE FROM public.order_status_history WHERE order_id = v_id;
      DELETE FROM public.payments WHERE order_id = v_id;

      -- Delete the cancelled order
      DELETE FROM public.orders WHERE id = v_id;

      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_cancelled_orders_bulk(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cancelled_orders_bulk(uuid[]) TO authenticated, service_role;
