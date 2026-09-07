-- 20260928000134_add_order_items_quantity_alias.sql
-- Ensures order_items has both 'quantity' and 'qty' kept in bidirectional synchronization
-- so that queries referencing either column succeed without error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'order_items' 
      AND column_name = 'quantity'
  ) THEN
    ALTER TABLE public.order_items ADD COLUMN quantity integer;
  END IF;
END $$;

UPDATE public.order_items 
SET quantity = qty 
WHERE quantity IS NULL AND qty IS NOT NULL;

UPDATE public.order_items 
SET qty = quantity 
WHERE qty IS NULL AND quantity IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_order_items_qty_and_quantity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.qty IS NOT NULL AND NEW.quantity IS NULL THEN
    NEW.quantity := NEW.qty;
  ELSIF NEW.quantity IS NOT NULL AND NEW.qty IS NULL THEN
    NEW.qty := NEW.quantity;
  ELSIF NEW.qty IS NOT NULL THEN
    NEW.quantity := NEW.qty;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_items_qty_and_quantity ON public.order_items;
CREATE TRIGGER trg_sync_order_items_qty_and_quantity
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_items_qty_and_quantity();

NOTIFY pgrst, 'reload schema';
