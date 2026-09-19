-- Migration: 20260928000304_fix_offline_sales_return_status_constraint_and_recalc.sql
-- Description: Align offline_sales_return_status_check constraint and recalculate_offline_sale_return_status to valid values ('none', 'partially_returned', 'returned', 'fully_returned', 'completed').

-- 1. Relax check constraint on offline_sales.return_status
ALTER TABLE public.offline_sales DROP CONSTRAINT IF EXISTS offline_sales_return_status_check;
ALTER TABLE public.offline_sales ADD CONSTRAINT offline_sales_return_status_check 
  CHECK (return_status IN ('none', 'partially_returned', 'returned', 'fully_returned', 'completed'));

-- 2. Update recalculate_offline_sale_return_status to strictly use canonical values
CREATE OR REPLACE FUNCTION public.recalculate_offline_sale_return_status(_sale_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_has_unreturned boolean;
  v_has_returned boolean;
  v_new_status text;
BEGIN
  IF _sale_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.offline_sale_items
      WHERE sale_id = _sale_id
        AND GREATEST(0, COALESCE(quantity_returnable, quantity_sold, qty, 1) - COALESCE(quantity_returned, returned_quantity, 0)) > 0
    ),
    EXISTS (
      SELECT 1 FROM public.offline_sale_items
      WHERE sale_id = _sale_id
        AND COALESCE(quantity_returned, returned_quantity, 0) > 0
    )
  INTO v_has_unreturned, v_has_returned;

  IF v_has_returned THEN
    IF v_has_unreturned THEN
      v_new_status := 'partially_returned';
    ELSE
      v_new_status := 'returned';
    END IF;
  ELSE
    v_new_status := 'none';
  END IF;

  UPDATE public.offline_sales
  SET return_status = v_new_status,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN v_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_offline_sale_return_status(uuid) TO authenticated, anon, service_role;
