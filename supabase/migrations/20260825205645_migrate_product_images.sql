-- ==============================================================================
-- Migration: Migrate Product Images to Relational Table
-- Description: Copies all existing image_url and images array data into the 
-- product_images table, and drops the legacy columns from products.
-- ==============================================================================

DO $$
DECLARE
  rec RECORD;
  img_url TEXT;
  idx INTEGER;
BEGIN
  FOR rec IN SELECT id, image_url, images FROM public.products LOOP
    idx := 0;
    
    -- Insert primary image from image_url if it exists
    IF rec.image_url IS NOT NULL AND trim(rec.image_url) <> '' THEN
      INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, is_primary, sort_order)
      VALUES (rec.id, rec.image_url, '', 'Primary Image', true, idx)
      ON CONFLICT DO NOTHING;
      idx := idx + 1;
    END IF;

    -- Insert remaining images from array
    IF rec.images IS NOT NULL THEN
      FOREACH img_url IN ARRAY rec.images LOOP
        -- Skip if it matches image_url to avoid duplicates
        IF img_url IS NOT NULL AND trim(img_url) <> '' AND (rec.image_url IS NULL OR img_url <> rec.image_url) THEN
          INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, is_primary, sort_order)
          VALUES (rec.id, img_url, '', 'Gallery Image', (idx = 0), idx)
          ON CONFLICT DO NOTHING;
          idx := idx + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Drop old columns
ALTER TABLE public.products DROP COLUMN IF EXISTS image_url;
ALTER TABLE public.products DROP COLUMN IF EXISTS images;

-- RPC for secure storage deletion
CREATE OR REPLACE FUNCTION public.delete_storage_object(bucket text, object_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Requires admin role
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Delete from storage.objects natively removes the file in Supabase
  DELETE FROM storage.objects WHERE bucket_id = bucket AND name = object_path;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_storage_object(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_storage_object(text, text) TO authenticated, service_role;
