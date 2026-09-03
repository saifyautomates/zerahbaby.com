-- ==============================================================================
-- Migration: 20260928000106_cleanup_invalid_blob_urls.sql
-- Description:
--   Removes any ephemeral local blob: or data: URIs accidentally saved in product_images,
--   ensuring that only valid persistent HTTPS URLs or storage paths remain.
-- ==============================================================================

DELETE FROM public.product_images
WHERE public_url LIKE 'blob:%' 
   OR public_url LIKE 'data:%'
   OR trim(public_url) = '';
