-- =============================================================================
-- Migration: 20260928000177_replenish_catalog_stock.sql
-- Description: Replenish zero or depleted inventory stock to standard retail stock
-- so POS terminal scanning and sales can operate smoothly.
-- =============================================================================

UPDATE public.products
SET stock = 100, updated_at = now()
WHERE stock <= 0;

UPDATE public.product_variants
SET stock = 100, updated_at = now()
WHERE stock <= 0;

NOTIFY pgrst, 'reload schema';
