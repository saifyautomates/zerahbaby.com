-- ==============================================================================
-- Migration: 20260928000113_fix_cancel_abandoned_order_inventory_tx.sql
-- Description:
-- 1. Fix `cancel_abandoned_order` which had a fatal error trying to insert into
--    non-existent columns `transaction_type` and `notes` on `inventory_transactions`.
--    Changed to `type`, `note`, and added `previous_quantity`, `new_quantity`.
-- 2. Added support for legacy non-variant items (fallback to product_slug).
-- ==============================================================================

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
    ELSE
      SELECT v.id AS variant_id, v.stock AS v_stock, p.id AS p_id, p.stock AS p_stock
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1
      FOR UPDATE OF v, p;
    END IF;

    IF variant.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock + item.qty
      WHERE id = variant.variant_id;

      UPDATE public.products
      SET stock = stock + item.qty
      WHERE id = variant.p_id;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
      ) VALUES (
        variant.p_id, variant.variant_id, 'adjustment'::public.inventory_tx_type, item.qty, variant.p_stock, variant.p_stock + item.qty, 'order', cancel_abandoned_order.order_id, 'Stock restored due to abandoned payment', uid
      );
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
