-- Add a product-level size field for the admin Age Group + Size controls.
-- Variant sizes remain stored on product_variants.size.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size text;

COMMENT ON COLUMN public.products.size IS 'Product-level size selection (1/2/3/4 or custom). Variant-specific sizes remain on product_variants.size.';
