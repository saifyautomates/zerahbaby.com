-- ==============================================================================
-- Migration: 20260928000274_performance_indexes_and_speed_optimization.sql
-- Description:
-- Adds high-performance B-tree and partial indexes to accelerate catalog queries,
-- search filters, relational joins, foreign keys, and administrative reports.
-- Drastically reduces DB response times across both Storefront and POS.
-- ==============================================================================

-- 1. Catalog, Categories & Products Optimization
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON public.products(brand_id);
CREATE INDEX IF NOT EXISTS idx_products_active_stock ON public.products(is_active, stock DESC);
CREATE INDEX IF NOT EXISTS idx_products_slug_active ON public.products(slug) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON public.categories(slug);

-- 2. Variants Optimization
CREATE INDEX IF NOT EXISTS idx_product_variants_product_stock ON public.product_variants(product_id, stock DESC);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON public.product_variants(sku) WHERE sku IS NOT NULL;

-- 3. Cart & Wishlist Acceleration
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON public.cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_product_id ON public.wishlist_items(product_id);

-- 4. Orders & Order Items Acceleration
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON public.orders(phone);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- 5. POS Sales & Returns Acceleration
CREATE INDEX IF NOT EXISTS idx_offline_sales_customer_id ON public.offline_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_offline_sales_created_by ON public.offline_sales(created_by);
CREATE INDEX IF NOT EXISTS idx_offline_sales_sale_number ON public.offline_sales(sale_number);
CREATE INDEX IF NOT EXISTS idx_offline_sales_created_at_desc ON public.offline_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_sale_items_sale_id ON public.offline_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_offline_sale_items_variant_id ON public.offline_sale_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_offline_returns_customer_id ON public.offline_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_offline_returns_created_by ON public.offline_returns(created_by);
CREATE INDEX IF NOT EXISTS idx_offline_returns_return_number ON public.offline_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_offline_returns_original_sale_id ON public.offline_returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_offline_returns_credit_token ON public.offline_returns(credit_token);

-- 6. POS Customers Fast Lookup
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone_lookup ON public.pos_customers(phone);
CREATE INDEX IF NOT EXISTS idx_pos_customers_name_trgm_ready ON public.pos_customers(lower(name));

-- 7. Store Credit Ledger & Vouchers
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_customer_id ON public.store_credit_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_source_sale_id ON public.store_credit_ledger(source_sale_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_used_in_sale_id ON public.store_credit_ledger(used_in_sale_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_source_return_id ON public.store_credit_ledger(source_return_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_user_id ON public.store_credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_created_by ON public.store_credit_ledger(created_by);

CREATE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_return_id ON public.pos_exchange_vouchers(return_id);
CREATE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_customer_id ON public.pos_exchange_vouchers(customer_id);

-- 8. Checkout Sessions, Coupons & Reviews
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_order_id ON public.checkout_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_session_id ON public.checkout_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_order_id ON public.coupon_usage(order_id);
CREATE INDEX IF NOT EXISTS idx_coupon_usage_user_id ON public.coupon_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_order_id ON public.reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON public.reviews(product_id);

-- 9. Multi-Cart POS Sessions
CREATE INDEX IF NOT EXISTS idx_pos_cart_sessions_customer_id ON public.pos_cart_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_pos_cart_sessions_offline_sale_id ON public.pos_cart_sessions(offline_sale_id);
CREATE INDEX IF NOT EXISTS idx_pos_session_items_variant_id ON public.pos_session_items(variant_id);

-- 10. Inventory Ledger
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product_created ON public.inventory_transactions(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_by ON public.inventory_transactions(created_by);

-- 11. Telemetry & Analytics
CREATE INDEX IF NOT EXISTS idx_analytics_events_order_id ON public.analytics_events(order_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_product_id ON public.analytics_events(product_id);
