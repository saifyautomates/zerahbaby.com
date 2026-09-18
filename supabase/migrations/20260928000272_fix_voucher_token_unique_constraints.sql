-- ==============================================================================
-- Migration: 20260928000272_fix_voucher_token_unique_constraints.sql
-- Description:
-- Add exact UNIQUE constraints on column "token" for pos_exchange_vouchers
-- and store_credit_vouchers to satisfy ON CONFLICT (token) in process_offline_return.
-- ==============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_exchange_vouchers_token_key'
  ) THEN
    ALTER TABLE public.pos_exchange_vouchers ADD CONSTRAINT pos_exchange_vouchers_token_key UNIQUE (token);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_credit_vouchers_token_key'
  ) THEN
    ALTER TABLE public.store_credit_vouchers ADD CONSTRAINT store_credit_vouchers_token_key UNIQUE (token);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
