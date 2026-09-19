-- Migration: 20260928000294_purge_ghost_default_variants.sql
-- Description: Permanently purge orphaned ghost 'Default' variants that coexist with real sized variants.

DELETE FROM public.product_variants
WHERE (name = 'Default' OR size IS NULL)
  AND is_active = false
  AND product_id IN (
    SELECT product_id 
    FROM public.product_variants 
    WHERE size IS NOT NULL AND trim(size) != ''
  );
