-- ============================================================================
-- Migration: 20260928000317_atomic_admin_variant_stock_update.sql
-- Purpose:
--   Make the admin variant-stock editor atomic and database-authoritative.
--   Prevent direct client writes from partially updating variants/parent stock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_replace_product_variant_stock(
  _product_id uuid,
  _variants jsonb,
  _delete_variant_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_product record;
  v_item record;
  v_existing record;
  v_prev integer;
  v_new integer;
  v_total integer;
  v_count integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(uid, 'admin')
     AND NOT public.has_role(uid, 'staff') THEN
    RAISE EXCEPTION 'Only authorized administrators or staff can update inventory';
  END IF;

  IF _variants IS NULL OR jsonb_typeof(_variants) <> 'array' THEN
    RAISE EXCEPTION 'Variant stock payload must be a JSON array';
  END IF;

  SELECT id, stock
  INTO v_product
  FROM public.products
  WHERE id = _product_id
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  -- Lock and validate every submitted variant before changing anything.
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(_variants)
      AS x(variant_id uuid, new_stock integer)
  LOOP
    IF v_item.variant_id IS NULL THEN
      RAISE EXCEPTION 'Variant id is required';
    END IF;

    IF v_item.new_stock IS NULL OR v_item.new_stock < 0 THEN
      RAISE EXCEPTION 'Variant stock cannot be negative or null';
    END IF;

    SELECT id, product_id, COALESCE(stock, 0)::integer AS stock
    INTO v_existing
    FROM public.product_variants
    WHERE id = v_item.variant_id
      AND product_id = _product_id
    FOR UPDATE;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'Variant % does not belong to this product', v_item.variant_id;
    END IF;
  END LOOP;

  -- Validate deletions before mutating rows.
  IF COALESCE(array_length(_delete_variant_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(_delete_variant_ids) AS d(id)
      LEFT JOIN public.product_variants pv
        ON pv.id = d.id AND pv.product_id = _product_id
      WHERE pv.id IS NULL
    ) THEN
      RAISE EXCEPTION 'One or more variants selected for deletion do not belong to this product';
    END IF;

    SELECT count(*)
    INTO v_count
    FROM public.product_variants
    WHERE product_id = _product_id
      AND (is_active IS NULL OR is_active = true);

    IF v_count - (
      SELECT count(*)
      FROM public.product_variants
      WHERE product_id = _product_id
        AND id = ANY(_delete_variant_ids)
        AND (is_active IS NULL OR is_active = true)
    ) <= 0 THEN
      RAISE EXCEPTION 'A product must maintain at least one active variant';
    END IF;
  END IF;

  -- Apply stock changes atomically and keep an audit trail.
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(_variants)
      AS x(variant_id uuid, new_stock integer)
  LOOP
    SELECT COALESCE(stock, 0)::integer
    INTO v_prev
    FROM public.product_variants
    WHERE id = v_item.variant_id
    FOR UPDATE;

    v_new := v_item.new_stock;

    IF v_prev IS DISTINCT FROM v_new THEN
      UPDATE public.product_variants
      SET stock = v_new,
          updated_at = now()
      WHERE id = v_item.variant_id;

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
        _product_id,
        v_item.variant_id,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        v_new - v_prev,
        v_prev,
        v_new,
        'admin_variant_stock_editor',
        v_item.variant_id,
        'Admin variant stock update',
        'Admin variant stock update',
        uid
      );
    END IF;
  END LOOP;

  IF COALESCE(array_length(_delete_variant_ids, 1), 0) > 0 THEN
    DELETE FROM public.product_variants
    WHERE product_id = _product_id
      AND id = ANY(_delete_variant_ids);
  END IF;

  -- Never allow a phantom Default variant to coexist with real variants.
  IF EXISTS (
    SELECT 1
    FROM public.product_variants
    WHERE product_id = _product_id
      AND (is_active IS NULL OR is_active = true)
      AND (
        NULLIF(trim(COALESCE(color, '')), '') IS NOT NULL
        OR NULLIF(trim(COALESCE(size, '')), '') IS NOT NULL
        OR NULLIF(trim(COALESCE(name, '')), '') IS NOT NULL
           AND trim(name) <> ''
           AND trim(name) <> 'Default'
      )
  ) THEN
    UPDATE public.product_variants
    SET is_active = false,
        stock = 0,
        updated_at = now()
    WHERE product_id = _product_id
      AND lower(trim(COALESCE(name, ''))) = 'default'
      AND NULLIF(trim(COALESCE(color, '')), '') IS NULL
      AND NULLIF(trim(COALESCE(size, '')), '') IS NULL;
  END IF;

  -- Parent stock is always derived from active variants.
  SELECT COALESCE(SUM(stock), 0)::integer
  INTO v_total
  FROM public.product_variants
  WHERE product_id = _product_id
    AND (is_active IS NULL OR is_active = true);

  UPDATE public.products
  SET stock = v_total,
      updated_at = now()
  WHERE id = _product_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', _product_id,
    'stock', v_total
  );
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.admin_replace_product_variant_stock(uuid, jsonb, uuid[])
FROM anon;

GRANT EXECUTE
ON FUNCTION public.admin_replace_product_variant_stock(uuid, jsonb, uuid[])
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
