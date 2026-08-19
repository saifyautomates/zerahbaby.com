CREATE SEQUENCE IF NOT EXISTS public.invoice_no_seq START 1001;
CREATE OR REPLACE FUNCTION public.set_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_no IS NULL OR NEW.invoice_no = '' THEN
    NEW.invoice_no := 'ZRH-' || to_char(now(), 'YYYY') || '-' || nextval('public.invoice_no_seq');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_invoice_no() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_invoice_no ON public.orders;
CREATE TRIGGER orders_invoice_no BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_invoice_no();