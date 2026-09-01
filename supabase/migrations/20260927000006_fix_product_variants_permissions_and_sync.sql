-- =====================================================================
-- Migration: 20260927000006_fix_product_variants_permissions_and_sync.sql
-- Description:
-- 1. Grant SELECT/ALL permissions on public.product_variants to anon, authenticated, service_role
-- 2. Ensure RLS policies allow reading variants for storefront, POS, and inventory
-- 3. Synchronize variant stock with parent product stock to eliminate false out-of-stock errors
-- 4. Create trigger to automatically keep default variants in sync with product stock
-- =====================================================================

-- 1. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated, service_role;
GRANT SELECT ON public.product_variants TO anon;

-- 2. Ensure RLS policies
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read product_variants" ON public.product_variants;
CREATE POLICY "public read product_variants"
  ON public.product_variants
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "admins manage product_variants" ON public.product_variants;
CREATE POLICY "admins manage product_variants"
  ON public.product_variants
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Synchronize existing variants where stock was 0 or out-of-sync with parent
UPDATE public.product_variants v
SET stock = p.stock
FROM public.products p
WHERE v.product_id = p.id
  AND (v.stock <= 0 OR v.stock IS NULL)
  AND p.stock > 0;

-- 4. Trigger to keep single/default variant stock in sync with parent product stock updates
CREATE OR REPLACE FUNCTION public.sync_product_variant_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If product has 1 variant (or Default variant), keep variant stock in sync with parent product stock
  UPDATE public.product_variants
  SET stock = NEW.stock
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
AFTER UPDATE OF stock ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_variant_stock();
