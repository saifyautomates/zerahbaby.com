-- Fix permissions for product_variants so anon and authenticated can read from it
GRANT SELECT ON public.product_variants TO anon;
GRANT SELECT ON public.product_variants TO authenticated;
