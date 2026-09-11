-- Migration: 20260928000169_harden_homepage_sections_permissions_and_rpcs.sql
-- Description: Grants table-level DML permissions on homepage_sections to authenticated,
--              establishes robust is_homepage_admin helper, and provides canonical admin RPCs.

-- 1. Helper function for homepage admin check
CREATE OR REPLACE FUNCTION public.is_homepage_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  u_email text;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Check user_roles table
  IF EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = uid 
      AND (role::text = 'admin' OR role::text = 'owner' OR role::text = 'manager')
  ) THEN
    RETURN true;
  END IF;

  -- 2. Check profiles table
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = uid AND is_admin = true
  ) THEN
    RETURN true;
  END IF;

  -- 3. Check admin_allowlist table by email
  SELECT lower(trim(email)) INTO u_email FROM auth.users WHERE id = uid;
  IF u_email IS NULL THEN
    BEGIN
      u_email := lower(trim(auth.jwt() ->> 'email'));
    EXCEPTION WHEN OTHERS THEN
      u_email := NULL;
    END;
  END IF;

  IF u_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admin_allowlist WHERE lower(trim(email)) = u_email
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_homepage_admin() TO authenticated, anon;

-- 2. Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homepage_sections TO authenticated;
GRANT ALL ON public.homepage_sections TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homepage_section_items TO authenticated;
GRANT ALL ON public.homepage_section_items TO service_role;

-- 3. Update RLS policies
ALTER TABLE public.homepage_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homepage_section_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view published homepage sections" ON public.homepage_sections;
CREATE POLICY "Public can view published homepage sections"
  ON public.homepage_sections FOR SELECT
  USING (
    (is_visible = true AND status = 'published')
    OR public.is_homepage_admin()
  );

DROP POLICY IF EXISTS "Admins can insert homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can insert homepage sections"
  ON public.homepage_sections FOR INSERT
  WITH CHECK (public.is_homepage_admin());

DROP POLICY IF EXISTS "Admins can update homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can update homepage sections"
  ON public.homepage_sections FOR UPDATE
  USING (public.is_homepage_admin())
  WITH CHECK (public.is_homepage_admin());

DROP POLICY IF EXISTS "Admins can delete homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can delete homepage sections"
  ON public.homepage_sections FOR DELETE
  USING (public.is_homepage_admin());

-- Items policies
DROP POLICY IF EXISTS "Public can view items of published sections" ON public.homepage_section_items;
CREATE POLICY "Public can view items of published sections"
  ON public.homepage_section_items FOR SELECT
  USING (
    (
      is_visible = true
      AND EXISTS (
        SELECT 1 FROM public.homepage_sections s
        WHERE s.id = homepage_section_items.section_id
          AND s.is_visible = true
          AND s.status = 'published'
      )
    )
    OR public.is_homepage_admin()
  );

DROP POLICY IF EXISTS "Admins can insert homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can insert homepage section items"
  ON public.homepage_section_items FOR INSERT
  WITH CHECK (public.is_homepage_admin());

DROP POLICY IF EXISTS "Admins can update homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can update homepage section items"
  ON public.homepage_section_items FOR UPDATE
  USING (public.is_homepage_admin())
  WITH CHECK (public.is_homepage_admin());

DROP POLICY IF EXISTS "Admins can delete homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can delete homepage section items"
  ON public.homepage_section_items FOR DELETE
  USING (public.is_homepage_admin());

-- 4. Canonical RPC: admin_save_homepage_section
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
  p_product_ids uuid[] DEFAULT ARRAY[]::uuid[]
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

  -- Upsert section
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
    updated_at = now();

  -- Sync items if provided
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

-- 5. Canonical RPC: admin_reorder_homepage_sections
CREATE OR REPLACE FUNCTION public.admin_reorder_homepage_sections(
  p_section_ids uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idx integer;
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  IF p_section_ids IS NOT NULL AND array_length(p_section_ids, 1) > 0 THEN
    FOR idx IN 1..array_length(p_section_ids, 1) LOOP
      UPDATE public.homepage_sections
      SET sort_order = idx, updated_at = now()
      WHERE id = p_section_ids[idx];
    END LOOP;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reorder_homepage_sections TO authenticated;

-- 6. Canonical RPC: admin_duplicate_homepage_section
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

-- 7. Canonical RPC: admin_delete_homepage_section
CREATE OR REPLACE FUNCTION public.admin_delete_homepage_section(
  p_section_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  DELETE FROM public.homepage_section_items WHERE section_id = p_section_id;
  DELETE FROM public.homepage_sections WHERE id = p_section_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_homepage_section TO authenticated;

-- 8. Canonical RPC: admin_toggle_homepage_section_visibility
CREATE OR REPLACE FUNCTION public.admin_toggle_homepage_section_visibility(
  p_section_id uuid,
  p_is_visible boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_homepage_admin() THEN
    RAISE EXCEPTION 'Access denied: Administrator privileges required.';
  END IF;

  UPDATE public.homepage_sections
  SET is_visible = p_is_visible, updated_at = now()
  WHERE id = p_section_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_homepage_section_visibility TO authenticated;

NOTIFY pgrst, 'reload schema';
