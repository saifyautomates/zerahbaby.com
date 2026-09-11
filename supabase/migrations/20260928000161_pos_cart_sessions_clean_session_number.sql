-- Migration: 20260928000161_pos_cart_sessions_clean_session_number.sql
-- Description: Drop unique constraint on session_number in pos_cart_sessions so tabs can use clean numbers (1, 2, 3...)

ALTER TABLE public.pos_cart_sessions DROP CONSTRAINT IF EXISTS pos_cart_sessions_session_number_key;

-- Update save_pos_session_full default fallback
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
BEGIN
  -- Extract or generate ID
  IF (p_session->>'id') IS NOT NULL AND (p_session->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_session_id := (p_session->>'id')::uuid;
  ELSE
    v_session_id := gen_random_uuid();
  END IF;

  v_session_number := COALESCE(NULLIF(TRIM(p_session->>'session_number'), ''), '1');
  -- Strip leading # if present
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
    status = EXCLUDED.status,
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
    updated_at = now();

  -- Replace session items
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
