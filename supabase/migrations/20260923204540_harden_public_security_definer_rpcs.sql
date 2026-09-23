-- Harden exposed SECURITY DEFINER RPCs.
-- Keep only explicitly public read/telemetry/contact endpoints callable anonymously.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT (
        p.proname = 'current_ist_date'
        OR p.proname = 'get_approved_product_reviews'
        OR p.proname = 'get_related_products'
        OR p.proname = 'get_payment_settings'
        OR p.proname = 'submit_customer_query'
        OR p.proname = 'record_store_activity'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.fn);
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.current_ist_date() TO anon;
GRANT EXECUTE ON FUNCTION public.get_approved_product_reviews(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_related_products(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_payment_settings() TO anon;
GRANT EXECUTE ON FUNCTION public.submit_customer_query(text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_store_activity(text, uuid, uuid, text, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';
