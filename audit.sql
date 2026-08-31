-- 1. Remote Migrations
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version ASC;

-- 2. Data Integrity Counts
-- Orphan order items
SELECT count(*) AS orphan_order_items FROM public.order_items WHERE order_id NOT IN (SELECT id FROM public.orders);
-- Orphan offline sale items
SELECT count(*) AS orphan_offline_items FROM public.offline_sale_items WHERE sale_id NOT IN (SELECT id FROM public.offline_sales);
-- Negative Stock
SELECT count(*) AS negative_stock FROM public.product_variants WHERE stock < 0;

-- 3. Functions
SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('place_order', 'place_offline_sale', 'sync_offline_sales', 'lookup_barcode');

-- 4. Triggers
SELECT tgname, relname AS table_name, tgtype, tgrelid::regclass
FROM pg_trigger
JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
WHERE pg_namespace.nspname = 'public' AND tgname NOT LIKE 'RI_ConstraintTrigger%';

-- 5. Policies
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';

-- 6. Tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- 7. Variant constraints (checking for offline_only)
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_variants' AND table_schema = 'public';

