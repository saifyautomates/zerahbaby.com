-- ==============================================================================
-- Migration: 20260928000100_pos_historical_pricing.sql
-- Description:
--   Add immutable historical pricing snapshot columns to offline_sale_items.
--   These columns capture the exact pricing at sale time so returns can always
--   use the original net paid price — never the current product price.
--
-- New columns:
--   unit_mrp                  — MRP of the product at time of sale
--   unit_selling_price        — The line price (after product-level discount, before bill/coupon)
--   line_gross_amount         — unit_selling_price × qty (pre-bill/coupon discount)
--   product_discount_amount   — any explicit per-unit product discount applied
--   allocated_bill_discount   — proportional share of whole-bill discount for this line
--   allocated_coupon_discount — proportional share of coupon discount for this line
--   final_unit_paid_price     — exact net amount per unit after ALL discounts
--   quantity_sold             — redundant copy of qty for clarity / immutability
--   quantity_returned         — running total of units returned against this line
-- ==============================================================================

-- 1. Add snapshot columns (all idempotent)
ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS unit_mrp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_selling_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_gross_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_bill_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocated_coupon_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_unit_paid_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_sold integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_returned integer NOT NULL DEFAULT 0;

-- 2. Backfill existing rows with the best available historical approximation.
--    For old data: final_unit_paid_price = price (unit line price). This is the
--    best we can do retroactively — existing transactions had no discount allocation.
--    All NEW sales (after this migration + migration 101) will have accurate values.
UPDATE public.offline_sale_items
SET
  unit_mrp              = CASE WHEN mrp_snapshot > 0 THEN mrp_snapshot ELSE price END,
  unit_selling_price    = price,
  line_gross_amount     = price * qty,
  product_discount_amount = 0,
  allocated_bill_discount = 0,
  allocated_coupon_discount = 0,
  final_unit_paid_price = price,
  quantity_sold         = qty,
  quantity_returned     = COALESCE(quantity_returned, 0)  -- keep existing value if already set
WHERE final_unit_paid_price = 0;

-- 3. Backfill quantity_returned from existing offline_return_items (for old data integrity)
--    This ensures quantity_returnable is correct for existing returns records.
UPDATE public.offline_sale_items si
SET quantity_returned = (
  SELECT COALESCE(SUM(ri.qty), 0)
  FROM public.offline_return_items ri
  WHERE ri.original_sale_item_id = si.id
)
WHERE EXISTS (
  SELECT 1 FROM public.offline_return_items ri WHERE ri.original_sale_item_id = si.id
);

-- 4. Ensure quantity_sold is always set for existing rows
UPDATE public.offline_sale_items
SET quantity_sold = qty
WHERE quantity_sold = 0;

-- 5. Add constraint: quantity_returned must never exceed quantity_sold
ALTER TABLE public.offline_sale_items
  DROP CONSTRAINT IF EXISTS chk_offline_sale_items_return_qty;

ALTER TABLE public.offline_sale_items
  ADD CONSTRAINT chk_offline_sale_items_return_qty
    CHECK (quantity_returned >= 0 AND quantity_returned <= quantity_sold);

-- 6. Index for quick returnability lookups
CREATE INDEX IF NOT EXISTS idx_offline_sale_items_returnable
  ON public.offline_sale_items(sale_id)
  WHERE quantity_returned < quantity_sold;

CREATE INDEX IF NOT EXISTS idx_offline_sale_items_original_return
  ON public.offline_sale_items(id)
  WHERE quantity_sold > 0;

-- 7. Notify PostgREST of schema change
NOTIFY pgrst, 'reload schema';
