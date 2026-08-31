-- Update lookup_barcode to support variants
CREATE OR REPLACE FUNCTION public.lookup_barcode(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  match_record record;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- 1. Try finding by variant sku first
  SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.stock AS variant_stock, v.price_override,
         p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
         p.barcode, p.image_url, p.is_active, p.age_group, p.description
  INTO match_record
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE v.sku = trim(_code)
  LIMIT 1;

  -- 2. If not found by variant sku, try parent sku or barcode, and return the Default variant
  IF match_record.variant_id IS NULL THEN
    SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.stock AS variant_stock, v.price_override,
           p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
           p.barcode, p.image_url, p.is_active, p.age_group, p.description
    INTO match_record
    FROM public.products p
    JOIN public.product_variants v ON v.product_id = p.id
    WHERE (p.barcode = trim(_code) OR p.sku = trim(_code))
    ORDER BY (v.name = 'Default') DESC -- Prefer 'Default' variant if matched by parent
    LIMIT 1;
  END IF;

  IF match_record.variant_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Product/Variant not found');
  END IF;

  IF NOT match_record.is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'archived', true,
      'error', 'Product is archived / unavailable for new sale',
      'product_id', match_record.product_id,
      'variant_id', match_record.variant_id,
      'name', match_record.product_name,
      'sku', COALESCE(match_record.variant_sku, match_record.barcode),
      'barcode', match_record.barcode
    );
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'product_id', match_record.product_id,
    'variant_id', match_record.variant_id,
    'slug', match_record.slug,
    'name', match_record.product_name || CASE WHEN match_record.variant_name != 'Default' THEN ' - ' || match_record.variant_name ELSE '' END,
    'brand', match_record.brand,
    'category', match_record.category,
    'price', COALESCE(match_record.price_override, match_record.price),
    'mrp', match_record.mrp,
    'stock', match_record.variant_stock,
    'sku', COALESCE(match_record.variant_sku, match_record.barcode),
    'barcode', match_record.barcode,
    'image_url', match_record.image_url,
    'age_group', match_record.age_group,
    'description', match_record.description
  );
END;
$$;
