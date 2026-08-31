SELECT json_build_object(
  'tables', (
    SELECT json_agg(json_build_object('table', table_name, 'columns', (
      SELECT json_agg(column_name) FROM information_schema.columns WHERE table_name = t.table_name AND table_schema = 'public'
    )))
    FROM information_schema.tables t
    WHERE table_schema = 'public'
  ),
  'functions', (
    SELECT json_agg(json_build_object('name', p.proname, 'def', pg_get_functiondef(p.oid)))
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname IN ('place_order', 'place_offline_sale', 'sync_offline_sales', 'lookup_barcode', 'admin_delete_order')
  )
) AS result;
