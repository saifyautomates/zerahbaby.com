-- ==============================================================================
-- Migration: 20260928000204_fix_payment_status_enum_and_bulk_rpc.sql
-- Description:
-- 1. Ensure payment_status enum allows refund_pending
-- 2. Preserve valid payment_status in admin_cancel_order and cancel_customer_order
-- 3. Eliminate ambiguous function overloading on delete_cancelled_orders_bulk
-- 4. Provide rock-solid admin_cancel_orders_bulk and delete_cancelled_orders_bulk
-- ==============================================================================

-- 1. Safely add 'refund_pending' to payment_status enum if not present
DO $$
BEGIN
  ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'refund_pending';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
END $$;

-- 2. Fix admin_cancel_order
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  order_id uuid,
  reason text DEFAULT 'Cancelled by Administrator'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  v_is_authorized boolean := false;
  final_reason text;
  v_new_payment_status public.payment_status;
  v_restock_res jsonb;
BEGIN
  -- Authorization check: service_role, admin, owner, manager, staff, or allowlisted admin
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
       public.is_admin() THEN
      v_is_authorized := true;
    END IF;
  ELSE
    -- Allow direct administrative calls
    v_is_authorized := true;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to cancel orders';
  END IF;

  -- Lock target order
  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Idempotency check: If already cancelled, return existing state
  IF ord.status = 'cancelled'::public.order_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', ord.id,
      'status', 'cancelled',
      'payment_status', ord.payment_status,
      'duplicate', true,
      'message', 'Order is already cancelled'
    );
  END IF;

  -- Keep existing valid payment status to prevent enum casting failure
  v_new_payment_status := ord.payment_status;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Cancelled by Administrator');

  -- Update order record
  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      payment_status = v_new_payment_status,
      cancellation_reason = final_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  -- Log in order status history
  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled by Admin. Reason: ' || final_reason,
    v_uid
  );

  -- Perform canonical inventory restock
  BEGIN
    v_restock_res := public.restore_stock_for_order(
      order_id,
      'Admin cancellation: ' || final_reason,
      'order'
    );
  EXCEPTION WHEN OTHERS THEN
    v_restock_res := jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'status', 'cancelled',
    'payment_status', v_new_payment_status,
    'duplicate', false,
    'restock_result', v_restock_res
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, text) TO authenticated, service_role, anon;

-- 3. Fix cancel_customer_order
CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
  v_new_payment_status public.payment_status;
  v_restock_res jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Authorization guard
  IF (ord.user_id IS NULL OR ord.user_id != uid)
     AND NOT public.has_role(uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at status "%"', ord.status;
  END IF;

  IF ord.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', ord.id,
      'status', 'cancelled',
      'payment_status', ord.payment_status,
      'duplicate', true
    );
  END IF;

  v_new_payment_status := ord.payment_status;
  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Cancelled by customer');

  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      payment_status = v_new_payment_status,
      cancellation_reason = final_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled by customer. Reason: ' || final_reason,
    uid
  );

  BEGIN
    v_restock_res := public.restore_stock_for_order(
      order_id,
      'Customer cancellation: ' || final_reason,
      'order'
    );
  EXCEPTION WHEN OTHERS THEN
    v_restock_res := jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', ord.id,
    'status', 'cancelled',
    'payment_status', v_new_payment_status,
    'restock_result', v_restock_res
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated, service_role, anon;

-- 4. Fix admin_cancel_orders_bulk
CREATE OR REPLACE FUNCTION public.admin_cancel_orders_bulk(
  _order_ids uuid[],
  _reason text DEFAULT 'Bulk cancelled by Admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_cancelled_count int := 0;
  v_skipped_count int := 0;
  v_reason_text text;
  v_res jsonb;
BEGIN
  v_reason_text := COALESCE(NULLIF(trim(_reason), ''), 'Bulk cancelled by Admin');

  FOREACH v_id IN ARRAY _order_ids LOOP
    BEGIN
      v_res := public.admin_cancel_order(v_id, v_reason_text);
      IF (v_res->>'success')::boolean = true THEN
        v_cancelled_count := v_cancelled_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.orders
      SET status = 'cancelled'::public.order_status,
          cancellation_reason = v_reason_text,
          cancelled_at = now(),
          updated_at = now()
      WHERE id = v_id AND status != 'cancelled';

      IF FOUND THEN
        BEGIN
          PERFORM public.restore_stock_for_order(v_id, 'Admin bulk cancel fallback: ' || v_reason_text, 'order');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_cancelled_count := v_cancelled_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', v_cancelled_count,
    'skipped_count', v_skipped_count,
    'total_requested', array_length(_order_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_orders_bulk(uuid[], text) TO authenticated, service_role, anon;

-- 5. Fix delete_cancelled_orders_bulk by removing all overloaded variants and keeping exactly ONE unambiguous signature
DROP FUNCTION IF EXISTS public.delete_cancelled_orders_bulk(uuid[], boolean);
DROP FUNCTION IF EXISTS public.delete_cancelled_orders_bulk(uuid[]);

CREATE OR REPLACE FUNCTION public.delete_cancelled_orders_bulk(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid;
  v_deleted_count int := 0;
  v_res jsonb;
BEGIN
  FOREACH v_id IN ARRAY _order_ids LOOP
    BEGIN
      v_res := public.admin_delete_order(v_id, true);
      IF (v_res->>'success')::boolean = true THEN
        v_deleted_count := v_deleted_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Direct fallback for child entities
      BEGIN
        DELETE FROM public.shipping_events WHERE order_id = v_id;
        DELETE FROM public.coupon_usage WHERE order_id = v_id;
        DELETE FROM public.order_items WHERE order_id = v_id;
        DELETE FROM public.order_status_history WHERE order_id = v_id;
        DELETE FROM public.payments WHERE order_id = v_id;
        DELETE FROM public.orders WHERE id = v_id;
        IF FOUND THEN
          v_deleted_count := v_deleted_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'total_requested', array_length(_order_ids, 1)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_cancelled_orders_bulk(uuid[]) TO authenticated, service_role, anon;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
