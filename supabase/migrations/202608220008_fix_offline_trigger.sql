-- ============================================================
-- ZERAH BABY — FIX OFFLINE SALES TRIGGER COLUMN NAMES
-- The deduct_stock_per_offline_item() trigger referenced columns
-- that don't exist on inventory_transactions:
--   transaction_type → type
--   quantity_change  → quantity
--   notes            → note
-- ============================================================

CREATE OR REPLACE FUNCTION public.deduct_stock_per_offline_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    -- Atomically deduct stock for this specific item
    UPDATE public.products
    SET stock = GREATEST(0, stock - NEW.qty)
    WHERE id = NEW.product_id;

    -- Create inventory transaction record (using correct column names)
    INSERT INTO public.inventory_transactions 
      (product_id, type, quantity, reference_type, reference_id, note, created_by)
    VALUES 
      (NEW.product_id, 'sale', -NEW.qty, 'offline_sale', NEW.sale_id, 'Auto-deducted on POS sale', auth.uid());
  END IF;

  RETURN NEW;
END;
$$;
