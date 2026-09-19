-- =====================================================================
-- Migration: 20260928000312_ground_store_credit_in_canonical_returns_and_heal.sql
-- Description: Ground customer store credit strictly in active offline_returns.
--              Purge orphaned demo/test voucher records and recalculate all customer
--              balances to 0 unless backed by genuine unredeemed returns.
-- =====================================================================

-- 1. Purge / Deactivate orphaned vouchers that have NO matching return in offline_returns
DELETE FROM public.pos_exchange_vouchers pev
WHERE NOT EXISTS (
  SELECT 1 FROM public.offline_returns r
  WHERE UPPER(TRIM(r.credit_token)) = UPPER(TRIM(pev.token))
);

DELETE FROM public.store_credit_vouchers scv
WHERE NOT EXISTS (
  SELECT 1 FROM public.offline_returns r
  WHERE UPPER(TRIM(r.credit_token)) = UPPER(TRIM(scv.token))
);

-- 2. Synchronize pos_customers and profiles so store_credit_balance strictly matches active unredeemed returns
UPDATE public.pos_customers pc
SET store_credit_balance = COALESCE((
  SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
  FROM public.offline_returns r
  WHERE (r.customer_id = pc.id OR (pc.phone IS NOT NULL AND pc.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(pc.phone)))
    AND (r.credit_token_status IS NULL OR r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
), 0),
store_credit = COALESCE((
  SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
  FROM public.offline_returns r
  WHERE (r.customer_id = pc.id OR (pc.phone IS NOT NULL AND pc.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(pc.phone)))
    AND (r.credit_token_status IS NULL OR r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
), 0);

UPDATE public.profiles p
SET store_credit_balance = COALESCE((
  SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
  FROM public.offline_returns r
  WHERE (r.customer_id = p.id OR (p.phone IS NOT NULL AND p.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(p.phone)))
    AND (r.credit_token_status IS NULL OR r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
), 0);

-- 3. Canonical get_customer_store_credit: Strictly ground in verified active returns
CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_balance numeric := 0;
  v_cust_id uuid := _customer_id;
  v_cust_name text := 'Walk-in Customer';
  v_cust_phone text := '';
  v_norm_phone text := public.normalize_phone(_phone);
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  recent_history jsonb := '[]'::jsonb;
  active_returns jsonb := '[]'::jsonb;
  v_single_voucher record;
  v_latest_token text := '';
BEGIN
  -- 1. If Token is provided, look up that specific voucher instrument in offline_returns
  IF v_clean_token != '' THEN
    SELECT 
      id, customer_id, customer_name, customer_phone,
      refund_amount, credit_used,
      GREATEST(0, refund_amount - COALESCE(credit_used, 0)) AS remaining_balance,
      expires_at
    INTO v_single_voucher
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = v_clean_token
      AND (credit_token_status IS NULL OR credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_single_voucher.id IS NOT NULL AND v_single_voucher.remaining_balance > 0 THEN
      v_balance := v_single_voucher.remaining_balance;
      v_cust_id := v_single_voucher.customer_id;
      v_cust_name := COALESCE(v_single_voucher.customer_name, 'Customer');
      v_cust_phone := COALESCE(v_single_voucher.customer_phone, '');
      v_latest_token := v_clean_token;

      active_returns := jsonb_build_array(
        jsonb_build_object(
          'id', v_single_voucher.id,
          'credit_token', v_clean_token,
          'refund_amount', v_single_voucher.refund_amount,
          'credit_used', v_single_voucher.credit_used,
          'credit_balance', v_single_voucher.remaining_balance,
          'expires_at', v_single_voucher.expires_at
        )
      );
    ELSE
      v_balance := 0;
    END IF;

  -- 2. Otherwise search by customer_id or phone strictly from active returns
  ELSIF v_cust_id IS NOT NULL OR v_norm_phone != '' THEN
    IF v_cust_id IS NOT NULL THEN
      SELECT name, COALESCE(phone, '') INTO v_cust_name, v_cust_phone
      FROM public.pos_customers WHERE id = v_cust_id;

      IF v_norm_phone = '' AND v_cust_phone != '' THEN
        v_norm_phone := public.normalize_phone(v_cust_phone);
      END IF;
    ELSIF v_norm_phone != '' THEN
      SELECT id, name, COALESCE(phone, '') INTO v_cust_id, v_cust_name, v_cust_phone
      FROM public.pos_customers WHERE public.normalize_phone(phone) = v_norm_phone
      ORDER BY created_at DESC LIMIT 1;
    END IF;

    -- Calculate true unredeemed balance strictly from active returns
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'return_number', r.return_number,
        'credit_token', r.credit_token,
        'refund_amount', r.refund_amount,
        'credit_used', COALESCE(r.credit_used, 0),
        'credit_balance', GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)),
        'created_at', r.created_at,
        'expires_at', r.expires_at
      ) ORDER BY r.created_at DESC
    ), '[]'::jsonb)
    INTO active_returns
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

    SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
    INTO v_balance
    FROM public.offline_returns r
    WHERE (
      (v_cust_id IS NOT NULL AND r.customer_id = v_cust_id)
      OR (v_norm_phone != '' AND public.normalize_phone(r.customer_phone) = v_norm_phone)
    )
    AND GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL);

    IF jsonb_array_length(active_returns) > 0 THEN
      v_latest_token := active_returns->0->>'credit_token';
    END IF;

    -- Synchronize pos_customers table with the strictly verified balance
    IF v_cust_id IS NOT NULL THEN
      UPDATE public.pos_customers
      SET store_credit_balance = v_balance,
          store_credit = v_balance,
          updated_at = now()
      WHERE id = v_cust_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_cust_id,
    'customer_name', COALESCE(v_cust_name, 'Customer'),
    'customer_phone', COALESCE(v_cust_phone, ''),
    'available_credit', v_balance,
    'credit_token', v_latest_token,
    'active_returns', active_returns,
    'history', recent_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text) TO authenticated, anon, service_role;

