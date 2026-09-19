-- =========================================================================================
-- MIGRATION: 20260928000264_fix_search_pos_customers_ambiguous_created_at.sql
-- Fix ambiguous column reference 'created_at' in search_pos_customers PL/pgSQL function.
-- Fully qualifies all column references in offline_returns and deduped tables.
-- =========================================================================================

CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS TABLE (
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
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean text := trim(COALESCE(_query, ''));
  v_norm text := public.normalize_phone(v_clean);
  v_voucher_cust_id uuid;
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  -- Check if query matches a return credit token (fully qualify ret.created_at to prevent PL/pgSQL ambiguity)
  SELECT ret.customer_id INTO v_voucher_cust_id
  FROM public.offline_returns ret
  WHERE upper(trim(ret.credit_token)) = upper(v_clean)
  ORDER BY ret.created_at DESC
  LIMIT 1;

  RETURN QUERY
  WITH combined_customers AS (
    SELECT 
      c.id,
      COALESCE(NULLIF(trim(c.name), ''), 'Walk-in Customer') AS name,
      COALESCE(c.phone, '') AS phone,
      COALESCE(c.email, '') AS email,
      COALESCE(c.city, '') AS city,
      COALESCE(c.address, '') AS address,
      COALESCE(c.state, '') AS state,
      COALESCE(c.pincode, '') AS pincode,
      ''::text AS notes,
      c.created_at,
      c.updated_at
    FROM public.pos_customers c
    UNION
    SELECT
      p.id,
      COALESCE(NULLIF(trim(p.full_name), ''), 'Walk-in Customer') AS name,
      COALESCE(p.phone, '') AS phone,
      COALESCE(p.email, '') AS email,
      COALESCE(p.city, '') AS city,
      COALESCE(p.address, '') AS address,
      COALESCE(p.state, '') AS state,
      COALESCE(p.pincode, '') AS pincode,
      ''::text AS notes,
      p.created_at,
      p.updated_at
    FROM public.profiles p
  ),
  deduped AS (
    SELECT DISTINCT ON (cc.id)
      cc.id,
      cc.name,
      cc.phone,
      cc.email,
      cc.city,
      cc.address,
      cc.state,
      cc.pincode,
      cc.notes,
      cc.created_at,
      cc.updated_at
    FROM combined_customers cc
    ORDER BY cc.id, cc.updated_at DESC
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
    -- Calculate live active store credit balance
    GREATEST(
      COALESCE((SELECT pc.store_credit_balance FROM public.pos_customers pc WHERE pc.id = d.id), 0),
      COALESCE((
        SELECT SUM(GREATEST(0, r.refund_amount - COALESCE(r.credit_used, 0)))
        FROM public.offline_returns r
        WHERE (r.customer_id = d.id OR (d.phone != '' AND public.normalize_phone(r.customer_phone) = public.normalize_phone(d.phone)))
          AND (r.credit_token_status = 'ACTIVE' OR r.credit_token_status IS NULL)
          AND (r.expires_at IS NULL OR r.expires_at >= now())
      ), 0)
    )::numeric AS store_credit_balance,
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
