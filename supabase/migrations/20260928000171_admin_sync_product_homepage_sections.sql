-- Migration: 20260928000171_admin_sync_product_homepage_sections.sql
-- Description: Adds canonical RPC to sync a product's assignment to homepage sections
--              and ensures custom campaign sections default to curated MANUAL mode.

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

  -- 1. Remove product from any sections NOT in p_section_ids
  IF p_section_ids IS NULL OR array_length(p_section_ids, 1) IS NULL THEN
    DELETE FROM public.homepage_section_items
    WHERE product_id = p_product_id;
  ELSE
    DELETE FROM public.homepage_section_items
    WHERE product_id = p_product_id
      AND section_id != ALL(p_section_ids);

    -- 2. Insert into selected sections if not already present
    FOREACH sid IN ARRAY p_section_ids LOOP
      IF sid IS NOT NULL THEN
        INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible)
        VALUES (sid, p_product_id, 999, true)
        ON CONFLICT (section_id, product_id) DO NOTHING;

        -- Ensure section source_type is MANUAL so it strictly respects curated items
        UPDATE public.homepage_sections
        SET source_type = 'MANUAL', updated_at = now()
        WHERE id = sid AND source_type != 'MANUAL';
      END IF;
    END LOOP;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_sync_product_homepage_sections TO authenticated;

-- Ensure custom created campaign sections default to curated MANUAL mode
UPDATE public.homepage_sections
SET source_type = 'MANUAL', updated_at = now()
WHERE title ILIKE '%summer essentials%'
   OR title ILIKE '%diwali specials%';
