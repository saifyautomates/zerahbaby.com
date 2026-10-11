-- ==============================================================================
-- Migration: 20261012000001_reconcile_unlinked_return_items.sql
-- Description:
-- Reconcile unlinked return items with their original sale items.
-- Automatically links offline_return_items to offline_sale_items when the return
-- has an original_sale_id or original_sale_number and the items match by SKU/barcode/product.
-- Decrements remaining returnable quantities to prevent duplicate return vulnerability.
-- ==============================================================================

DO $$
DECLARE
  r_rec RECORD;
  s_item RECORD;
BEGIN
  -- 1. Loop through offline_return_items that lack original_sale_item_id
  -- but belong to an offline_return that has an original_sale_id or original_sale_number
  FOR r_rec IN 
    SELECT 
      ri.id AS return_item_id,
      ri.return_id,
      ri.qty,
      ri.sku,
      ri.barcode,
      ri.product_id,
      r.original_sale_id,
      r.original_sale_number
    FROM public.offline_return_items ri
    JOIN public.offline_returns r ON r.id = ri.return_id
    WHERE ri.original_sale_item_id IS NULL
      AND (r.original_sale_id IS NOT NULL OR r.original_sale_number IS NOT NULL)
  LOOP
    -- Find matching unreturned or partially returned item in the original sale
    SELECT osi.id, osi.sale_id, osi.quantity_sold, osi.quantity_returned, osi.qty
    INTO s_item
    FROM public.offline_sale_items osi
    JOIN public.offline_sales os ON os.id = osi.sale_id
    WHERE (
      (r_rec.original_sale_id IS NOT NULL AND osi.sale_id = r_rec.original_sale_id)
      OR
      (r_rec.original_sale_number IS NOT NULL AND os.sale_number = r_rec.original_sale_number)
    )
    AND (
      (r_rec.sku IS NOT NULL AND r_rec.sku != '' AND osi.sku = r_rec.sku)
      OR
      (r_rec.barcode IS NOT NULL AND r_rec.barcode != '' AND osi.barcode = r_rec.barcode)
      OR
      (r_rec.product_id IS NOT NULL AND osi.product_id = r_rec.product_id)
    )
    AND COALESCE(osi.quantity_returned, osi.returned_quantity, 0) < COALESCE(osi.quantity_sold, osi.qty, 1)
    LIMIT 1;

    IF s_item.id IS NOT NULL THEN
      -- Link original_sale_item_id on the return item
      UPDATE public.offline_return_items
      SET original_sale_item_id = s_item.id
      WHERE id = r_rec.return_item_id;

      -- Update the offline_sale_items row
      UPDATE public.offline_sale_items
      SET 
        quantity_returned = LEAST(
          COALESCE(quantity_sold, qty, 1),
          COALESCE(quantity_returned, returned_quantity, 0) + r_rec.qty
        ),
        returned_quantity = LEAST(
          COALESCE(quantity_sold, qty, 1),
          COALESCE(returned_quantity, quantity_returned, 0) + r_rec.qty
        ),
        quantity_returnable = GREATEST(
          0,
          COALESCE(quantity_sold, qty, 1) - (COALESCE(quantity_returned, returned_quantity, 0) + r_rec.qty)
        ),
        returnable_qty = GREATEST(
          0,
          COALESCE(quantity_sold, qty, 1) - (COALESCE(quantity_returned, returned_quantity, 0) + r_rec.qty)
        ),
        return_status = CASE
          WHEN COALESCE(quantity_sold, qty, 1) <= (COALESCE(quantity_returned, returned_quantity, 0) + r_rec.qty)
            THEN 'fully_returned'
          ELSE 'partially_returned'
        END,
        updated_at = now()
      WHERE id = s_item.id;
    END IF;
  END LOOP;

  -- 2. Specifically update offline_sales return status & returned_amount
  UPDATE public.offline_sales s
  SET 
    returned_amount = (
      SELECT COALESCE(SUM(ri.refund_price * ri.qty), 0)
      FROM public.offline_return_items ri
      JOIN public.offline_sale_items osi ON osi.id = ri.original_sale_item_id
      WHERE osi.sale_id = s.id
    ),
    return_status = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM public.offline_sale_items osi
        WHERE osi.sale_id = s.id
          AND COALESCE(osi.returnable_qty, osi.quantity_returnable, 1) > 0
      ) THEN 'fully_returned'
      WHEN EXISTS (
        SELECT 1 FROM public.offline_sale_items osi
        WHERE osi.sale_id = s.id
          AND COALESCE(osi.already_returned_qty, osi.quantity_returned, 0) > 0
      ) THEN 'partially_returned'
      ELSE s.return_status
    END,
    updated_at = now()
  WHERE s.sale_number = 'POS-261004-93245'
     OR EXISTS (
       SELECT 1 FROM public.offline_returns r
       WHERE (r.original_sale_id = s.id OR r.original_sale_number = s.sale_number)
     );
END $$;
