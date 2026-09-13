-- ==============================================================================
-- Migration: 20260928000197_create_store_credit_vouchers_table.sql
-- Description:
-- Create missing public.store_credit_vouchers table required for POS returns,
-- exchanges, and store credit voucher redemption during offline sales.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.store_credit_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL,
  customer_phone text,
  initial_amount numeric(12,2) NOT NULL DEFAULT 0,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_credit_vouchers_token ON public.store_credit_vouchers(upper(token));
CREATE INDEX IF NOT EXISTS idx_store_credit_vouchers_customer ON public.store_credit_vouchers(customer_id);

ALTER TABLE public.store_credit_vouchers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'store_credit_vouchers' 
      AND policyname = 'store_credit_vouchers_all_policy'
  ) THEN
    CREATE POLICY store_credit_vouchers_all_policy ON public.store_credit_vouchers
      FOR ALL
      TO authenticated, service_role, anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON TABLE public.store_credit_vouchers TO anon, authenticated, service_role;
