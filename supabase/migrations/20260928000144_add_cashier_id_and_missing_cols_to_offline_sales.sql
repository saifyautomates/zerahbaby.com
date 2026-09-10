-- Migration: 20260928000144_add_cashier_id_and_missing_cols_to_offline_sales.sql
-- Fix: POS sale fails with "column cashier_id of relation offline_sales does not exist"
-- Root Cause: place_offline_sale RPC inserts cashier_id, customer_id, idempotency_key,
--             store_credit_used, credit_token, coupon_code but table was never updated.

-- 1. cashier_id (the user who made the sale)
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS cashier_id uuid REFERENCES auth.users(id);

-- 2. Backfill from created_by
UPDATE public.offline_sales
  SET cashier_id = created_by
  WHERE cashier_id IS NULL AND created_by IS NOT NULL;

-- 3. customer_id (FK to pos_customers)
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS customer_id uuid;

-- 4. idempotency_key
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 5. store_credit_used
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS store_credit_used numeric NOT NULL DEFAULT 0;

-- 6. credit_token
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS credit_token text;

-- 7. coupon_code
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS coupon_code text;

-- 8. discount_type and coupon_discount
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'none';
ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS coupon_discount numeric NOT NULL DEFAULT 0;

-- 9. Unique index on idempotency_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_sales_idempotency_key
  ON public.offline_sales(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 10. FK to pos_customers if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_customers') THEN
    BEGIN
      ALTER TABLE public.offline_sales
        ADD CONSTRAINT offline_sales_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES public.pos_customers(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- 11. Indexes
CREATE INDEX IF NOT EXISTS idx_offline_sales_cashier_id ON public.offline_sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_offline_sales_customer_id ON public.offline_sales(customer_id);