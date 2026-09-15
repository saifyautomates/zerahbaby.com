-- =====================================================================
-- Migration: 20260928000241_fix_offline_sale_items_total_column.sql
-- Description: Ensure the "total" column exists on public.offline_sale_items
--              so place_offline_sale inserts safely without column "total" error.
-- =====================================================================

ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0;

UPDATE public.offline_sale_items
SET total = COALESCE(total, subtotal, line_gross_amount, price * COALESCE(quantity, qty, 1), 0)
WHERE total IS NULL OR total = 0;

NOTIFY pgrst, 'reload schema';
