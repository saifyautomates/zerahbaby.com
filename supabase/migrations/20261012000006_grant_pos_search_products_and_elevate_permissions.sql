-- Forward Migration: Grant execute permissions and enforce SECURITY DEFINER on pos_search_products
-- Fixes permission denied for anon/authenticated roles on POS product search RPC

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'pos_search_products'
  ) THEN
    ALTER FUNCTION public.pos_search_products(text, integer) SECURITY DEFINER;
    ALTER FUNCTION public.pos_search_products(text, integer) SET search_path = public;
    GRANT EXECUTE ON FUNCTION public.pos_search_products(text, integer) TO anon, authenticated, service_role;
  END IF;
END $$;
