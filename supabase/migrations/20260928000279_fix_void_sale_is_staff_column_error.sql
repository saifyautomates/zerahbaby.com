-- ==============================================================================
-- Migration: 20260928000279_fix_void_sale_is_staff_column_error.sql
-- Description: Fix missing is_staff column on profiles and harden admin_void_offline_sale
-- ==============================================================================

-- 1. Ensure is_staff column exists on profiles table safely
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS is_staff boolean DEFAULT false;

-- 2. Authoritative and Safe admin_void_offline_sale RPC
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');
  v_prev_stock int;
  v_new_stock int;
  net_restore_qty int;
BEGIN
  -- 1. Strict Authorization Check
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR public.has_role(uid, 'pos_user')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'owner')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff', 'pos_user'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  END IF;

  -- 2. Row lock target sale and verify existence
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Sale not found with id: %', _sale_id;
  END IF;

  IF target_sale.notes ILIKE '[VOIDED]%' THEN
    RAISE EXCEPTION 'Sale #% has already been voided', target_sale.sale_number;
  END IF;

  -- 3. Stock restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        IF target_item.variant_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = target_item.variant_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.variant_id;

          -- trg_sync_variant_to_product_stock atomically updates products.stock!

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
            target_item.product_id,
            target_item.variant_id,
            'void'::public.inventory_tx_type,
            'void'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        ELSIF target_item.product_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.products WHERE id = target_item.product_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = target_item.product_id;

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
            target_item.product_id,
            NULL,
            'void'::public.inventory_tx_type,
            'void'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from voided POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        END IF;

        items_restored := items_restored + 1;
        total_units_restored := total_units_restored + net_restore_qty;
      END IF;
    END LOOP;
  END IF;

  -- 4. Mark sale as VOIDED
  UPDATE public.offline_sales
  SET notes = '[VOIDED] ' || v_clean_reason || CASE WHEN trim(COALESCE(notes, '')) != '' THEN ' | Original Notes: ' || notes ELSE '' END,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'voided_by', uid,
    'stock_restored', _restore_stock,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'message', 'Sale #' || target_sale.sale_number || ' voided successfully.'
  );
END;
$$;

-- 3. Authoritative and Safe admin_adjust_inventory RPC
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
BEGIN
  -- 1. Authorization check
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR public.has_role(uid, 'pos_user')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'owner')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff', 'pos_user'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
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

  -- 3. Determine previous stock and compute target final stock
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

  -- 4. Calculate target stock
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

  -- 5. Apply single-source updates
  IF _variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = variant.id;
  ELSE
    UPDATE public.products
    SET stock = v_final_stock,
        updated_at = now()
    WHERE id = prod.id;
  END IF;

  -- 6. Log auditable inventory transaction
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
    _variant_id,
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

-- 4. Authoritative and Safe admin_bulk_void_offline_sales RPC
CREATE OR REPLACE FUNCTION public.admin_bulk_void_offline_sales(
  _sale_ids uuid[],
  _reason text DEFAULT 'Bulk voided by administrator',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_voided_count int := 0;
  v_res jsonb;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR public.has_role(uid, 'staff')
    OR public.has_role(uid, 'pos_user')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'owner')
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff', 'pos_user'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Only administrators can void POS sale records';
  END IF;

  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'voided_count', 0, 'message', 'No sales provided');
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    v_res := public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
    IF (v_res->>'success')::boolean = true THEN
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'voided_count', v_voided_count, 'message', 'Bulk void completed');
END;
$$;

-- 5. Permissions
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory(uuid, uuid, integer, integer, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) TO authenticated, service_role, anon;
