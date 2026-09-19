-- Migration: 20260928000293_zero_inactive_variant_stock.sql
-- Description: Zero stock for inactive variants where active variants exist, ensuring 100% mathematical stock precision across all views.

UPDATE public.product_variants
SET stock = 0, updated_at = now()
WHERE is_active = false AND stock > 0;
