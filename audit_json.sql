SELECT json_build_object(
  'migrations', (SELECT json_agg(version ORDER BY version ASC) FROM supabase_migrations.schema_migrations),
  
  'integrity', json_build_object(
    'orphan_order_items', (SELECT count(*) FROM public.order_items WHERE order_id NOT IN (SELECT id FROM public.orders)),
    'orphan_offline_items', (SELECT count(*) FROM public.offline_sale_items WHERE sale_id NOT IN (SELECT id FROM public.offline_sales)),
    'negative_stock', (SELECT count(*) FROM public.product_variants WHERE stock < 0),
    'duplicate_idempotency', (SELECT count(*) FROM (SELECT idempotency_key FROM public.offline_sales WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING count(*) > 1) d),
    'duplicate_barcodes', (SELECT count(*) FROM (SELECT barcode FROM public.product_variants WHERE barcode IS NOT NULL GROUP BY barcode HAVING count(*) > 1) d)
  ),

  'functions', (
    SELECT json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid)))
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname IN ('place_order', 'place_offline_sale', 'sync_offline_sales', 'lookup_barcode', 'admin_delete_order')
  ),

  'triggers', (
    SELECT json_agg(json_build_object('trigger', tgname, 'table', relname))
    FROM pg_trigger
    JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
    JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
    WHERE pg_namespace.nspname = 'public' AND tgname NOT LIKE 'RI_ConstraintTrigger%'
  ),

  'policies', (
    SELECT json_agg(json_build_object('table', tablename, 'policy', policyname, 'roles', roles, 'cmd', cmd))
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('orders', 'order_items', 'offline_sales', 'product_variants', 'products')
  ),

  'variant_columns', (
    SELECT json_agg(json_build_object('col', column_name, 'type', data_type))
    FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND table_schema = 'public'
  ),

  'product_columns', (
    SELECT json_agg(json_build_object('col', column_name, 'type', data_type))
    FROM information_schema.columns 
    WHERE table_name = 'products' AND table_schema = 'public'
  )
) AS result;
