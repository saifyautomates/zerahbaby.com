-- Migration: 20260928000069_harden_order_cancellation_and_restock_triggers.sql
-- Prevent any potential double-stock restoration cascade on online order cancellation and returns

-- 1. Redefine restore_stock_on_cancel trigger function with single-source recalculation
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item record;
  v_prod record;
  v_var record;
  v_prev_stock int;
  v_new_stock int;
  v_total_var_stock int;
BEGIN
  -- Check if status transitioned to cancelled/returned or payment_status to failed
  IF (NEW.status IN ('cancelled', 'returned') AND OLD.status NOT IN ('cancelled', 'returned')) OR 
     (NEW.payment_status = 'failed' AND OLD.payment_status != 'failed') THEN
    
    -- Idempotency check: Ensure we haven't already restored stock for this order
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_transactions 
      WHERE reference_id = NEW.id 
        AND reference_type = 'order'
        AND (type = 'adjustment'::public.inventory_tx_type OR type = 'return'::public.inventory_tx_type OR note LIKE '%Stock restored%')
    ) THEN
      
      -- Restore stock for each item
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = item.product_id OR slug = item.product_slug
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          v_prev_stock := v_prod.stock;

          -- 1. Restore specific variant stock if variant_id exists
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
            -- Restore product stock and default variant
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

          -- 2. Log inventory transaction with full audit trail
          INSERT INTO public.inventory_transactions (
            product_id,
            variant_id,
            type,
            transaction_type,
            quantity,
            previous_quantity,
            new_quantity,
            reference_type,
            reference_id,
            note,
            notes,
            created_by
          ) VALUES (
            v_prod.id,
            item.variant_id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            item.qty,
            v_prev_stock,
            v_new_stock,
            'order',
            NEW.id,
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

-- 2. Redefine cancel_customer_order with identical single-source safety
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
  v_prod record;
  v_total_var_stock int;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF ord.user_id != uid AND NOT public.has_role(uid, 'admin') AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true) THEN
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

  -- 1. Restore stock safely
  FOR item IN SELECT * FROM public.order_items WHERE public.order_items.order_id = cancel_customer_order.order_id LOOP
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
        product_id,
        variant_id,
        type,
        transaction_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        note,
        notes,
        created_by
      ) VALUES (
        v_prod.id,
        item.variant_id,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        item.qty,
        v_prev_stock,
        v_new_stock,
        'order',
        cancel_customer_order.order_id,
        'Stock restored due to cancellation',
        'Stock restored due to cancellation',
        uid
      );
    END IF;
  END LOOP;

  -- 2. Restore coupon use count if applied
  IF ord.coupon_code IS NOT NULL AND trim(ord.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = GREATEST(0, used_count - 1),
        usage_count = GREATEST(0, usage_count - 1)
    WHERE UPPER(code) = UPPER(trim(ord.coupon_code));
  END IF;

  -- 3. Update order record
  UPDATE public.orders
  SET
    status = 'cancelled'::public.order_status,
    payment_status = CASE WHEN payment_status = 'paid' THEN 'refund_pending'::public.payment_status ELSE 'failed'::public.payment_status END,
    cancellation_reason = final_reason,
    cancelled_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (order_id, 'cancelled', 'Order cancelled by customer: ' || final_reason, uid);

  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'message', 'Order cancelled successfully'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated, anon, service_role;
