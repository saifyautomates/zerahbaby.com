-- ==============================================================================
-- Migration: 20260928000140_harden_admin_void_offline_sale_authorization.sql
-- Fixes authorization loophole in admin_void_offline_sale and admin_delete_offline_sale
-- Ensures unauthenticated / anon users cannot bypass authorization or invoke void RPC.
-- ==============================================================================

DROP FUNCTION IF EXISTS public.admin_void_offline_sale(uuid, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_void_offline_sale CASCADE;

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
  v_prod record;
  items_restored integer := 0;
  total_units_restored integer := 0;
  v_clean_reason text := COALESCE(NULLIF(trim(_reason), ''), 'Administrative void');
  v_prev_stock int;
  v_new_stock int;
  v_voucher_rec record;
  v_new_voucher_balance numeric := 0;
BEGIN
  -- 1. Strict Authorization Check FIRST (Prevent existence leaking and anon bypass)
  IF auth.role() = 'service_role' THEN
    -- service_role is trusted system execution
    NULL;
  ELSIF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  ELSIF NOT (
    public.has_role(uid, 'admin') 
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner', 'manager', 'staff'))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND (is_admin = true OR is_staff = true))
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only authenticated store administrators or authorized staff can void completed POS sales';
  END IF;

  -- 2. Row lock target sale and verify existence
  SELECT * INTO target_sale
  FROM public.offline_sales
  WHERE id = _sale_id
  FOR UPDATE;

  IF target_sale.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SALE_NOT_FOUND',
      'message', 'Sale record not found'
    );
  END IF;

  -- 3. Idempotency & Status Check
  IF target_sale.status IN ('voided', 'cancelled') OR target_sale.is_voided = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_voided', true,
      'code', 'ALREADY_VOIDED',
      'sale_number', target_sale.sale_number,
      'message', 'Sale #' || target_sale.sale_number || ' has already been voided.',
      'sale_id', _sale_id,
      'restored_units', 0
    );
  END IF;

  -- 4. Compensating Inventory Restoration
  IF _restore_stock = true THEN
    FOR target_item IN
      SELECT 
        si.id as item_id,
        si.product_id, 
        si.variant_id,
        si.product_slug, 
        si.qty, 
        si.name, 
        si.sku, 
        si.barcode,
        COALESCE(SUM(ri.qty), 0) as already_returned_qty
      FROM public.offline_sale_items si
      LEFT JOIN public.offline_return_items ri ON ri.original_sale_item_id = si.id
      WHERE si.sale_id = _sale_id
      GROUP BY si.id, si.product_id, si.variant_id, si.product_slug, si.qty, si.name, si.sku, si.barcode
    LOOP
      DECLARE
        net_restore_qty integer := GREATEST(0, target_item.qty - target_item.already_returned_qty);
      BEGIN
        IF net_restore_qty > 0 AND target_item.product_id IS NOT NULL THEN
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = target_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            v_prev_stock := v_prod.stock;
            v_new_stock := v_prev_stock + net_restore_qty;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_prod.id;

            -- Restore variant stock if present
            IF target_item.variant_id IS NOT NULL THEN
              UPDATE public.product_variants
              SET stock = stock + net_restore_qty,
                  updated_at = now()
              WHERE id = target_item.variant_id;
            ELSE
              UPDATE public.product_variants
              SET stock = stock + net_restore_qty,
                  updated_at = now()
              WHERE product_id = v_prod.id
                AND (
                  (sku IS NOT NULL AND sku ILIKE target_item.sku) 
                  OR (barcode IS NOT NULL AND barcode = target_item.barcode) 
                  OR name = 'Default'
                );
            END IF;

            -- Log compensating inventory transaction
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
              'adjustment'::public.inventory_tx_type,
              'adjustment'::public.inventory_tx_type,
              net_restore_qty,
              v_prev_stock,
              v_new_stock,
              'offline_sale_void',
              _sale_id,
              'Compensating void reversal for POS sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
              'Compensating void reversal for POS sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
              uid
            );

            items_restored := items_restored + 1;
            total_units_restored := total_units_restored + net_restore_qty;
          END IF;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 5. Restore Store Credit / Voucher Balance if used in this sale
  IF COALESCE(target_sale.store_credit_used, 0) > 0 THEN
    -- Restore single voucher instrument if token was used
    IF target_sale.credit_token IS NOT NULL AND trim(target_sale.credit_token) != '' THEN
      SELECT * INTO v_voucher_rec
      FROM public.offline_returns
      WHERE UPPER(credit_token) = UPPER(TRIM(target_sale.credit_token))
      FOR UPDATE;

      IF v_voucher_rec.id IS NOT NULL THEN
        v_new_voucher_balance := LEAST(v_voucher_rec.refund_amount, COALESCE(v_voucher_rec.credit_balance, 0) + target_sale.store_credit_used);

        UPDATE public.offline_returns
        SET credit_used = GREATEST(0, COALESCE(credit_used, 0) - target_sale.store_credit_used),
            credit_balance = v_new_voucher_balance,
            credit_token_status = CASE 
              WHEN v_voucher_rec.expires_at IS NOT NULL AND v_voucher_rec.expires_at < now() THEN 'EXPIRED'
              ELSE 'ACTIVE' 
            END,
            updated_at = now()
        WHERE id = v_voucher_rec.id;
      END IF;
    END IF;

    -- Restore customer account balance if customer record exists
    IF target_sale.customer_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = COALESCE(store_credit_balance, 0) + target_sale.store_credit_used,
          store_credit = COALESCE(store_credit, 0) + target_sale.store_credit_used,
          updated_at = now()
      WHERE id = target_sale.customer_id;
    END IF;

    -- Log compensating ledger transaction
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_name,
      customer_phone,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      used_in_sale_id,
      notes,
      created_by,
      created_at
    ) VALUES (
      target_sale.customer_id,
      target_sale.customer_name,
      target_sale.customer_phone,
      target_sale.credit_token,
      'CREDIT_RESTORED',
      target_sale.store_credit_used,
      0,
      target_sale.store_credit_used,
      _sale_id,
      'Credit restored on voiding POS Sale #' || target_sale.sale_number || ' (' || v_clean_reason || ')',
      uid,
      now()
    );
  END IF;

  -- 6. Revert customer purchase metrics safely
  IF target_sale.customer_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
        total_spend = GREATEST(0, COALESCE(total_spend, target_sale.total) - target_sale.total),
        total_spent = GREATEST(0, COALESCE(total_spent, target_sale.total) - target_sale.total),
        updated_at = now()
    WHERE id = target_sale.customer_id;
  END IF;

  -- 7. Mark sale as voided
  UPDATE public.offline_sales
  SET status = 'voided',
      is_voided = true,
      void_reason = v_clean_reason,
      voided_at = now(),
      voided_by = uid,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', target_sale.sale_number,
    'status', 'voided',
    'stock_restored', _restore_stock,
    'credit_restored', COALESCE(target_sale.store_credit_used, 0),
    'items_restored_count', items_restored,
    'units_restored_count', total_units_restored,
    'reason', v_clean_reason
  );
END;
$$;

-- Compatibility layer: forward admin_delete_offline_sale safely to admin_void_offline_sale
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_offline_sale CASCADE;

CREATE OR REPLACE FUNCTION public.admin_delete_offline_sale(
  _sale_id uuid,
  _revert_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.admin_void_offline_sale(
    _sale_id := _sale_id,
    _reason := 'Compatibility forwarder from admin_delete_offline_sale',
    _restore_stock := COALESCE(_revert_stock, false)
  );
END;
$$;

-- Revoke execute from anon, grant exclusively to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_void_offline_sale(uuid, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_offline_sale(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
