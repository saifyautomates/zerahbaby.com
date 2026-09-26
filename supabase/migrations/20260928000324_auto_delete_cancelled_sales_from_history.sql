-- ==============================================================================
-- Migration: 20260928000324_auto_delete_cancelled_sales_from_history.sql
-- Description: Automatically delete cancelled/voided POS sales from sales history.
--              Do not store cancelled sales in history.
--              When a sale is cancelled:
--                1. Restore inventory stock (variants and products) & record audit tx
--                2. Restore store credit / vouchers if used
--                3. Revert customer purchase totals and counts
--                4. Safely unlink foreign key references
--                5. Hard delete sale items and the sale itself so it never lingers
-- ==============================================================================

-- Step 1: Clean up any existing cancelled/voided sales sitting in offline_sales
DO $$
BEGIN
  -- Unlink offline_return_items referencing cancelled sales
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_return_items') THEN
    UPDATE public.offline_return_items
    SET original_sale_item_id = NULL
    WHERE original_sale_item_id IN (
      SELECT id FROM public.offline_sale_items
      WHERE sale_id IN (
        SELECT id FROM public.offline_sales
        WHERE status IN ('cancelled', 'voided')
           OR is_voided = true
           OR notes ILIKE '[VOIDED]%'
      )
    );
  END IF;

  -- Unlink offline_returns referencing cancelled sales
  UPDATE public.offline_returns
  SET original_sale_id = NULL
  WHERE original_sale_id IN (
    SELECT id FROM public.offline_sales
    WHERE status IN ('cancelled', 'voided')
       OR is_voided = true
       OR notes ILIKE '[VOIDED]%'
  );

  UPDATE public.offline_returns
  SET linked_sale_id = NULL
  WHERE linked_sale_id IN (
    SELECT id FROM public.offline_sales
    WHERE status IN ('cancelled', 'voided')
       OR is_voided = true
       OR notes ILIKE '[VOIDED]%'
  );

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_returns' AND column_name = 'sale_id') THEN
    UPDATE public.offline_returns
    SET sale_id = NULL
    WHERE sale_id IN (
      SELECT id FROM public.offline_sales
      WHERE status IN ('cancelled', 'voided')
         OR is_voided = true
         OR notes ILIKE '[VOIDED]%'
    );
  END IF;

  -- Unlink store_credit_ledger referencing cancelled sales
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
    UPDATE public.store_credit_ledger
    SET used_in_sale_id = NULL
    WHERE used_in_sale_id IN (
      SELECT id FROM public.offline_sales
      WHERE status IN ('cancelled', 'voided')
         OR is_voided = true
         OR notes ILIKE '[VOIDED]%'
    );

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'source_sale_id') THEN
      UPDATE public.store_credit_ledger
      SET source_sale_id = NULL
      WHERE source_sale_id IN (
        SELECT id FROM public.offline_sales
        WHERE status IN ('cancelled', 'voided')
           OR is_voided = true
           OR notes ILIKE '[VOIDED]%'
      );
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'sale_id') THEN
      UPDATE public.store_credit_ledger
      SET sale_id = NULL
      WHERE sale_id IN (
        SELECT id FROM public.offline_sales
        WHERE status IN ('cancelled', 'voided')
           OR is_voided = true
           OR notes ILIKE '[VOIDED]%'
      );
    END IF;
  END IF;

  -- Unlink sms_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sms_logs') THEN
    UPDATE public.sms_logs
    SET offline_sale_id = NULL
    WHERE offline_sale_id IN (
      SELECT id FROM public.offline_sales
      WHERE status IN ('cancelled', 'voided')
         OR is_voided = true
         OR notes ILIKE '[VOIDED]%'
    );
  END IF;

  -- Unlink pos_cart_sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions') THEN
    UPDATE public.pos_cart_sessions
    SET offline_sale_id = NULL
    WHERE offline_sale_id IN (
      SELECT id FROM public.offline_sales
      WHERE status IN ('cancelled', 'voided')
         OR is_voided = true
         OR notes ILIKE '[VOIDED]%'
    );
  END IF;

  -- Delete all cancelled sale items and sales
  DELETE FROM public.offline_sale_items
  WHERE sale_id IN (
    SELECT id FROM public.offline_sales
    WHERE status IN ('cancelled', 'voided')
       OR is_voided = true
       OR notes ILIKE '[VOIDED]%'
  );

  DELETE FROM public.offline_sales
  WHERE status IN ('cancelled', 'voided')
     OR is_voided = true
     OR notes ILIKE '[VOIDED]%';
