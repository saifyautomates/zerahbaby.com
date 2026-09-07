-- ==============================================================================
-- Migration: 20260928000125_pos_server_side_product_search.sql
-- Description:
-- High-performance server-side product and variant search engine for POS Terminal.
-- Features:
-- 1. Enables pg_trgm extension for fuzzy typo-resilient text matching.
-- 2. Creates targeted GIN and B-Tree indexes across products and product_variants.
-- 3. Implements pos_search_products RPC returning ranked results with variant hierarchy.
-- ==============================================================================

-- 1. Enable Trigram Extension for Typo & Fuzzy Matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Indexes for Products & Product Variants
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON public.products USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_lower ON public.products (lower(sku));
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (lower(category));
CREATE INDEX IF NOT EXISTS idx_products_is_active ON public.products (is_active);

CREATE INDEX IF NOT EXISTS idx_product_variants_sku_lower ON public.product_variants (lower(sku));
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants (barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_name_trgm ON public.product_variants USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_variants_color ON public.product_variants (lower(color));

-- 3. Canonical POS Server-Side Product Search RPC
CREATE OR REPLACE FUNCTION public.pos_search_products(
  _query text,
  _limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  brand text,
  category text,
  price numeric,
  mrp numeric,
  stock int,
  sku text,
  barcode text,
  image_url text,
  sales_channel text,
  is_active boolean,
  match_score int,
  matched_variant_id uuid,
  matched_reason text,
  variants jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_input text;
  clean_lower text;
  compact_input text;
  terms text[];
  limit_val int;
BEGIN
  clean_input := trim(COALESCE(_query, ''));
  IF clean_input = '' THEN
    RETURN;
  END IF;

  clean_lower := lower(clean_input);
  -- Remove spaces and hyphens for compact code matching (e.g. "ZR GN 5007" -> "zrgn5007")
  compact_input := regexp_replace(clean_lower, '[\s\-_]+', '', 'g');
  -- Split input into distinct words for multi-word matching
  terms := string_to_array(regexp_replace(clean_lower, '\s+', ' ', 'g'), ' ');
  limit_val := LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);

  RETURN QUERY
  WITH scored_products AS (
    SELECT
      p.id AS p_id,
      p.slug AS p_slug,
      p.name AS p_name,
      COALESCE(p.brand, 'Zérah Baby & Kids') AS p_brand,
      COALESCE(p.category, 'Clothing') AS p_category,
      p.price AS p_price,
      p.mrp AS p_mrp,
      COALESCE(p.stock, 0) AS p_stock,
      COALESCE(p.sku, '') AS p_sku,
      COALESCE(p.barcode, '') AS p_barcode,
      p.sales_channel AS p_sales_channel,
      p.is_active AS p_is_active,
      -- Primary Image fallback from product_images
      (
        SELECT pi.public_url
        FROM public.product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.sort_order ASC
        LIMIT 1
      ) AS p_image_url,
      -- Calculate match score and best matching variant
      (
        SELECT jsonb_build_object(
          'score',
          CASE
            -- 1. Exact barcode match on parent or variant (Score 100)
            WHEN p.barcode = clean_input OR EXISTS (
              SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.barcode = clean_input
            ) THEN 100

            -- 2. Exact SKU match on parent or variant (Score 90)
            WHEN lower(p.sku) = clean_lower OR EXISTS (
              SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND lower(v.sku) = clean_lower
            ) THEN 90

            -- 3. Compact code match (e.g. ignoring hyphens or spaces) (Score 80)
            WHEN regexp_replace(lower(p.sku), '[\s\-_]+', '', 'g') = compact_input OR EXISTS (
              SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND regexp_replace(lower(v.sku), '[\s\-_]+', '', 'g') = compact_input
            ) THEN 80

            -- 4. Exact product name match (Score 75)
            WHEN lower(p.name) = clean_lower THEN 75

            -- 5. Product name starts with query (Score 70)
            WHEN lower(p.name) LIKE clean_lower || '%' THEN 70

            -- 6. All query terms found in product name (Score 65)
            WHEN (
              SELECT bool_and(lower(p.name) LIKE '%' || term || '%')
              FROM unnest(terms) AS term
            ) THEN 65

            -- 7. Variant attribute exact/prefix match (color, size, name) (Score 60)
            WHEN EXISTS (
              SELECT 1 FROM public.product_variants v
              WHERE v.product_id = p.id AND (
                lower(v.name) = clean_lower OR
                lower(COALESCE(v.color, '')) = clean_lower OR
                lower(COALESCE(v.size, '')) = clean_lower
              )
            ) THEN 60

            -- 8. Partial name or variant SKU contains query (Score 55)
            WHEN lower(p.name) LIKE '%' || clean_lower || '%' OR lower(p.sku) LIKE '%' || clean_lower || '%' OR EXISTS (
              SELECT 1 FROM public.product_variants v
              WHERE v.product_id = p.id AND (lower(v.sku) LIKE '%' || clean_lower || '%' OR lower(v.name) LIKE '%' || clean_lower || '%')
            ) THEN 55

            -- 9. Fuzzy Trigram similarity on product name (handles typos like "tshirt" vs "tshirrt") (Score 45)
            WHEN similarity(lower(p.name), clean_lower) > 0.25 OR word_similarity(clean_lower, lower(p.name)) > 0.35 THEN 45

            -- 10. Phonetic / double-letter normalized similarity (e.g. collapsing repeated letters) (Score 40)
            WHEN similarity(regexp_replace(lower(p.name), '([a-z])\1+', '\1', 'g'), regexp_replace(clean_lower, '([a-z])\1+', '\1', 'g')) > 0.35 THEN 40

            -- 11. Brand or category match (Score 30)
            WHEN lower(p.brand) LIKE '%' || clean_lower || '%' OR lower(p.category) LIKE '%' || clean_lower || '%' THEN 30

            ELSE 0
          END,
          'matched_variant_id',
          (
            SELECT v.id
            FROM public.product_variants v
            WHERE v.product_id = p.id AND (
              v.barcode = clean_input OR
              lower(v.sku) = clean_lower OR
              lower(v.name) = clean_lower OR
              lower(COALESCE(v.color, '')) = clean_lower OR
              lower(v.sku) LIKE '%' || clean_lower || '%'
            )
            ORDER BY (v.barcode = clean_input) DESC, (lower(v.sku) = clean_lower) DESC, v.stock DESC
            LIMIT 1
          ),
          'reason',
          CASE
            WHEN p.barcode = clean_input OR EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.barcode = clean_input) THEN 'Exact Barcode'
            WHEN lower(p.sku) = clean_lower OR EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND lower(v.sku) = clean_lower) THEN 'Exact SKU'
            WHEN lower(p.name) = clean_lower THEN 'Exact Name'
            WHEN lower(p.name) LIKE clean_lower || '%' THEN 'Name Prefix'
            WHEN similarity(lower(p.name), clean_lower) > 0.25 OR word_similarity(clean_lower, lower(p.name)) > 0.35 THEN 'Fuzzy Name'
            WHEN EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND (lower(COALESCE(v.color, '')) = clean_lower OR lower(v.name) = clean_lower)) THEN 'Variant Attribute'
            ELSE 'Partial Match'
          END
        )
      ) AS match_meta
    FROM public.products p
    WHERE p.is_active = true
      AND (
        p.barcode = clean_input OR
        lower(p.sku) LIKE '%' || clean_lower || '%' OR
        lower(p.name) LIKE '%' || clean_lower || '%' OR
        similarity(lower(p.name), clean_lower) > 0.25 OR
        word_similarity(clean_lower, lower(p.name)) > 0.35 OR
        similarity(regexp_replace(lower(p.name), '([a-z])\1+', '\1', 'g'), regexp_replace(clean_lower, '([a-z])\1+', '\1', 'g')) > 0.35 OR
        lower(COALESCE(p.brand, '')) LIKE '%' || clean_lower || '%' OR
        lower(COALESCE(p.category, '')) LIKE '%' || clean_lower || '%' OR
        EXISTS (
          SELECT 1 FROM public.product_variants v
          WHERE v.product_id = p.id AND (
            v.barcode = clean_input OR
            lower(v.sku) LIKE '%' || clean_lower || '%' OR
            lower(v.name) LIKE '%' || clean_lower || '%' OR
            lower(COALESCE(v.color, '')) LIKE '%' || clean_lower || '%'
          )
        )
      )
  )
  SELECT
    sp.p_id,
    sp.p_slug,
    sp.p_name,
    sp.p_brand,
    sp.p_category,
    sp.p_price,
    sp.p_mrp,
    sp.p_stock,
    sp.p_sku,
    sp.p_barcode,
    sp.p_image_url,
    sp.p_sales_channel,
    sp.p_is_active,
    (sp.match_meta->>'score')::int AS match_score,
    (sp.match_meta->>'matched_variant_id')::uuid AS matched_variant_id,
    (sp.match_meta->>'reason')::text AS matched_reason,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'name', v.name,
            'sku', v.sku,
            'barcode', v.barcode,
            'stock', COALESCE(v.stock, 0),
            'price', COALESCE(v.price_override, sp.p_price),
            'mrp', COALESCE(v.mrp_override, sp.p_mrp),
            'color', v.color,
            'size', v.size,
            'image_url', COALESCE(v.image_url, sp.p_image_url),
            'is_matched', (v.id = (sp.match_meta->>'matched_variant_id')::uuid)
          )
          ORDER BY (v.id = (sp.match_meta->>'matched_variant_id')::uuid) DESC, (COALESCE(v.stock, 0) > 0) DESC, v.created_at ASC
        )
        FROM public.product_variants v
        WHERE v.product_id = sp.p_id
      ),
      '[]'::jsonb
    ) AS variants
  FROM scored_products sp
  WHERE (sp.match_meta->>'score')::int > 0
  ORDER BY
    (sp.match_meta->>'score')::int DESC,
    (sp.p_stock > 0) DESC,
    sp.p_name ASC
  LIMIT limit_val;
END;
$$;

-- 4. Permissions
GRANT EXECUTE ON FUNCTION public.pos_search_products(text, int) TO anon, authenticated, service_role;
