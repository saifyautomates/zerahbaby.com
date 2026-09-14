-- ==============================================================================
-- Migration: 20260928000212_auto_archive_zero_stock_strict.sql
-- Description:
-- Strictly and automatically archive products when stock reaches 0 or below (is_active = false, status = 'archived').
-- Automatically restore products to active status when stock is replenished (> 0).
--
-- 1. Triggers on public.products:
--    BEFORE INSERT OR UPDATE ON public.products
--    Ensures that regardless of update payload, if stock <= 0, the product is immediately
--    archived (is_active = false, status = 'archived').
-- 2. Enhanced fn_sync_variant_to_product_stock:
--    When all variants of a product reach 0 or negative stock, parent product is
--    atomically archived.
-- 3. Retroactive backfill:
--    Archives all existing products where stock <= 0.
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
    NEW.stock := 0;
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

-- Drop and recreate without column restriction so ANY update resulting in stock <= 0 archives the product
DROP TRIGGER IF EXISTS trg_auto_archive_soldout_products ON public.products;
CREATE TRIGGER trg_auto_archive_soldout_products
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_archive_soldout_products();

-- 2. Update variant-to-product sync function to ensure strict archiving on variant depletion
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod_id uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_total_stock bigint;
  v_curr_stock bigint;
  v_curr_is_active boolean;
  v_curr_status public.product_status;
BEGIN
  IF v_prod_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Compute true sum of active variants
  SELECT COALESCE(SUM(stock), 0) INTO v_total_stock
  FROM public.product_variants
  WHERE product_id = v_prod_id
    AND (is_active IS NULL OR is_active = true);

  -- Fetch current parent product state
  SELECT stock, is_active, status
  INTO v_curr_stock, v_curr_is_active, v_curr_status
  FROM public.products
  WHERE id = v_prod_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only perform update if parent values actually differ to avoid unnecessary loops
  IF v_curr_stock IS DISTINCT FROM GREATEST(0::bigint, v_total_stock)
     OR (v_total_stock <= 0 AND v_curr_is_active = true)
     OR (v_total_stock > 0 AND v_curr_status = 'archived'::public.product_status) THEN

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
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER INSERT OR UPDATE OF stock, is_active OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();

-- 3. Retroactive backfill: Ensure all products with stock <= 0 are immediately archived
UPDATE public.products
SET stock = 0,
    is_active = false,
    status = 'archived'::public.product_status,
    updated_at = now()
WHERE stock <= 0
  AND (is_active = true OR status != 'archived'::public.product_status);
