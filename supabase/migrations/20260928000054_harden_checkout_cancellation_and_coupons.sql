-- Migration: Harden Checkout Cancellation, Abandoned Order Stock Restoration, and Coupon Count Reconciliation

-- 1. Redefine cancel_abandoned_order to support both 'placed' and 'pending' orders (online payment flow)
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

  -- Ensure ownership if authenticated
  IF uid IS NOT NULL AND ord.user_id IS NOT NULL AND ord.user_id != uid THEN
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

      IF FOUND THEN
        UPDATE public.product_variants
        SET stock = stock + item.qty
        WHERE id = variant.variant_id;

        UPDATE public.products
        SET stock = stock + item.qty
        WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'adjustment', item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
        );
      END IF;
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


-- 2. Update cancel_customer_order to also restore coupon use count
CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
  item record;
  variant record;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF ord.user_id != uid AND NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'This order has already been shipped and can no longer be cancelled.';
  END IF;

  IF ord.status = 'cancelled' THEN
    RAISE EXCEPTION 'This order has already been cancelled.';
  END IF;

  IF ord.status NOT IN ('placed', 'pending', 'confirmed', 'processing', 'packed') THEN
    RAISE EXCEPTION 'Order with status "%" cannot be cancelled.', ord.status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Customer cancelled before shipment');

  -- 1. Restore stock
  FOR item IN SELECT * FROM public.order_items WHERE public.order_items.order_id = cancel_customer_order.order_id LOOP
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id
      FOR UPDATE OF v, p;

      IF FOUND THEN
        UPDATE public.product_variants
        SET stock = stock + item.qty
        WHERE id = variant.variant_id;

        UPDATE public.products
        SET stock = stock + item.qty
        WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, transaction_type, quantity, reference_type, reference_id, notes, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'adjustment', item.qty, 'order', cancel_customer_order.order_id, 'Stock restored due to cancellation', uid
        );
      END IF;
    END IF;
  END LOOP;

  -- 2. Restore coupon use count if applied
  IF ord.coupon_code IS NOT NULL AND trim(ord.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = GREATEST(0, used_count - 1)
    WHERE UPPER(code) = UPPER(trim(ord.coupon_code));
  END IF;

  -- 3. Update order record
  UPDATE public.orders
  SET
    status = 'cancelled',
    cancellation_reason = final_reason,
    cancelled_at = now(),
    cancelled_by = uid
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (order_id, 'cancelled', 'Order cancelled: ' || final_reason, uid);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'status', 'cancelled',
    'reason', final_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated;
