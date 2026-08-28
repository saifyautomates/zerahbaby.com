-- ==============================================================================
-- FIX: Grant execute on lookup_barcode to authenticated users
-- ==============================================================================
GRANT EXECUTE ON FUNCTION public.lookup_barcode(text) TO authenticated, service_role;

-- ==============================================================================
-- NEW RPC: Admin Void Offline Sale
-- Safely cancels an offline POS transaction and restores stock
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
BEGIN
  -- Verify admin
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Only admins can void sales';
  END IF;

  -- Verify sale exists and get details
  SELECT id, sale_number, status, customer_id, total INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Offline sale not found';
  END IF;

  IF target_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Sale is already voided';
  END IF;

  -- Restore stock for each item
  FOR target_item IN
    SELECT product_id, qty, name
    FROM public.offline_sale_items
    WHERE sale_id = _sale_id
  LOOP
    IF target_item.product_id IS NOT NULL THEN
      -- Atomically restore stock
      UPDATE public.products
      SET stock = stock + target_item.qty
      WHERE id = target_item.product_id;

      -- Log inventory transaction
      INSERT INTO public.inventory_transactions (
        product_id, transaction_type, quantity_change, reference_type, reference_id, notes, created_by
      ) VALUES (
        target_item.product_id,
        'return',
        target_item.qty,
        'offline_sale',
        _sale_id,
        'Auto-restored from voided POS sale',
        uid
      );
    END IF;
  END LOOP;

  -- Update customer stats if applicable
  IF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = GREATEST(0, total_purchases - 1),
        total_spend = GREATEST(0, total_spend - target_sale.total)
    WHERE id = target_sale.customer_id;
  END IF;

  -- Mark sale as cancelled (void)
  UPDATE public.offline_sales
  SET status = 'cancelled',
      notes = notes || ' [VOIDED BY ADMIN]',
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Sale ' || target_sale.sale_number || ' successfully voided and stock restored'
  );
END; $$;

-- Set permissions
REVOKE EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid) TO authenticated, service_role;
