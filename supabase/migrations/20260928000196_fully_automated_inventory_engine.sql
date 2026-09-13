-- ==============================================================================
-- Migration: 20260928000196_fully_automated_inventory_engine.sql
-- Description:
-- Fully Automated, Atomic, and Idempotent Inventory Management Engine:
-- 1. Canonical restore_stock_for_order(uuid, text, text) function:
--    - Single authoritative order restock mechanism
--    - Strict idempotency: Checks inventory_transactions before mutating stock
--    - Zero double-restoration: Repeated calls or triggers safely return duplicate
--    - Atomic FOR UPDATE row-level locking on product_variants
-- 2. Canonical admin_cancel_order(uuid, text) RPC:
--    - Allows authenticated admins/managers/staff to cancel orders with atomic restock
--    - Records cancellation reason, status history, and auditable inventory transactions
-- 3. Hardened cancel_customer_order(uuid, text) RPC:
--    - Delegates restock to canonical restore_stock_for_order function
-- 4. Hardened restore_stock_on_cancel() trigger function:
--    - Delegates restock to canonical restore_stock_for_order function
-- 5. Standardized admin_process_return_qc RPC:
--    - Uses canonical public.inventory_transactions column names
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CANONICAL ORDER RESTOCK FUNCTION (ZERO DOUBLE-RESTORATION GUARANTEE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_stock_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'Order cancellation',
  p_reference_type text DEFAULT 'order'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  item record;
  v_prod record;
  v_prev_stock bigint;
  v_new_stock bigint;
  v_restocked_count integer := 0;
BEGIN
  -- Idempotency Guard: Check if inventory has already been restored for this order
  IF EXISTS (
    SELECT 1 FROM public.inventory_transactions
    WHERE reference_id = p_order_id
      AND reference_type = p_reference_type
      AND (type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type)
           OR transaction_type IN ('restock'::public.inventory_tx_type, 'adjustment'::public.inventory_tx_type, 'return'::public.inventory_tx_type))
      AND quantity > 0
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_restored', true,
      'order_id', p_order_id,
      'message', 'Inventory was already restored previously'
    );
  END IF;

  -- Iterate through order items and restore exact variant quantities atomically
  FOR item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
    IF item.variant_id IS NOT NULL THEN
      -- Lock variant row
      SELECT stock INTO v_prev_stock
      FROM public.product_variants
      WHERE id = item.variant_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := v_prev_stock + item.qty;

        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.variant_id;

        -- Parent product stock is automatically updated by trg_sync_variant_to_product_stock!

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
          item.product_id,
          item.variant_id,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          item.qty,
          v_prev_stock,
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    ELSIF item.product_id IS NOT NULL THEN
      -- Standalone product without explicit variant_id
      SELECT stock INTO v_prev_stock
      FROM public.products
      WHERE id = item.product_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_stock := v_prev_stock + item.qty;

        UPDATE public.products
        SET stock = v_new_stock,
            updated_at = now()
        WHERE id = item.product_id;

        -- Keep single default variant in sync if present
        UPDATE public.product_variants
        SET stock = v_new_stock,
            updated_at = now()
        WHERE product_id = item.product_id
          AND (name = 'Default' OR (SELECT count(*) FROM public.product_variants WHERE product_id = item.product_id) <= 1);

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
          item.product_id,
          NULL,
          'restock'::public.inventory_tx_type,
          'restock'::public.inventory_tx_type,
          item.qty,
          v_prev_stock,
          v_new_stock,
          p_reference_type,
          p_order_id,
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          COALESCE(p_reason, 'Stock restored due to order cancellation/return'),
          v_uid
        );

        v_restocked_count := v_restocked_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_restored', false,
    'order_id', p_order_id,
    'items_restocked', v_restocked_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_stock_for_order(uuid, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. CANONICAL ADMIN ORDER CANCELLATION RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  order_id uuid,
  reason text DEFAULT 'Cancelled by Administrator'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  v_is_authorized boolean := false;
  final_reason text;
  v_new_payment_status public.payment_status;
  v_restock_res jsonb;
BEGIN
  -- Authorization check: service_role or admin user
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
       public.is_admin() THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to cancel orders';
  END IF;

  -- Lock target order
  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Idempotency check: If already cancelled, return existing state
  IF ord.status = 'cancelled'::public.order_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', ord.id,
      'status', 'cancelled',
      'payment_status', ord.payment_status,
      'duplicate', true,
      'message', 'Order is already cancelled'
    );
  END IF;

  -- Check if order has reached irreversible delivery states
  IF ord.status IN ('delivered'::public.order_status, 'returned'::public.order_status) THEN
    RAISE EXCEPTION 'Order cannot be cancelled at terminal status "%"', ord.status;
  END IF;

  IF ord.payment_status = 'paid'::public.payment_status THEN
    v_new_payment_status := 'refund_pending'::public.payment_status;
  ELSE
    v_new_payment_status := ord.payment_status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Cancelled by Administrator');

  -- Update order record
  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      payment_status = v_new_payment_status,
      cancel_reason = final_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  -- Log in order status history
  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled by Admin. Reason: ' || final_reason,
    v_uid
  );

  -- Perform canonical inventory restock
  v_restock_res := public.restore_stock_for_order(
    order_id,
    'Admin cancellation: ' || final_reason,
    'order'
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', order_id,
    'status', 'cancelled',
    'payment_status', v_new_payment_status,
    'duplicate', false,
    'restock_result', v_restock_res
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. HARDEN CUSTOMER ORDER CANCELLATION RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_customer_order(
  order_id uuid,
  reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  final_reason text;
  v_new_payment_status public.payment_status;
  v_restock_res jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to cancel an order';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = order_id FOR UPDATE;

  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Authorization guard
  IF (ord.user_id IS NULL OR ord.user_id != uid)
     AND NOT public.has_role(uid, 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  IF ord.status IN ('shipped', 'out_for_delivery', 'delivered', 'returned') THEN
    RAISE EXCEPTION 'Order cannot be cancelled at status "%"', ord.status;
  END IF;

  IF ord.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', ord.id,
      'status', 'cancelled',
      'payment_status', ord.payment_status,
      'duplicate', true
    );
  END IF;

  IF ord.payment_status = 'paid' THEN
    v_new_payment_status := 'refund_pending'::public.payment_status;
  ELSE
    v_new_payment_status := ord.payment_status;
  END IF;

  final_reason := COALESCE(NULLIF(trim(reason), ''), 'Cancelled by customer');

  UPDATE public.orders
  SET status = 'cancelled'::public.order_status,
      payment_status = v_new_payment_status,
      cancel_reason = final_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = order_id;

  INSERT INTO public.order_status_history (order_id, old_status, new_status, note, changed_by)
  VALUES (
    order_id,
    ord.status::text,
    'cancelled',
    'Order cancelled by customer. Reason: ' || final_reason,
    uid
  );

  -- Perform canonical inventory restock
  v_restock_res := public.restore_stock_for_order(
    order_id,
    'Customer cancellation: ' || final_reason,
    'order'
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', ord.id,
    'status', 'cancelled',
    'payment_status', v_new_payment_status,
    'duplicate', false,
    'restock_result', v_restock_res
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_customer_order(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. HARDEN RESTORE STOCK TRIGGER ON ORDERS (DELEGATE TO CANONICAL ENGINE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire when order transitions to cancelled or returned
  IF (NEW.status IN ('cancelled'::public.order_status, 'returned'::public.order_status)
      AND OLD.status NOT IN ('cancelled'::public.order_status, 'returned'::public.order_status))
     OR
     (NEW.payment_status = 'failed'::public.payment_status
      AND OLD.payment_status IS DISTINCT FROM 'failed'::public.payment_status)
  THEN
    -- Canonical restock handles internal idempotency check safely
    PERFORM public.restore_stock_for_order(
      NEW.id,
      'Stock restored due to order status transition to ' || NEW.status::text,
      'order'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_restore_stock_trigger ON public.orders;
CREATE TRIGGER orders_restore_stock_trigger
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.restore_stock_on_cancel();

-- ------------------------------------------------------------------------------
-- 5. STANDARDIZE ADMIN_PROCESS_RETURN_QC (CANONICAL LEDGER COLUMNS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_process_return_qc(
  _return_id uuid,
  _items_qc jsonb,
  _qc_summary text DEFAULT '',
  _restock_approved boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_return record;
  v_is_authorized boolean := false;
  v_qc_item record;
  v_ret_item record;
  v_any_approved boolean := false;
  v_new_return_status text;
  v_new_refund_status text;
  v_prev_stock bigint;
  v_new_stock bigint;
BEGIN
  -- Authorization check
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) OR
       public.is_admin() THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can process return QC';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  FOR v_qc_item IN SELECT * FROM jsonb_to_recordset(_items_qc) AS x(
    order_item_id uuid,
    passed boolean,
    qty_accepted int,
    qc_note text
  ) LOOP
    SELECT * INTO v_ret_item
    FROM public.online_return_items
    WHERE return_id = _return_id AND order_item_id = v_qc_item.order_item_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_qc_item.passed THEN
        v_any_approved := true;
        UPDATE public.online_return_items
        SET qc_status = 'PASSED',
            quantity_approved = v_qc_item.qty_accepted,
            quantity_received = v_qc_item.qty_accepted,
            qc_note = v_qc_item.qc_note,
            updated_at = now()
        WHERE id = v_ret_item.id;

        -- Idempotent stock restoration on QC pass
        IF _restock_approved AND NOT COALESCE(v_ret_item.inventory_restored, false) THEN
          IF v_ret_item.variant_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.product_variants
            WHERE id = v_ret_item.variant_id
            FOR UPDATE;

            v_new_stock := v_prev_stock + v_qc_item.qty_accepted;

            UPDATE public.product_variants
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_ret_item.variant_id;

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
              v_ret_item.product_id,
              v_ret_item.variant_id,
              'return'::public.inventory_tx_type,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              v_prev_stock,
              v_new_stock,
              'online_return',
              _return_id,
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              v_uid
            );
          ELSIF v_ret_item.product_id IS NOT NULL THEN
            SELECT stock INTO v_prev_stock
            FROM public.products
            WHERE id = v_ret_item.product_id
            FOR UPDATE;

            v_new_stock := v_prev_stock + v_qc_item.qty_accepted;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_ret_item.product_id;

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
              v_ret_item.product_id,
              NULL,
              'return'::public.inventory_tx_type,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              v_prev_stock,
              v_new_stock,
              'online_return',
              _return_id,
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              'Restocked from Online Return: ' || v_return.return_number || ' (' || COALESCE(v_ret_item.product_name_snapshot, '') || ')',
              v_uid
            );
          END IF;

          UPDATE public.online_return_items
          SET inventory_restored = true
          WHERE id = v_ret_item.id;
        END IF;

      ELSE
        UPDATE public.online_return_items
        SET qc_status = 'REJECTED',
            quantity_approved = 0,
            quantity_received = COALESCE(v_qc_item.qty_accepted, 0),
            qc_note = COALESCE(v_qc_item.qc_note, 'Failed inspection'),
            updated_at = now()
        WHERE id = v_ret_item.id;
      END IF;
    END IF;
  END LOOP;

  IF v_any_approved THEN
    v_new_return_status := 'QC_APPROVED';
    v_new_refund_status := 'PENDING';
  ELSE
    v_new_return_status := 'QC_REJECTED';
    v_new_refund_status := 'REJECTED';
  END IF;

  UPDATE public.online_returns
  SET return_status = v_new_return_status,
      refund_status = v_new_refund_status,
      qc_completed_at = now(),
      qc_processed_by = v_uid,
      updated_at = now(),
      updated_by = v_uid
  WHERE id = _return_id;

  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    old_status,
    new_status,
    note,
    actor_id,
    actor_role,
    metadata
  ) VALUES (
    _return_id,
    'QC_PROCESSED',
    v_return.return_status,
    v_new_return_status,
    'QC Completed. Overall status: ' || v_new_return_status,
    v_uid,
    'ADMIN',
    jsonb_build_object('items_qc', _items_qc, 'restock_approved', _restock_approved)
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_status', v_new_return_status,
    'refund_status', v_new_refund_status,
    'any_approved', v_any_approved
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_process_return_qc(uuid, jsonb, text, boolean) TO authenticated, service_role;
