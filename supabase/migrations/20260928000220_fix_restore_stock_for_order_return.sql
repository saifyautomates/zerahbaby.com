-- Migration: 20260928000220_fix_restore_stock_for_order_return.sql
-- Description: Fix restore_stock_for_order to explicitly return 'already_restored', false on initial successful restock.

CREATE OR REPLACE FUNCTION public.restore_stock_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'Order cancellation',
  p_reference_type text DEFAULT 'order'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  item record;
  v_prod record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_item_qty bigint;
  v_restocked_count integer := 0;
BEGIN
  -- Idempotency Guard: Check if inventory has already been restored for this order
  IF EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE reference_id = p_order_id
      AND reference_type = p_reference_type
      AND (type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type)
           OR transaction_type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type))
      AND quantity > 0
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_restored', true,
      'order_id', p_order_id,
      'message', 'Inventory was already restored previously'
    );
  END IF;

  -- Iterate through order items and restore exact variant quantities atomically
  FOR item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
    v_item_qty := GREATEST(1, COALESCE(item.qty, 1));

    IF item.variant_id IS NOT NULL THEN
      -- Lock variant row
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = item.variant_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := COALESCE(v_prev_stock, 0) + v_item_qty;

        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.variant_id;

        -- Parent product stock is automatically updated by trg_sync_variant_to_product_stock!

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
          item.product_id,
          item.variant_id,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          v_item_qty,
          COALESCE(v_prev_stock, 0),
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    ELSIF item.product_id IS NOT NULL THEN
      -- Standalone product without explicit variant_id
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := COALESCE(v_prev_stock, 0) + v_item_qty;

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.product_id;

        -- Keep single default variant in sync if present
        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE product_id = item.product_id
          AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = item.product_id) <= 1);

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
          item.product_id,
          NULL,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          v_item_qty,
          COALESCE(v_prev_stock, 0),
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_restored', false,
    'order_id', p_order_id,
    'restocked_items_count', v_restocked_count,
    'message', 'Inventory successfully restored'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid, text, text) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
