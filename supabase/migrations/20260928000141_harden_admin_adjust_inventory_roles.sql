-- ==============================================================================
-- Migration: 20260928000141_harden_admin_adjust_inventory_roles.sql
-- Description:
-- 1. Harden authorization in admin_adjust_inventory to allow service_role, owner,
--    manager, staff, and admin users.
-- 2. Ensure anonymous unauthenticated callers are strictly rejected.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _new_stock integer DEFAULT NULL,
  _adjustment_delta integer DEFAULT NULL,
  _reason text DEFAULT 'Manual adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prod record;
  variant record;
  v_prev_stock int;
  v_final_stock int;
  v_delta int;
  v_adj_reason text;
  v_parent_final_stock int;
BEGIN
  -- 1. Authorization check
  IF auth.role() = 'service_role' THEN
    -- service_role is trusted system execution
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can adjust inventory';
  END IF;

  -- 2. Lock and fetch parent product
  SELECT id, name, slug, stock, is_active
  INTO prod
  FROM public.products
  WHERE id = _product_id
  FOR UPDATE;

  IF prod.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_adj_reason := COALESCE(NULLIF(trim(_reason), ''), 'Manual stock adjustment');

  -- 3. If variant specified, lock and fetch variant to compute deltas based on variant stock
  IF _variant_id IS NOT NULL THEN
    SELECT id, name, stock
    INTO variant
    FROM public.product_variants
    WHERE id = _variant_id AND product_id = prod.id
    FOR UPDATE;

    IF variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant not found';
    END IF;

    v_prev_stock := variant.stock;
  ELSE
    v_prev_stock := prod.stock;
  END IF;

  -- 4. Compute new stock level and delta
  IF _new_stock IS NOT NULL THEN
    IF _new_stock < 0 THEN
      RAISE EXCEPTION 'Stock level cannot be negative';
    END IF;
    v_final_stock := _new_stock;
    v_delta := _new_stock - v_prev_stock;
  ELSIF _adjustment_delta IS NOT NULL THEN
    IF (v_prev_stock + _adjustment_delta) < 0 THEN
      RAISE EXCEPTION 'Adjustment would result in negative stock';
    END IF;
    v_final_stock := v_prev_stock + _adjustment_delta;
    v_delta := _adjustment_delta;
  ELSE
    RAISE EXCEPTION 'Either _new_stock or _adjustment_delta must be provided';
  END IF;

  -- 5. Apply updates
  IF _variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_final_stock
    WHERE id = variant.id;
    
    v_parent_final_stock := GREATEST(0, prod.stock + v_delta);
  ELSE
    -- If single/default variant, keep it in sync
    UPDATE public.product_variants
    SET stock = v_final_stock
    WHERE product_id = prod.id
      AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = prod.id) <= 1);
      
    v_parent_final_stock := v_final_stock;
  END IF;

  -- 6. Update parent product stock
  UPDATE public.products
  SET stock = v_parent_final_stock
  WHERE id = prod.id;

  -- 7. Log auditable inventory transaction
  INSERT INTO public.inventory_transactions (
    product_id,
    variant_id,
    type,
    quantity,
    previous_quantity,
    new_quantity,
    reference_type,
    reference_id,
    note,
    created_by
  ) VALUES (
    prod.id,
    _variant_id,
    'adjustment'::public.inventory_tx_type,
    v_delta,
    v_prev_stock,
    v_final_stock,
    'manual_adjustment',
    prod.id,
    v_adj_reason,
    uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', prod.id,
    'variant_id', _variant_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_final_stock,
    'delta', v_delta,
    'reason', v_adj_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_inventory FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
