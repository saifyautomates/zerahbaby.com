-- Migration: 20260928000254_replenish_set_variant_stock.sql
-- Description: Replenish stock for first variant of product 'set' after concurrent test runs.

UPDATE public.product_variants
SET stock = 10,
    is_active = true,
    updated_at = now()
WHERE id = '44a4eabb-6dc1-4e14-bd71-e6c46da43525';
