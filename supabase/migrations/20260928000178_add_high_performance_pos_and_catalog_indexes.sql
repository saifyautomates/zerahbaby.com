-- Migration: Add High Performance POS and Catalog Indexes
-- Accelerates POS barcode lookups, product searches, variant joins, and storefront page loads

-- 1. Accelerate Catalog filtering and ordering (Storefront & Shop page)
-- Query: WHERE is_active = true AND sales_channel = 'ONLINE_AND_OFFLINE' ORDER BY sort_order ASC
CREATE INDEX IF NOT EXISTS idx_products_active_channel_sort 
  ON public.products (is_active, sales_channel, sort_order);

-- 2. Fast case-insensitive slug lookup (Product Detail Pages)
CREATE INDEX IF NOT EXISTS idx_products_slug_lower 
  ON public.products (lower(slug));

-- 3. Clean trimmed barcode index for lightning fast barcode matching
CREATE INDEX IF NOT EXISTS idx_products_barcode_trimmed 
  ON public.products (trim(barcode)) 
  WHERE barcode IS NOT NULL AND trim(barcode) <> '';

-- 4. Product Variants: foreign key join index & fast variant lookup
CREATE INDEX IF NOT EXISTS idx_product_variants_prod_id 
  ON public.product_variants (product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_barcode_trimmed 
  ON public.product_variants (trim(barcode)) 
  WHERE barcode IS NOT NULL AND trim(barcode) <> '';

CREATE INDEX IF NOT EXISTS idx_product_variants_sku_lower_trimmed 
  ON public.product_variants (lower(trim(sku))) 
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_stock_status 
  ON public.product_variants (product_id, stock);

-- 5. Product Images: fast join and ordering for primary hero images
CREATE INDEX IF NOT EXISTS idx_product_images_prod_sort 
  ON public.product_images (product_id, is_primary DESC, sort_order ASC);

-- 6. Categories: fast ordering and case-insensitive slug lookup
CREATE INDEX IF NOT EXISTS idx_categories_sort_order 
  ON public.categories (sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_categories_slug_lower 
  ON public.categories (lower(slug));

-- 7. POS Offline Sales & Customer Orders: fast lookup and sorting
CREATE INDEX IF NOT EXISTS idx_offline_sales_created_desc 
  ON public.offline_sales (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_created_desc 
  ON public.orders (user_id, created_at DESC);
