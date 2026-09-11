-- Migration: 20260928000168_create_homepage_sections_cms.sql
-- Description: Creates database-backed dynamic homepage multi-section CMS with RLS and seed defaults.

-- 1. Create homepage_sections table
CREATE TABLE IF NOT EXISTS public.homepage_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  subtitle text NOT NULL DEFAULT '',
  slug text NOT NULL,
  section_type text NOT NULL DEFAULT 'PRODUCT_GRID' CHECK (section_type IN ('PRODUCT_GRID', 'PRODUCT_CAROUSEL')),
  source_type text NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('MANUAL', 'BESTSELLERS', 'NEW_ARRIVALS', 'DISCOUNTED', 'CATEGORY')),
  category_slug text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft', 'archived')),
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  display_settings jsonb NOT NULL DEFAULT '{
    "max_products": 8,
    "show_subtitle": true,
    "show_cta": true,
    "cta_label": "View all",
    "cta_link": "/shop"
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. Create homepage_section_items table
CREATE TABLE IF NOT EXISTS public.homepage_section_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.homepage_sections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_section_product UNIQUE (section_id, product_id)
);

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_homepage_sections_visibility 
  ON public.homepage_sections(is_visible, status, sort_order);

CREATE INDEX IF NOT EXISTS idx_homepage_section_items_section 
  ON public.homepage_section_items(section_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_homepage_section_items_product 
  ON public.homepage_section_items(product_id);

-- 4. Enable Row Level Security
ALTER TABLE public.homepage_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homepage_section_items ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for homepage_sections
DROP POLICY IF EXISTS "Public can view published homepage sections" ON public.homepage_sections;
CREATE POLICY "Public can view published homepage sections"
  ON public.homepage_sections FOR SELECT
  USING (
    (is_visible = true AND status = 'published')
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Admins can insert homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can insert homepage sections"
  ON public.homepage_sections FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can update homepage sections"
  ON public.homepage_sections FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete homepage sections" ON public.homepage_sections;
CREATE POLICY "Admins can delete homepage sections"
  ON public.homepage_sections FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. RLS Policies for homepage_section_items
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
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Admins can insert homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can insert homepage section items"
  ON public.homepage_section_items FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can update homepage section items"
  ON public.homepage_section_items FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete homepage section items" ON public.homepage_section_items;
CREATE POLICY "Admins can delete homepage section items"
  ON public.homepage_section_items FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- 7. Grant Permissions
GRANT SELECT ON public.homepage_sections TO anon, authenticated;
GRANT ALL ON public.homepage_sections TO service_role;

GRANT SELECT ON public.homepage_section_items TO anon, authenticated;
GRANT ALL ON public.homepage_section_items TO service_role;

-- 8. Seed existing default sections for seamless 1:1 continuity
INSERT INTO public.homepage_sections (
  id,
  title,
  subtitle,
  slug,
  section_type,
  source_type,
  status,
  is_visible,
  sort_order,
  display_settings
)
VALUES 
  (
    '00000000-0000-0000-0000-000000000001',
    'Bestsellers',
    'Top picks loved by parents across India',
    'bestsellers',
    'PRODUCT_GRID',
    'BESTSELLERS',
    'published',
    true,
    1,
    '{"max_products": 8, "show_subtitle": true, "show_cta": true, "cta_label": "View all", "cta_link": "/shop"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Deals of the week',
    'Biggest savings across the store, refreshed every Monday.',
    'deals-of-the-week',
    'PRODUCT_GRID',
    'DISCOUNTED',
    'published',
    true,
    2,
    '{"max_products": 4, "show_subtitle": true, "show_cta": true, "cta_label": "View all deals", "cta_link": "/shop"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
