-- ==============================================================================
-- Migration: 20260928000199_auto_archive_soldout_products.sql
-- Description:
-- Automatically archive sold out products (stock <= 0) and automatically restore
-- them to active status when restocked (stock > 0).
--
-- 1. Triggers on public.products:
--    - BEFORE INSERT OR UPDATE OF stock ON public.products:
--      Ensures that whenever product stock drops to <= 0, is_active is set to false
--      and status is set to 'archived'.
--      When product stock is replenished to > 0, it automatically sets is_active = true
--      and status = 'active' (unless intentionally in 'draft').
-- 2. Enhanced fn_sync_variant_to_product_stock:
--    - Automatically sets parent product is_active and status when variant stocks
--      are updated, depleted, or restored.
-- 3. Retroactive backfill:
--    - Immediately archives any existing zero or negative stock products.
-- ==============================================================================

-- 1. Trigger function for auto-archiving on products table
CREATE OR REPLACE FUNCTION public.fn_auto_archive_soldout_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When stock drops to zero or below, automatically archive the product
  IF NEW.stock <= 0 THEN
    NEW.is_active := false;
    NEW.status := 'archived'::public.product_status;
  -- When stock is replenished to > 0 from a sold out or archived state, automatically restore
  ELSIF NEW.stock > 0 AND (OLD IS NULL OR OLD.stock <= 0 OR OLD.status = 'archived'::public.product_status OR OLD.is_active = false) THEN
    -- Only auto-activate if not intentionally saved as a draft
    IF OLD IS NULL OR OLD.status != 'draft'::public.product_status THEN
      NEW.is_active := true;
      NEW.status := 'active'::public.product_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_archive_soldout_products ON public.products;
CREATE TRIGGER trg_auto_archive_soldout_products
  BEFORE INSERT OR UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_archive_soldout_products();

-- 2. Update variant-to-product sync function to ensure consistency
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod_id uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_total_stock bigint;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_total_stock
  FROM public.product_variants
  WHERE product_id = v_prod_id
    AND (is_active IS NULL OR is_active = true);

  UPDATE public.products
  SET stock = GREATEST(0::bigint, v_total_stock),
      is_active = CASE
        WHEN v_total_stock <= 0 THEN false
        WHEN is_active = false AND status = 'archived'::public.product_status THEN true
        ELSE is_active
      END,
      status = CASE
        WHEN v_total_stock <= 0 THEN 'archived'::public.product_status
        WHEN status = 'archived'::public.product_status AND v_total_stock > 0 THEN 'active'::public.product_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = v_prod_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER INSERT OR UPDATE OF stock, is_active OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();

-- 3. Retroactive backfill: Ensure any existing products with stock <= 0 are archived
UPDATE public.products
SET is_active = false,
    status = 'archived'::public.product_status,
    updated_at = now()
WHERE stock <= 0
  AND (is_active = true OR status != 'archived'::public.product_status);

NOTIFY pgrst, 'reload schema';
