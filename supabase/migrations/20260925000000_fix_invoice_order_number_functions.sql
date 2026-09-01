-- Drop trigger and old function returning trigger, then create string generators

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
END;
$$;

DROP TRIGGER IF EXISTS orders_generate_number ON public.orders;
DROP FUNCTION IF EXISTS public.generate_order_number() CASCADE;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invoice_number() TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.generate_order_number() TO authenticated, service_role, anon;
