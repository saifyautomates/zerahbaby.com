-- ============================================================
-- ZERAH BABY — SCHEMA CLEANUP
-- Drops legacy redundant columns that were replaced by
-- unified columns.
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- Drop the redundant trigger first
DROP TRIGGER IF EXISTS products_sync_stock ON public.products;
DROP FUNCTION IF EXISTS public.sync_product_stock();

-- Drop redundant columns
ALTER TABLE public.products
  DROP COLUMN IF EXISTS stock_quantity,
  DROP COLUMN IF EXISTS low_stock_threshold,
  DROP COLUMN IF EXISTS featured,
  DROP COLUMN IF EXISTS review_count,
  DROP COLUMN IF EXISTS compare_at_price,
  DROP COLUMN IF EXISTS cost_price;
