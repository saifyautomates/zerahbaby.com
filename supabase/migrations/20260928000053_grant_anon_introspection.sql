-- Migration: 20260928000053_grant_anon_introspection.sql
-- Grant SELECT on online returns tables to anon so PostgREST schema introspection discovers them (RLS still strictly protects all records)

GRANT SELECT ON public.online_returns TO anon;
GRANT SELECT ON public.online_return_items TO anon;
GRANT SELECT ON public.online_return_events TO anon;
GRANT SELECT ON public.open_box_events TO anon;

GRANT EXECUTE ON FUNCTION public.calculate_online_return_refund(uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_online_return(uuid, jsonb, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_online_return_status(uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_return_qc(uuid, jsonb, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_online_refund(uuid, numeric, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_open_box_delivery(uuid, text, text, text, text) TO anon, authenticated;
