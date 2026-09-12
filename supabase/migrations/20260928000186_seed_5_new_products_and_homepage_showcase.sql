-- ==============================================================================
-- Migration: 20260928000186_seed_5_new_products_and_homepage_showcase.sql
-- Description:
-- 1. Inserts 5 brand-new premium omnichannel products across clothing, toys, care,
--    feeding, and gear with exactly 5 stock each (both products.stock = 5 and
--    product_variants.stock = 5 for strict mathematical normalization).
-- 2. Configures homepage sections and section items so all 5 products appear
--    prominently on the Storefront Homepage.
-- ==============================================================================

DO $$
DECLARE
  v_prod1 uuid := 'f1000000-0000-4000-8000-000000000001'::uuid;
  v_prod2 uuid := 'f1000000-0000-4000-8000-000000000002'::uuid;
  v_prod3 uuid := 'f1000000-0000-4000-8000-000000000003'::uuid;
  v_prod4 uuid := 'f1000000-0000-4000-8000-000000000004'::uuid;
  v_prod5 uuid := 'f1000000-0000-4000-8000-000000000005'::uuid;

  v_var1 uuid := 'f2000000-0000-4000-8000-000000000001'::uuid;
  v_var2 uuid := 'f2000000-0000-4000-8000-000000000002'::uuid;
  v_var3 uuid := 'f2000000-0000-4000-8000-000000000003'::uuid;
  v_var4 uuid := 'f2000000-0000-4000-8000-000000000004'::uuid;
  v_var5 uuid := 'f2000000-0000-4000-8000-000000000005'::uuid;

  v_sec1 uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_sec2 uuid := '00000000-0000-4000-8000-000000000002'::uuid;

  v_cat_clothing uuid;
  v_cat_toys uuid;
  v_cat_care uuid;
  v_cat_feeding uuid;
  v_cat_gear uuid;
