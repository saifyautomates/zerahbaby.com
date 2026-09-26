-- Migration: 20260928000319_grant_public_permissions_homepage_sections_and_reviews.sql
-- Description: Ensures public (anon) visitors have execution rights for RLS helper functions and SELECT on public storefront tables.

DO $$
BEGIN
  -- 1. Grant execution rights on security helper functions
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_homepage_admin') THEN
    GRANT EXECUTE ON FUNCTION public.is_homepage_admin() TO anon, authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role') THEN
    GRANT EXECUTE ON FUNCTION public.has_role(uuid, text) TO anon, authenticated;
  END IF;

  -- 2. Ensure table SELECT permissions for storefront tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'homepage_sections') THEN
    GRANT SELECT ON public.homepage_sections TO anon, authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'homepage_section_items') THEN
    GRANT SELECT ON public.homepage_section_items TO anon, authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reviews') THEN
    GRANT SELECT ON public.reviews TO anon, authenticated;
  END IF;
END $$;
