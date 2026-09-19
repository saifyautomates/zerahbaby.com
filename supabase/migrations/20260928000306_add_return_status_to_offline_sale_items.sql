-- Migration: 20260928000306_add_return_status_to_offline_sale_items.sql
-- Description: Add return_status and return tracking columns to public.offline_sale_items to fix "column return_status of relation offline_sale_items does not exist" in process_offline_return.

-- 1. Add return_status column to offline_sale_items
ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS return_status text DEFAULT 'NONE';

-- 2. Ensure return quantity tracking columns exist with defaults
ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS returned_quantity integer DEFAULT 0;

ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS quantity_returned integer DEFAULT 0;

ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS quantity_returnable integer DEFAULT 1;

-- 3. Backfill return_status based on current quantities
UPDATE public.offline_sale_items
SET return_status = CASE
  WHEN COALESCE(quantity_returnable, 0) <= 0 AND COALESCE(returned_quantity, quantity_returned, 0) > 0 THEN 'RETURNED'
  WHEN COALESCE(returned_quantity, quantity_returned, 0) > 0 THEN 'PARTIALLY_RETURNED'
  ELSE 'NONE'
END
WHERE return_status IS NULL;

-- 4. Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.offline_sale_items TO authenticated, service_role, anon;
