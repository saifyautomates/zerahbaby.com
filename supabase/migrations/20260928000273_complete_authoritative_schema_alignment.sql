-- ==============================================================================
-- Migration: 20260928000273_complete_authoritative_schema_alignment.sql
-- Description:
-- Permanently align all table schemas with every canonical and historical RPC,
-- trigger, and frontend query across the entire system.
-- Eliminates any possibility of 'column "..." does not exist' runtime errors.
-- ==============================================================================

-- 1. Table: offline_sales
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS token_number integer,
  ADD COLUMN IF NOT EXISTS tax numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS change_given numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_customer_id uuid;

-- Backfill token_number from pos_token_number if present
UPDATE public.offline_sales
SET token_number = pos_token_number
WHERE token_number IS NULL AND pos_token_number IS NOT NULL;

-- Backfill total_amount from total
UPDATE public.offline_sales
SET total_amount = total
WHERE total_amount = 0 AND total IS NOT NULL;

-- 2. Table: offline_sale_items
ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;

UPDATE public.offline_sale_items
SET unit_price = COALESCE(unit_selling_price, price, 0)
WHERE unit_price = 0;

-- 3. Table: offline_returns
ALTER TABLE public.offline_returns
  ADD COLUMN IF NOT EXISTS cashier_id uuid,
  ADD COLUMN IF NOT EXISTS refund_subtotal numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_token_issued text,
  ADD COLUMN IF NOT EXISTS processed_by uuid;

UPDATE public.offline_returns
SET refund_subtotal = COALESCE(refund_amount, 0),
    refund_total = COALESCE(refund_amount, 0),
    credit_token_issued = credit_token
WHERE refund_total = 0;

-- 4. Table: order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS product_sku text,
  ADD COLUMN IF NOT EXISTS product_barcode text,
  ADD COLUMN IF NOT EXISTS variant_name text,
  ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_at_time numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_sku text,
  ADD COLUMN IF NOT EXISTS variant_color text,
  ADD COLUMN IF NOT EXISTS variant_size text,
  ADD COLUMN IF NOT EXISTS variant_barcode text,
  ADD COLUMN IF NOT EXISTS item_image text,
  ADD COLUMN IF NOT EXISTS item_title text;

UPDATE public.order_items
SET title = COALESCE(title, name, product_name_snapshot, 'Product'),
    product_name = COALESCE(product_name, name, product_name_snapshot, 'Product'),
    product_sku = COALESCE(product_sku, sku_snapshot),
    product_barcode = COALESCE(product_barcode, barcode_snapshot),
    unit_cost = COALESCE(unit_cost, buying_price, 0),
    slug = COALESCE(slug, product_slug),
    sku = COALESCE(sku, sku_snapshot),
    unit_price = COALESCE(unit_price, price, 0),
    price_at_time = COALESCE(price_at_time, price, 0),
    variant_sku = COALESCE(variant_sku, sku_snapshot),
    variant_color = COALESCE(variant_color, color_snapshot, color),
    variant_size = COALESCE(variant_size, size_snapshot, size),
    variant_barcode = COALESCE(variant_barcode, barcode_snapshot),
    item_image = COALESCE(item_image, image_url_snapshot, image_url),
    item_title = COALESCE(item_title, title, name, product_name_snapshot);

-- 5. Table: inventory_transactions
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS change_qty bigint,
  ADD COLUMN IF NOT EXISTS prev_stock bigint,
  ADD COLUMN IF NOT EXISTS new_stock bigint,
  ADD COLUMN IF NOT EXISTS performed_by uuid,
  ADD COLUMN IF NOT EXISTS changed_by uuid;

UPDATE public.inventory_transactions
SET change_qty = COALESCE(change_qty, quantity),
    prev_stock = COALESCE(prev_stock, previous_quantity),
    new_stock = COALESCE(new_stock, new_quantity),
    performed_by = COALESCE(performed_by, created_by),
    changed_by = COALESCE(changed_by, created_by)
WHERE change_qty IS NULL;

-- 6. Table: payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- 7. Table: store_credit_ledger
ALTER TABLE public.store_credit_ledger
  ADD COLUMN IF NOT EXISTS issued_by uuid;

-- 8. Table: payment_settings
ALTER TABLE public.payment_settings
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 9. Table: online_return_items
ALTER TABLE public.online_return_items
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS image_url_snapshot text,
  ADD COLUMN IF NOT EXISTS unit_price_snapshot numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount_per_item numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_line_refund numeric DEFAULT 0;

UPDATE public.online_return_items
SET color = COALESCE(color, color_snapshot),
    size = COALESCE(size, size_snapshot),
    image_url_snapshot = COALESCE(image_url_snapshot, image_snapshot),
    unit_price_snapshot = COALESCE(unit_price_snapshot, historical_unit_price, 0),
    refund_amount_per_item = COALESCE(refund_amount_per_item, item_refund_amount, 0),
    total_line_refund = COALESCE(total_line_refund, item_refund_amount, 0);

-- 10. Table: online_return_events
ALTER TABLE public.online_return_events
  ADD COLUMN IF NOT EXISTS from_status text,
  ADD COLUMN IF NOT EXISTS to_status text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

UPDATE public.online_return_events
SET from_status = COALESCE(from_status, old_status),
    to_status = COALESCE(to_status, new_status),
    notes = COALESCE(notes, note),
    created_by = COALESCE(created_by, actor_id);
