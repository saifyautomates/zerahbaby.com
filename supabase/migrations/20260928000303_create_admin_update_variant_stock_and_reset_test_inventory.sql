-- Migration: 20260928000303_create_admin_update_variant_stock_and_reset_test_inventory.sql
-- Description: Create admin_update_variant_stock RPC and restock test catalog variants to baseline of 15 units.

CREATE OR REPLACE FUNCTION public.admin_update_variant_stock(_variant_id uuid, _new_stock int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_prod_id uuid;
BEGIN
  UPDATE public.product_variants
  SET stock = _new_stock,
      updated_at = now()
  WHERE id = _variant_id
  RETURNING product_id INTO v_prod_id;

  IF v_prod_id IS NOT NULL THEN
    UPDATE public.products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_prod_id),
        updated_at = now()
    WHERE id = v_prod_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'variant_id', _variant_id, 'new_stock', _new_stock);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_variant_stock(uuid, int) TO anon, authenticated, service_role;

-- Restock catalog to 15 per variant and align parent product stocks
UPDATE public.product_variants SET stock = 15;
UPDATE public.products p
SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants v WHERE v.product_id = p.id),
    is_active = true;
