-- =====================================================================
-- Migration: Grant DELETE permission on offline_sales tables
-- Allows authenticated admins to permanently delete POS orders
-- =====================================================================

GRANT DELETE ON public.offline_sales TO authenticated;
GRANT DELETE ON public.offline_sale_items TO authenticated;

-- Make sure policies are strictly applied if they aren't covered by FOR ALL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'offline_sales' AND policyname = 'admins delete offline sales'
  ) THEN
    CREATE POLICY "admins delete offline sales"
      ON public.offline_sales
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'offline_sale_items' AND policyname = 'admins delete offline sale items'
  ) THEN
    CREATE POLICY "admins delete offline sale items"
      ON public.offline_sale_items
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
