-- ==============================================================================
-- CANONICAL ADMIN VOID OFFLINE SALE: AUTO-RESTOCK, STATUS CANCELLATION & AUDIT
-- Migration: 20260928000291_canonical_admin_void_offline_sale_status_and_restock.sql
-- 
-- 1. Sets offline_sales.status = 'cancelled' and is_voided = true upon cancellation.
-- 2. Automatically restores stock for all item variants and parent products.
-- 3. Logs authoritative inventory adjustments in inventory_transactions.
-- 4. Automatically restores customer store credit / voucher balances if used.
-- 5. Backfills any historical sales with '[VOIDED]' notes to cancelled status.
-- ==============================================================================

-- 1. Canonical admin_void_offline_sale RPC (by sale UUID)
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
  v_eff_var_id uuid;
  v_prev_stock int;
  v_new_stock int;
  net_restore_qty int;
  v_clean_reason text;
  items_restored int := 0;
  total_units_restored int := 0;
BEGIN
  -- 1. Authorization: service_role or admin/staff
  IF auth.role() = 'service_role' OR current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to cancel offline sales';
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
    RAISE EXCEPTION 'Unauthorized: only store administrators or authorized staff can cancel offline sales';
  END IF;

  v_clean_reason := COALESCE(NULLIF(trim(_reason), ''), 'Cancelled by Administrator');

  -- 2. Fetch and lock target sale
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RAISE EXCEPTION 'Offline sale not found with id: %', _sale_id;
  END IF;

  -- 3. Prevent duplicate void / cancellation
  IF target_sale.status IN ('cancelled', 'voided') OR target_sale.is_voided = true OR target_sale.notes ILIKE '[VOIDED]%' THEN
    -- Ensure status flags are uniform
    UPDATE public.offline_sales
    SET status = 'cancelled',
        is_voided = true,
        void_reason = COALESCE(void_reason, v_clean_reason),
        voided_at = COALESCE(voided_at, now()),
        updated_at = now()
    WHERE id = _sale_id;

    RETURN jsonb_build_object(
      'success', true,
      'already_voided', true,
      'sale_id', _sale_id,
      'sale_number', target_sale.sale_number,
      'items_restored', 0,
      'total_units_restored', 0,
      'message', 'Sale #' || target_sale.sale_number || ' has already been cancelled.'
    );
  END IF;

  -- 4. Stock restoration with variant & product resolution
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

        -- Fallback 1: Resolve variant by exact or lowercase SKU match
        IF v_eff_var_id IS NULL AND target_item.sku IS NOT NULL AND trim(target_item.sku) != '' THEN
          SELECT pv.id, pv.product_id INTO v_eff_var_id, target_item.product_id
          FROM public.product_variants pv
          WHERE lower(trim(pv.sku)) = lower(trim(target_item.sku))
          LIMIT 1;
        END IF;

        -- Fallback 2: Resolve variant by parent product ID
        IF v_eff_var_id IS NULL AND target_item.product_id IS NOT NULL THEN
          SELECT id INTO v_eff_var_id
          FROM public.product_variants
          WHERE product_id = target_item.product_id
            AND (is_active IS NULL OR is_active = true)
          ORDER BY stock DESC
          LIMIT 1;
        END IF;

        IF v_eff_var_id IS NOT NULL THEN
          -- Restock variant
          SELECT stock INTO v_prev_stock FROM public.product_variants WHERE id = v_eff_var_id FOR UPDATE;
          v_new_stock := COALESCE(v_prev_stock, 0) + net_restore_qty;

          UPDATE public.product_variants
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_eff_var_id;

          -- Authoritative parent product stock sync
          IF target_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = target_item.product_id),
                updated_at = now()
            WHERE id = target_item.product_id;
          END IF;

          -- Audit ledger entry
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
            v_eff_var_id,
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            'Restored from cancelled POS Sale #' || target_sale.sale_number || ': ' || v_clean_reason,
            uid
          );
        ELSIF target_item.product_id IS NOT NULL THEN
          -- Simple product without variants
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
            'adjustment'::public.inventory_tx_type,
            'adjustment'::public.inventory_tx_type,
            net_restore_qty,
            v_prev_stock,
            v_new_stock,
            'offline_sale_void',
            _sale_id,
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

  -- 5. Restore Customer Store Credit / Voucher Balances if used
  IF COALESCE(target_sale.store_credit_used, 0) > 0 THEN
    -- Restore voucher balance
    IF target_sale.credit_token_used IS NOT NULL AND trim(target_sale.credit_token_used) != '' THEN
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

    -- Restore customer store credit ledger
    IF target_sale.customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          store_credit = COALESCE(store_credit, 0) + target_sale.store_credit_used,
          total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
          updated_at = now()
      WHERE id = target_sale.customer_id;
    END IF;
  ELSIF target_sale.customer_id IS NOT NULL THEN
    -- Reverse total_spent from customer profile
    UPDATE public.pos_customers
    SET total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(target_sale.total, 0)),
        updated_at = now()
    WHERE id = target_sale.customer_id;
  END IF;

  -- 6. Mark sale as CANCELLED and VOIDED
  UPDATE public.offline_sales
  SET status = 'cancelled',
      is_voided = true,
      void_reason = v_clean_reason,
      voided_at = now(),
      voided_by = uid,
      notes = '[VOIDED] ' || v_clean_reason || CASE WHEN trim(COALESCE(notes, '')) != '' THEN ' | Original Notes: ' || notes ELSE '' END,
      updated_at = now()
  WHERE id = _sale_id;

  -- 7. Zero out returnable quantities on items since sale is voided
  UPDATE public.offline_sale_items
  SET quantity_returnable = 0,
      updated_at = now()
  WHERE sale_id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'items_restored', items_restored,
    'total_units_restored', total_units_restored,
    'reason', v_clean_reason,
    'message', 'Sale #' || target_sale.sale_number || ' cancelled and inventory restocked successfully.'
  );
END;
$$;

-- 2. Convenience RPC to cancel by receipt number (e.g. 'POS-260919-64500')
CREATE OR REPLACE FUNCTION public.admin_void_offline_sale_by_number(
  _sale_number text,
  _reason text DEFAULT 'Administrative void',
  _restore_stock boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sale_id uuid;
BEGIN
  SELECT id INTO v_sale_id
  FROM public.offline_sales
  WHERE lower(trim(sale_number)) = lower(trim(_sale_number))
  LIMIT 1;

  IF v_sale_id IS NULL THEN
    RAISE EXCEPTION 'Offline sale not found with receipt number: %', _sale_number;
  END IF;

  RETURN public.admin_void_offline_sale(v_sale_id, _reason, _restore_stock);
END;
$$;

-- 3. Bulk Void RPC
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
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR COALESCE(is_staff, false) = true))
    OR public.is_admin()
    OR public.is_staff_or_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only store administrators or staff can cancel sales';
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

  RETURN jsonb_build_object('success', true, 'voided_count', v_voided_count, 'message', 'Bulk cancellation completed');
END;
$$;

-- 4. Permissions
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale_by_number(text, text, boolean) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_void_offline_sales(uuid[], text, boolean) TO authenticated, service_role, anon;

-- 5. Backfill any legacy offline_sales marked with '[VOIDED]'
UPDATE public.offline_sales
SET status = 'cancelled',
    is_voided = true,
    void_reason = COALESCE(void_reason, 'Cancelled by Administrator'),
    voided_at = COALESCE(voided_at, updated_at, now()),
    updated_at = now()
WHERE notes ILIKE '[VOIDED]%'
  AND (status != 'cancelled' OR is_voided IS DISTINCT FROM true);
