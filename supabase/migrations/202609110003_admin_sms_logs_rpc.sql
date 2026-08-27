-- ============================================================
-- SECURE ADMIN RPC FOR SMS LOGS
-- Migration: 202609110003_admin_sms_logs_rpc.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_sms_logs(p_limit int DEFAULT 200)
RETURNS SETOF public.sms_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can access SMS delivery logs';
  END IF;

  RETURN QUERY
  SELECT * FROM public.sms_logs
  ORDER BY created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_sms_logs(int) TO authenticated;
