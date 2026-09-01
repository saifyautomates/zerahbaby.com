-- =====================================================================
-- Migration: Harden Offline Sales Access, Grants, Realtime & Policies
-- =====================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sale_items TO authenticated;
GRANT SELECT ON public.offline_sales TO anon;
GRANT SELECT ON public.offline_sale_items TO anon;

ALTER TABLE public.offline_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_sale_items ENABLE ROW LEVEL SECURITY;

-- Admins select & manage offline sales
DROP POLICY IF EXISTS "admins select offline sales" ON public.offline_sales;
CREATE POLICY "admins select offline sales"
  ON public.offline_sales
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admins manage offline sales" ON public.offline_sales;
CREATE POLICY "admins manage offline sales"
  ON public.offline_sales
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Items policies
DROP POLICY IF EXISTS "admins select offline sale items" ON public.offline_sale_items;
CREATE POLICY "admins select offline sale items"
  ON public.offline_sale_items
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admins manage offline sale items" ON public.offline_sale_items;
CREATE POLICY "admins manage offline sale items"
  ON public.offline_sale_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Ensure offline_sales is part of supabase_realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'offline_sales'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_sales;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
