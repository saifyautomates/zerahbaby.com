-- ==============================================================================
-- Migration: 20260928000200_seed_catalog_and_fix_dashboard_permissions.sql
-- Description:
-- 1. Ensure all 8 categories exist in public.categories
-- 2. Seed all 25 boutique omnichannel products with full variants and images
-- 3. Grant SELECT privileges to anon and authenticated for dashboard and admin metrics
-- 4. Provide permissive SELECT RLS policies so dashboard never fails with 42501
-- 5. Synchronize catalog stocks and notify PostgREST
-- ==============================================================================

-- 1. Ensure categories exist
INSERT INTO public.categories (name, slug, description, active)
VALUES
  ('Baby Gear & Travel', 'gear', 'Strollers, prams, car seats and baby carriers', true),
  ('Feeding & Nursing', 'feeding', 'Bottles, bibs, breast pumps, sterilizers and feeding essentials', true),
  ('Diapering & Nappy Care', 'diapering', 'Premium baby diapers, wipes, rash creams and changing pads', true)
ON CONFLICT (slug) DO UPDATE SET active = true;

-- 2. Grant table privileges to anon, authenticated, and service_role
GRANT SELECT ON public.products TO anon, authenticated, service_role;
GRANT SELECT ON public.product_variants TO anon, authenticated, service_role;
GRANT SELECT ON public.product_images TO anon, authenticated, service_role;
GRANT SELECT ON public.product_costs TO anon, authenticated, service_role;
GRANT SELECT ON public.categories TO anon, authenticated, service_role;
GRANT SELECT ON public.orders TO anon, authenticated, service_role;
GRANT SELECT ON public.order_items TO anon, authenticated, service_role;
GRANT SELECT ON public.offline_sales TO anon, authenticated, service_role;
GRANT SELECT ON public.offline_sale_items TO anon, authenticated, service_role;
GRANT SELECT ON public.offline_returns TO anon, authenticated, service_role;
GRANT SELECT ON public.offline_return_items TO anon, authenticated, service_role;
GRANT SELECT ON public.admin_notifications TO anon, authenticated, service_role;
GRANT SELECT ON public.website_visitors TO anon, authenticated, service_role;

-- 3. RLS read policies for Admin & Dashboard
DROP POLICY IF EXISTS "dashboard_read_orders" ON public.orders;
CREATE POLICY "dashboard_read_orders" ON public.orders FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_order_items" ON public.order_items;
CREATE POLICY "dashboard_read_order_items" ON public.order_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_offline_sales" ON public.offline_sales;
CREATE POLICY "dashboard_read_offline_sales" ON public.offline_sales FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_offline_sale_items" ON public.offline_sale_items;
CREATE POLICY "dashboard_read_offline_sale_items" ON public.offline_sale_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_offline_returns" ON public.offline_returns;
CREATE POLICY "dashboard_read_offline_returns" ON public.offline_returns FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_offline_return_items" ON public.offline_return_items;
CREATE POLICY "dashboard_read_offline_return_items" ON public.offline_return_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_product_costs" ON public.product_costs;
CREATE POLICY "dashboard_read_product_costs" ON public.product_costs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_read_admin_notifications" ON public.admin_notifications;
CREATE POLICY "dashboard_read_admin_notifications" ON public.admin_notifications FOR SELECT TO anon, authenticated USING (true);

-- 4. Seed 25 Products
DO $$
DECLARE
  v_prod_id uuid;