BEGIN

  SELECT id INTO v_cat_clothing FROM public.categories WHERE slug = 'clothing' LIMIT 1;
  SELECT id INTO v_cat_toys FROM public.categories WHERE slug = 'toys' LIMIT 1;
  SELECT id INTO v_cat_care FROM public.categories WHERE slug = 'care' LIMIT 1;
  SELECT id INTO v_cat_feeding FROM public.categories WHERE slug = 'feeding' LIMIT 1;
  SELECT id INTO v_cat_gear FROM public.categories WHERE slug = 'gear' LIMIT 1;

  -- ----------------------------------------------------------------------------
  -- 1. INSERT 5 NEW PRODUCTS (stock: 5 each)
  -- ----------------------------------------------------------------------------

  -- Product 1: Kimono Romper (Clothing)
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    v_prod1,
    'zerah-organic-bamboo-kimono-romper-sage',
    'Zérah Pure Organic Bamboo Cotton Kimono Romper (Sage Green)',
    'Zérah Essentials',
    'clothing',
    v_cat_clothing,
    'Made with 100% butter-soft certified organic bamboo cotton. Features an easy wrap-around kimono design with nickel-free snap buttons for stress-free dressing without pulling over baby''s delicate head.',
    '100% butter-soft organic bamboo cotton kimono romper with scratch mittens and foldover cuffs.',
    'ZR-CL-026',
    799,
    1399,
    4.9,
    48,
    '0-6m',
    ARRAY['100% GOTS Certified Bamboo Cotton', 'Side kimono snap closure - no pulling over head', 'Foldover scratch protection mittens', 'Hypoallergenic & thermo-regulating']::text[],
    5,
    2,
    'active',
    true,
    true,
    true,
    true,
    '8907812000263',
    'ONLINE_AND_OFFLINE',
    1,
    'Zérah Pure Organic Bamboo Cotton Kimono Romper | Zérah Baby & Kids',
    'Ultra-soft organic bamboo cotton kimono romper for newborns and infants.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    stock = 5,
    is_active = true,
    status = 'active',
    is_featured = true,
    new_arrival = true,
    sort_order = 1,
    updated_at = now();

  -- Product 2: Montessori Rainbow Blocks (Toys)
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    v_prod2,
    'montessori-wooden-rainbow-stacking-blocks',
    'Montessori Wooden Rainbow Stacking & Balance Blocks Set',
    'Zérah Play',
    'toys',
    v_cat_toys,
    'Handcrafted from sustainable European beechwood with rounded splinter-free edges. Finished with 100% non-toxic food-grade water dyes. Fosters spatial balance, fine motor skills, and open-ended creative play.',
    'Handcrafted European beechwood sensory stacking blocks with non-toxic water-based colors.',
    'ZR-TY-027',
    899,
    1499,
    4.9,
    36,
    '6-12m',
    ARRAY['Sustainably harvested natural beechwood', '100% Non-toxic baby-safe water dyes', 'Improves hand-eye coordination & cognitive balance', 'Child-safe smooth rounded corners']::text[],
    5,
    2,
    'active',
    true,
    true,
    true,
    true,
    '8907812000270',
    'ONLINE_AND_OFFLINE',
    2,
    'Montessori Wooden Rainbow Stacking Blocks | Zérah Baby & Kids',
    'Premium wooden sensory stacking blocks for toddlers and infants.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    stock = 5,
    is_active = true,
    status = 'active',
    is_featured = true,
    new_arrival = true,
    sort_order = 2,
    updated_at = now();

  -- Product 3: Baby Massage Oil (Care)
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    v_prod3,
    'zerah-natural-baby-massage-oil-almond-200ml',
    'Natural Plant-Enriched Baby Massage Oil with Sweet Almond & Calendula (200ml)',
    'Zérah Care',
    'care',
    v_cat_care,
    'Clinically tested Ayurvedic formulation blending cold-pressed sweet almond, virgin olive, and calendula flower extracts. Strengthens infant bone density, deeply moisturizes, and protects delicate skin barriers without mineral oils.',
    'Cold-pressed sweet almond and organic calendula baby massage oil for soft, nourished skin.',
    'ZR-CR-028',
    449,
    699,
    4.8,
    82,
    '0-6m',
    ARRAY['Cold-pressed Sweet Almond & Olive Oils', 'Infused with soothing organic Calendula', '0% Mineral oil, parabens, silicones & fragrance', 'Pediatrician certified hypoallergenic']::text[],
    5,
    2,
    'active',
    true,
    true,
    true,
    true,
    '8907812000287',
    'ONLINE_AND_OFFLINE',
    3,
    'Natural Plant-Enriched Baby Massage Oil 200ml | Zérah Baby & Kids',
    'Gentle, deeply nourishing sweet almond and calendula baby massage oil.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    stock = 5,
    is_active = true,
    status = 'active',
    is_featured = true,
    new_arrival = true,
    sort_order = 3,
    updated_at = now();

  -- Product 4: Glass Feeding Bottle (Feeding)
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    v_prod4,
    'anti-colic-wide-neck-glass-feeding-bottle-240ml',
    'Anti-Colic BPA-Free Wide-Neck Glass Feeding Bottle (240ml)',
    'Zérah Nurture',
    'feeding',
    v_cat_feeding,
    'Crafted from medical-grade thermal shock-resistant borosilicate glass with a dual anti-colic ventilation silicone nipple that mimics natural breastfeeding. Includes a shock-absorbing pastel silicone sleeve.',
    'Thermal borosilicate glass feeding bottle with anti-colic nipple and protective silicone sleeve.',
    'ZR-FD-029',
    649,
    1099,
    4.8,
    59,
    '0-6m',
    ARRAY['Thermal shock-resistant Borosilicate glass', 'Dual anti-colic ventilation system reduces gas', 'Breast-like natural flex silicone nipple', 'BPA, BPS & Phthalate-free with protective sleeve']::text[],
    5,
    2,
    'active',
    true,
    true,
    true,
    true,
    '8907812000294',
    'ONLINE_AND_OFFLINE',
    4,
    'Anti-Colic Wide-Neck Glass Feeding Bottle 240ml | Zérah Baby & Kids',
    'Safe, toxin-free borosilicate glass feeding bottle with protective silicone grip.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    stock = 5,
    is_active = true,
    status = 'active',
    is_featured = true,
    new_arrival = true,
    sort_order = 4,
    updated_at = now();

  -- Product 5: Baby Lounger & Nest (Gear)
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    v_prod5,
    'cloudcomfort-ergonomic-portable-baby-nest-lounger',
    'CloudComfort Ergonomic Portable Baby Nest & Sleep Lounger',
    'Zérah Baby',
    'gear',
    v_cat_gear,
    'Designed to simulate the comforting security of a mother''s womb, this multi-functional baby lounger provides 360-degree protective cushioning for supervised resting, tummy time, and travel. Features 100% breathable organic cotton.',
    '360° ergonomic portable baby nest and lounger with removable washable organic cover.',
    'ZR-GR-030',
    1899,
    3299,
    4.9,
    73,
    '0-6m',
    ARRAY['Bionic womb-like ergonomic design', '100% breathable organic cotton cover', 'Removable, machine-washable hypoallergenic zipper cover', 'Ultra-portable with dual reinforced carry handles']::text[],
    5,
    2,
    'active',
    true,
    true,
    true,
    true,
    '8907812000300',
    'ONLINE_AND_OFFLINE',
    5,
    'CloudComfort Ergonomic Portable Baby Nest & Lounger | Zérah Baby & Kids',
    'Comforting, breathable bionic baby lounger for supervised sleep and tummy time.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    stock = 5,
    is_active = true,
    status = 'active',
    is_featured = true,
    new_arrival = true,
    sort_order = 5,
    updated_at = now();

  -- ----------------------------------------------------------------------------
  -- 2. PRODUCT IMAGES
  -- ----------------------------------------------------------------------------
  DELETE FROM public.product_images WHERE product_id IN (v_prod1, v_prod2, v_prod3, v_prod4, v_prod5);

  INSERT INTO public.product_images (product_id, public_url, storage_path, alt_text, sort_order, is_primary) VALUES
    (v_prod1, 'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80', '', 'Zérah Pure Organic Bamboo Cotton Kimono Romper', 0, true),
    (v_prod2, 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80', '', 'Montessori Wooden Rainbow Stacking Blocks Set', 0, true),
    (v_prod3, 'https://images.unsplash.com/photo-1608248597359-00e9324024a8?w=800&auto=format&fit=crop&q=80', '', 'Natural Plant-Enriched Baby Massage Oil 200ml', 0, true),
    (v_prod4, 'https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&auto=format&fit=crop&q=80', '', 'Anti-Colic BPA-Free Wide-Neck Glass Feeding Bottle', 0, true),
    (v_prod5, 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=800&auto=format&fit=crop&q=80', '', 'CloudComfort Ergonomic Portable Baby Nest & Lounger', 0, true);

  -- ----------------------------------------------------------------------------
  -- 3. PRODUCT VARIANTS (EXACTLY 5 STOCK EACH - NORMALIZED 1:1)
  -- ----------------------------------------------------------------------------
  DELETE FROM public.product_variants WHERE product_id IN (v_prod1, v_prod2, v_prod3, v_prod4, v_prod5);

  INSERT INTO public.product_variants (id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active) VALUES
    (v_var1, v_prod1, '0-6M', '0-6M', 'ZR-CL-026-06M', 5, 799, 1399, '8907812000263', true),
    (v_var2, v_prod2, 'Standard', 'Standard', 'ZR-TY-027-STD', 5, 899, 1499, '8907812000270', true),
    (v_var3, v_prod3, '200ml', '200ml', 'ZR-CR-028-200ML', 5, 449, 699, '8907812000287', true),
    (v_var4, v_prod4, '240ml', '240ml', 'ZR-FD-029-240ML', 5, 649, 1099, '8907812000294', true),
    (v_var5, v_prod5, 'Standard', 'Standard', 'ZR-GR-030-STD', 5, 1899, 3299, '8907812000300', true);

  -- ----------------------------------------------------------------------------
  -- 4. LOG INITIAL INVENTORY TRANSACTIONS
  -- ----------------------------------------------------------------------------
  INSERT INTO public.inventory_transactions (
    product_id, variant_id, transaction_type, quantity, reference_type, notes
  ) VALUES
    (v_prod1, v_var1, 'restock'::public.inventory_tx_type, 5, 'admin_adjustment', 'Initial inventory seed: 5 units'),
    (v_prod2, v_var2, 'restock'::public.inventory_tx_type, 5, 'admin_adjustment', 'Initial inventory seed: 5 units'),
    (v_prod3, v_var3, 'restock'::public.inventory_tx_type, 5, 'admin_adjustment', 'Initial inventory seed: 5 units'),
    (v_prod4, v_var4, 'restock'::public.inventory_tx_type, 5, 'admin_adjustment', 'Initial inventory seed: 5 units'),
    (v_prod5, v_var5, 'restock'::public.inventory_tx_type, 5, 'admin_adjustment', 'Initial inventory seed: 5 units');

  -- ----------------------------------------------------------------------------
  -- 5. ENSURE HOMEPAGE SECTIONS & SECTION ITEMS
  -- ----------------------------------------------------------------------------
  INSERT INTO public.homepage_sections (
    id, title, subtitle, slug, section_type, source_type, status, is_visible, sort_order, display_settings, theme_preset
  ) VALUES (
    v_sec1,
    'New Arrivals & Trending',
    'Freshly curated premium essentials for your little ones',
    'new-arrivals-trending',
    'PRODUCT_GRID',
    'MANUAL',
    'published',
    true,
    1,
    '{"max_products": 8, "show_subtitle": true, "show_cta": true, "cta_label": "Explore Collection", "cta_link": "/shop"}'::jsonb,
    'DEFAULT'
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    source_type = 'MANUAL',
    status = 'published',
    is_visible = true,
    sort_order = 1,
    updated_at = now();

  INSERT INTO public.homepage_sections (
    id, title, subtitle, slug, section_type, source_type, status, is_visible, sort_order, display_settings, theme_preset
  ) VALUES (
    v_sec2,
    'Bestsellers & Parent Favorites',
    'Top picks loved by parents across India',
    'bestsellers-parent-favorites',
    'PRODUCT_GRID',
    'BESTSELLERS',
    'published',
    true,
    2,
    '{"max_products": 8, "show_subtitle": true, "show_cta": true, "cta_label": "View All", "cta_link": "/shop"}'::jsonb,
    'DEFAULT'
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    status = 'published',
    is_visible = true,
    sort_order = 2,
    updated_at = now();

  -- Clean & re-assign items for Section 1 to feature the 5 new products right at the top
  DELETE FROM public.homepage_section_items WHERE section_id = v_sec1;

  INSERT INTO public.homepage_section_items (section_id, product_id, sort_order, is_visible) VALUES
    (v_sec1, v_prod1, 1, true),
    (v_sec1, v_prod2, 2, true),
    (v_sec1, v_prod3, 3, true),
    (v_sec1, v_prod4, 4, true),
    (v_sec1, v_prod5, 5, true);

END $$;

NOTIFY pgrst, 'reload schema';
