-- ==============================================================================
-- Migration: Include sales_channel in lookup_barcode RPC
-- Description: Ensures lookup_barcode returns p.sales_channel so POS terminal correctly
--              identifies and displays 'OFFLINE_ONLY' vs 'ONLINE_AND_OFFLINE' products.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.lookup_barcode(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  match_record record;
  clean_input text;
BEGIN
  clean_input := trim(COALESCE(_code, ''));
  IF clean_input = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- 1. Try finding by exact variant barcode or variant SKU first
  SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
         v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
         COALESCE(v.stock, p.stock) AS variant_stock, v.price_override, v.mrp_override,
         p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
         p.barcode AS product_barcode, p.is_active, p.age_group, p.description, p.sales_channel
  INTO match_record
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE (v.barcode = clean_input OR v.sku ILIKE clean_input)
  LIMIT 1;

  -- 2. If not found, try finding by parent barcode, parent SKU, parent slug, or parent ID with variants
  IF match_record.product_id IS NULL THEN
    SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
           v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
           COALESCE(v.stock, p.stock) AS variant_stock, v.price_override, v.mrp_override,
           p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
           p.barcode AS product_barcode, p.is_active, p.age_group, p.description, p.sales_channel
    INTO match_record
    FROM public.products p
    LEFT JOIN public.product_variants v ON v.product_id = p.id
    WHERE (p.barcode = clean_input OR p.sku ILIKE clean_input OR p.slug ILIKE clean_input OR p.id::text = clean_input)
    ORDER BY (v.name = 'Default') DESC, v.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF match_record.product_id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'Product/Variant not found for code: ' || clean_input);
  END IF;

  IF NOT match_record.is_active THEN
    RETURN jsonb_build_object(
      'found', true,
      'archived', true,
      'error', 'Product is archived / unavailable for new sale',
      'product_id', match_record.product_id,
      'variant_id', match_record.variant_id,
      'name', match_record.product_name,
      'sku', COALESCE(match_record.variant_sku, match_record.product_barcode),
      'barcode', COALESCE(match_record.variant_barcode, match_record.product_barcode),
      'sales_channel', COALESCE(match_record.sales_channel, 'ONLINE_AND_OFFLINE')
    );
  END IF;

  -- Fallback image from product_images if variant image is null
  IF match_record.variant_image IS NULL THEN
    SELECT public_url INTO match_record.variant_image
    FROM public.product_images
    WHERE product_id = match_record.product_id
      AND (match_record.variant_color IS NULL OR color = match_record.variant_color OR color IS NULL)
    ORDER BY is_primary DESC, sort_order ASC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'product_id', match_record.product_id,
    'variant_id', match_record.variant_id,
    'slug', match_record.slug,
    'name', match_record.product_name || CASE 
      WHEN match_record.variant_color IS NOT NULL AND match_record.variant_size IS NOT NULL 
        THEN ' (' || match_record.variant_color || ' / ' || match_record.variant_size || ')'
      WHEN match_record.variant_name IS NOT NULL AND match_record.variant_name != 'Default' AND match_record.variant_name != ''
        THEN ' - ' || match_record.variant_name 
      ELSE '' 
    END,
    'brand', COALESCE(match_record.brand, 'Zérah Baby & Kids'),
    'category', COALESCE(match_record.category, 'clothing'),
    'color', match_record.variant_color,
    'size', match_record.variant_size,
    'price', COALESCE(match_record.price_override, match_record.price, 0),
    'mrp', COALESCE(match_record.mrp_override, match_record.mrp, match_record.price, 0),
    'stock', COALESCE(match_record.variant_stock, 0),
    'sku', COALESCE(match_record.variant_sku, match_record.product_barcode, ''),
    'barcode', COALESCE(match_record.variant_barcode, match_record.product_barcode, clean_input),
    'image_url', match_record.variant_image,
    'age_group', COALESCE(match_record.age_group, ''),
    'description', COALESCE(match_record.description, ''),
    'sales_channel', COALESCE(match_record.sales_channel, 'ONLINE_AND_OFFLINE')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_barcode(text) TO anon, authenticated, service_role;
