-- Migration: 20260928000170_advanced_homepage_cms_themes_and_scheduling.sql
-- Description: Adds per-section visual themes, backgrounds, campaign badges, scheduling, and spacing to homepage_sections.

-- 1. Add new columns to public.homepage_sections
ALTER TABLE public.homepage_sections
  ADD COLUMN IF NOT EXISTS theme_preset text NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS theme_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS badge_text text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS spacing text NOT NULL DEFAULT 'normal' CHECK (spacing IN ('compact', 'normal', 'spacious'));

-- 2. Create index for fast schedule queries
CREATE INDEX IF NOT EXISTS idx_homepage_sections_schedule 
  ON public.homepage_sections(is_visible, status, sort_order, starts_at, ends_at);

-- 3. Update Public RLS policy on homepage_sections with scheduling awareness
DROP POLICY IF EXISTS "Public can view published homepage sections" ON public.homepage_sections;
CREATE POLICY "Public can view published homepage sections"
  ON public.homepage_sections FOR SELECT
  USING (
    (
      is_visible = true 
      AND status = 'published'
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at >= now())
    )
    OR public.is_homepage_admin()
  );

-- 4. Update canonical RPC: admin_save_homepage_section
DROP FUNCTION IF EXISTS public.admin_save_homepage_section(
  uuid, text, text, text, text, text, text, text, boolean, integer, jsonb, uuid[]
);

CREATE OR REPLACE FUNCTION public.admin_save_homepage_section(
  p_id uuid,
  p_title text,
  p_subtitle text,
  p_slug text,
  p_section_type text,
  p_source_type text,
  p_category_slug text,
  p_status text,
  p_is_visible boolean,
  p_sort_order integer,
  p_display_settings jsonb,
  p_product_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_theme_preset text DEFAULT 'DEFAULT',
  p_theme_config jsonb DEFAULT '{}'::jsonb,
  p_badge_text text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_spacing text DEFAULT 'normal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid := p_id;
  result_row record;
  idx integer;
  pid uuid;
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  IF target_id IS NULL THEN
    target_id := gen_random_uuid();
  END IF;

  -- Upsert section with theme and scheduling
  INSERT INTO public.homepage_sections (
    id,
    title,
    subtitle,
    slug,
    section_type,
    source_type,
    category_slug,
    status,
    is_visible,
    sort_order,
    display_settings,
    theme_preset,
    theme_config,
    badge_text,
    starts_at,
    ends_at,
    spacing,
    updated_at
  )
  VALUES (
    target_id,
    trim(p_title),
    COALESCE(trim(p_subtitle), ''),
    p_slug,
    COALESCE(p_section_type, 'PRODUCT_GRID'),
    COALESCE(p_source_type, 'MANUAL'),
    p_category_slug,
    COALESCE(p_status, 'published'),
    COALESCE(p_is_visible, true),
    COALESCE(p_sort_order, 0),
    COALESCE(p_display_settings, '{}'::jsonb),
    COALESCE(p_theme_preset, 'DEFAULT'),
    COALESCE(p_theme_config, '{}'::jsonb),
    p_badge_text,
    p_starts_at,
    p_ends_at,
    COALESCE(p_spacing, 'normal'),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    slug = EXCLUDED.slug,
    section_type = EXCLUDED.section_type,
    source_type = EXCLUDED.source_type,
    category_slug = EXCLUDED.category_slug,
    status = EXCLUDED.status,
    is_visible = EXCLUDED.is_visible,
    sort_order = EXCLUDED.sort_order,
    display_settings = EXCLUDED.display_settings,
    theme_preset = EXCLUDED.theme_preset,
    theme_config = EXCLUDED.theme_config,
    badge_text = EXCLUDED.badge_text,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    spacing = EXCLUDED.spacing,
    updated_at = now();

  -- Sync items if manual
  IF p_source_type = 'MANUAL' AND p_product_ids IS NOT NULL THEN
    DELETE FROM public.homepage_section_items WHERE section_id = target_id;
    IF array_length(p_product_ids, 1) > 0 THEN
      FOR idx IN 1..array_length(p_product_ids, 1) LOOP
        pid := p_product_ids[idx];
        IF pid IS NOT NULL THEN
          INSERT INTO public.homepage_section_items (
            section_id,
            product_id,
            sort_order,
            is_visible
          )
          VALUES (
            target_id,
            pid,
            idx,
            true
          )
          ON CONFLICT (section_id, product_id) DO UPDATE SET
            sort_order = EXCLUDED.sort_order;
        END IF;
      END LOOP;
    END IF;
  END IF;

  SELECT * INTO result_row FROM public.homepage_sections WHERE id = target_id;
  RETURN to_jsonb(result_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_homepage_section TO authenticated;

-- 5. Update canonical RPC: admin_duplicate_homepage_section
CREATE OR REPLACE FUNCTION public.admin_duplicate_homepage_section(
  p_section_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  orig public.homepage_sections%ROWTYPE;
  new_id uuid := gen_random_uuid();
  new_slug text;
  result_row record;
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  SELECT * INTO orig FROM public.homepage_sections WHERE id = p_section_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source section not found';
  END IF;

  new_slug := orig.slug || '-copy-' || substr(md5(random()::text), 1, 6);

  INSERT INTO public.homepage_sections (
    id,
    title,
    subtitle,
    slug,
    section_type,
    source_type,
    category_slug,
    status,
    is_visible,
    sort_order,
    display_settings,
    theme_preset,
    theme_config,
    badge_text,
    starts_at,
    ends_at,
    spacing,
    created_at,
    updated_at
  )
  VALUES (
    new_id,
    orig.title || ' (Copy)',
    orig.subtitle,
    new_slug,
    orig.section_type,
    orig.source_type,
    orig.category_slug,
    orig.status,
    orig.is_visible,
    orig.sort_order + 1,
    orig.display_settings,
    orig.theme_preset,
    orig.theme_config,
    orig.badge_text,
    orig.starts_at,
    orig.ends_at,
    orig.spacing,
    now(),
    now()
  );

  -- Duplicate items if any
  INSERT INTO public.homepage_section_items (
    section_id,
    product_id,
    sort_order,
    is_visible
  )
  SELECT 
    new_id,
    product_id,
    sort_order,
    is_visible
  FROM public.homepage_section_items
  WHERE section_id = p_section_id;

  SELECT * INTO result_row FROM public.homepage_sections WHERE id = new_id;
  RETURN to_jsonb(result_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_duplicate_homepage_section TO authenticated;

NOTIFY pgrst, 'reload schema';