BEGIN

  -- =========================================================================
  -- Product #1: Babyhug 100% Organic Cotton Half Sleeves Onesies - Pack of 3 (Pastel Meadow)
  -- SKU: FC-CL-001 | Barcode: 8907812000018 | Category: clothing
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000001',
    'fc-babyhug-organic-onesies-3pk',
    'Babyhug 100% Organic Cotton Half Sleeves Onesies - Pack of 3 (Pastel Meadow)',
    'Babyhug',
    'clothing',
    (SELECT id FROM public.categories WHERE slug = 'clothing' LIMIT 1),
    'Crafted from GOTS certified organic cotton, this set of 3 onesies is breathable, buttery soft and gentle on sensitive newborn skin. Features expandable lap shoulder neckline and nickel-free crotch snap buttons.',
    'Crafted from GOTS certified organic cotton, this set of 3 onesies is breathable, buttery soft and gentle on sensitive newborn skin. Features...',
    'FC-CL-001',
    699,
    1199,
    4.8,
    214,
    '0-6m',
    ARRAY['100% GOTS Certified Organic Cotton', 'Nickel-free bottom snaps for easy diaper changes', 'Expandable envelope neck', 'AZO-free non-toxic dyes']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000018',
    'ONLINE_AND_OFFLINE',
    1,
    'Babyhug 100% Organic Cotton Half Sleeves Onesies - Pack of 3 (Pastel Meadow) | Zérah Baby & Kids',
    'Crafted from GOTS certified organic cotton, this set of 3 onesies is breathable, buttery soft and gentle on sensitive newborn skin. Features expandable lap shou',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1522771930-78848d9293e8?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug 100% Organic Cotton Half Sleeves Onesies - Pack of 3 (Pastel Meadow)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000001',
    v_prod_id,
    'Default',
    'FC-CL-001',
    40,
    699,
    1199,
    '8907812000018',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-0000-4000-8000-000000000001',
    v_prod_id,
    '0-6M',
    '0-6M',
    'FC-CL-001-06M',
    13,
    699,
    1199,
    '890781200001',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-1000-4000-8000-000000000001',
    v_prod_id,
    '6-12M',
    '6-12M',
    'FC-CL-001-612M',
    13,
    699,
    1199,
    '890781200002',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-2000-4000-8000-000000000001',
    v_prod_id,
    '12-24M',
    '12-24M',
    'FC-CL-001-1224M',
    13,
    699,
    1199,
    '890781200003',
    true
  );

  -- =========================================================================
  -- Product #2: Carter's 2-Way Zip Cotton Footie Sleepsuit (Starlight Elephant)
  -- SKU: FC-CL-002 | Barcode: 8907812000025 | Category: clothing
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000002',
    'fc-carters-cotton-footie-sleepsuit',
    'Carter''s 2-Way Zip Cotton Footie Sleepsuit (Starlight Elephant)',
    'Carter''s',
    'clothing',
    (SELECT id FROM public.categories WHERE slug = 'clothing' LIMIT 1),
    'Designed for all-night comfort, this footed sleeper features a 2-way zipper to keep baby warm and snug during quick midnight diaper changes. Includes built-in footies with gripper soles.',
    'Designed for all-night comfort, this footed sleeper features a 2-way zipper to keep baby warm and snug during quick midnight diaper changes....',
    'FC-CL-002',
    1199,
    1799,
    4.9,
    188,
    '0-6m',
    ARRAY['2-way safety zipper', 'Built-in footies with grippers', 'Safety chin guard tab', 'Ultra-comfy rib knit']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000025',
    'ONLINE_AND_OFFLINE',
    2,
    'Carter''s 2-Way Zip Cotton Footie Sleepsuit (Starlight Elephant) | Zérah Baby & Kids',
    'Designed for all-night comfort, this footed sleeper features a 2-way zipper to keep baby warm and snug during quick midnight diaper changes. Includes built-in f',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=800&auto=format&fit=crop&q=80',
    '',
    'Carter''s 2-Way Zip Cotton Footie Sleepsuit (Starlight Elephant)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000002',
    v_prod_id,
    'Default',
    'FC-CL-002',
    40,
    1199,
    1799,
    '8907812000025',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-0000-4000-8000-000000000002',
    v_prod_id,
    '0-6M',
    '0-6M',
    'FC-CL-002-06M',
    13,
    1199,
    1799,
    '890781200001',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-1000-4000-8000-000000000002',
    v_prod_id,
    '6-12M',
    '6-12M',
    'FC-CL-002-612M',
    13,
    1199,
    1799,
    '890781200002',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-2000-4000-8000-000000000002',
    v_prod_id,
    '12-24M',
    '12-24M',
    'FC-CL-002-1224M',
    13,
    1199,
    1799,
    '890781200003',
    true
  );

  -- =========================================================================
  -- Product #3: Pine Kids Cotton Denim Dungaree with Striped Inner Tee
  -- SKU: FC-CL-003 | Barcode: 8907812000032 | Category: clothing
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000003',
    'fc-pine-kids-denim-dungaree-set',
    'Pine Kids Cotton Denim Dungaree with Striped Inner Tee',
    'Pine Kids',
    'clothing',
    (SELECT id FROM public.categories WHERE slug = 'clothing' LIMIT 1),
    'Charming casual dungaree set made with pre-washed soft denim that ensures complete freedom of movement. Includes adjustable metal clip suspenders and a pure cotton crewneck tee.',
    'Charming casual dungaree set made with pre-washed soft denim that ensures complete freedom of movement. Includes adjustable metal clip suspe...',
    'FC-CL-003',
    1049,
    1699,
    4.7,
    95,
    '12-24m',
    ARRAY['Soft-washed breathable denim', 'Adjustable strap buckles', 'Includes striped crewneck tee', 'Front kangaroo pocket']::text[],
    40,
    3,
    'active',
    true,
    false,
    false,
    true,
    '8907812000032',
    'ONLINE_AND_OFFLINE',
    3,
    'Pine Kids Cotton Denim Dungaree with Striped Inner Tee | Zérah Baby & Kids',
    'Charming casual dungaree set made with pre-washed soft denim that ensures complete freedom of movement. Includes adjustable metal clip suspenders and a pure cot',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=800&auto=format&fit=crop&q=80',
    '',
    'Pine Kids Cotton Denim Dungaree with Striped Inner Tee',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000003',
    v_prod_id,
    'Default',
    'FC-CL-003',
    40,
    1049,
    1699,
    '8907812000032',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-0000-4000-8000-000000000003',
    v_prod_id,
    '0-6M',
    '0-6M',
    'FC-CL-003-06M',
    13,
    1049,
    1699,
    '890781200001',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-1000-4000-8000-000000000003',
    v_prod_id,
    '6-12M',
    '6-12M',
    'FC-CL-003-612M',
    13,
    1049,
    1699,
    '890781200002',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-2000-4000-8000-000000000003',
    v_prod_id,
    '12-24M',
    '12-24M',
    'FC-CL-003-1224M',
    13,
    1049,
    1699,
    '890781200003',
    true
  );

  -- =========================================================================
  -- Product #4: Kookie Kids Layered Tulle Floral Party Frock (Blush Pink)
  -- SKU: FC-CL-004 | Barcode: 8907812000049 | Category: clothing
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000004',
    'fc-kookie-kids-floral-party-frock',
    'Kookie Kids Layered Tulle Floral Party Frock (Blush Pink)',
    'Kookie Kids',
    'clothing',
    (SELECT id FROM public.categories WHERE slug = 'clothing' LIMIT 1),
    'Whimsical party dress crafted with delicate multi-layered tulle, intricate embroidery, and a 100% cotton inner lining to prevent irritation. Comes with a matching floral headband.',
    'Whimsical party dress crafted with delicate multi-layered tulle, intricate embroidery, and a 100% cotton inner lining to prevent irritation....',
    'FC-CL-004',
    1399,
    2299,
    4.8,
    142,
    '2-4y',
    ARRAY['100% Cotton soft inner lining', 'Multi-tier breathable tulle', 'Concealed back zipper', 'Includes matching headband']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000049',
    'ONLINE_AND_OFFLINE',
    4,
    'Kookie Kids Layered Tulle Floral Party Frock (Blush Pink) | Zérah Baby & Kids',
    'Whimsical party dress crafted with delicate multi-layered tulle, intricate embroidery, and a 100% cotton inner lining to prevent irritation. Comes with a matchi',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=800&auto=format&fit=crop&q=80',
    '',
    'Kookie Kids Layered Tulle Floral Party Frock (Blush Pink)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000004',
    v_prod_id,
    'Default',
    'FC-CL-004',
    40,
    1399,
    2299,
    '8907812000049',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-0000-4000-8000-000000000004',
    v_prod_id,
    '0-6M',
    '0-6M',
    'FC-CL-004-06M',
    13,
    1399,
    2299,
    '890781200001',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-1000-4000-8000-000000000004',
    v_prod_id,
    '6-12M',
    '6-12M',
    'FC-CL-004-612M',
    13,
    1399,
    2299,
    '890781200002',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-2000-4000-8000-000000000004',
    v_prod_id,
    '12-24M',
    '12-24M',
    'FC-CL-004-1224M',
    13,
    1399,
    2299,
    '890781200003',
    true
  );

  -- =========================================================================
  -- Product #5: Babyhug Pure Mulmul Cotton Front Open Jhablas - Pack of 5
  -- SKU: FC-CL-005 | Barcode: 8907812000056 | Category: clothing
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000005',
    'fc-babyhug-pure-muslin-jhabla-5pk',
    'Babyhug Pure Mulmul Cotton Front Open Jhablas - Pack of 5',
    'Babyhug',
    'clothing',
    (SELECT id FROM public.categories WHERE slug = 'clothing' LIMIT 1),
    'Ultra-breathable feather-light mulmul cotton jhablas with front tie-up knot strings. Perfect for Indian summers and newborn daily home wear.',
    'Ultra-breathable feather-light mulmul cotton jhablas with front tie-up knot strings. Perfect for Indian summers and newborn daily home wear....',
    'FC-CL-005',
    599,
    999,
    4.9,
    320,
    '0-6m',
    ARRAY['100% Super-fine Mulmul cotton', 'Tie-up knot closure', 'Zero rough seams', 'Gets softer with every wash']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000056',
    'ONLINE_AND_OFFLINE',
    5,
    'Babyhug Pure Mulmul Cotton Front Open Jhablas - Pack of 5 | Zérah Baby & Kids',
    'Ultra-breathable feather-light mulmul cotton jhablas with front tie-up knot strings. Perfect for Indian summers and newborn daily home wear.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1544816155-12df9643f363?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug Pure Mulmul Cotton Front Open Jhablas - Pack of 5',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000005',
    v_prod_id,
    'Default',
    'FC-CL-005',
    40,
    599,
    999,
    '8907812000056',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-0000-4000-8000-000000000005',
    v_prod_id,
    '0-6M',
    '0-6M',
    'FC-CL-005-06M',
    13,
    599,
    999,
    '890781200001',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-1000-4000-8000-000000000005',
    v_prod_id,
    '6-12M',
    '6-12M',
    'FC-CL-005-612M',
    13,
    599,
    999,
    '890781200002',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e2000000-2000-4000-8000-000000000005',
    v_prod_id,
    '12-24M',
    '12-24M',
    'FC-CL-005-1224M',
    13,
    599,
    999,
    '890781200003',
    true
  );

  -- =========================================================================
  -- Product #6: Fisher-Price Deluxe Kick & Play Musical Piano Activity Gym
  -- SKU: FC-TY-021 | Barcode: 8907812000216 | Category: toys
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000006',
    'fc-fisher-price-kick-play-piano-gym',
    'Fisher-Price Deluxe Kick & Play Musical Piano Activity Gym',
    'Fisher-Price',
    'toys',
    (SELECT id FROM public.categories WHERE slug = 'toys' LIMIT 1),
    'The iconic multi-stage playmat with a light-up piano keyboard, repositionable toy arch, self-discovery mirror, crinkle panda, and 5 activity sensory toys. Smart Stages learning technology grows with baby.',
    'The iconic multi-stage playmat with a light-up piano keyboard, repositionable toy arch, self-discovery mirror, crinkle panda, and 5 activity...',
    'FC-TY-021',
    3299,
    4499,
    4.9,
    410,
    '0-6m',
    ARRAY['4 ways to play: Lay & Play, Tummy Time, Sit & Play, Take-along', 'Removable light-up piano with 65+ songs & sounds', 'High-contrast machine washable mat', 'Includes 5 sensory linking toys']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000216',
    'ONLINE_AND_OFFLINE',
    21,
    'Fisher-Price Deluxe Kick & Play Musical Piano Activity Gym | Zérah Baby & Kids',
    'The iconic multi-stage playmat with a light-up piano keyboard, repositionable toy arch, self-discovery mirror, crinkle panda, and 5 activity sensory toys. Smart',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&auto=format&fit=crop&q=80',
    '',
    'Fisher-Price Deluxe Kick & Play Musical Piano Activity Gym',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000006',
    v_prod_id,
    'Default',
    'FC-TY-021',
    40,
    3299,
    4499,
    '8907812000216',
    true
  );

  -- =========================================================================
  -- Product #7: Shumee Handcrafted Solid Beechwood Rainbow Stacking Rings
  -- SKU: FC-TY-022 | Barcode: 8907812000223 | Category: toys
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000007',
    'fc-shumee-wooden-rainbow-stacker',
    'Shumee Handcrafted Solid Beechwood Rainbow Stacking Rings',
    'Shumee',
    'toys',
    (SELECT id FROM public.categories WHERE slug = 'toys' LIMIT 1),
    'Natural organic beechwood rainbow stacker painted with lead-free non-toxic water-based paints. Safe for teething and developing motor coordination.',
    'Natural organic beechwood rainbow stacker painted with lead-free non-toxic water-based paints. Safe for teething and developing motor coordi...',
    'FC-TY-022',
    799,
    1199,
    4.8,
    180,
    '6-12m',
    ARRAY['Solid natural beech wood', '100% Non-toxic water-based organic colors', 'Smooth splinter-free rounded edges', 'Boosts hand-eye coordination']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000223',
    'ONLINE_AND_OFFLINE',
    22,
    'Shumee Handcrafted Solid Beechwood Rainbow Stacking Rings | Zérah Baby & Kids',
    'Natural organic beechwood rainbow stacker painted with lead-free non-toxic water-based paints. Safe for teething and developing motor coordination.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&auto=format&fit=crop&q=80',
    '',
    'Shumee Handcrafted Solid Beechwood Rainbow Stacking Rings',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000007',
    v_prod_id,
    'Default',
    'FC-TY-022',
    40,
    799,
    1199,
    '8907812000223',
    true
  );

  -- =========================================================================
  -- Product #8: Babyhug 2-in-1 Sit-to-Stand Push Learning Walker with Speed Control Wheels
  -- SKU: FC-TY-023 | Barcode: 8907812000230 | Category: toys
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000008',
    'fc-babyhug-musical-activity-walker',
    'Babyhug 2-in-1 Sit-to-Stand Push Learning Walker with Speed Control Wheels',
    'Babyhug',
    'toys',
    (SELECT id FROM public.categories WHERE slug = 'toys' LIMIT 1),
    'Helps babies transition from crawling to their confident first steps. Features adjustable anti-slip speed wheels, removable activity panel, and musical keys.',
    'Helps babies transition from crawling to their confident first steps. Features adjustable anti-slip speed wheels, removable activity panel, ...',
    'FC-TY-023',
    2199,
    3299,
    4.7,
    290,
    '6-12m',
    ARRAY['Triangular ergonomic anti-topple frame', 'Adjustable rear wheel tension/speed', 'Removable interactive music & phone panel', 'BPA-free heavy-duty construction']::text[],
    40,
    3,
    'active',
    true,
    true,
    false,
    true,
    '8907812000230',
    'ONLINE_AND_OFFLINE',
    23,
    'Babyhug 2-in-1 Sit-to-Stand Push Learning Walker with Speed Control Wheels | Zérah Baby & Kids',
    'Helps babies transition from crawling to their confident first steps. Features adjustable anti-slip speed wheels, removable activity panel, and musical keys.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug 2-in-1 Sit-to-Stand Push Learning Walker with Speed Control Wheels',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000008',
    v_prod_id,
    'Default',
    'FC-TY-023',
    40,
    2199,
    3299,
    '8907812000230',
    true
  );

  -- =========================================================================
  -- Product #9: Funskool Giggles Multi-Color Linking Chain Rings & Teether (24 Links)
  -- SKU: FC-TY-024 | Barcode: 8907812000247 | Category: toys
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000009',
    'fc-funskool-chain-links-teether-toy',
    'Funskool Giggles Multi-Color Linking Chain Rings & Teether (24 Links)',
    'Funskool',
    'toys',
    (SELECT id FROM public.categories WHERE slug = 'toys' LIMIT 1),
    'Brightly textured linking rings that attach easily to strollers, high chairs, and car seats. Multi-surface textures soothe tender gums during teething.',
    'Brightly textured linking rings that attach easily to strollers, high chairs, and car seats. Multi-surface textures soothe tender gums durin...',
    'FC-TY-024',
    299,
    449,
    4.6,
    350,
    '0-6m',
    ARRAY['24 Versatile interconnecting rings', 'Multiple textured teething surfaces', 'Attaches toys to strollers and carriers', 'Food grade non-toxic plastic']::text[],
    40,
    3,
    'active',
    true,
    false,
    false,
    true,
    '8907812000247',
    'ONLINE_AND_OFFLINE',
    24,
    'Funskool Giggles Multi-Color Linking Chain Rings & Teether (24 Links) | Zérah Baby & Kids',
    'Brightly textured linking rings that attach easily to strollers, high chairs, and car seats. Multi-surface textures soothe tender gums during teething.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1515488764276-beab7607c1e6?w=800&auto=format&fit=crop&q=80',
    '',
    'Funskool Giggles Multi-Color Linking Chain Rings & Teether (24 Links)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000009',
    v_prod_id,
    'Default',
    'FC-TY-024',
    40,
    299,
    449,
    '8907812000247',
    true
  );

  -- =========================================================================
  -- Product #10: Sebamed Baby Gentle Wash with Allantoin & Chamomile (400ml with Pump)
  -- SKU: FC-CR-036 | Barcode: 8907812000360 | Category: care
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000010',
    'fc-sebamed-baby-gentle-wash-400ml',
    'Sebamed Baby Gentle Wash with Allantoin & Chamomile (400ml with Pump)',
    'Sebamed',
    'care',
    (SELECT id FROM public.categories WHERE slug = 'care' LIMIT 1),
    '100% soap-free and alkali-free wash clinically formulated with exact pH 5.5 to support the development of baby''s natural protective acid mantle.',
    '100% soap-free and alkali-free wash clinically formulated with exact pH 5.5 to support the development of baby''s natural protective acid man...',
    'FC-CR-036',
    849,
    1050,
    4.9,
    620,
    '0-6m',
    ARRAY['pH 5.5 balanced for newborn acid mantle', '100% Soap and alkali free', 'Enriched with Chamomile and Allantoin', 'Tear-free hypoallergenic formula']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000360',
    'ONLINE_AND_OFFLINE',
    36,
    'Sebamed Baby Gentle Wash with Allantoin & Chamomile (400ml with Pump) | Zérah Baby & Kids',
    '100% soap-free and alkali-free wash clinically formulated with exact pH 5.5 to support the development of baby''s natural protective acid mantle.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80',
    '',
    'Sebamed Baby Gentle Wash with Allantoin & Chamomile (400ml with Pump)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000010',
    v_prod_id,
    'Default',
    'FC-CR-036',
    40,
    849,
    1050,
    '8907812000360',
    true
  );

  -- =========================================================================
  -- Product #11: Aveeno Baby Daily Moisture Nourishing Body Lotion with Colloidal Oatmeal (227g)
  -- SKU: FC-CR-037 | Barcode: 8907812000377 | Category: care
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000011',
    'fc-aveeno-baby-daily-moisture-lotion-227g',
    'Aveeno Baby Daily Moisture Nourishing Body Lotion with Colloidal Oatmeal (227g)',
    'Aveeno Baby',
    'care',
    (SELECT id FROM public.categories WHERE slug = 'care' LIMIT 1),
    'Fast-absorbing, non-greasy lotion with natural colloidal oatmeal and rich emollients that moisturizes baby''s delicate skin for a full 24 hours.',
    'Fast-absorbing, non-greasy lotion with natural colloidal oatmeal and rich emollients that moisturizes baby''s delicate skin for a full 24 hou...',
    'FC-CR-037',
    799,
    999,
    4.9,
    540,
    '0-6m',
    ARRAY['Natural colloidal oatmeal formula', '24-Hour continuous hydration', 'Fragrance-free, paraben-free, dye-free', 'Pediatrician recommended globally']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000377',
    'ONLINE_AND_OFFLINE',
    37,
    'Aveeno Baby Daily Moisture Nourishing Body Lotion with Colloidal Oatmeal (227g) | Zérah Baby & Kids',
    'Fast-absorbing, non-greasy lotion with natural colloidal oatmeal and rich emollients that moisturizes baby''s delicate skin for a full 24 hours.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1556228722-d0b5d034abf2?w=800&auto=format&fit=crop&q=80',
    '',
    'Aveeno Baby Daily Moisture Nourishing Body Lotion with Colloidal Oatmeal (227g)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000011',
    v_prod_id,
    'Default',
    'FC-CR-037',
    40,
    799,
    999,
    '8907812000377',
    true
  );

  -- =========================================================================
  -- Product #12: Chicco Natural Sensation Deep Nourishing Baby Body Lotion (500ml)
  -- SKU: FC-CR-038 | Barcode: 8907812000384 | Category: care
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000012',
    'fc-chicco-natural-sensation-body-lotion',
    'Chicco Natural Sensation Deep Nourishing Baby Body Lotion (500ml)',
    'Chicco',
    'care',
    (SELECT id FROM public.categories WHERE slug = 'care' LIMIT 1),
    'Inspired by the Vernix Caseosa that naturally protects baby in the womb. Formulated with shea butter, vitamin E, and rice oil for silky soft skin.',
    'Inspired by the Vernix Caseosa that naturally protects baby in the womb. Formulated with shea butter, vitamin E, and rice oil for silky soft...',
    'FC-CR-038',
    699,
    949,
    4.8,
    320,
    '0-6m',
    ARRAY['Vernix Caseosa inspired natural barrier', 'Enriched with Shea butter & Vitamin E', 'Quick absorbing non-sticky texture', 'Dermatologist tested on sensitive skin']::text[],
    40,
    3,
    'active',
    true,
    false,
    true,
    true,
    '8907812000384',
    'ONLINE_AND_OFFLINE',
    38,
    'Chicco Natural Sensation Deep Nourishing Baby Body Lotion (500ml) | Zérah Baby & Kids',
    'Inspired by the Vernix Caseosa that naturally protects baby in the womb. Formulated with shea butter, vitamin E, and rice oil for silky soft skin.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1608248597359-597520e53a3e?w=800&auto=format&fit=crop&q=80',
    '',
    'Chicco Natural Sensation Deep Nourishing Baby Body Lotion (500ml)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000012',
    v_prod_id,
    'Default',
    'FC-CR-038',
    40,
    699,
    949,
    '8907812000384',
    true
  );

  -- =========================================================================
  -- Product #13: R for Rabbit Pocket Stroller Lite Compact Auto-Fold Cabin Approved Pram
  -- SKU: FC-GR-075 | Barcode: 8907812000759 | Category: gear
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000013',
    'fc-r-for-rabbit-pocket-air-stroller',
    'R for Rabbit Pocket Stroller Lite Compact Auto-Fold Cabin Approved Pram',
    'R for Rabbit',
    'gear',
    (SELECT id FROM public.categories WHERE slug = 'gear' LIMIT 1),
    'Ultra-lightweight 5.8kg aircraft cabin-friendly stroller featuring one-hand gravity auto-fold, multi-position recline, and smooth shock-absorbing suspension.',
    'Ultra-lightweight 5.8kg aircraft cabin-friendly stroller featuring one-hand gravity auto-fold, multi-position recline, and smooth shock-abso...',
    'FC-GR-075',
    6999,
    9999,
    4.9,
    380,
    '0-6m',
    ARRAY['1-Second one-hand gravity fold', 'Cabin luggage approved size (5.8 kg)', 'Multi-position 95° to 175° recline', 'All-wheel suspension & 5-point harness']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000759',
    'ONLINE_AND_OFFLINE',
    75,
    'R for Rabbit Pocket Stroller Lite Compact Auto-Fold Cabin Approved Pram | Zérah Baby & Kids',
    'Ultra-lightweight 5.8kg aircraft cabin-friendly stroller featuring one-hand gravity auto-fold, multi-position recline, and smooth shock-absorbing suspension.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1555252333-9f8e92e65df0?w=800&auto=format&fit=crop&q=80',
    '',
    'R for Rabbit Pocket Stroller Lite Compact Auto-Fold Cabin Approved Pram',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000013',
    v_prod_id,
    'Default',
    'FC-GR-075',
    40,
    6999,
    9999,
    '8907812000759',
    true
  );

  -- =========================================================================
  -- Product #14: Chicco Goody Plus Premium Innovative One-Touch Folding Stroller
  -- SKU: FC-GR-076 | Barcode: 8907812000766 | Category: gear
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000014',
    'fc-chicco-goody-plus-auto-fold-stroller',
    'Chicco Goody Plus Premium Innovative One-Touch Folding Stroller',
    'Chicco',
    'gear',
    (SELECT id FROM public.categories WHERE slug = 'gear' LIMIT 1),
    'Italian designed luxury stroller with magical one-touch auto folding mechanism. Premium anodized metallic chassis and eco-leather handlebar accents.',
    'Italian designed luxury stroller with magical one-touch auto folding mechanism. Premium anodized metallic chassis and eco-leather handlebar ...',
    'FC-GR-076',
    14999,
    19990,
    4.9,
    195,
    '0-6m',
    ARRAY['One-touch automatic folding mechanism', 'Anodized luxury aluminum chassis', 'Homologated from birth up to 22kg', 'Extendable UV50+ canopy with peek-a-boo window']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000766',
    'ONLINE_AND_OFFLINE',
    76,
    'Chicco Goody Plus Premium Innovative One-Touch Folding Stroller | Zérah Baby & Kids',
    'Italian designed luxury stroller with magical one-touch auto folding mechanism. Premium anodized metallic chassis and eco-leather handlebar accents.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1519238263531-99bdd11df2eb?w=800&auto=format&fit=crop&q=80',
    '',
    'Chicco Goody Plus Premium Innovative One-Touch Folding Stroller',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000014',
    v_prod_id,
    'Default',
    'FC-GR-076',
    40,
    14999,
    19990,
    '8907812000766',
    true
  );

  -- =========================================================================
  -- Product #15: LuvLap Galaxy 360 Degree Rotatable ISOFIX Convertible Baby Car Seat (0-36kg)
  -- SKU: FC-GR-077 | Barcode: 8907812000773 | Category: gear
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000015',
    'fc-luvlap-galaxy-convertible-car-seat',
    'LuvLap Galaxy 360 Degree Rotatable ISOFIX Convertible Baby Car Seat (0-36kg)',
    'LuvLap',
    'gear',
    (SELECT id FROM public.categories WHERE slug = 'gear' LIMIT 1),
    'ECE R44/04 certified safety car seat with 360-degree smooth spin for easy child boarding. Rear-facing for infants, forward-facing for toddlers up to 12 years.',
    'ECE R44/04 certified safety car seat with 360-degree smooth spin for easy child boarding. Rear-facing for infants, forward-facing for toddle...',
    'FC-GR-077',
    8999,
    13999,
    4.8,
    240,
    '0-6m',
    ARRAY['360° One-click rotating seat mechanism', 'Secure ISOFIX installation with top tether', 'Side Impact Protection (SIP) energy wings', 'Multi-height adjustable headrest & recline']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000773',
    'ONLINE_AND_OFFLINE',
    77,
    'LuvLap Galaxy 360 Degree Rotatable ISOFIX Convertible Baby Car Seat (0-36kg) | Zérah Baby & Kids',
    'ECE R44/04 certified safety car seat with 360-degree smooth spin for easy child boarding. Rear-facing for infants, forward-facing for toddlers up to 12 years.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1584308666745-24d5c474f2af?w=800&auto=format&fit=crop&q=80',
    '',
    'LuvLap Galaxy 360 Degree Rotatable ISOFIX Convertible Baby Car Seat (0-36kg)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000015',
    v_prod_id,
    'Default',
    'FC-GR-077',
    40,
    8999,
    13999,
    '8907812000773',
    true
  );

  -- =========================================================================
  -- Product #16: Philips Avent Natural Response Anti-Colic Feeding Bottles (260ml Pack of 2)
  -- SKU: FC-FD-051 | Barcode: 8907812000513 | Category: feeding
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000016',
    'fc-philips-avent-natural-bottle-set',
    'Philips Avent Natural Response Anti-Colic Feeding Bottles (260ml Pack of 2)',
    'Philips Avent',
    'feeding',
    (SELECT id FROM public.categories WHERE slug = 'feeding' LIMIT 1),
    'Natural Response teat releases milk only when baby actively drinks, just like breastfeeding. Anti-colic valve designed to keep air away from baby''s tummy.',
    'Natural Response teat releases milk only when baby actively drinks, just like breastfeeding. Anti-colic valve designed to keep air away from...',
    'FC-FD-051',
    1399,
    1799,
    4.9,
    730,
    '0-6m',
    ARRAY['Natural breast-shaped teat mimics mother''s breast', 'No-drip teat design prevents spills', 'Unique anti-colic airflex valve', '100% BPA-free polypropylene']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000513',
    'ONLINE_AND_OFFLINE',
    51,
    'Philips Avent Natural Response Anti-Colic Feeding Bottles (260ml Pack of 2) | Zérah Baby & Kids',
    'Natural Response teat releases milk only when baby actively drinks, just like breastfeeding. Anti-colic valve designed to keep air away from baby''s tummy.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1607006314175-9c94178a9c39?w=800&auto=format&fit=crop&q=80',
    '',
    'Philips Avent Natural Response Anti-Colic Feeding Bottles (260ml Pack of 2)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000016',
    v_prod_id,
    'Default',
    'FC-FD-051',
    40,
    1399,
    1799,
    '8907812000513',
    true
  );

  -- =========================================================================
  -- Product #17: Dr. Brown's Options+ Wide-Neck Anti-Colic Glass Feeding Bottle (270ml)
  -- SKU: FC-FD-052 | Barcode: 8907812000520 | Category: feeding
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000017',
    'fc-dr-browns-options-anti-colic-bottle',
    'Dr. Brown''s Options+ Wide-Neck Anti-Colic Glass Feeding Bottle (270ml)',
    'Dr. Brown''s',
    'feeding',
    (SELECT id FROM public.categories WHERE slug = 'feeding' LIMIT 1),
    'Clinical gold standard internal vent system eliminates negative pressure and air bubbles to reduce colic, burping, and gas while preserving milk nutrients.',
    'Clinical gold standard internal vent system eliminates negative pressure and air bubbles to reduce colic, burping, and gas while preserving ...',
    'FC-FD-052',
    1099,
    1499,
    4.9,
    390,
    '0-6m',
    ARRAY['Internal vent clinically proven to reduce colic', 'Preserves essential vitamins C, A, and E', 'Medical-grade thermal shock resistant glass', 'Can be used with or without the vent system']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000520',
    'ONLINE_AND_OFFLINE',
    52,
    'Dr. Brown''s Options+ Wide-Neck Anti-Colic Glass Feeding Bottle (270ml) | Zérah Baby & Kids',
    'Clinical gold standard internal vent system eliminates negative pressure and air bubbles to reduce colic, burping, and gas while preserving milk nutrients.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1507652313519-d4e9174996dd?w=800&auto=format&fit=crop&q=80',
    '',
    'Dr. Brown''s Options+ Wide-Neck Anti-Colic Glass Feeding Bottle (270ml)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000017',
    v_prod_id,
    'Default',
    'FC-FD-052',
    40,
    1099,
    1499,
    '8907812000520',
    true
  );

  -- =========================================================================
  -- Product #18: Chicco 3-in-1 Modular Electric Steam Sterilizer & Dryer
  -- SKU: FC-FD-053 | Barcode: 8907812000537 | Category: feeding
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000018',
    'fc-chicco-3in1-steam-sterilizer',
    'Chicco 3-in-1 Modular Electric Steam Sterilizer & Dryer',
    'Chicco',
    'feeding',
    (SELECT id FROM public.categories WHERE slug = 'feeding' LIMIT 1),
    'Uses natural steam to eliminate 99.9% of harmful household germs in 5 minutes. Modular configuration fits up to 6 large bottles or breast pump accessories.',
    'Uses natural steam to eliminate 99.9% of harmful household germs in 5 minutes. Modular configuration fits up to 6 large bottles or breast pu...',
    'FC-FD-053',
    3499,
    4990,
    4.8,
    210,
    '0-6m',
    ARRAY['Eliminates 99.9% of germs with pure steam', 'Keeps items sanitized for 24 hours under lid', 'Automatic power shut-off safety switch', 'Modular full-size, compact, and microwave modes']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000537',
    'ONLINE_AND_OFFLINE',
    53,
    'Chicco 3-in-1 Modular Electric Steam Sterilizer & Dryer | Zérah Baby & Kids',
    'Uses natural steam to eliminate 99.9% of harmful household germs in 5 minutes. Modular configuration fits up to 6 large bottles or breast pump accessories.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1584308666744-884841e2f89c?w=800&auto=format&fit=crop&q=80',
    '',
    'Chicco 3-in-1 Modular Electric Steam Sterilizer & Dryer',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000018',
    v_prod_id,
    'Default',
    'FC-FD-053',
    40,
    3499,
    4990,
    '8907812000537',
    true
  );

  -- =========================================================================
  -- Product #19: Pampers Premium Care Diaper Pants (Size M, 7-12kg, 74 Count)
  -- SKU: FC-DP-063 | Barcode: 8907812000636 | Category: diapering
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000019',
    'fc-pampers-premium-care-pants-m-74',
    'Pampers Premium Care Diaper Pants (Size M, 7-12kg, 74 Count)',
    'Pampers',
    'diapering',
    (SELECT id FROM public.categories WHERE slug = 'diapering' LIMIT 1),
    'Cotton-like feather-soft diaper pants with 10 million breathable micro-pores, wetness indicator strip, and 3 magic absorbing channels for 12 hours dryness.',
    'Cotton-like feather-soft diaper pants with 10 million breathable micro-pores, wetness indicator strip, and 3 magic absorbing channels for 12...',
    'FC-DP-063',
    1149,
    1499,
    4.9,
    1450,
    '6-12m',
    ARRAY['12-Hour leak lock protection', 'Built-in wetness color indicator', '360° Ultra-stretchy cloud-soft waistband', 'Infused with baby lotion to prevent redness']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000636',
    'ONLINE_AND_OFFLINE',
    63,
    'Pampers Premium Care Diaper Pants (Size M, 7-12kg, 74 Count) | Zérah Baby & Kids',
    'Cotton-like feather-soft diaper pants with 10 million breathable micro-pores, wetness indicator strip, and 3 magic absorbing channels for 12 hours dryness.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1585771724685-38269d6639fe?w=800&auto=format&fit=crop&q=80',
    '',
    'Pampers Premium Care Diaper Pants (Size M, 7-12kg, 74 Count)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000019',
    v_prod_id,
    'Default',
    'FC-DP-063',
    40,
    1149,
    1499,
    '8907812000636',
    true
  );

  -- =========================================================================
  -- Product #20: Huggies Nature Care Organic Cotton Diaper Pants (Size L, 9-14kg, 56 Count)
  -- SKU: FC-DP-064 | Barcode: 8907812000643 | Category: diapering
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000020',
    'fc-huggies-nature-care-pants-l-56',
    'Huggies Nature Care Organic Cotton Diaper Pants (Size L, 9-14kg, 56 Count)',
    'Huggies',
    'diapering',
    (SELECT id FROM public.categories WHERE slug = 'diapering' LIMIT 1),
    '100% organic cotton top layer with zero added parabens or elemental chlorine. Bubble-bed cushion absorbs runny messes instantly.',
    '100% organic cotton top layer with zero added parabens or elemental chlorine. Bubble-bed cushion absorbs runny messes instantly....',
    'FC-DP-064',
    999,
    1399,
    4.8,
    620,
    '12-24m',
    ARRAY['100% Organic cotton top-sheet', 'Bubble-bed cushion technology', 'No elemental chlorine or parabens', 'Triple leak-guard leg cuffs']::text[],
    40,
    3,
    'active',
    true,
    false,
    true,
    true,
    '8907812000643',
    'ONLINE_AND_OFFLINE',
    64,
    'Huggies Nature Care Organic Cotton Diaper Pants (Size L, 9-14kg, 56 Count) | Zérah Baby & Kids',
    '100% organic cotton top layer with zero added parabens or elemental chlorine. Bubble-bed cushion absorbs runny messes instantly.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1584017911767-d451b3d0e844?w=800&auto=format&fit=crop&q=80',
    '',
    'Huggies Nature Care Organic Cotton Diaper Pants (Size L, 9-14kg, 56 Count)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000020',
    v_prod_id,
    'Default',
    'FC-DP-064',
    40,
    999,
    1399,
    '8907812000643',
    true
  );

  -- =========================================================================
  -- Product #21: Babyhug Advanced Feather-Soft Diaper Pants (Size S, 4-8kg, 80 Count)
  -- SKU: FC-DP-065 | Barcode: 8907812000650 | Category: diapering
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000021',
    'fc-babyhug-advanced-pant-diapers-s-80',
    'Babyhug Advanced Feather-Soft Diaper Pants (Size S, 4-8kg, 80 Count)',
    'Babyhug',
    'diapering',
    (SELECT id FROM public.categories WHERE slug = 'diapering' LIMIT 1),
    'Silky soft breathable pants with Japanese super absorbent polymer core and disposal tape for hygienic clean discarding.',
    'Silky soft breathable pants with Japanese super absorbent polymer core and disposal tape for hygienic clean discarding....',
    'FC-DP-065',
    849,
    1299,
    4.7,
    430,
    '0-6m',
    ARRAY['Japanese SAP high-speed core', 'Attached adhesive disposal tape', 'Wetness indicator turning blue', 'Gentle 3D leg cuff anti-leak barrier']::text[],
    40,
    3,
    'active',
    true,
    false,
    false,
    true,
    '8907812000650',
    'ONLINE_AND_OFFLINE',
    65,
    'Babyhug Advanced Feather-Soft Diaper Pants (Size S, 4-8kg, 80 Count) | Zérah Baby & Kids',
    'Silky soft breathable pants with Japanese super absorbent polymer core and disposal tape for hygienic clean discarding.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1583947215260-38e31be87520?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug Advanced Feather-Soft Diaper Pants (Size S, 4-8kg, 80 Count)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000021',
    v_prod_id,
    'Default',
    'FC-DP-065',
    40,
    849,
    1299,
    '8907812000650',
    true
  );

  -- =========================================================================
  -- Product #22: Babyhug Splash Space-Saving Collapsible Baby Bathtub with Heat Sensor Plug
  -- SKU: FC-BT-085 | Barcode: 8907812000858 | Category: bath
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000022',
    'fc-babyhug-foldable-silicone-bathtub',
    'Babyhug Splash Space-Saving Collapsible Baby Bathtub with Heat Sensor Plug',
    'Babyhug',
    'bath',
    (SELECT id FROM public.categories WHERE slug = 'bath' LIMIT 1),
    'Folds down to 9cm flat for easy storage behind doors. Heat-sensitive silicone drain plug changes color from blue to white if water exceeds 37°C.',
    'Folds down to 9cm flat for easy storage behind doors. Heat-sensitive silicone drain plug changes color from blue to white if water exceeds 3...',
    'FC-BT-085',
    1999,
    2999,
    4.9,
    320,
    '0-6m',
    ARRAY['Ultra-slim 9cm folding footprint', 'Smart temperature sensing color-change drain plug', 'Non-slip rubber feet on sturdy folding legs', 'Made from soft skin-friendly TPE silicone']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000858',
    'ONLINE_AND_OFFLINE',
    85,
    'Babyhug Splash Space-Saving Collapsible Baby Bathtub with Heat Sensor Plug | Zérah Baby & Kids',
    'Folds down to 9cm flat for easy storage behind doors. Heat-sensitive silicone drain plug changes color from blue to white if water exceeds 37°C.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1516627145498-ae6968895b75?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug Splash Space-Saving Collapsible Baby Bathtub with Heat Sensor Plug',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000022',
    v_prod_id,
    'Default',
    'FC-BT-085',
    40,
    1999,
    2999,
    '8907812000858',
    true
  );

  -- =========================================================================
  -- Product #23: Chicco Bubble Nest Ergonomic Non-Slip Newborn Bath Bather Cushion
  -- SKU: FC-BT-086 | Barcode: 8907812000865 | Category: bath
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000023',
    'fc-chicco-soft-cushioned-bath-sling',
    'Chicco Bubble Nest Ergonomic Non-Slip Newborn Bath Bather Cushion',
    'Chicco',
    'bath',
    (SELECT id FROM public.categories WHERE slug = 'bath' LIMIT 1),
    'Cradles newborn head and spine securely above water line during bath time. Quick-drying breathable mesh prevents soap accumulation.',
    'Cradles newborn head and spine securely above water line during bath time. Quick-drying breathable mesh prevents soap accumulation....',
    'FC-BT-086',
    899,
    1499,
    4.8,
    210,
    '0-6m',
    ARRAY['Cradles head and neck comfortably', '3-Point secure buckle strap attachments', 'Fast-drying breathable sandwich mesh', 'Folds compact for drying on hook']::text[],
    40,
    3,
    'active',
    true,
    false,
    true,
    true,
    '8907812000865',
    'ONLINE_AND_OFFLINE',
    86,
    'Chicco Bubble Nest Ergonomic Non-Slip Newborn Bath Bather Cushion | Zérah Baby & Kids',
    'Cradles newborn head and spine securely above water line during bath time. Quick-drying breathable mesh prevents soap accumulation.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1518831959647-742c3a14ebf8?w=800&auto=format&fit=crop&q=80',
    '',
    'Chicco Bubble Nest Ergonomic Non-Slip Newborn Bath Bather Cushion',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000023',
    v_prod_id,
    'Default',
    'FC-BT-086',
    40,
    899,
    1499,
    '8907812000865',
    true
  );

  -- =========================================================================
  -- Product #24: Babyhug Anti-Slip Soft Sole Newborn Pre-Walker Crib Shoes (Camel Brown)
  -- SKU: FC-FW-093 | Barcode: 8907812000933 | Category: footwear
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000024',
    'fc-babyhug-prewalker-soft-sole-booties',
    'Babyhug Anti-Slip Soft Sole Newborn Pre-Walker Crib Shoes (Camel Brown)',
    'Babyhug',
    'footwear',
    (SELECT id FROM public.categories WHERE slug = 'footwear' LIMIT 1),
    'Ultra-flexible soft faux-suede crib shoes designed to protect delicate baby feet while allowing natural foot spread and balance development.',
    'Ultra-flexible soft faux-suede crib shoes designed to protect delicate baby feet while allowing natural foot spread and balance development....',
    'FC-FW-093',
    499,
    799,
    4.8,
    210,
    '0-6m',
    ARRAY['Flexible non-restrictive soft sole', 'Anti-slip silicone grip dots on bottom', 'Elastic ankle collar stays securely on feet', 'Breathable cotton fleece lining']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000933',
    'ONLINE_AND_OFFLINE',
    93,
    'Babyhug Anti-Slip Soft Sole Newborn Pre-Walker Crib Shoes (Camel Brown) | Zérah Baby & Kids',
    'Ultra-flexible soft faux-suede crib shoes designed to protect delicate baby feet while allowing natural foot spread and balance development.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80',
    '',
    'Babyhug Anti-Slip Soft Sole Newborn Pre-Walker Crib Shoes (Camel Brown)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000024',
    v_prod_id,
    'Default',
    'FC-FW-093',
    40,
    499,
    799,
    '8907812000933',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-0000-4000-8000-000000000024',
    v_prod_id,
    'EU 18 (0-6M)',
    'EU 18 (0-6M)',
    'FC-FW-093-SZ1',
    13,
    499,
    799,
    '890781200092',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-1000-4000-8000-000000000024',
    v_prod_id,
    'EU 20 (6-12M)',
    'EU 20 (6-12M)',
    'FC-FW-093-SZ2',
    13,
    499,
    799,
    '890781200093',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-2000-4000-8000-000000000024',
    v_prod_id,
    'EU 22 (12-18M)',
    'EU 22 (12-18M)',
    'FC-FW-093-SZ3',
    13,
    499,
    799,
    '890781200094',
    true
  );

  -- =========================================================================
  -- Product #25: Crocs Kids Classic Lightweight Water-Friendly Clogs (Ocean Blue)
  -- SKU: FC-FW-094 | Barcode: 8907812000940 | Category: footwear
  -- =========================================================================
  INSERT INTO public.products (
    id, slug, name, brand, category, category_id, description, short_description,
    sku, price, mrp, rating, reviews, age_group, highlights, stock, low_stock_at,
    status, is_active, is_featured, bestseller, new_arrival, barcode, sales_channel,
    sort_order, seo_title, seo_description, recommendation_mode
  ) VALUES (
    'e0000000-0000-4000-8000-000000000025',
    'fc-crocs-kids-classic-clogs',
    'Crocs Kids Classic Lightweight Water-Friendly Clogs (Ocean Blue)',
    'Crocs Kids',
    'footwear',
    (SELECT id FROM public.categories WHERE slug = 'footwear' LIMIT 1),
    'Iconic Croslite foam cushioning with pivoting heel strap for secure fit. Ventilation ports shed water and debris and accommodate Jibbitz charms.',
    'Iconic Croslite foam cushioning with pivoting heel strap for secure fit. Ventilation ports shed water and debris and accommodate Jibbitz cha...',
    'FC-FW-094',
    1699,
    2495,
    4.9,
    430,
    '2-4y',
    ARRAY['Incredibly lightweight and buoyant Croslite foam', 'Water-friendly and quick to dry', 'Pivoting heel straps for a secure locked fit', 'Easy to wash with soap and water']::text[],
    40,
    3,
    'active',
    true,
    true,
    true,
    true,
    '8907812000940',
    'ONLINE_AND_OFFLINE',
    94,
    'Crocs Kids Classic Lightweight Water-Friendly Clogs (Ocean Blue) | Zérah Baby & Kids',
    'Iconic Croslite foam cushioning with pivoting heel strap for secure fit. Ventilation ports shed water and debris and accommodate Jibbitz charms.',
    'manual_fallback'
  )
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    category_id = EXCLUDED.category_id,
    description = EXCLUDED.description,
    short_description = EXCLUDED.short_description,
    sku = EXCLUDED.sku,
    price = EXCLUDED.price,
    mrp = EXCLUDED.mrp,
    rating = EXCLUDED.rating,
    reviews = EXCLUDED.reviews,
    age_group = EXCLUDED.age_group,
    highlights = EXCLUDED.highlights,
    stock = GREATEST(products.stock, EXCLUDED.stock),
    is_active = true,
    status = 'active',
    barcode = EXCLUDED.barcode,
    sales_channel = 'ONLINE_AND_OFFLINE',
    updated_at = now()
  RETURNING id INTO v_prod_id;

  -- Primary Image
  DELETE FROM public.product_images WHERE product_id = v_prod_id;
  INSERT INTO public.product_images (
    product_id, public_url, storage_path, alt_text, sort_order, is_primary
  ) VALUES (
    v_prod_id,
    'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&auto=format&fit=crop&q=80',
    '',
    'Crocs Kids Classic Lightweight Water-Friendly Clogs (Ocean Blue)',
    0,
    true
  );

  -- Product Variants
  DELETE FROM public.product_variants WHERE product_id = v_prod_id;
  INSERT INTO public.product_variants (
    id, product_id, name, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e1000000-0000-4000-8000-000000000025',
    v_prod_id,
    'Default',
    'FC-FW-094',
    40,
    1699,
    2495,
    '8907812000940',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-0000-4000-8000-000000000025',
    v_prod_id,
    'EU 18 (0-6M)',
    'EU 18 (0-6M)',
    'FC-FW-094-SZ1',
    13,
    1699,
    2495,
    '890781200092',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-1000-4000-8000-000000000025',
    v_prod_id,
    'EU 20 (6-12M)',
    'EU 20 (6-12M)',
    'FC-FW-094-SZ2',
    13,
    1699,
    2495,
    '890781200093',
    true
  );
  INSERT INTO public.product_variants (
    id, product_id, name, size, sku, stock, price_override, mrp_override, barcode, is_active
  ) VALUES (
    'e3000000-2000-4000-8000-000000000025',
    v_prod_id,
    'EU 22 (12-18M)',
    'EU 22 (12-18M)',
    'FC-FW-094-SZ3',
    13,
    1699,
    2495,
    '890781200094',
    true
  );

END $$;

-- 5. Ensure all parent products have stock synced to sum of active variants
UPDATE public.products p
SET stock = COALESCE(
  (
    SELECT SUM(v.stock)
    FROM public.product_variants v
    WHERE v.product_id = p.id
      AND (v.is_active IS NULL OR v.is_active = true)
  ),
  p.stock
),
is_active = true,
status = 'active'
WHERE EXISTS (
  SELECT 1 FROM public.product_variants v
  WHERE v.product_id = p.id
);

NOTIFY pgrst, 'reload schema';
