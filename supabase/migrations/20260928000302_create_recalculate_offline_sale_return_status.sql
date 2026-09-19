-- Migration: 20260928000302_create_recalculate_offline_sale_return_status.sql
-- Description: Create public.recalculate_offline_sale_return_status function and ensure inline fallback in process_offline_return.

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
    v_new_status := 'completed';
  END IF;

  UPDATE public.offline_sales
  SET return_status = v_new_status,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN v_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_offline_sale_return_status(uuid) TO authenticated, anon, service_role;
