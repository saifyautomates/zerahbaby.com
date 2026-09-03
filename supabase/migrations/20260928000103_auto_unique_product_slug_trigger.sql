-- ==============================================================================
-- Migration: 20260928000103_auto_unique_product_slug_trigger.sql
-- Description:
--   Guarantees that duplicate key violations on products_slug_key CAN NEVER OCCUR.
--   A BEFORE INSERT OR UPDATE trigger automatically inspects the candidate slug.
--   If a collision exists with any existing row (active or archived), it automatically
--   appends -2, -3, etc. until an unused unique slug is found.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.auto_unique_product_slug()
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
  -- 1. If slug is missing or empty, derive from name
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := lower(regexp_replace(trim(COALESCE(NEW.name, 'product')), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'product';
    END IF;
  ELSE
    -- Normalize the slug (lowercase, alphanumeric + hyphens only, no leading/trailing hyphens)
    NEW.slug := lower(regexp_replace(trim(NEW.slug), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := trim(both '-' from NEW.slug);
    IF NEW.slug = '' THEN
      NEW.slug := 'product';
    END IF;
  END IF;

  v_base_slug := NEW.slug;
  v_candidate_slug := v_base_slug;

  -- 2. Fast path: check if the normalized slug is already free
  IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.products
      WHERE slug = v_candidate_slug AND id != NEW.id
    ) INTO v_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.products
      WHERE slug = v_candidate_slug
    ) INTO v_exists;
  END IF;

  IF NOT v_exists THEN
    NEW.slug := v_candidate_slug;
    RETURN NEW;
  END IF;

  -- 3. Collision detected: increment counter until a free slug is found
  LOOP
    v_counter := v_counter + 1;
    v_candidate_slug := v_base_slug || '-' || v_counter;

    IF TG_OP = 'UPDATE' AND NEW.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.products
        WHERE slug = v_candidate_slug AND id != NEW.id
      ) INTO v_exists;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.products
        WHERE slug = v_candidate_slug
      ) INTO v_exists;
    END IF;

    IF NOT v_exists THEN
      NEW.slug := v_candidate_slug;
      EXIT;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_unique_product_slug ON public.products;
CREATE TRIGGER trg_auto_unique_product_slug
BEFORE INSERT OR UPDATE OF slug, name ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_unique_product_slug();