END $$;

-- Step 2: Canonical admin_void_offline_sale that automatically hard-deletes the sale
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale(
  _sale_id uuid,
  _reason text DEFAULT 'Voided by Store Admin',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  target_sale record;
  target_item record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Voided by Store Admin');
  v_eff_var_id uuid;
  v_prev_stock bigint;
  v_new_stock bigint;
  net_restore_qty integer;
BEGIN
  -- Authorization check
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
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR COALESCE(is_staff, false) = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only store administrators or staff can cancel sales';
  END IF;

  -- 1. Fetch target sale
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'sale_id', _sale_id,
      'items_restored', 0,
      'total_units_restored', 0,
      'deleted', true,
      'message', 'Sale record not found or already deleted from sales history.'
    );
  END IF;

  -- 2. Stock restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT *
      FROM public.offline_sale_items
      WHERE sale_id = _sale_id
      FOR UPDATE
    LOOP
      net_restore_qty := GREATEST(0, COALESCE(target_item.qty, target_item.quantity, 1) - COALESCE(target_item.quantity_returned, 0));

      IF net_restore_qty > 0 THEN
        v_eff_var_id := target_item.variant_id;

        IF v_eff_var_id IS NULL AND target_item.sku IS NOT NULL AND trim(target_item.sku) != '' THEN
          SELECT pv.id, pv.product_id INTO v_eff_var_id, target_item.product_id
          FROM public.product_variants pv
          WHERE lower(trim(pv.sku)) = lower(trim(target_item.sku))
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NULL AND target_item.product_id IS NOT NULL THEN
          SELECT id INTO v_eff_var_id
          FROM public.product_variants
          WHERE product_id = target_item.product_id
            AND (is_active IS NULL OR is_active = true)
          ORDER BY stock DESC
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NOT NULL THEN
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_eff_var_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_eff_var_id;

          IF target_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = target_item.product_id),
                updated_at = now()
            WHERE id = target_item.product_id;
          END IF;

          INSERT INTO public.inventory_transactions (
            product_id, variant_id, type, transaction_type,
            quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, notes, created_by
          ) VALUES (
            target_item.product_id, v_eff_var_id,
            'adjustment'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type,
            net_restore_qty, v_prev_stock, v_new_stock,
            'offline_sale_void', _sale_id,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
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
            product_id, variant_id, type, transaction_type,
            quantity, previous_quantity, new_quantity,
            reference_type, reference_id, note, notes, created_by
          ) VALUES (
            target_item.product_id, NULL,
            'adjustment'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type,
            net_restore_qty, v_prev_stock, v_new_stock,
            'offline_sale_void', _sale_id,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        END IF;

        items_restored := items_restored + 1;
        total_units_restored := total_units_restored + net_restore_qty;
      END IF;
    END LOOP;
  END IF;

  -- 3. Restore Customer Store Credit / Voucher Balances if used
  IF COALESCE(target_sale.store_credit_used, 0) > 0 THEN
    IF target_sale.credit_token_used IS NOT NULL AND trim(target_sale.credit_token_used) != '' THEN
      UPDATE public.offline_returns
      SET credit_used = GREATEST(0, COALESCE(credit_used, 0) - target_sale.store_credit_used),
          credit_balance = refund_amount - GREATEST(0, COALESCE(credit_used, 0) - target_sale.store_credit_used),
          credit_token_status = 'ACTIVE',
          updated_at = now()
      WHERE UPPER(TRIM(credit_token)) = UPPER(TRIM(target_sale.credit_token_used));

      UPDATE public.store_credit_vouchers
      SET current_balance = current_balance + target_sale.store_credit_used,
          is_active = true,
          updated_at = now()
      WHERE UPPER(TRIM(token)) = UPPER(TRIM(target_sale.credit_token_used));

      UPDATE public.pos_exchange_vouchers
      SET remaining_balance = remaining_balance + target_sale.store_credit_used,
          status = 'active',
          updated_at = now()
      WHERE UPPER(TRIM(token)) = UPPER(TRIM(target_sale.credit_token_used));
    END IF;

    IF target_sale.customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          store_credit = COALESCE(store_credit, 0) + target_sale.store_credit_used,
          total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
          total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
          updated_at = now()
      WHERE id = target_sale.customer_id;

      UPDATE public.profiles
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          updated_at = now()
      WHERE id = target_sale.customer_id;
    END IF;
  ELSIF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
        total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
        updated_at = now()
    WHERE id = target_sale.customer_id;
  END IF;

  -- 4. Safely unlink dependent foreign keys before deletion
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_return_items') THEN
    UPDATE public.offline_return_items
    SET original_sale_item_id = NULL
    WHERE original_sale_item_id IN (
      SELECT id FROM public.offline_sale_items WHERE sale_id = _sale_id
    );
  END IF;

  UPDATE public.offline_returns
  SET original_sale_id = NULL
  WHERE original_sale_id = _sale_id;

  UPDATE public.offline_returns
  SET linked_sale_id = NULL
  WHERE linked_sale_id = _sale_id;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_returns' AND column_name = 'sale_id') THEN
    UPDATE public.offline_returns
    SET sale_id = NULL
    WHERE sale_id = _sale_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
    UPDATE public.store_credit_ledger
    SET used_in_sale_id = NULL
    WHERE used_in_sale_id = _sale_id;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'source_sale_id') THEN
      UPDATE public.store_credit_ledger
      SET source_sale_id = NULL
      WHERE source_sale_id = _sale_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'sale_id') THEN
      UPDATE public.store_credit_ledger
      SET sale_id = NULL
      WHERE sale_id = _sale_id;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sms_logs') THEN
    UPDATE public.sms_logs
    SET offline_sale_id = NULL
    WHERE offline_sale_id = _sale_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions') THEN
    UPDATE public.pos_cart_sessions
    SET offline_sale_id = NULL
    WHERE offline_sale_id = _sale_id;
  END IF;

  -- 5. Automatically delete sale items and sale record completely from sales history!
  DELETE FROM public.offline_sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.offline_sales WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'deleted', true,
    'message', 'Sale #' || target_sale.sale_number || ' cancelled, stock restored, and automatically deleted from sales history.'
  );
