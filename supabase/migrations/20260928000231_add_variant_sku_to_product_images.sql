-- Migration: 20260928000231_add_variant_sku_to_product_images.sql
-- Description: Add variant_id, variant_sku, and media_type to product_images table to support variant-wise photos/videos.

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_sku text,
  ADD COLUMN IF NOT EXISTS media_type text DEFAULT 'image';

CREATE INDEX IF NOT EXISTS idx_product_images_variant_sku ON public.product_images(variant_sku);
CREATE INDEX IF NOT EXISTS idx_product_images_variant_id ON public.product_images(variant_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_variant ON public.product_images(product_id, variant_sku);

-- Ensure permissions
GRANT SELECT ON public.product_images TO anon;
GRANT ALL ON public.product_images TO authenticated, service_role;
