-- Migration: 20260928000091_fix_admin_delete_single_sale_not_found.sql
-- Description: Fix admin_delete_offline_sale to return a deterministic SALE_NOT_FOUND
-- response when the requested sale does not exist, instead of misleading success with
-- deleted_count: 0.

DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid);
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid, boolean);

CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid,
  _restore_stock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Delegate to the bulk handler
  v_result := public.admin_hard_delete_offline_sales(ARRAY[_sale_id], _restore_stock);

  -- For the single-sale contract, distinguish "not found" from "deleted"
  IF (v_result->>'deleted_count')::int = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SALE_NOT_FOUND',
      'message', 'POS sale not found or already deleted.',
      'deleted_count', 0
    );
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) TO authenticated, anon, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
