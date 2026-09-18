-- Migration: 20260928000276_restock_and_activate_initial_products.sql
-- Description: Restock core store catalog products and reactivate active variants

-- 1. Set healthy inventory for active variants
UPDATE public.product_variants
SET stock = 25,
    is_active = true,
    updated_at = now()
WHERE name != 'Default' OR product_id NOT IN (
  SELECT product_id FROM public.product_variants WHERE name != 'Default'
);

-- 2. Ensure parent product stock matches variant totals and reactivates
UPDATE public.products p
SET stock = COALESCE((
      SELECT SUM(pv.stock)
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
        AND pv.is_active = true
    ), 25),
    is_active = true,
    status = 'active',
    updated_at = now();

NOTIFY pgrst, 'reload schema';
