-- ==============================================================================
-- Migration: 20260928000208_remove_phantom_default_variants.sql
-- Description:
-- Clean up phantom 'Default' variants that coexist with real sized variants
-- on multi-variant products, and synchronize parent product stock.
-- ==============================================================================

DELETE FROM public.product_variants
WHERE (name = 'Default' OR size IS NULL OR trim(size) = '')
  AND product_id IN (
    SELECT v.product_id
    FROM public.product_variants v
    WHERE v.size IS NOT NULL AND trim(v.size) != ''
    GROUP BY v.product_id
    HAVING count(*) >= 1
  );

-- Synchronize parent stock to the sum of active sized variants
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
