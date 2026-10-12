-- ==============================================================================
-- Migration: 20261012000004_cascade_set_null_on_product_variant_fk.sql
-- Purpose:
--   Allow hard deletion of obsolete product_variants without constraint
--   violations by ensuring online_return_items.variant_id is ON DELETE SET NULL.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'online_return_items_variant_id_fkey'
      AND table_name = 'online_return_items'
  ) THEN
    ALTER TABLE public.online_return_items 
      DROP CONSTRAINT online_return_items_variant_id_fkey;
  END IF;

  ALTER TABLE public.online_return_items
    ADD CONSTRAINT online_return_items_variant_id_fkey
    FOREIGN KEY (variant_id)
    REFERENCES public.product_variants(id)
    ON DELETE SET NULL;
END $$;
