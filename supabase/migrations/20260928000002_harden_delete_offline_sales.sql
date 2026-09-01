-- ==============================================================================
-- HARDEN POS OFFLINE SALE VOID & PERMANENT DELETE
-- Authoritative RPC to safely delete POS offline sales, restore stock, and clean up items
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  v_prod record;
  v_var record;
BEGIN
  -- 1. Auth verification (admin or staff)
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'staff') THEN
      RAISE EXCEPTION 'Only authorized administrators or staff can delete sales';
    END IF;
  END IF;

  -- 2. Verify sale exists and lock it
  SELECT id, sale_number, status, customer_id, total, subtotal INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    -- Sale was already deleted
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Sale was already deleted'
    );
  END IF;

  -- 3. Restore stock for each item if sale was not already cancelled
  IF target_sale.status != 'cancelled' THEN
    FOR target_item IN
      SELECT product_id, product_slug, qty, name, sku, barcode
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
    LOOP
      IF target_item.product_id IS NOT NULL THEN
        -- Atomically restore product stock
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = target_item.product_id
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          UPDATE public.products
          SET stock = stock + target_item.qty
          WHERE id = v_prod.id;

          -- Also update variant if matching SKU/barcode exists
          UPDATE public.product_variants
          SET stock = stock + target_item.qty
          WHERE product_id = v_prod.id
            AND (sku ILIKE target_item.sku OR barcode = target_item.barcode OR name = 'Default');

          -- Log inventory transaction
          INSERT INTO public.inventory_transactions (
            product_id, transaction_type, quantity_change, reference_type, reference_id, notes, created_by
          ) VALUES (
            target_item.product_id,
            'return',
            target_item.qty,
            'offline_sale',
            _sale_id,
            'Restored from deleted POS sale #' || target_sale.sale_number,
            uid
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 4. Revert customer purchase metrics if applicable
  IF target_sale.customer_id IS NOT NULL AND target_sale.status != 'cancelled' THEN
    UPDATE public.pos_customers
    SET total_purchases = GREATEST(0, total_purchases - 1),
        total_spend = GREATEST(0, total_spend - target_sale.total)
    WHERE id = target_sale.customer_id;
  END IF;

  -- 5. Delete child items and sale record
  DELETE FROM public.offline_sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.offline_sales WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Sale #' || target_sale.sale_number || ' deleted and inventory restored successfully.'
  );
END; $$;

-- Maintain backwards compatibility for admin_void_offline_sale
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.admin_delete_offline_sale(_sale_id);
END; $$;

-- Permissions
GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid) TO authenticated, service_role, anon;
