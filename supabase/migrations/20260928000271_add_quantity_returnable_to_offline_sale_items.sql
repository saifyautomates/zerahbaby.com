-- ==============================================================================
-- Migration: 20260928000271_add_quantity_returnable_to_offline_sale_items.sql
-- Description:
-- Fix POS sale crash: "column quantity_returnable of relation offline_sale_items does not exist".
-- Add quantity_returnable column to public.offline_sale_items with safe defaults,
-- backfill from quantity_sold and quantity_returned, and update schema cache.
-- ==============================================================================

-- 1. Add quantity_returnable and returnable_qty columns to public.offline_sale_items
ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS quantity_returnable numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returnable_qty numeric NOT NULL DEFAULT 0;

-- 2. Backfill existing rows with accurate returnable quantity
UPDATE public.offline_sale_items
SET
  quantity_returnable = GREATEST(0, COALESCE(quantity_sold, quantity, qty, 1) - COALESCE(quantity_returned, returned_quantity, 0)),
  returnable_qty = GREATEST(0, COALESCE(quantity_sold, quantity, qty, 1) - COALESCE(quantity_returned, returned_quantity, 0))
WHERE quantity_returnable = 0;

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
