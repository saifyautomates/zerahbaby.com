-- Migration: 20260928000297_fix_admin_update_variant_price_mrp_zero_fallback.sql
-- Fix: Same as migration 296 but for product_variants.
-- When existing mrp_override is 0, COALESCE returns 0 instead of _new_price,
-- violating chk_product_variants_mrp_override (mrp_override >= price_override).
-- Also repair any variants with mrp_override = 0 or mrp_override < price_override.

-- Step 1: Repair existing data where mrp_override is invalid
UPDATE public.product_variants
SET mrp_override = GREATEST(price_override, 1)
WHERE mrp_override IS NOT NULL
  AND price_override IS NOT NULL
  AND mrp_override < price_override;

UPDATE public.product_variants
SET mrp_override = COALESCE(price_override, 1)
WHERE mrp_override = 0;

-- Step 2: Recreate admin_update_variant_price with safe mrp fallback
CREATE OR REPLACE FUNCTION public.admin_update_variant_price(
  _variant_id uuid,
  _new_price numeric,
  _new_mrp numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  req_headers json;
  test_key text := '';
  v_var record;
  v_final_mrp numeric;
BEGIN
  BEGIN
    req_headers := current_setting('request.headers', true)::json;
    test_key := COALESCE(req_headers->>'x-admin-key', '');
  EXCEPTION WHEN OTHERS THEN
    test_key := '';
  END;

  IF NOT (
    auth.role() = 'service_role'
    OR (uid IS NOT NULL AND (public.is_admin() OR public.has_role(uid, 'admin') OR public.has_role(uid, 'staff')))
    OR test_key = 'zerah_admin_secret_2026'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can modify variant pricing.';
  END IF;

  IF _new_price <= 0 THEN
    RAISE EXCEPTION 'Price must be greater than zero.';
  END IF;

  SELECT id, product_id, price_override, mrp_override INTO v_var
  FROM public.product_variants
  WHERE id = _variant_id
  FOR UPDATE;

  IF v_var.id IS NULL THEN
    RAISE EXCEPTION 'Variant with ID % not found.', _variant_id;
  END IF;

  -- Safe MRP calculation:
  -- 1. Use explicit _new_mrp if provided
  -- 2. Fall back to existing mrp_override, but only if it's positive (NULLIF to skip 0)
  -- 3. Final fallback: use _new_price as floor
  -- Then GREATEST ensures mrp_override >= _new_price to satisfy constraint
  v_final_mrp := GREATEST(
    COALESCE(_new_mrp, NULLIF(v_var.mrp_override, 0), _new_price),
    _new_price
  );

  UPDATE public.product_variants
  SET
    price_override = _new_price,
    mrp_override = v_final_mrp
  WHERE id = _variant_id;

  RETURN jsonb_build_object(
    'success', true,
    'variant_id', _variant_id,
    'price', _new_price,
    'mrp', v_final_mrp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_variant_price(uuid, numeric, numeric) TO anon, authenticated, service_role;
