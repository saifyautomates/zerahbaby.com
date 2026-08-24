-- Create secure product_costs table
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  buying_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

-- Policies: Only admins can manage and read
DROP POLICY IF EXISTS "admins manage product costs" ON public.product_costs;
CREATE POLICY "admins manage product costs" ON public.product_costs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Migrate existing cost_price data if the column exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'cost_price') THEN
    INSERT INTO public.product_costs (product_id, buying_price)
    SELECT id, COALESCE(cost_price, 0)
    FROM public.products
    ON CONFLICT (product_id) DO NOTHING;
    
    -- Drop the insecure column
    ALTER TABLE public.products DROP COLUMN cost_price;
  END IF;
END
$$;
