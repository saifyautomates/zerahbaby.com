-- Reset hero_media to empty array to restore the default baby photo
UPDATE public.site_settings
SET value = '[]', updated_at = NOW()
WHERE key = 'hero_media';
