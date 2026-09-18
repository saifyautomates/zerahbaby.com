-- ==============================================================================
-- Migration: 20260928000265_fix_variant_price_override_sync.sql
-- Description:
-- 1. Reset phantom price_override and mrp_override on Default variants so they
--    always inherit parent product pricing dynamically (prevents stale pricing bug).
-- 2. Update provision_default_product_variant to insert NULL for overrides.
-- 3. Update sync_product_variant_stock trigger to clear overrides for default variants.
-- ==============================================================================

-- 1. Reset phantom price/mrp overrides on default/single variants
UPDATE public.product_variants
SET price_override = NULL,
    mrp_override = NULL
WHERE name = 'Default'
   OR (color IS NULL AND size IS NULL);

-- Specifically ensure all variants of tshirt-short inherit current price
UPDATE public.product_variants
SET price_override = NULL,
    mrp_override = NULL
WHERE product_id IN (SELECT id FROM public.products WHERE slug = 'tshirt-short');

-- 2. Update provision_default_product_variant to avoid hardcoding initial price as override
CREATE OR REPLACE FUNCTION public.provision_default_product_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = NEW.id) THEN
    INSERT INTO public.product_variants (
      product_id,
      name,
      sku,
      barcode,
      stock,
      price_override,
      mrp_override
    ) VALUES (
      NEW.id,
      'Default',
      COALESCE(NEW.sku, 'ZR-PRD-' || substr(NEW.id::text, 1, 8)),
      NEW.barcode,
      COALESCE(NEW.stock, 0),
      NULL,
      NULL
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Update sync_product_variant_stock trigger to clear overrides for default variants
CREATE OR REPLACE FUNCTION public.sync_product_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.product_variants
  SET stock = NEW.stock,
      price_override = CASE
        WHEN name = 'Default' OR (color IS NULL AND size IS NULL) THEN NULL
        ELSE price_override
      END,
      mrp_override = CASE
        WHEN name = 'Default' OR (color IS NULL AND size IS NULL) THEN NULL
        ELSE mrp_override
      END
  WHERE product_id = NEW.id
    AND (
      name = 'Default'
      OR (SELECT count(*) FROM public.product_variants WHERE product_id = NEW.id) <= 1
      OR (color IS NULL AND size IS NULL)
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_variant_stock
AFTER UPDATE OF stock, price, mrp ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_variant_stock();
