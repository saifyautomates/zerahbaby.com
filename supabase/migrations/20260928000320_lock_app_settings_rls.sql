-- Migration: 20260928000320_lock_app_settings_rls.sql
-- Description: Locks down public.app_settings with Row Level Security (RLS) to prevent unauthorized mutations.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_settings') THEN
    -- 1. Enable RLS
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

    -- 2. Drop existing policies if any
    DROP POLICY IF EXISTS "Public can view app_settings" ON public.app_settings;
    DROP POLICY IF EXISTS "Admins can manage app_settings" ON public.app_settings;
    DROP POLICY IF EXISTS "Service role can manage app_settings" ON public.app_settings;

    -- 3. Create read-only policy for public/anon
    CREATE POLICY "Public can view app_settings"
      ON public.app_settings FOR SELECT
      USING (true);

    -- 4. Create management policy for admins
    CREATE POLICY "Admins can manage app_settings"
      ON public.app_settings FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text IN ('admin', 'owner')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
        )
        OR EXISTS (
          SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role::text IN ('admin', 'owner')
        )
      );

    -- 5. Grant table permissions
    GRANT SELECT ON public.app_settings TO anon, authenticated;
    GRANT ALL ON public.app_settings TO service_role;
  END IF;
END $$;
