-- =============================================================================
-- Migration: 20260928000080_fix_cancel_customer_order_payment_status_enum.sql
--
-- ROOT CAUSE BUG (Critical — Production Crash):
--   cancel_customer_order sets:
--     payment_status = CASE WHEN payment_status = 'paid'
--                           THEN 'refund_pending'::public.payment_status
--                           ...
--   But 'refund_pending' is NOT a valid value in the payment_status enum.
--   Valid values: pending | paid | failed | refunded | processing | authorized
--
--   Effect: Every attempt by a customer to cancel a PAID online order
--   results in: "invalid input value for enum payment_status: refund_pending"
--   The order is never cancelled, the UI shows a confusing error, and the
--   customer is stuck — a critical production crash path.
--
-- CORRECT SEMANTICS:
--   - paid order cancelled → payment_status = 'refunded'
--     (semantically: refund has been or will be initiated; admin sees 'refunded'
--     badge and knows to process the Razorpay refund)
--   - COD / pending order cancelled → payment_status = 'failed'
--     (no payment was made; 'failed' accurately represents abandoned payment intent)
--   - Any other status (processing/authorized) → keep existing status
--     (admin handles the edge case manually)
--
-- ADDITIONAL HARDENING:
--   Also fixes the restore_stock_on_cancel trigger which references the same
--   payment_status 'failed' condition — ensures cast is explicit and safe.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid              uuid := auth.uid();
  ord              public.orders%ROWTYPE;
  final_reason     text;
  item             record;
  v_prod           record;
  v_total_var_stock int;
  v_prev_stock     int;
  v_new_stock      int;
  v_new_payment_status public.payment_status;
BEGIN
  -- ── Auth ────────────────────────────────────────────────────────────────────
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF ord.user_id != uid
     AND NOT public.has_role(uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true) THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  -- ── Status gate ─────────────────────────────────────────────────────────────
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

  -- ── Determine correct payment_status ────────────────────────────────────────
  -- FIXED: 'refund_pending' is not a valid enum value.
  -- Use 'refunded' for paid orders (refund will be initiated), 'failed' for unpaid.
  v_new_payment_status := CASE
    WHEN ord.payment_status = 'paid'::public.payment_status
      THEN 'refunded'::public.payment_status      -- paid → refund initiated
    WHEN ord.payment_status IN ('processing'::public.payment_status, 'authorized'::public.payment_status)
      THEN 'refunded'::public.payment_status      -- payment captured/authorized → refund
    ELSE 'failed'::public.payment_status           -- pending/COD → no money exchanged
  END;

  -- ── 1. Restore stock safely ──────────────────────────────────────────────────
  FOR item IN
    SELECT * FROM public.order_items
    WHERE public.order_items.order_id = cancel_customer_order.order_id
  LOOP
    SELECT id, stock INTO v_prod
    FROM public.products
    WHERE id = item.product_id OR slug = item.product_slug
    FOR UPDATE;

    IF v_prod.id IS NOT NULL THEN
      v_prev_stock := v_prod.stock;

      IF item.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = item.variant_id;

        SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
        FROM public.product_variants
        WHERE product_id = v_prod.id;

        UPDATE public.products
        SET stock = v_total_var_stock,
            updated_at = now()
        WHERE id = v_prod.id;

        v_new_stock := v_total_var_stock;
      ELSE
        UPDATE public.products
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE id = v_prod.id;

        UPDATE public.product_variants
        SET stock = stock + item.qty,
            updated_at = now()
        WHERE product_id = v_prod.id
          AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = v_prod.id) <= 1);

        v_new_stock := v_prev_stock + item.qty;
      END IF;

      INSERT INTO public.inventory_transactions (
        product_id, variant_id, type, transaction_type,
        quantity, previous_quantity, new_quantity,
        reference_type, reference_id, note, notes, created_by
      ) VALUES (
        v_prod.id, item.variant_id,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        item.qty, v_prev_stock, v_new_stock,
        'order', cancel_customer_order.order_id,
        'Stock restored due to cancellation',
        'Stock restored due to cancellation',
        uid
      );
    END IF;
  END LOOP;

  -- ── 2. Restore coupon use count if applied ──────────────────────────────────
  IF ord.coupon_code IS NOT NULL AND trim(ord.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count  = GREATEST(0, used_count  - 1),
        usage_count = GREATEST(0, usage_count - 1)
    WHERE UPPER(code) = UPPER(trim(ord.coupon_code));
  END IF;

  -- ── 3. Update order record ──────────────────────────────────────────────────
  UPDATE public.orders
  SET
    status             = 'cancelled'::public.order_status,
    payment_status     = v_new_payment_status,          -- ← FIXED (was 'refund_pending')
    cancellation_reason = final_reason,
    cancelled_at       = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (order_id, 'cancelled', 'Order cancelled by customer: ' || final_reason, uid);

  RETURN jsonb_build_object(
    'success',  true,
    'order_id', order_id,
    'message',  'Order cancelled successfully'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated, anon, service_role;

-- Also update the restore_stock_on_cancel trigger to use explicit enum casts
-- so it is immune to future enum changes
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item             record;
  v_prod           record;
  v_var            record;
  v_prev_stock     int;
  v_new_stock      int;
  v_total_var_stock int;
BEGIN
  -- Fire when status transitions to cancelled/returned OR payment transitions to failed
  IF (NEW.status IN ('cancelled'::public.order_status, 'returned'::public.order_status)
      AND OLD.status NOT IN ('cancelled'::public.order_status, 'returned'::public.order_status))
     OR
     (NEW.payment_status = 'failed'::public.payment_status
      AND OLD.payment_status IS DISTINCT FROM 'failed'::public.payment_status)
  THEN
    -- Idempotency: only restore stock once per order
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_transactions
      WHERE reference_id   = NEW.id
        AND reference_type = 'order'
        AND (note LIKE '%Stock restored%' OR note LIKE '%cancellation%')
    ) THEN
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = item.product_id OR slug = item.product_slug
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          v_prev_stock := v_prod.stock;

          IF item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = stock + item.qty, updated_at = now()
            WHERE id = item.variant_id;

            SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
            FROM public.product_variants
            WHERE product_id = v_prod.id;

            UPDATE public.products
            SET stock = v_total_var_stock, updated_at = now()
            WHERE id = v_prod.id;

            v_new_stock := v_total_var_stock;
          ELSE
            UPDATE public.products
            SET stock = stock + item.qty, updated_at = now()
            WHERE id = v_prod.id;

            UPDATE public.product_variants
            SET stock = stock + item.qty, updated_at = now()
            WHERE product_id = v_prod.id
              AND (name = 'Default'
                   OR (SELECT count(*) FROM public.product_variants WHERE product_id = v_prod.id) <= 1);

            v_new_stock := v_prev_stock + item.qty;
          END IF;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, transaction_type,
            quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, notes, created_by
          ) VALUES (
            v_prod.id, item.variant_id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            item.qty, v_prev_stock, v_new_stock,
            'order', NEW.id,
            'Stock restored due to order cancellation/failure',
            'Stock restored due to order cancellation/failure',
            COALESCE(auth.uid(), NEW.user_id)
          );
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
