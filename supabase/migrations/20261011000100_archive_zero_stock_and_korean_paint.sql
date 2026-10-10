-- ==============================================================================
-- Migration: 20261011000100_archive_zero_stock_and_korean_paint.sql
-- Description:
-- Strictly archive all products with 0 or negative stock, ensuring KOREAN PAINT
-- (ZR-CL-2878) and all other 0-stock products are marked as archived.
-- ==============================================================================

UPDATE public.products
SET stock = 0,
    is_active = false,
    status = 'archived'::public.product_status,
    updated_at = now()
WHERE stock <= 0
   OR sku = 'ZR-CL-2878';

-- Also ensure any 0-stock variants are deactivated
UPDATE public.product_variants
SET is_active = false,
    updated_at = now()
WHERE stock <= 0;
