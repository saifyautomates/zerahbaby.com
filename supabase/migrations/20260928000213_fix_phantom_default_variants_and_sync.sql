-- ==============================================================================
-- Migration: 20260928000213_fix_phantom_default_variants_and_sync.sql
-- Description:
-- Deactivate phantom unconfigured 'Default' variants that coexist with real variants
-- on products, and synchronize parent product stock strictly to active variants.
-- Preserves all historical sales references without deletion.
-- ==============================================================================

-- Deactivate phantom Default variants where real variants exist
UPDATE public.product_variants
SET is_active = false,
    stock = 0,
    updated_at = now()
WHERE (name = 'Default' AND color IS NULL AND size IS NULL)
  AND product_id IN (
    SELECT v.product_id
    FROM public.product_variants v
    WHERE (v.color IS NOT NULL AND trim(v.color) != '')
       OR (v.size IS NOT NULL AND trim(v.size) != '')
       OR (v.name IS NOT NULL AND v.name != 'Default')
    GROUP BY v.product_id
    HAVING count(*) >= 1
  );

-- Synchronize parent stock to the sum of active variants
UPDATE public.products p
SET stock = COALESCE(sub.total_stock, 0),
    updated_at = now()
FROM (
  SELECT product_id, SUM(stock) AS total_stock
  FROM public.product_variants
  WHERE is_active IS NULL OR is_active = true
  GROUP BY product_id
) sub
WHERE p.id = sub.product_id;

NOTIFY pgrst, 'reload schema';
