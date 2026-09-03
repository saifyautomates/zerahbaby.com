-- Migration: 20260928000066_harden_online_returns_inventory_and_auth.sql
-- Harden online returns QC and refund RPCs against double restocking and authorization mismatches

CREATE OR REPLACE FUNCTION public.inspect_open_box_return(
  _return_id uuid,
  _items_qc jsonb,
  _restock_approved boolean DEFAULT true,
  _notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_return record;
  v_qc_item record;
  v_ret_item record;
  v_any_approved boolean := false;
  v_all_rejected boolean := true;
  v_new_return_status text;
  v_new_refund_status text;
  v_variant record;
  v_prod record;
  v_prev_stock int;
  v_new_stock int;
  v_total_var_stock int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    IF NOT public.has_role(v_uid, 'admin') 
       AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role::text IN ('admin', 'owner'))
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_admin = true) THEN
      RAISE EXCEPTION 'Unauthorized: Only store admins can process return QC';
    END IF;
  END IF;

  SELECT * INTO v_return FROM public.online_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found';
  END IF;

  -- Loop through each item's QC assessment
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
      IF v_qc_item.passed AND v_qc_item.qty_accepted > 0 THEN
        v_any_approved := true;
        v_all_rejected := false;

        UPDATE public.online_return_items
        SET qc_status = 'APPROVED',
            quantity_approved = v_qc_item.qty_accepted,
            quantity_received = v_qc_item.qty_accepted,
            qc_note = COALESCE(v_qc_item.qc_note, ''),
            updated_at = now()
        WHERE id = v_ret_item.id;

        -- Idempotently restore inventory if requested and not yet restored
        IF _restock_approved AND NOT COALESCE(v_ret_item.inventory_restored, false) THEN
          IF v_ret_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = stock + v_qc_item.qty_accepted,
                updated_at = now()
            WHERE id = v_ret_item.variant_id;

            IF v_ret_item.product_id IS NOT NULL THEN
              SELECT COALESCE(SUM(stock), 0) INTO v_total_var_stock
              FROM public.product_variants
              WHERE product_id = v_ret_item.product_id;

              UPDATE public.products
              SET stock = v_total_var_stock,
                  updated_at = now()
              WHERE id = v_ret_item.product_id;
            END IF;
          ELSIF v_ret_item.product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock = stock + v_qc_item.qty_accepted,
                updated_at = now()
            WHERE id = v_ret_item.product_id;
          END IF;

          IF v_ret_item.product_id IS NOT NULL THEN
            -- Record authoritative inventory transaction
            INSERT INTO public.inventory_transactions (
              product_id,
              variant_id,
              type,
              transaction_type,
              quantity,
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

  -- Determine final return and refund status
  IF v_all_rejected THEN
    v_new_return_status := 'REJECTED_QC';
    v_new_refund_status := 'REJECTED';
  ELSIF v_any_approved THEN
    v_new_return_status := 'QC_APPROVED';
    v_new_refund_status := 'PENDING_APPROVAL';
  ELSE
    v_new_return_status := 'IN_QC';
    v_new_refund_status := v_return.refund_status;
  END IF;

  UPDATE public.online_returns
  SET return_status = v_new_return_status,
      refund_status = v_new_refund_status,
      qc_inspected_at = now(),
      qc_inspected_by = v_uid,
      notes = CASE WHEN _notes != '' THEN COALESCE(notes, '') || E'\nQC Notes: ' || _notes ELSE notes END,
      updated_at = now()
  WHERE id = _return_id;

  INSERT INTO public.online_return_events (
    return_id,
    event_type,
    from_status,
    to_status,
    notes,
    created_by
  ) VALUES (
    _return_id,
    'QC_INSPECTION_COMPLETED',
    v_return.return_status,
    v_new_return_status,
    'QC Assessment: ' || CASE WHEN v_all_rejected THEN 'All Items Rejected' WHEN v_any_approved THEN 'Approved for Refund' ELSE 'Partial' END || COALESCE('. ' || _notes, ''),
    v_uid
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

GRANT EXECUTE ON FUNCTION public.inspect_open_box_return(uuid, jsonb, boolean, text) TO authenticated, anon, service_role;