END;
$$;

-- Step 3: Canonical admin_bulk_void_offline_sales that deletes all cancelled sales
CREATE OR REPLACE FUNCTION public.admin_bulk_void_offline_sales(
  _sale_ids uuid[],
  _reason text DEFAULT 'Bulk voided by administrator',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR COALESCE(is_staff, false) = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only store administrators or staff can cancel sales';
  END IF;

  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'voided_count', 0, 'deleted_count', 0, 'message', 'No sales provided');
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    v_res := public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
    IF (v_res->>'success')::boolean = true THEN
      v_voided_count := v_voided_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'voided_count', v_voided_count,
    'deleted_count', v_voided_count,
    'message', v_voided_count || ' sale(s) cancelled, stock restored, and automatically deleted from sales history.'
  );
END;
$$;

-- Step 4: Canonical admin_void_offline_sale_by_number
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale_by_number(
  _sale_number text,
  _reason text DEFAULT 'Voided by Store Admin',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_sale_id uuid;
BEGIN
  SELECT id INTO v_sale_id
  FROM public.offline_sales
  WHERE UPPER(TRIM(sale_number)) = UPPER(TRIM(_sale_number))
  LIMIT 1;

  IF v_sale_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted', true,
      'message', 'Sale #' || _sale_number || ' not found or already deleted from sales history.'
    );
  END IF;

  RETURN public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
END;
$$;

-- Step 5: Grant execution permissions
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale_by_number(text, text, boolean) TO authenticated, service_role, anon;
