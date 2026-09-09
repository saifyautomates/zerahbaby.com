-- ==============================================================================
-- Migration: 20260928000142_seed_safe_test_inventory.sql
-- Description: Replenish catalog inventory for live store products and variants
-- ==============================================================================

UPDATE public.products
SET stock = 50, updated_at = now()
WHERE slug IN ('saify', 'tshirrt');

UPDATE public.product_variants
SET stock = 50, updated_at = now()
WHERE product_id IN (SELECT id FROM public.products WHERE slug IN ('saify', 'tshirrt'));

NOTIFY pgrst, 'reload schema';
