-- Diagnostic RPC to inspect customer credit records
CREATE OR REPLACE FUNCTION public.get_customer_audit_records(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_norm text := public.normalize_phone(p_phone);
  v_res jsonb;
BEGIN
  SELECT jsonb_build_object(
    'pos_customers', (
      SELECT jsonb_agg(pc) FROM public.pos_customers pc 
      WHERE public.normalize_phone(pc.phone) = v_norm OR pc.phone ILIKE '%' || p_phone || '%'
    ),
    'profiles', (
      SELECT jsonb_agg(p) FROM public.profiles p 
      WHERE public.normalize_phone(p.phone) = v_norm OR p.phone ILIKE '%' || p_phone || '%'
    ),
    'offline_returns', (
      SELECT jsonb_agg(r) FROM public.offline_returns r 
      WHERE public.normalize_phone(r.customer_phone) = v_norm OR r.customer_phone ILIKE '%' || p_phone || '%'
    ),
    'store_credit_vouchers', (
      SELECT jsonb_agg(v) FROM public.store_credit_vouchers v 
      WHERE public.normalize_phone(v.customer_phone) = v_norm OR v.customer_phone ILIKE '%' || p_phone || '%'
    ),
    'pos_exchange_vouchers', (
      SELECT jsonb_agg(pv) FROM public.pos_exchange_vouchers pv 
      WHERE public.normalize_phone(pv.customer_phone) = v_norm OR pv.customer_phone ILIKE '%' || p_phone || '%'
    ),
    'store_credit_ledger', (
      SELECT jsonb_agg(l) FROM public.store_credit_ledger l 
      WHERE public.normalize_phone(l.customer_phone) = v_norm OR l.customer_phone ILIKE '%' || p_phone || '%'
    )
  ) INTO v_res;
  
  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_audit_records(text) TO authenticated, anon, service_role;
