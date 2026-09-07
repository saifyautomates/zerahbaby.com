-- ==============================================================================
-- Migration: 20260928000110_fix_sync_product_variant_stock_trigger.sql
-- Description:
-- 1. Fix sync_product_variant_stock trigger which erroneously synced the parent product's
--    total stock to the 'Default' variant even when multiple variants existed.
--    This caused the Default variant to artificially inflate and absorb the sum of all
--    other variants' stock whenever the parent product was updated.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sync_product_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only strictly sync variant stock if the product has EXACTLY 1 variant.
  -- If it has multiple variants, products.stock represents the SUM of all variants,
  -- so we should NOT overwrite any individual variant's stock with the parent's sum.
  IF (SELECT count(*) FROM public.product_variants WHERE product_id = NEW.id) <= 1 THEN
    UPDATE public.product_variants
    SET stock = NEW.stock,
        price_override = COALESCE(price_override, NEW.price),
        mrp_override = COALESCE(mrp_override, NEW.mrp)
    WHERE product_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;
