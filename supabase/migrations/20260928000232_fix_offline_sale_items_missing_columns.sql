-- Migration: 20260928000232_fix_offline_sale_items_missing_columns.sql
-- Description: Ensure all alias and historical pricing columns exist on public.offline_sale_items
-- to guarantee place_offline_sale and process_offline_return never fail with missing column errors.

-- 1. Add all schema column variations to offline_sale_items safely
ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS final_unit_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_unit_paid_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_bill_discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_coupon_discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_discount_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_mrp numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_selling_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_gross_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_quantity integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_returned integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_sold integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS name text DEFAULT 'Item',
  ADD COLUMN IF NOT EXISTS product_name text DEFAULT 'Item',
  ADD COLUMN IF NOT EXISTS qty integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS barcode text DEFAULT '',
  ADD COLUMN IF NOT EXISTS sku text DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_info text DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_slug text DEFAULT '';

-- 2. Backfill nulls with safe defaults
UPDATE public.offline_sale_items
SET
  final_unit_price = COALESCE(final_unit_price, final_unit_paid_price, price, 0),
  final_unit_paid_price = COALESCE(final_unit_paid_price, final_unit_price, price, 0),
  allocated_bill_discount = COALESCE(allocated_bill_discount, 0),
  allocated_coupon_discount = COALESCE(allocated_coupon_discount, 0),
  product_discount_amount = COALESCE(product_discount_amount, 0),
  returned_quantity = COALESCE(returned_quantity, quantity_returned, 0),
  quantity_returned = COALESCE(quantity_returned, returned_quantity, 0),
  quantity_sold = COALESCE(quantity_sold, quantity, qty, 1),
  name = COALESCE(name, product_name, 'Item'),
  product_name = COALESCE(product_name, name, 'Item'),
  qty = COALESCE(qty, quantity, 1),
  quantity = COALESCE(quantity, qty, 1)
WHERE final_unit_price IS NULL
   OR final_unit_paid_price IS NULL
   OR returned_quantity IS NULL
   OR quantity_returned IS NULL
   OR name IS NULL
   OR product_name IS NULL;

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
