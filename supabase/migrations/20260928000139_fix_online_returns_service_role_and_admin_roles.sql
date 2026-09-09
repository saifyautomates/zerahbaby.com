-- Migration: 20260928000139_fix_online_returns_service_role_and_admin_roles.sql
-- Description: Allow service_role (Edge Functions) and canonical admin roles (admin, owner, manager, staff, profiles.is_admin, admin_allowlist)
-- in online returns management RPCs: admin_record_online_refund, admin_update_online_return_status, and admin_process_return_qc.

-- 1. admin_record_online_refund
CREATE OR REPLACE FUNCTION public.admin_record_online_refund(
  _return_id uuid,
  _refund_amount numeric,
  _refund_method text DEFAULT 'razorpay',
  _gateway_refund_id text DEFAULT NULL,
  _notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_is_authorized boolean := false;
BEGIN
  v_uid := auth.uid();

  -- Check if caller is service_role (e.g. from Edge Functions)
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can record refunds';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  UPDATE public.online_returns
  SET refund_status = 'PROCESSED',
      return_status = 'COMPLETED',
      final_refund_amount = _refund_amount,
      razorpay_refund_id = COALESCE(_gateway_refund_id, razorpay_refund_id),
      razorpay_refund_status = 'PROCESSED',
      refund_completed_at = now(),
      admin_note = CASE WHEN _notes != '' THEN COALESCE(admin_note || ' | ', '') || _notes ELSE admin_note END,
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
    'REFUND_PROCESSED',
    v_return.refund_status,
    'PROCESSED',
    'Refund completed: ₹' || _refund_amount || ' via ' || _refund_method,
    v_uid,
    CASE WHEN v_uid IS NULL THEN 'system' ELSE 'admin' END,
    jsonb_build_object('refund_id', _gateway_refund_id, 'amount', _refund_amount, 'method', _refund_method)
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'refund_status', 'PROCESSED',
    'return_status', 'COMPLETED',
    'refund_amount', _refund_amount,
    'gateway_refund_id', _gateway_refund_id
  );
END;
$$;

-- 2. admin_update_online_return_status
CREATE OR REPLACE FUNCTION public.admin_update_online_return_status(
  _return_id uuid,
  _new_status text,
  _admin_note text DEFAULT '',
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_old_status text;
  v_is_authorized boolean := false;
BEGIN
  v_uid := auth.uid();

  -- Check authorization
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) THEN
      v_is_authorized := true;
    END IF;
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can update return statuses';
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  v_old_status := v_return.return_status;

  UPDATE public.online_returns
  SET return_status = _new_status,
      admin_note = CASE WHEN _admin_note != '' THEN _admin_note ELSE admin_note END,
      received_at = CASE WHEN _new_status = 'RECEIVED' AND received_at IS NULL THEN now() ELSE received_at END,
      pickup_scheduled_at = CASE WHEN _new_status = 'PICKUP_SCHEDULED' AND pickup_scheduled_at IS NULL THEN now() ELSE pickup_scheduled_at END,
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
    'STATUS_UPDATE',
    v_old_status,
    _new_status,
    COALESCE(_admin_note, 'Status updated by admin'),
    v_uid,
    CASE WHEN v_uid IS NULL THEN 'system' ELSE 'admin' END,
    _metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'old_status', v_old_status,
    'new_status', _new_status
  );
END;
$$;

-- 3. admin_process_return_qc
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
  v_uid uuid;
  v_return record;
  v_ret_item record;
  v_qc_item record;
  v_any_approved boolean := false;
  v_new_return_status text;
  v_new_refund_status text;
  v_variant record;
  v_prod record;
  v_is_authorized boolean := false;
BEGIN
  v_uid := auth.uid();

  -- Check authorization
  IF current_user = 'service_role' OR COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    v_is_authorized := true;
  ELSIF v_uid IS NOT NULL THEN
    IF public.has_role(v_uid, 'admin') OR
       public.has_role(v_uid, 'owner') OR
       public.has_role(v_uid, 'manager') OR
       public.has_role(v_uid, 'staff') OR
       EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) OR
       EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email) WHERE u.id = v_uid) THEN
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

        IF _restock_approved AND NOT COALESCE(v_ret_item.inventory_restored, false) THEN
          IF v_ret_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = stock + v_qc_item.qty_accepted,
                updated_at = now()
            WHERE id = v_ret_item.variant_id;
          ELSIF v_ret_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = stock + v_qc_item.qty_accepted,
                updated_at = now()
            WHERE id = v_ret_item.product_id;
          END IF;

          IF v_ret_item.product_id IS NOT NULL THEN
            INSERT INTO public.inventory_transactions (
              product_id,
              variant_id,
              tx_type,
              qty_change,
              reference_type,
              reference_id,
              note,
              created_by
            ) VALUES (
              v_ret_item.product_id,
              v_ret_item.variant_id,
              'return'::public.inventory_tx_type,
              v_qc_item.qty_accepted,
              'online_return',
              _return_id,
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
    v_new_refund_status := 'NOT_APPLICABLE';
  END IF;

  UPDATE public.online_returns
  SET return_status = v_new_return_status,
      refund_status = v_new_refund_status,
      qc_summary = _qc_summary,
      qc_completed_at = now(),
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
    'QC_COMPLETED',
    v_return.return_status,
    v_new_return_status,
    'Quality check completed: ' || _qc_summary,
    v_uid,
    CASE WHEN v_uid IS NULL THEN 'system' ELSE 'admin' END,
    jsonb_build_object('refund_status', v_new_refund_status, 'restocked', _restock_approved)
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_status', v_new_return_status,
    'refund_status', v_new_refund_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_online_refund(uuid, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_online_return_status(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_process_return_qc(uuid, jsonb, text, boolean) TO authenticated, service_role;
