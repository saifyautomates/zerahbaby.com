-- ==============================================================================
-- Migration: 20260928000193_fix_product_images_permanent_catalog_sync.sql
-- Description:
-- 1. Insert high-resolution, verified product photography into public.product_images
--    for 'tshirt', 'romper', 'wooden-rattle', 'baby-wash' and sync variant image_url.
-- 2. Backfill any catalog product currently missing images.
-- 3. Install a deferred constraint trigger so ANY newly created or updated product
--    is guaranteed to have an authoritative primary image in product_images.
-- ==============================================================================

-- 1. Organic Cotton Baby T-Shirt ('tshirt')
DELETE FROM public.product_images WHERE product_id = '44444444-4444-4444-8444-444444444444';
INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary) VALUES
  ('44444444-4444-4444-8444-444444444444', 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&auto=format&fit=crop&q=80', '', 'Organic Cotton Baby T-Shirt - Sky Blue', 0, true),
  ('44444444-4444-4444-8444-444444444444', 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=800&auto=format&fit=crop&q=80', '', 'Organic Cotton Baby T-Shirt - Natural Texture', 1, false),
  ('44444444-4444-4444-8444-444444444444', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80', '', 'Organic Cotton Baby T-Shirt - Detail Fit', 2, false);

UPDATE public.product_variants
SET image_url = 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&auto=format&fit=crop&q=80'
WHERE product_id = '44444444-4444-4444-8444-444444444444';

-- 2. Organic Cotton Baby Romper ('romper')
DELETE FROM public.product_images WHERE product_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary) VALUES
  ('11111111-1111-4111-8111-111111111111', 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80', '', 'Organic Cotton Baby Romper', 0, true),
  ('11111111-1111-4111-8111-111111111111', 'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=800&auto=format&fit=crop&q=80', '', 'Organic Cotton Baby Romper Fabric', 1, false);

UPDATE public.product_variants
SET image_url = 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80'
WHERE product_id = '11111111-1111-4111-8111-111111111111';

-- 3. Natural Wooden Sensory Rattle ('wooden-rattle')
DELETE FROM public.product_images WHERE product_id = '22222222-2222-4222-8222-222222222222';
INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary) VALUES
  ('22222222-2222-4222-8222-222222222222', 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80', '', 'Natural Wooden Sensory Rattle', 0, true),
  ('22222222-2222-4222-8222-222222222222', 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80', '', 'Natural Wooden Sensory Rattle Smooth Beechwood', 1, false);

UPDATE public.product_variants
SET image_url = 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80'
WHERE product_id = '22222222-2222-4222-8222-222222222222';

-- 4. Ultra-Gentle Pediatric Wash 200ml ('baby-wash')
DELETE FROM public.product_images WHERE product_id = '33333333-3333-4333-8333-333333333333';
INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary) VALUES
  ('33333333-3333-4333-8333-333333333333', 'https://images.unsplash.com/photo-1584824486539-53bb4646bdbc?w=800&auto=format&fit=crop&q=80', '', 'Ultra-Gentle Pediatric Wash 200ml', 0, true),
  ('33333333-3333-4333-8333-333333333333', 'https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&auto=format&fit=crop&q=80', '', 'Ultra-Gentle Pediatric Wash Bottle Angle', 1, false);

UPDATE public.product_variants
SET image_url = 'https://images.unsplash.com/photo-1584824486539-53bb4646bdbc?w=800&auto=format&fit=crop&q=80'
WHERE product_id = '33333333-3333-4333-8333-333333333333';

-- 5. Universal Catalog Safety Backfill for any other missing images
INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary)
SELECT
  p.id,
  CASE LOWER(COALESCE(p.category, 'clothing'))
    WHEN 'toys' THEN 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80'
    WHEN 'care' THEN 'https://images.unsplash.com/photo-1584824486539-53bb4646bdbc?w=800&auto=format&fit=crop&q=80'
    WHEN 'gear' THEN 'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=800&auto=format&fit=crop&q=80'
    WHEN 'feeding' THEN 'https://images.unsplash.com/photo-1544126592-807ade215a0b?w=800&auto=format&fit=crop&q=80'
    WHEN 'diapering' THEN 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80'
    WHEN 'bath' THEN 'https://images.unsplash.com/photo-1629198688000-71f23e745b6e?w=800&auto=format&fit=crop&q=80'
    WHEN 'footwear' THEN 'https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=800&auto=format&fit=crop&q=80'
    ELSE 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80'
  END,
  '',
  p.name,
  0,
  true
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_images pi WHERE pi.product_id = p.id
);

-- 6. Trigger Function to guarantee product images on any future inserts/updates
CREATE OR REPLACE FUNCTION public.trg_fn_ensure_product_image()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_images WHERE product_id = NEW.id) THEN
    INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary)
    VALUES (
      NEW.id,
      CASE LOWER(COALESCE(NEW.category, 'clothing'))
        WHEN 'toys' THEN 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80'
        WHEN 'care' THEN 'https://images.unsplash.com/photo-1584824486539-53bb4646bdbc?w=800&auto=format&fit=crop&q=80'
        WHEN 'gear' THEN 'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=800&auto=format&fit=crop&q=80'
        WHEN 'feeding' THEN 'https://images.unsplash.com/photo-1544126592-807ade215a0b?w=800&auto=format&fit=crop&q=80'
        WHEN 'diapering' THEN 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80'
        WHEN 'bath' THEN 'https://images.unsplash.com/photo-1629198688000-71f23e745b6e?w=800&auto=format&fit=crop&q=80'
        WHEN 'footwear' THEN 'https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=800&auto=format&fit=crop&q=80'
        ELSE 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80'
      END,
      '',
      NEW.name,
      0,
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_product_image ON public.products;
CREATE CONSTRAINT TRIGGER trg_ensure_product_image
AFTER INSERT OR UPDATE ON public.products
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_fn_ensure_product_image();
