-- =============================================================================
-- Migration: 20260928000195_add_all_entities_to_supabase_realtime.sql
-- Description: Ensure all authoritative business entity tables are published to
--              supabase_realtime for zero-stale-data propagation across Admin, POS,
--              Storefront, and all dependent interfaces.
-- =============================================================================

DO $$
DECLARE
  tbl text;
  tables_to_add text[] := ARRAY[
    'categories',
    'site_settings',
    'payment_settings',
    'homepage_sections',
    'homepage_section_items',
    'product_images',
    'product_relations',
    'product_videos',
    'coupons',
    'store_credit_ledger',
    'profiles',
    'pos_cart_sessions',
    'pos_session_items'
  ];
BEGIN
  -- 1. Ensure supabase_realtime publication exists
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- 2. Add each entity table to supabase_realtime if present and not already added
  FOREACH tbl IN ARRAY tables_to_add LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      END IF;

      -- Set REPLICA IDENTITY FULL so UPDATE/DELETE events carry complete record payloads
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
    END IF;
  END LOOP;
END $$;
