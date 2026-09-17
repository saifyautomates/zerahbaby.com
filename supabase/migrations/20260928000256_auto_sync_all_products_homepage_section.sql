-- Migration: 20260928000256_auto_sync_all_products_homepage_section.sql
-- Description: Ensures "All Products" homepage section is automatic (source_type = 'ALL')
--              and newly created / uploaded products are automatically linked to it.

-- 1. Update check constraint on homepage_sections to allow 'ALL'
ALTER TABLE public.homepage_sections DROP CONSTRAINT IF EXISTS homepage_sections_source_type_check;
ALTER TABLE public.homepage_sections ADD CONSTRAINT homepage_sections_source_type_check
  CHECK (source_type = ANY (ARRAY['MANUAL'::text, 'ALL'::text, 'BESTSELLERS'::text, 'NEW_ARRIVALS'::text, 'DISCOUNTED'::text, 'CATEGORY'::text]));

-- 2. Update existing "All Products" section to source_type = 'ALL'
UPDATE public.homepage_sections
SET source_type = 'ALL', updated_at = now()
WHERE slug = 'all-products' OR title ILIKE 'All Products';

-- 3. Update admin_sync_product_homepage_sections RPC so it never forces 'ALL' or 'all-products' sections into 'MANUAL'
CREATE OR REPLACE FUNCTION public.admin_sync_product_homepage_sections(
  p_product_id uuid,
  p_section_ids uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid uuid;
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  IF p_product_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Remove product from any manual sections NOT in p_section_ids
  IF p_section_ids IS NULL OR array_length(p_section_ids, 1) IS NULL THEN
    DELETE FROM public.homepage_section_items
    WHERE product_id = p_product_id
      AND section_id IN (
        SELECT id FROM public.homepage_sections
        WHERE source_type != 'ALL' AND slug != 'all-products' AND title NOT ILIKE 'All Products'
      );
  ELSE
    DELETE FROM public.homepage_section_items
    WHERE product_id = p_product_id
      AND section_id != ALL(p_section_ids)
      AND section_id IN (
        SELECT id FROM public.homepage_sections
        WHERE source_type != 'ALL' AND slug != 'all-products' AND title NOT ILIKE 'All Products'
      );

    -- 2. Insert into selected sections if not already present
    FOREACH sid IN ARRAY p_section_ids LOOP
      IF sid IS NOT NULL THEN
        INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible)
        VALUES (sid, p_product_id, 999, true)
        ON CONFLICT (section_id, product_id) DO NOTHING;

        -- Ensure section source_type is MANUAL only if it's not an ALL section
        UPDATE public.homepage_sections
        SET source_type = 'MANUAL', updated_at = now()
        WHERE id = sid
          AND source_type != 'MANUAL'
          AND source_type != 'ALL'
          AND slug != 'all-products'
          AND title NOT ILIKE 'All Products';
      END IF;
    END LOOP;
  END IF;

  -- 3. Always ensure product is linked to any 'ALL' or 'all-products' sections
  INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible)
  SELECT id, p_product_id, 999, true
  FROM public.homepage_sections
  WHERE source_type = 'ALL' OR slug = 'all-products' OR title ILIKE 'All Products'
  ON CONFLICT (section_id, product_id) DO NOTHING;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_sync_product_homepage_sections TO authenticated;

-- 4. Database Trigger: whenever ANY product is inserted, automatically link it to 'ALL' / 'all-products' sections
CREATE OR REPLACE FUNCTION public.trg_auto_add_product_to_all_sections()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  FOR s IN
    SELECT id FROM public.homepage_sections
    WHERE source_type = 'ALL' OR slug = 'all-products' OR title ILIKE 'All Products'
  LOOP
    INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible)
    VALUES (s.id, NEW.id, 999, true)
    ON CONFLICT (section_id, product_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_add_product_to_all_sections ON public.products;
CREATE TRIGGER trg_auto_add_product_to_all_sections
  AFTER INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_add_product_to_all_sections();

-- 5. Seed existing products into 'ALL' / 'all-products' sections
INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible)
SELECT s.id, p.id, 999, true
FROM public.homepage_sections s
CROSS JOIN public.products p
WHERE (s.source_type = 'ALL' OR s.slug = 'all-products' OR s.title ILIKE 'All Products')
ON CONFLICT (section_id, product_id) DO NOTHING;
