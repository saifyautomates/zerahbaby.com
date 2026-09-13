-- Migration: 20260928000194_fix_pos_sessions_terminal_and_batch_close.sql
-- Description: Enforce terminal states (cancelled, completed) on POS sessions, add atomic batch close RPCs, and harden active query

-- 1. Function to close a single session and its line items
CREATE OR REPLACE FUNCTION public.close_pos_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.pos_cart_sessions
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now()),
      updated_at = now()
  WHERE id = p_session_id
    AND status IN ('draft', 'held', 'payment_pending');

  DELETE FROM public.pos_session_items
  WHERE session_id = p_session_id;
END;
$$;

-- 2. Function to close multiple sessions in an atomic batch
CREATE OR REPLACE FUNCTION public.close_pos_sessions_batch(p_session_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_session_ids IS NULL OR array_length(p_session_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.pos_cart_sessions
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now()),
      updated_at = now()
  WHERE id = ANY(p_session_ids)
    AND status IN ('draft', 'held', 'payment_pending');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.pos_session_items
  WHERE session_id = ANY(p_session_ids);

  RETURN v_count;
END;
$$;

-- 3. Function to close ALL active sessions (for Delete All), optionally preserving a specific session
CREATE OR REPLACE FUNCTION public.close_all_pos_sessions(p_except_session_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count integer := 0;
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.pos_cart_sessions
  WHERE status IN ('draft', 'held', 'payment_pending')
    AND (p_except_session_id IS NULL OR id <> p_except_session_id);

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    UPDATE public.pos_cart_sessions
    SET status = 'cancelled',
        cancelled_at = COALESCE(cancelled_at, now()),
        updated_at = now()
    WHERE id = ANY(v_ids);

    GET DIAGNOSTICS v_count = ROW_COUNT;

    DELETE FROM public.pos_session_items
    WHERE session_id = ANY(v_ids);

    RETURN v_count;
  END IF;

  RETURN 0;
END;
$$;

-- 4. Harden save_pos_session_full to refuse resurrecting cancelled or completed sessions
CREATE OR REPLACE FUNCTION public.save_pos_session_full(
  p_session jsonb,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_session_id uuid;
  v_session_number text;
  v_item jsonb;
  v_result jsonb;
  v_current_status text;
BEGIN
  -- Extract or generate ID
  IF (p_session->>'id') IS NOT NULL AND (p_session->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_session_id := (p_session->>'id')::uuid;
  ELSE
    v_session_id := gen_random_uuid();
  END IF;

  -- Check if existing session is already in a terminal state
  SELECT status INTO v_current_status
  FROM public.pos_cart_sessions
  WHERE id = v_session_id;

  -- If session is already cancelled or completed, do not allow resurrection to draft/held
  IF v_current_status IN ('cancelled', 'completed') AND COALESCE(p_session->>'status', 'draft') NOT IN ('cancelled', 'completed') THEN
    SELECT jsonb_build_object(
      'id', s.id,
      'session_number', s.session_number,
      'status', s.status,
      'total', s.total,
      'customer_name', s.customer_name
    ) INTO v_result
    FROM public.pos_cart_sessions s
    WHERE s.id = v_session_id;

    RETURN v_result;
  END IF;

  v_session_number := COALESCE(NULLIF(TRIM(p_session->>'session_number'), ''), '1');
  IF v_session_number LIKE '#%' THEN
    v_session_number := SUBSTRING(v_session_number FROM 2);
  END IF;

  -- Upsert session
  INSERT INTO public.pos_cart_sessions (
    id,
    session_number,
    cashier_id,
    customer_id,
    customer_mode,
    customer_name,
    customer_phone,
    customer_email,
    status,
    discount_type,
    discount_value,
    applied_coupon,
    payment_method,
    notes,
    store_credit_applied,
    credit_token_input,
    subtotal,
    discount_total,
    total,
    held_at,
    completed_at,
    cancelled_at,
    updated_at
  ) VALUES (
    v_session_id,
    v_session_number,
    CASE WHEN (p_session->>'cashier_id') IS NOT NULL AND (p_session->>'cashier_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_session->>'cashier_id')::uuid ELSE auth.uid() END,
    CASE WHEN (p_session->>'customer_id') IS NOT NULL AND (p_session->>'customer_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_session->>'customer_id')::uuid ELSE NULL END,
    COALESCE(p_session->>'customer_mode', 'walkin'),
    COALESCE(p_session->>'customer_name', 'Walk-in Customer'),
    COALESCE(p_session->>'customer_phone', ''),
    COALESCE(p_session->>'customer_email', ''),
    COALESCE(p_session->>'status', 'draft'),
    COALESCE(p_session->>'discount_type', 'none'),
    COALESCE((p_session->>'discount_value')::numeric, 0),
    p_session->'applied_coupon',
    COALESCE(p_session->>'payment_method', 'cash'),
    COALESCE(p_session->>'notes', ''),
    COALESCE((p_session->>'store_credit_applied')::numeric, 0),
    COALESCE(p_session->>'credit_token_input', ''),
    COALESCE((p_session->>'subtotal')::numeric, 0),
    COALESCE((p_session->>'discount_total')::numeric, 0),
    COALESCE((p_session->>'total')::numeric, 0),
    CASE WHEN p_session->>'held_at' IS NOT NULL THEN (p_session->>'held_at')::timestamptz ELSE NULL END,
    CASE WHEN p_session->>'completed_at' IS NOT NULL THEN (p_session->>'completed_at')::timestamptz ELSE NULL END,
    CASE WHEN p_session->>'cancelled_at' IS NOT NULL THEN (p_session->>'cancelled_at')::timestamptz ELSE NULL END,
    now()
  ) ON CONFLICT (id) DO UPDATE SET
    session_number = EXCLUDED.session_number,
    customer_id = EXCLUDED.customer_id,
    customer_mode = EXCLUDED.customer_mode,
    customer_name = EXCLUDED.customer_name,
    customer_phone = EXCLUDED.customer_phone,
    customer_email = EXCLUDED.customer_email,
    status = CASE
      WHEN pos_cart_sessions.status IN ('cancelled', 'completed') AND EXCLUDED.status NOT IN ('cancelled', 'completed') THEN pos_cart_sessions.status
      ELSE EXCLUDED.status
    END,
    discount_type = EXCLUDED.discount_type,
    discount_value = EXCLUDED.discount_value,
    applied_coupon = EXCLUDED.applied_coupon,
    payment_method = EXCLUDED.payment_method,
    notes = EXCLUDED.notes,
    store_credit_applied = EXCLUDED.store_credit_applied,
    credit_token_input = EXCLUDED.credit_token_input,
    subtotal = EXCLUDED.subtotal,
    discount_total = EXCLUDED.discount_total,
    total = EXCLUDED.total,
    held_at = CASE WHEN EXCLUDED.status = 'held' AND pos_cart_sessions.held_at IS NULL THEN now() ELSE pos_cart_sessions.held_at END,
    completed_at = CASE WHEN EXCLUDED.status = 'completed' AND pos_cart_sessions.completed_at IS NULL THEN now() ELSE pos_cart_sessions.completed_at END,
    cancelled_at = CASE WHEN EXCLUDED.status = 'cancelled' AND pos_cart_sessions.cancelled_at IS NULL THEN now() ELSE pos_cart_sessions.cancelled_at END,
    updated_at = now()
  WHERE pos_cart_sessions.status NOT IN ('cancelled', 'completed') OR EXCLUDED.status IN ('cancelled', 'completed');

  -- Replace session items only if session is active
  IF v_current_status IS NULL OR v_current_status NOT IN ('cancelled', 'completed') THEN
    DELETE FROM public.pos_session_items WHERE session_id = v_session_id;

    IF jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        INSERT INTO public.pos_session_items (
          session_id,
          product_id,
          variant_id,
          product_slug,
          name,
          sku,
          barcode,
          brand,
          category,
          image_url,
          price,
          mrp,
          stock,
          qty,
          subtotal,
          is_custom
        ) VALUES (
          v_session_id,
          CASE WHEN (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_item->>'product_id')::uuid ELSE NULL END,
          CASE WHEN (v_item->>'variant_id') IS NOT NULL AND (v_item->>'variant_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_item->>'variant_id')::uuid ELSE NULL END,
          COALESCE(v_item->>'slug', v_item->>'product_slug', ''),
          COALESCE(v_item->>'name', 'Item'),
          COALESCE(v_item->>'sku', ''),
          COALESCE(v_item->>'barcode', ''),
          COALESCE(v_item->>'brand', ''),
          COALESCE(v_item->>'category', ''),
          v_item->>'image_url',
          COALESCE((v_item->>'price')::numeric, 0),
          COALESCE((v_item->>'mrp')::numeric, 0),
          COALESCE((v_item->>'stock')::int, 0),
          GREATEST(1, COALESCE((v_item->>'qty')::int, 1)),
          COALESCE((v_item->>'subtotal')::numeric, (COALESCE((v_item->>'price')::numeric, 0) * GREATEST(1, COALESCE((v_item->>'qty')::int, 1)))),
          COALESCE((v_item->>'isCustom')::boolean, (v_item->>'is_custom')::boolean, false)
        );
      END LOOP;
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'session_number', s.session_number,
    'status', s.status,
    'total', s.total,
    'customer_name', s.customer_name
  ) INTO v_result
  FROM public.pos_cart_sessions s
  WHERE s.id = v_session_id;

  RETURN v_result;
END;
$$;

-- 5. Harden get_active_pos_sessions to strictly exclude cancelled and completed sessions
CREATE OR REPLACE FUNCTION public.get_active_pos_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'session_number', s.session_number,
        'cashier_id', s.cashier_id,
        'customer_id', s.customer_id,
        'customer_mode', s.customer_mode,
        'customer_name', s.customer_name,
        'customer_phone', s.customer_phone,
        'customer_email', s.customer_email,
        'status', s.status,
        'discount_type', s.discount_type,
        'discount_value', s.discount_value,
        'applied_coupon', s.applied_coupon,
        'payment_method', s.payment_method,
        'notes', s.notes,
        'store_credit_applied', s.store_credit_applied,
        'credit_token_input', s.credit_token_input,
        'subtotal', s.subtotal,
        'discount_total', s.discount_total,
        'total', s.total,
        'held_at', s.held_at,
        'created_at', s.created_at,
        'updated_at', s.updated_at,
        'items', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'product_id', i.product_id,
                'variant_id', i.variant_id,
                'slug', i.product_slug,
                'name', i.name,
                'sku', i.sku,
                'barcode', i.barcode,
                'brand', i.brand,
                'category', i.category,
                'image_url', i.image_url,
                'price', i.price,
                'mrp', i.mrp,
                'stock', i.stock,
                'qty', i.qty,
                'subtotal', i.subtotal,
                'isCustom', i.is_custom
              ) ORDER BY i.created_at ASC
            )
            FROM public.pos_session_items i
            WHERE i.session_id = s.id
          ),
          '[]'::jsonb
        )
      ) ORDER BY s.created_at ASC
    ),
    '[]'::jsonb
  ) INTO v_sessions
  FROM public.pos_cart_sessions s
  WHERE s.status IN ('draft', 'held', 'payment_pending')
    AND s.cancelled_at IS NULL
    AND s.completed_at IS NULL;

  RETURN v_sessions;
END;
$$;

-- 6. Permissions
GRANT EXECUTE ON FUNCTION public.close_pos_session(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_pos_sessions_batch(uuid[]) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_all_pos_sessions(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_pos_session_full(jsonb, jsonb) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_pos_sessions() TO authenticated, anon, service_role;
