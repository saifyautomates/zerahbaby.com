-- ============================================================================
-- Migration: 20260928000314_fix_admin_adjust_inventory_exact_target.sql
-- Purpose:
--   Fix manual admin inventory updates so a product-level target stock is
--   applied exactly for products with multiple active variants.
--
-- Scope:
--   - Manual admin inventory adjustment only.
--   - No changes to online sales, offline POS sales, returns, refunds,
--     cancellations, or historical transaction flows.
--   - Existing product/variant stock synchronization triggers remain
--     authoritative.
-- ============================================================================

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
  v_row record;

  v_prev_stock integer := 0;
  v_final_stock integer := 0;
  v_delta integer := 0;
  v_adj_reason text;

  v_var_count integer := 0;
  v_cur_var_total integer := 0;
  v_first_var_id uuid;

  v_remaining integer := 0;
  v_take integer := 0;
  v_actual_product_stock integer := 0;
BEGIN
  -- Lock the parent product first so concurrent manual adjustments for the
  -- same product are serialized.
  SELECT id, name, slug, stock, is_active
  INTO prod
  FROM public.products
  WHERE id = _product_id
  FOR UPDATE;

  IF prod.id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_adj_reason := COALESCE(
    NULLIF(trim(_reason), ''),
    'Manual stock adjustment'
  );

  /*
   * Lock all active variants and calculate the authoritative current total.
   * This matches the existing parent-stock trigger semantics:
   * active variants are the source for products.stock when variants exist.
   */
  FOR v_row IN
    SELECT id, COALESCE(stock, 0)::integer AS stock
    FROM public.product_variants
    WHERE product_id = prod.id
      AND (is_active IS NULL OR is_active = true)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_var_count := v_var_count + 1;
    v_cur_var_total := v_cur_var_total + v_row.stock;

    IF v_first_var_id IS NULL THEN
      v_first_var_id := v_row.id;
    END IF;
  END LOOP;

  /* Determine the previous quantity represented by this adjustment. */
  IF _variant_id IS NOT NULL THEN
    SELECT id, name, stock, is_active
    INTO variant
    FROM public.product_variants
    WHERE id = _variant_id
      AND product_id = prod.id
    FOR UPDATE;

    IF variant.id IS NULL THEN
      RAISE EXCEPTION 'Variant not found for product';
    END IF;

    v_prev_stock := COALESCE(variant.stock, 0);
  ELSIF v_var_count > 0 THEN
    v_prev_stock := v_cur_var_total;
  ELSE
    v_prev_stock := COALESCE(prod.stock, 0);
  END IF;

  /* Calculate the requested final quantity. */
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

  /*
   * Variant-level adjustment:
   * change only the requested variant. Existing DB triggers reconcile the
   * parent product stock automatically.
   */
  IF _variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = variant.id;

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
      variant.id,
      'adjustment'::public.inventory_tx_type,
      'adjustment'::public.inventory_tx_type,
      v_delta,
      v_prev_stock,
      v_final_stock,
      'admin_manual_adjustment',
      variant.id,
      v_adj_reason,
      v_adj_reason,
      uid
    );

  /*
   * Product-level adjustment:
   * - zero active variants: update products.stock directly.
   * - one active variant: set that variant to the requested total.
   * - multiple active variants:
   *     * positive delta: add it to the deterministic first variant.
   *     * negative delta: remove it across variants until the exact target
   *       total is reached, never allowing any variant below zero.
   *
   * This guarantees the requested product total is actually reached.
   */
  ELSE
    IF v_var_count = 0 THEN
      UPDATE public.products
      SET stock = v_final_stock,
          updated_at = now()
      WHERE id = prod.id;

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
        NULL,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        v_delta,
        v_prev_stock,
        v_final_stock,
        'admin_manual_adjustment',
        prod.id,
        v_adj_reason,
        v_adj_reason,
        uid
      );

    ELSIF v_var_count = 1 THEN
      UPDATE public.product_variants
      SET stock = v_final_stock,
          updated_at = now()
      WHERE id = v_first_var_id;

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
        v_first_var_id,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        v_delta,
        v_prev_stock,
        v_final_stock,
        'admin_manual_adjustment',
        prod.id,
        v_adj_reason,
        v_adj_reason,
        uid
      );

    ELSIF v_delta >= 0 THEN
      UPDATE public.product_variants
      SET stock = COALESCE(stock, 0) + v_delta,
          updated_at = now()
      WHERE id = v_first_var_id;

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
      )
      SELECT
        prod.id,
        id,
        'adjustment'::public.inventory_tx_type,
        'adjustment'::public.inventory_tx_type,
        v_delta,
        COALESCE(stock, 0),
        COALESCE(stock, 0) + v_delta,
        'admin_manual_adjustment',
        prod.id,
        v_adj_reason,
        v_adj_reason,
        uid
      FROM public.product_variants
      WHERE id = v_first_var_id;

    ELSE
      v_remaining := ABS(v_delta);

      FOR v_row IN
        SELECT id, COALESCE(stock, 0)::integer AS stock
        FROM public.product_variants
        WHERE product_id = prod.id
          AND (is_active IS NULL OR is_active = true)
          AND COALESCE(stock, 0) > 0
        ORDER BY stock DESC, id
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_take := LEAST(v_row.stock, v_remaining);

        IF v_take > 0 THEN
          UPDATE public.product_variants
          SET stock = v_row.stock - v_take,
              updated_at = now()
          WHERE id = v_row.id;

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
            v_row.id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            -v_take,
            v_row.stock,
            v_row.stock - v_take,
            'admin_manual_adjustment',
            prod.id,
            v_adj_reason,
            v_adj_reason,
            uid
          );

          v_remaining := v_remaining - v_take;
        END IF;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'Unable to reduce stock by the requested amount';
      END IF;
    END IF;
  END IF;

  /*
   * Read the final parent stock after trigger reconciliation so the response
   * reflects the database's actual current value.
   */
  SELECT COALESCE(stock, 0)
  INTO v_actual_product_stock
  FROM public.products
  WHERE id = prod.id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', prod.id,
    'variant_id', _variant_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_final_stock,
    'product_stock', v_actual_product_stock,
    'delta', v_delta,
    'reason', v_adj_reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory(uuid, uuid, integer, integer, text)
TO authenticated, anon, service_role;
