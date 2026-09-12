-- ==============================================================================
-- Migration: 20260928000192_restore_pink_blue_announcement_header.sql
-- Description:
-- Restore the signature Pink & Blue gradient as the default announcement background
-- in site_settings.
-- ==============================================================================

INSERT INTO public.site_settings (key, value)
VALUES ('announcement_bg', 'linear-gradient(90deg, #E82A82 0%, #A855F7 50%, #00B4D8 100%)')
ON CONFLICT (key) DO UPDATE
SET value = 'linear-gradient(90deg, #E82A82 0%, #A855F7 50%, #00B4D8 100%)',
    updated_at = now();
