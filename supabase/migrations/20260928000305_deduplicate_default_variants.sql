-- Migration: 20260928000305_deduplicate_default_variants.sql
-- Description: Consolidate duplicate 'Default' variants per product, re-link historical references, combine stock, and clear stale price overrides.

DO $$
DECLARE
  r RECORD;
  canonical_id UUID;
  dup_id UUID;
  total_stock INT;
BEGIN
  FOR r IN (
    SELECT product_id, COUNT(*) as cnt
    FROM public.product_variants
    WHERE lower(trim(name)) = 'default'
    GROUP BY product_id
    HAVING COUNT(*) > 1
  ) LOOP
    -- Pick canonical (first created)
    SELECT id INTO canonical_id
    FROM public.product_variants
    WHERE product_id = r.product_id AND lower(trim(name)) = 'default'
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Calculate total stock across all duplicate defaults
    SELECT COALESCE(SUM(stock), 0) INTO total_stock
    FROM public.product_variants
    WHERE product_id = r.product_id AND lower(trim(name)) = 'default';

    -- Re-link historical references to canonical variant before deleting duplicate
    FOR dup_id IN (
      SELECT id FROM public.product_variants
      WHERE product_id = r.product_id AND lower(trim(name)) = 'default' AND id != canonical_id
    ) LOOP
      UPDATE public.offline_sale_items SET variant_id = canonical_id WHERE variant_id = dup_id;
      UPDATE public.offline_return_items SET variant_id = canonical_id WHERE variant_id = dup_id;
      UPDATE public.inventory_transactions SET variant_id = canonical_id WHERE variant_id = dup_id;
      DELETE FROM public.product_variants WHERE id = dup_id;
    END LOOP;

    -- Update canonical variant with consolidated stock and clear price override
    UPDATE public.product_variants
    SET stock = total_stock,
        price_override = NULL,
        mrp_override = NULL,
        updated_at = now()
    WHERE id = canonical_id;

    -- Align parent product stock
    UPDATE public.products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = r.product_id),
        updated_at = now()
    WHERE id = r.product_id;
  END LOOP;
END $$;
