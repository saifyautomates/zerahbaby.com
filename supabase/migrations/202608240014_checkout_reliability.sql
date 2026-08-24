-- Migration: Fix Abandoned Cart Stock Drain

-- 1. Create RPC to allow clients to cancel their own pending abandoned orders securely
CREATE OR REPLACE FUNCTION public.cancel_abandoned_order(order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
BEGIN
  -- Fetch the order
  SELECT * INTO ord FROM public.orders WHERE id = order_id AND user_id = uid;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or unauthorized';
  END IF;

  -- Only allow if it's pending and online
  IF ord.status != 'pending' OR ord.payment_method != 'online' THEN
    RAISE EXCEPTION 'Order cannot be cancelled. Status: %, Payment: %', ord.status, ord.payment_method;
  END IF;

  -- Update status to trigger stock restoration
  UPDATE public.orders SET status = 'cancelled', payment_status = 'failed' WHERE id = order_id;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid) TO authenticated;


-- 2. Create Trigger to restore stock securely and idempotently
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item record;
BEGIN
  -- Check if status transitioned to cancelled/returned or payment_status to failed
  IF (NEW.status IN ('cancelled', 'returned') AND OLD.status NOT IN ('cancelled', 'returned')) OR 
     (NEW.payment_status = 'failed' AND OLD.payment_status != 'failed') THEN
    
    -- Idempotency check: Ensure we haven't already restored stock for this order
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_transactions 
      WHERE reference_id = NEW.id 
      AND note = 'Stock restored due to order cancellation/failure'
    ) THEN
      
      -- Restore stock for each item
      FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
        -- Restore stock atomically
        UPDATE public.products 
        SET stock = stock + item.qty
        WHERE slug = item.product_slug;

        -- Log inventory transaction
        INSERT INTO public.inventory_transactions (product_id, type, quantity, reference_type, reference_id, note, created_by)
        SELECT p.id, 'adjustment', item.qty, 'order', NEW.id, 'Stock restored due to order cancellation/failure', 
          COALESCE(auth.uid(), NEW.user_id)
        FROM public.products p WHERE p.slug = item.product_slug;
      END LOOP;

    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS orders_restore_stock_trigger ON public.orders;
CREATE TRIGGER orders_restore_stock_trigger
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.restore_stock_on_cancel();
