-- ==============================================================================
-- Migration: 20261012000003_harden_lookup_barcode_cross_entity_collision.sql
-- Description:
-- 1. Updates lookup_barcode RPC to detect cross-entity collisions across parent
--    product codes and variant codes before selecting any result.
-- 2. Detects intra-product variant collisions when multiple variants share a code.
-- 3. Supports optional color segments (e.g., ZR-CL-RED-M-1234) in placeholder
--    barcode detection.
-- 4. PREPARED ONLY: Not deployed to production without explicit user approval.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.lookup_barcode(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  match_record record;
  clean_input text;
  distinct_prod_count int := 0;
  distinct_variant_count int := 0;
BEGIN
  clean_input := trim(COALESCE(_code, ''));
  IF clean_input = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- 1. Strip non-printable ASCII control characters
  clean_input := regexp_replace(clean_input, '[\x00-\x1F\x7F-\x9F]', '', 'g');
  -- 2. Strip ISO/IEC 15424 AIM symbology identifiers (e.g. ]e0, ]C1, ]A0, ]Q3, ]d2)
  clean_input := regexp_replace(clean_input, '^\][a-zA-Z0-9]{2,3}', '');
  clean_input := trim(clean_input);

  IF clean_input = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Empty barcode');
  END IF;

  -- 1. Check collisions across both parent product codes and variant codes together
  SELECT count(DISTINCT p_id)
  INTO distinct_prod_count
  FROM (
    SELECT v.product_id AS p_id
    FROM public.product_variants v
    WHERE COALESCE(v.is_active, true) = true AND (
      v.barcode = clean_input 
      OR v.sku ILIKE clean_input
      OR (length(clean_input) = 13 AND clean_input LIKE '0%' AND v.barcode = substr(clean_input, 2))
      OR (length(clean_input) = 12 AND v.barcode = '0' || clean_input)
      OR (v.barcode LIKE '0%' AND clean_input = substr(v.barcode, 2))
    )
    UNION
    SELECT p.id AS p_id
    FROM public.products p
    WHERE (
      p.barcode = clean_input 
      OR p.sku ILIKE clean_input 
      OR p.slug ILIKE clean_input 
      OR p.id::text = clean_input
      OR (length(clean_input) = 13 AND clean_input LIKE '0%' AND p.barcode = substr(clean_input, 2))
      OR (length(clean_input) = 12 AND p.barcode = '0' || clean_input)
      OR (p.barcode LIKE '0%' AND clean_input = substr(p.barcode, 2))
    )
  ) combined;

  IF distinct_prod_count > 1 THEN
    RETURN jsonb_build_object(
      'found', false,
      'conflict', true,
      'error', 'Barcode conflict: code "' || clean_input || '" is assigned to ' || distinct_prod_count || ' distinct products'
    );
  END IF;

  -- 2. Check if multiple distinct variants match within the same product
  SELECT count(DISTINCT v.id)
  INTO distinct_variant_count
  FROM public.product_variants v
  WHERE COALESCE(v.is_active, true) = true AND (
    v.barcode = clean_input 
    OR v.sku ILIKE clean_input
    OR (length(clean_input) = 13 AND clean_input LIKE '0%' AND v.barcode = substr(clean_input, 2))
    OR (length(clean_input) = 12 AND v.barcode = '0' || clean_input)
    OR (v.barcode LIKE '0%' AND clean_input = substr(v.barcode, 2))
  );

  IF distinct_variant_count > 1 THEN
    RETURN jsonb_build_object(
      'found', false,
      'conflict', true,
      'error', 'Barcode conflict: code "' || clean_input || '" matches ' || distinct_variant_count || ' variants of the same product'
    );
  END IF;

  -- 3. If a specific variant matched, retrieve that variant
  IF distinct_variant_count = 1 THEN
    SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
           v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
           COALESCE(v.stock, p.stock) AS variant_stock, v.price_override, v.mrp_override,
           p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
           p.barcode AS product_barcode, p.is_active, p.age_group, p.description, p.sales_channel
    INTO match_record
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE COALESCE(v.is_active, true) = true AND (
      v.barcode = clean_input 
      OR v.sku ILIKE clean_input
      OR (length(clean_input) = 13 AND clean_input LIKE '0%' AND v.barcode = substr(clean_input, 2))
      OR (length(clean_input) = 12 AND v.barcode = '0' || clean_input)
      OR (v.barcode LIKE '0%' AND clean_input = substr(v.barcode, 2))
    )
    LIMIT 1;
  -- 4. Otherwise, if parent product matched, retrieve the parent product
  ELSIF distinct_prod_count = 1 THEN
    SELECT v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.color AS variant_color,
           v.size AS variant_size, v.barcode AS variant_barcode, v.image_url AS variant_image,
           COALESCE(v.stock, p.stock) AS variant_stock, v.price_override, v.mrp_override,
           p.id AS product_id, p.slug, p.name AS product_name, p.brand, p.category, p.price, p.mrp,
           p.barcode AS product_barcode, p.is_active, p.age_group, p.description, p.sales_channel
    INTO match_record
    FROM public.products p
    LEFT JOIN public.product_variants v ON v.product_id = p.id AND COALESCE(v.is_active, true) = true
    WHERE (
      p.barcode = clean_input 
      OR p.sku ILIKE clean_input 
      OR p.slug ILIKE clean_input 
      OR p.id::text = clean_input
      OR (length(clean_input) = 13 AND clean_input LIKE '0%' AND p.barcode = substr(clean_input, 2))
      OR (length(clean_input) = 12 AND p.barcode = '0' || clean_input)
      OR (p.barcode LIKE '0%' AND clean_input = substr(p.barcode, 2))
    )
    ORDER BY (COALESCE(v.stock, p.stock) > 0) DESC, (v.name = 'Default') DESC, v.created_at ASC NULLS LAST
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

-- Optional placeholder reconciliation (only executed with explicit user confirmation):
-- WITH conflicting_barcodes AS (
--   SELECT barcode
--   FROM public.product_variants
--   WHERE barcode IS NOT NULL AND barcode ~* '^ZR-[A-Z]{2}(-[A-Z0-9]+)?-M-\d{4}$'
--   GROUP BY barcode
--   HAVING count(DISTINCT product_id) > 1
-- )
-- UPDATE public.product_variants pv
-- SET barcode = pv.sku,
--     updated_at = now()
-- FROM conflicting_barcodes cb
-- WHERE pv.barcode = cb.barcode
--   AND pv.size IS NOT NULL
--   AND lower(pv.size) NOT IN ('m', 'med', 'medium')
--   AND pv.sku IS NOT NULL;
