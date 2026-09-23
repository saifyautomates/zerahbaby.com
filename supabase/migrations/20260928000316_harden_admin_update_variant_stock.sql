-- ============================================================================
-- Migration: 20260928000316_harden_admin_update_variant_stock.sql
-- Purpose:
--   Harden the existing admin_update_variant_stock RPC without changing its
--   stock-update behavior.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_variant_stock(
  _variant_id uuid,
  _new_stock int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_prod_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(uid, 'admin')
     AND NOT public.has_role(uid, 'staff') THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can update variant stock';
  END IF;

  UPDATE public.product_variants
  SET stock = _new_stock,
      updated_at = now()
  WHERE id = _variant_id
  RETURNING product_id INTO v_prod_id;

  IF v_prod_id IS NOT NULL THEN
    UPDATE public.products
    SET stock = (
      SELECT COALESCE(SUM(stock), 0)
      FROM public.product_variants
      WHERE product_id = v_prod_id
    ),
    updated_at = now()
    WHERE id = v_prod_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'variant_id', _variant_id,
    'new_stock', _new_stock
  );
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.admin_update_variant_stock(uuid, integer)
FROM anon;

GRANT EXECUTE
ON FUNCTION public.admin_update_variant_stock(uuid, integer)
TO authenticated, service_role;
