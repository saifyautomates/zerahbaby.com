-- ======================== PRODUCT VARIANTS =====================

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  stock integer NOT NULL DEFAULT 0,
  price_override numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);
CREATE INDEX idx_product_variants_product ON public.product_variants(product_id);
GRANT SELECT ON public.product_variants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product variants public read" ON public.product_variants FOR SELECT USING (true);
CREATE POLICY "admins manage product variants" ON public.product_variants FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER variants_touch BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