-- 4. Canonical get_pos_customer_intel: Strictly ground in verified active returns
CREATE OR REPLACE FUNCTION public.get_pos_customer_intel(
  p_customer_id uuid DEFAULT NULL,
  _customer_id uuid DEFAULT NULL,
  p_phone text DEFAULT '',
  _phone text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id uuid := COALESCE(p_customer_id, _customer_id);
  v_phone text := COALESCE(NULLIF(p_phone, ''), _phone);
  v_norm_phone text := public.normalize_phone(v_phone);
  v_prof record;
  v_recent_sales jsonb;
  v_recent_orders jsonb;
  v_total_purchases integer;
  v_total_spend numeric;
  v_credit_balance numeric := 0;
BEGIN
  IF v_id IS NULL AND length(v_norm_phone) = 10 THEN
    SELECT id INTO v_id FROM public.pos_customers WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.profiles WHERE public.normalize_phone(phone) = v_norm_phone LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_id;
  IF v_prof.id IS NULL THEN
    SELECT 
      id, name AS full_name, phone, email, city, address
    INTO v_prof 
    FROM public.pos_customers WHERE id = v_id;
  END IF;

  IF v_prof.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculate active returns credit strictly from active unredeemed returns
  SELECT COALESCE(SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0))), 0)
  INTO v_credit_balance
  FROM public.offline_returns r
  WHERE (r.customer_id = v_id OR (v_prof.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(v_prof.phone)))
    AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL)
    AND (r.expires_at IS NULL OR r.expires_at >= now())
    AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0;

  -- Combined total purchases and spend
  SELECT 
    (COALESCE((SELECT COUNT(*) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT COUNT(*) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0)),
    (COALESCE((SELECT SUM(total) FROM public.orders WHERE user_id = v_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT SUM(total) FROM public.offline_sales WHERE customer_id = v_id AND status != 'cancelled'), 0))
  INTO v_total_purchases, v_total_spend;

  -- Recent POS Sales
  SELECT jsonb_agg(sub) INTO v_recent_sales
  FROM (
    SELECT id, sale_number, total, payment_method, return_status, created_at
    FROM public.offline_sales
    WHERE customer_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  -- Recent Online Orders
  SELECT jsonb_agg(sub) INTO v_recent_orders
  FROM (
    SELECT id, order_number, total, payment_method, status, created_at
    FROM public.orders
    WHERE user_id = v_id
    ORDER BY created_at DESC
    LIMIT 5
  ) sub;

  RETURN jsonb_build_object(
    'id', v_prof.id,
    'name', COALESCE(NULLIF(v_prof.full_name, ''), 'Guest Customer'),
    'phone', COALESCE(v_prof.phone, ''),
    'email', COALESCE(v_prof.email, ''),
    'city', COALESCE(v_prof.city, ''),
    'address', COALESCE(v_prof.address, ''),
    'total_purchases', v_total_purchases,
    'total_spend', v_total_spend,
    'store_credit_balance', v_credit_balance,
    'recentSales', COALESCE(v_recent_sales, '[]'::jsonb),
    'recentOrders', COALESCE(v_recent_orders, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customer_intel(uuid, uuid, text, text) TO authenticated, anon, service_role;

-- 5. Canonical search_pos_customers: Strictly ground store_credit_balance in verified active returns
CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS TABLE(
  id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  state text,
  pincode text,
  notes text,
  total_purchases integer,
  total_spend numeric,
  store_credit_balance numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean text := trim(_query);
  v_norm text := public.normalize_phone(v_clean);
  v_voucher_cust_id uuid := NULL;
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  IF length(v_clean) >= 3 THEN
    SELECT customer_id INTO v_voucher_cust_id
    FROM public.offline_returns
    WHERE UPPER(TRIM(credit_token)) = UPPER(v_clean)
      AND (credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR credit_token_status IS NULL)
      AND (expires_at IS NULL OR expires_at > now())
      AND (refund_amount - COALESCE(credit_used, 0)) > 0
    LIMIT 1;
  END IF;

  RETURN QUERY
  WITH combined_customers AS (
    SELECT 
      pc.id,
      pc.name,
      pc.phone,
      pc.email,
      pc.city,
      pc.address,
      pc.state,
      pc.pincode,
      pc.notes,
      pc.created_at,
      pc.updated_at
    FROM public.pos_customers pc

    UNION ALL

    SELECT 
      p.id,
      COALESCE(NULLIF(trim(p.full_name), ''), 'Online Customer') AS name,
      p.phone,
      p.email,
      p.city,
      p.address,
      NULL::text AS state,
      NULL::text AS pincode,
      NULL::text AS notes,
      p.created_at,
      p.updated_at
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pos_customers pc2 
      WHERE pc2.id = p.id 
         OR (p.phone IS NOT NULL AND p.phone != '' AND public.normalize_phone(pc2.phone) = public.normalize_phone(p.phone))
    )
  ),
  deduped AS (
    SELECT DISTINCT ON (c.id)
      c.id,
      c.name,
      c.phone,
      c.email,
      c.city,
      c.address,
      c.state,
      c.pincode,
      c.notes,
      c.created_at,
      c.updated_at
    FROM combined_customers c
    ORDER BY c.id, c.updated_at DESC
  )
  SELECT 
    d.id,
    d.name,
    d.phone,
    d.email,
    d.city,
    d.address,
    d.state,
    d.pincode,
    d.notes,
    (
      COALESCE((SELECT COUNT(*)::integer FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT COUNT(*)::integer FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::integer AS total_purchases,
    (
      COALESCE((SELECT SUM(s.total)::numeric FROM public.offline_sales s WHERE s.customer_id = d.id AND s.status != 'cancelled'), 0)
      + COALESCE((SELECT SUM(o.total)::numeric FROM public.orders o WHERE o.user_id = d.id AND o.status != 'cancelled'), 0)
    )::numeric AS total_spend,
    COALESCE((
      SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
      FROM public.offline_returns r
      WHERE (r.customer_id = d.id OR (d.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(d.phone)))
        AND (r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED') OR r.credit_token_status IS NULL)
        AND (r.expires_at IS NULL OR r.expires_at >= now())
        AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
    ), 0)::numeric AS store_credit_balance,
    d.created_at,
    d.updated_at
  FROM deduped d
  WHERE 
    (v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id)
    OR d.name ILIKE '%' || v_clean || '%'
    OR (v_norm != '' AND public.normalize_phone(d.phone) = v_norm)
    OR d.phone ILIKE '%' || v_clean || '%'
    OR d.email ILIKE '%' || v_clean || '%'
    OR d.city ILIKE '%' || v_clean || '%'
    OR d.id::text ILIKE '%' || v_clean || '%'
  ORDER BY 
    CASE 
      WHEN v_voucher_cust_id IS NOT NULL AND d.id = v_voucher_cust_id THEN 0
      WHEN v_norm != '' AND public.normalize_phone(d.phone) = v_norm THEN 1
      WHEN lower(trim(d.name)) = lower(v_clean) THEN 2
      WHEN lower(trim(d.name)) ILIKE lower(v_clean) || '%' THEN 3
      ELSE 4
    END,
    d.updated_at DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pos_customers(text) TO authenticated, anon, service_role;

-- 6. Harden admin_hard_delete_offline_returns to purge vouchers and re-sync customer credit
CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_returns(
  _return_ids uuid[],
  _revert_stock boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  uid uuid := auth.uid();
  v_deleted_count integer := 0;
  v_item_rec record;
  v_prod record;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  IF uid IS NOT NULL THEN
    IF NOT public.has_role(uid, 'admin') 
       AND NOT EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = uid AND role::text IN ('admin', 'owner')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true
       )
    THEN
      RAISE EXCEPTION 'Only administrators can delete POS return records';
    END IF;
  END IF;

  IF _return_ids IS NULL OR array_length(_return_ids, 1) IS NULL OR array_length(_return_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'No return IDs provided for deletion.'
    );
  END IF;

  -- 1. Snapshot affected customer IDs and tokens for cleanup
  CREATE TEMP TABLE temp_affected_returns ON COMMIT DROP AS
  SELECT id, customer_id, customer_phone, credit_token
  FROM public.offline_returns
  WHERE id = ANY(_return_ids);

  -- 2. Optional Inventory Reversal
  IF _revert_stock = true THEN
    FOR v_item_rec IN
      SELECT 
        ri.product_id,
        ri.variant_id,
        ri.product_slug,
        ri.qty,
        ri.name,
        ri.sku,
        ri.barcode,
        r.return_number
      FROM public.offline_return_items ri
      JOIN public.offline_returns r ON r.id = ri.return_id
      WHERE ri.return_id = ANY(_return_ids)
    LOOP
      IF v_item_rec.qty > 0 AND v_item_rec.product_id IS NOT NULL THEN
        SELECT id, stock INTO v_prod
        FROM public.products
        WHERE id = v_item_rec.product_id
        FOR UPDATE;

        IF v_prod.id IS NOT NULL THEN
          v_prev_stock := v_prod.stock;
          v_new_stock := GREATEST(0, v_prev_stock - v_item_rec.qty);

          UPDATE public.products
          SET stock = v_new_stock,
              updated_at = now()
          WHERE id = v_prod.id;

          IF v_item_rec.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock = GREATEST(0, stock - v_item_rec.qty),
                updated_at = now()
            WHERE id = v_item_rec.variant_id;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 3. Delete matching pos_exchange_vouchers
  DELETE FROM public.pos_exchange_vouchers
  WHERE return_id = ANY(_return_ids)
     OR UPPER(TRIM(token)) IN (SELECT UPPER(TRIM(credit_token)) FROM temp_affected_returns WHERE credit_token IS NOT NULL);

  -- 4. Delete matching store_credit_vouchers
  DELETE FROM public.store_credit_vouchers
  WHERE UPPER(TRIM(token)) IN (SELECT UPPER(TRIM(credit_token)) FROM temp_affected_returns WHERE credit_token IS NOT NULL);

  -- 5. Clean up associated notifications
  DELETE FROM public.admin_notifications
  WHERE event_key = ANY(SELECT 'POS_RETURN:' || unnest(_return_ids)::text)
     OR (entity_type = 'offline_return' AND entity_id = ANY(SELECT unnest(_return_ids)::text));

  -- 6. Clean up store credit ledger references
  UPDATE public.store_credit_ledger
  SET source_return_id = NULL
  WHERE source_return_id = ANY(_return_ids);

  -- 7. Delete from offline_return_items
  DELETE FROM public.offline_return_items
  WHERE return_id = ANY(_return_ids);

  -- 8. Delete from offline_returns
  DELETE FROM public.offline_returns
  WHERE id = ANY(_return_ids);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 9. Re-calculate pos_customers store_credit_balance for affected customers
  UPDATE public.pos_customers pc
  SET store_credit_balance = COALESCE((
    SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
    FROM public.offline_returns r
    WHERE (r.customer_id = pc.id OR (pc.phone IS NOT NULL AND pc.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(pc.phone)))
      AND (r.credit_token_status IS NULL OR r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
  ), 0),
  store_credit = COALESCE((
    SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
    FROM public.offline_returns r
    WHERE (r.customer_id = pc.id OR (pc.phone IS NOT NULL AND pc.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(pc.phone)))
      AND (r.credit_token_status IS NULL OR r.credit_token_status IN ('ACTIVE', 'PARTIALLY_USED'))
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND (r.refund_amount - COALESCE(r.credit_used, 0)) > 0
  ), 0)
  WHERE pc.id IN (SELECT customer_id FROM temp_affected_returns WHERE customer_id IS NOT NULL)
     OR (pc.phone IS NOT NULL AND pc.phone != '' AND public.normalize_phone(pc.phone) IN (SELECT public.normalize_phone(customer_phone) FROM temp_affected_returns WHERE customer_phone IS NOT NULL));

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'message', 'Successfully deleted ' || v_deleted_count || ' return record(s) and re-synchronized customer credit balances.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_returns(uuid[], boolean) TO authenticated, service_role, anon;
