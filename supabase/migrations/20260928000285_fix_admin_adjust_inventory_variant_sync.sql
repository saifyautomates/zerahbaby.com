-- ==============================================================================
-- Migration: 20260928000285_fix_admin_adjust_inventory_variant_sync.sql
-- Description:
-- 1. Perfectly synchronize product stock and product_variants stock on manual
--    admin adjustments (inline +/-, modal edits, and bulk adjustments).
-- 2. Ensure both products table and product_variants table stay 100% in sync.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory(
  _product_id uuid,
  _variant_id uuid DEFAULT NULL,
  _new_stock integer DEFAULT NULL,
  _adjustment_delta integer DEFAULT NULL,
  _reason text DEFAULT 'Manual stock adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  prod record;
  variant record;
  v_prev_stock int;
  v_final_stock int;
  v_delta int;
  v_adj_reason text;
  v_var_count int := 0;
  v_first_var_id uuid;
  v_cur_var_total int := 0;
BEGIN
  -- 1. Lock and fetch parent product
  SELECT id, name, slug, stock, is_active
  INTO prod
  FROM public.products
  WHERE id = _product_id
  FOR UPDATE;

  IF prod.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_adj_reason := COALESCE(NULLIF(trim(_reason), ''), 'Manual stock adjustment');

  -- Count variants
  SELECT count(*), COALESCE(sum(stock), 0), min(id)
  INTO v_var_count, v_cur_var_total, v_first_var_id
  FROM public.product_variants
  WHERE product_id = prod.id;

  -- 2. Determine previous stock and compute target final stock
  IF _variant_id IS NOT NULL THEN
    SELECT id, name, stock
    INTO variant
    FROM public.product_variants
    WHERE id = _variant_id AND product_id = prod.id
    FOR UPDATE;

    IF variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product';
    END IF;
    v_prev_stock := COALESCE(variant.stock, 0);
  ELSE
    v_prev_stock := COALESCE(prod.stock, 0);
  END IF;

  -- 3. Calculate target stock
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

  -- 4. Apply synchronized updates across products and product_variants
  IF _variant_id IS NOT NULL THEN
    -- Update targeted variant
    UPDATE public.product_variants
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = _variant_id;

    -- Update parent product stock to sum of all variants
    UPDATE public.products
    SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = prod.id),
        updated_at = now()
    WHERE id = prod.id;

  ELSE
    -- Parent product adjustment without specific variant
    IF v_var_count = 1 THEN
      -- Single variant: keep 1:1 sync
      UPDATE public.product_variants
      SET stock = v_final_stock,
          updated_at = now()
      WHERE id = v_first_var_id;

      UPDATE public.products
      SET stock = v_final_stock,
          updated_at = now()
      WHERE id = prod.id;

    ELSIF v_var_count > 1 THEN
      -- Multiple variants: adjust primary variant with delta and set parent stock
      UPDATE public.product_variants
      SET stock = GREATEST(0, stock + v_delta),
          updated_at = now()
      WHERE id = v_first_var_id;

      UPDATE public.products
      SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = prod.id),
          updated_at = now()
      WHERE id = prod.id;

    ELSE
      -- No variants: simple product update
      UPDATE public.products
      SET stock = v_final_stock,
          updated_at = now()
      WHERE id = prod.id;
    END IF;
  END IF;

  -- 5. Log auditable inventory transaction
  INSERT INTO public.inventory_transactions (
    product_id,
    variant_id,
    type,
    transaction_type,
    quantity,
    previous_quantity,
    new_quantity,
    reference_type,
    reference_id,
    note,
    notes,
    created_by
  ) VALUES (
    prod.id,
    COALESCE(_variant_id, v_first_var_id),
    'adjustment'::public.inventory_tx_type,
    'adjustment'::public.inventory_tx_type,
    v_delta,
    v_prev_stock,
    v_final_stock,
    'admin_manual_adjustment',
    COALESCE(_variant_id, prod.id),
    v_adj_reason,
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

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory(uuid, uuid, integer, integer, text) TO authenticated, anon, service_role;
