-- ==============================================================================
-- Migration: 20260928000149_replenish_catalog_stock.sql
-- Description: Replenish store inventory for standard products and variants
-- ==============================================================================

UPDATE public.products
SET stock = 100, updated_at = now()
WHERE stock < 10;

UPDATE public.product_variants
SET stock = 100, updated_at = now()
WHERE stock < 10;

NOTIFY pgrst, 'reload schema';
