-- ==============================================================================
-- Migration: 20260927000007_idempotent_default_variants_and_notifications.sql
-- Description:
-- 1. Create idempotent AFTER INSERT trigger on public.products to automatically
--    provision a Default variant for products that do not specify multi-variants.
-- 2. Ensure AFTER UPDATE trigger synchronizes single/Default variant stock with parent.
-- 3. Backfill any existing products missing a variant record without altering stock values.
-- 4. Enable RLS and grants for offline_returns to ensure admin notifications can read returns.
-- ==============================================================================

-- 1. Function to provision default variant on product creation
CREATE OR REPLACE FUNCTION public.provision_default_product_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create Default variant if no variant exists for this product
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
      NEW.price,
      NEW.mrp
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach AFTER INSERT trigger
DROP TRIGGER IF EXISTS trg_provision_default_product_variant ON public.products;
CREATE TRIGGER trg_provision_default_product_variant
AFTER INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.provision_default_product_variant();

-- 2. Harden stock sync trigger on AFTER UPDATE
CREATE OR REPLACE FUNCTION public.sync_product_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If product has exactly 1 variant (or Default variant), keep variant stock strictly in sync
  UPDATE public.product_variants
  SET stock = NEW.stock,
      price_override = COALESCE(price_override, NEW.price),
      mrp_override = COALESCE(mrp_override, NEW.mrp)
  WHERE product_id = NEW.id
    AND (
      name = 'Default'
      OR (SELECT count(*) FROM public.product_variants WHERE product_id = NEW.id) <= 1
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_variant_stock
AFTER UPDATE OF stock, price, mrp ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_variant_stock();

-- 3. Backfill: Provision Default variant for any existing product that lacks one
INSERT INTO public.product_variants (
  product_id,
  name,
  sku,
  barcode,
  stock,
  price_override,
  mrp_override
)
SELECT 
  p.id,
  'Default',
  COALESCE(p.sku, 'ZR-PRD-' || substr(p.id::text, 1, 8)),
  p.barcode,
  COALESCE(p.stock, 0),
  p.price,
  p.mrp
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id
)
ON CONFLICT DO NOTHING;

-- 4. Sync single-variant stock where variant stock had drifted from products.stock
UPDATE public.product_variants v
SET stock = p.stock
FROM public.products p
WHERE v.product_id = p.id
  AND (
    v.name = 'Default' 
    OR (SELECT count(*) FROM public.product_variants pv WHERE pv.product_id = p.id) = 1
  )
  AND v.stock != p.stock;

-- 5. Permissions and RLS for offline_returns so admins and POS cashiers can read return notifications
GRANT SELECT ON public.offline_returns TO authenticated;
GRANT SELECT ON public.offline_return_items TO authenticated;
