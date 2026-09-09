-- ==============================================================================
-- Migration: 20260928000143_enforce_price_positive_constraints.sql
-- Description:
-- 1. Correct test products to valid commercial retail pricing.
-- 2. Add CHECK constraints ensuring product and variant prices are strictly positive.
-- 3. Enforce MRP >= price to prevent nonsensical inverse discounts.
-- ==============================================================================

-- 1. Correct invalid prices on existing products
UPDATE public.products
SET price = 499,
    mrp = 799,
    updated_at = now()
WHERE slug = 'tshirrt' OR price <= 1;

UPDATE public.product_variants
SET price_override = 499,
    mrp_override = 799,
    updated_at = now()
WHERE product_id IN (SELECT id FROM public.products WHERE slug = 'tshirrt');

-- 2. Ensure saify is also consistent
UPDATE public.products
SET price = 699,
    mrp = 999,
    updated_at = now()
WHERE slug = 'saify';

UPDATE public.product_variants
SET price_override = 699,
    mrp_override = 999,
    updated_at = now()
WHERE product_id IN (SELECT id FROM public.products WHERE slug = 'saify');

-- 3. Add CHECK constraints on public.products
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_price_positive,
  ADD CONSTRAINT chk_products_price_positive CHECK (price > 0);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_mrp_nonnegative,
  ADD CONSTRAINT chk_products_mrp_nonnegative CHECK (mrp >= price);

-- 4. Add CHECK constraints on public.product_variants
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS chk_product_variants_price_override,
  ADD CONSTRAINT chk_product_variants_price_override CHECK (price_override IS NULL OR price_override > 0);

ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS chk_product_variants_mrp_override,
  ADD CONSTRAINT chk_product_variants_mrp_override CHECK (mrp_override IS NULL OR mrp_override >= COALESCE(price_override, 0));

NOTIFY pgrst, 'reload schema';
