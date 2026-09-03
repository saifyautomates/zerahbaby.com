-- ==============================================================================
-- Migration: 20260928000105_ensure_product_variants_uuid_default.sql
-- Description:
--   Guarantees that public.product_variants.id ALWAYS has a default UUID
--   and an automatic fallback trigger so inserting without an explicit id
--   never throws "null value in column id of relation product_variants violates not-null constraint".
-- ==============================================================================

-- 1. Ensure column default is gen_random_uuid()
ALTER TABLE public.product_variants 
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. Trigger fallback to guarantee id is populated before insert
CREATE OR REPLACE FUNCTION public.trg_ensure_product_variant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_product_variant_id_trg ON public.product_variants;
CREATE TRIGGER ensure_product_variant_id_trg
BEFORE INSERT ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.trg_ensure_product_variant_id();
