DROP POLICY IF EXISTS "active products public read" ON public.products;
CREATE POLICY "active products anon read" ON public.products FOR SELECT TO anon USING (is_active);
CREATE POLICY "active products auth read" ON public.products FOR SELECT TO authenticated USING (is_active OR has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.products TO authenticated;