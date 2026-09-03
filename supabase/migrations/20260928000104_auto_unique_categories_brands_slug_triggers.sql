-- ==============================================================================
-- Migration: 20260928000104_auto_unique_categories_brands_slug_triggers.sql
-- Description:
--   Guarantees that duplicate slug collisions on categories and brands tables
--   are automatically deduplicated at database level before insert/update.
-- ==============================================================================

-- 1. Categories Auto Unique Slug Trigger
CREATE OR REPLACE FUNCTION public.auto_unique_category_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_slug text;
  v_candidate_slug text;
  v_counter int := 1;
  v_exists boolean;
BEGIN
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := lower(regexp_replace(trim(COALESCE(NEW.name, 'category')), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'category';
    END IF;
  ELSE
    NEW.slug := lower(regexp_replace(trim(NEW.slug), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'category';
    END IF;
  END IF;

  v_base_slug := NEW.slug;
  v_candidate_slug := v_base_slug;

  LOOP
    IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.categories
        WHERE slug = v_candidate_slug AND id != NEW.id
      ) INTO v_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.categories
        WHERE slug = v_candidate_slug
      ) INTO v_exists;
    END IF;

    IF NOT v_exists THEN
      NEW.slug := v_candidate_slug;
      EXIT;
    END IF;

    v_counter := v_counter + 1;
    v_candidate_slug := v_base_slug || '-' || v_counter;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unique_category_slug ON public.categories;
CREATE TRIGGER trg_auto_unique_category_slug
BEFORE INSERT OR UPDATE OF slug, name ON public.categories
FOR EACH ROW
EXECUTE FUNCTION public.auto_unique_category_slug();


-- 2. Brands Auto Unique Slug Trigger
CREATE OR REPLACE FUNCTION public.auto_unique_brand_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_slug text;
  v_candidate_slug text;
  v_counter int := 1;
  v_exists boolean;
BEGIN
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := lower(regexp_replace(trim(COALESCE(NEW.name, 'brand')), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'brand';
    END IF;
  ELSE
    NEW.slug := lower(regexp_replace(trim(NEW.slug), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'brand';
    END IF;
  END IF;

  v_base_slug := NEW.slug;
  v_candidate_slug := v_base_slug;

  LOOP
    IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.brands
        WHERE slug = v_candidate_slug AND id != NEW.id
      ) INTO v_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.brands
        WHERE slug = v_candidate_slug
      ) INTO v_exists;
    END IF;

    IF NOT v_exists THEN
      NEW.slug := v_candidate_slug;
      EXIT;
    END IF;

    v_counter := v_counter + 1;
    v_candidate_slug := v_base_slug || '-' || v_counter;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unique_brand_slug ON public.brands;
CREATE TRIGGER trg_auto_unique_brand_slug
BEFORE INSERT OR UPDATE OF slug, name ON public.brands
FOR EACH ROW
EXECUTE FUNCTION public.auto_unique_brand_slug();
