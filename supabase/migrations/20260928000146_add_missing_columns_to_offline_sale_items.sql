-- Migration: 20260928000146_add_missing_columns_to_offline_sale_items.sql
-- Fix: POS sale failed with "column mrp of relation offline_sale_items does not exist"
-- Root Cause: place_offline_sale RPC inserts mrp, cost_price, barcode, variant_info,
--             product_slug, name into offline_sale_items, but table was missing mrp and related columns.

ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS mrp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS barcode text DEFAULT '',
  ADD COLUMN IF NOT EXISTS variant_info text DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_slug text DEFAULT '',
  ADD COLUMN IF NOT EXISTS name text DEFAULT 'POS Item',
  ADD COLUMN IF NOT EXISTS unit_mrp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_selling_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_bill_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_coupon_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_unit_paid_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_sold integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity_returned integer NOT NULL DEFAULT 0;

-- Backfill defaults for existing rows if needed
UPDATE public.offline_sale_items
SET
  mrp = COALESCE(NULLIF(mrp, 0), price),
  unit_mrp = COALESCE(NULLIF(unit_mrp, 0), mrp, price),
  unit_selling_price = COALESCE(NULLIF(unit_selling_price, 0), price),
  line_gross_amount = COALESCE(NULLIF(line_gross_amount, 0), price * qty),
  final_unit_paid_price = COALESCE(NULLIF(final_unit_paid_price, 0), price),
  quantity_sold = COALESCE(NULLIF(quantity_sold, 0), qty)
WHERE price > 0;
