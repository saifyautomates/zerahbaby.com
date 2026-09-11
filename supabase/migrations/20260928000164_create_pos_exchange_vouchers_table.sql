-- =====================================================================
-- Migration: 20260928000164_create_pos_exchange_vouchers_table.sql
-- Description: Create public.pos_exchange_vouchers table, backfill from
--              offline_returns, and ensure place_offline_sale,
--              process_offline_return, and get_store_credit_voucher
--              handle exchange credit tokens without any missing relation errors.
-- =====================================================================

-- 1. Create the pos_exchange_vouchers table if it does not exist
CREATE TABLE IF NOT EXISTS public.pos_exchange_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  return_id uuid REFERENCES public.offline_returns(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.pos_customers(id) ON DELETE SET NULL,
  customer_phone text,
  customer_name text,
  original_amount numeric NOT NULL DEFAULT 0,
  remaining_balance numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active', -- 'active' | 'redeemed' | 'expired'
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Unique index on uppercase token
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_token 
  ON public.pos_exchange_vouchers (UPPER(token));

CREATE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_customer 
  ON public.pos_exchange_vouchers (customer_id);

CREATE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_phone 
  ON public.pos_exchange_vouchers (customer_phone);

CREATE INDEX IF NOT EXISTS idx_pos_exchange_vouchers_status 
  ON public.pos_exchange_vouchers (status);

-- 3. Table Permissions & Row Level Security
ALTER TABLE public.pos_exchange_vouchers ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.pos_exchange_vouchers TO authenticated;
GRANT ALL ON public.pos_exchange_vouchers TO service_role;
GRANT SELECT ON public.pos_exchange_vouchers TO anon;

DROP POLICY IF EXISTS "pos_exchange_vouchers_authenticated_all" ON public.pos_exchange_vouchers;
CREATE POLICY "pos_exchange_vouchers_authenticated_all" ON public.pos_exchange_vouchers
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "pos_exchange_vouchers_service_role_all" ON public.pos_exchange_vouchers;
CREATE POLICY "pos_exchange_vouchers_service_role_all" ON public.pos_exchange_vouchers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Backfill from existing offline_returns records
INSERT INTO public.pos_exchange_vouchers (
  token,
  return_id,
  customer_id,
  customer_phone,
  customer_name,
  original_amount,
  remaining_balance,
  status,
  expires_at,
  created_at,
  updated_at
)
SELECT 
  UPPER(trim(r.credit_token)),
  r.id,
  r.customer_id,
  r.customer_phone,
  r.customer_name,
  COALESCE(r.refund_amount, 0),
  GREATEST(0, COALESCE(r.refund_amount, 0) - COALESCE(r.credit_used, 0)),
  CASE 
    WHEN GREATEST(0, COALESCE(r.refund_amount, 0) - COALESCE(r.credit_used, 0)) <= 0 THEN 'redeemed'
    WHEN r.credit_token_status = 'CONSUMED' THEN 'redeemed'
    WHEN r.credit_token_status = 'EXPIRED' THEN 'expired'
    ELSE 'active'
  END,
  COALESCE(r.expires_at, now() + interval '365 days'),
  r.created_at,
  COALESCE(r.updated_at, r.created_at)
FROM public.offline_returns r
WHERE r.credit_token IS NOT NULL AND trim(r.credit_token) != ''
ON CONFLICT (UPPER(token)) DO UPDATE
SET remaining_balance = EXCLUDED.remaining_balance,
    status = EXCLUDED.status,
    updated_at = now();

-- Also ensure customer store credit in pos_customers matches vouchers
UPDATE public.pos_customers c
SET store_credit_balance = COALESCE(v.total_remaining, c.store_credit_balance, 0),
    store_credit = COALESCE(v.total_remaining, c.store_credit, 0)
FROM (
  SELECT customer_id, SUM(remaining_balance) as total_remaining
  FROM public.pos_exchange_vouchers
  WHERE customer_id IS NOT NULL AND status = 'active'
  GROUP BY customer_id
) v
WHERE c.id = v.customer_id;

-- 5. Updated get_store_credit_voucher RPC that checks pos_exchange_vouchers
CREATE OR REPLACE FUNCTION public.get_store_credit_voucher(
  _token text,
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clean_token text := UPPER(TRIM(COALESCE(_token, '')));
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
  v_voucher record;
  v_remaining numeric := 0;
  v_is_expired boolean := false;
BEGIN
  IF v_clean_token = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Please enter a voucher token');
  END IF;

  -- 1. Check in pos_exchange_vouchers first
  SELECT * INTO v_voucher
  FROM public.pos_exchange_vouchers
  WHERE UPPER(token) = v_clean_token
  LIMIT 1;

  -- 2. Fallback check in offline_returns if not yet in pos_exchange_vouchers
  IF v_voucher.id IS NULL THEN
    SELECT 
      id as return_id,
      UPPER(trim(credit_token)) as token,
      customer_id,
      customer_phone,
      customer_name,
      refund_amount as original_amount,
      GREATEST(0, refund_amount - COALESCE(credit_used, 0)) as remaining_balance,
      CASE 
        WHEN credit_token_status = 'CONSUMED' OR GREATEST(0, refund_amount - COALESCE(credit_used, 0)) <= 0 THEN 'redeemed'
        WHEN credit_token_status = 'EXPIRED' THEN 'expired'
        ELSE 'active'
      END as status,
      COALESCE(expires_at, now() + interval '365 days') as expires_at,
      created_at
    INTO v_voucher
    FROM public.offline_returns
    WHERE UPPER(trim(credit_token)) = v_clean_token
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_voucher.token IS NOT NULL THEN
      -- Automatically sync into pos_exchange_vouchers
      INSERT INTO public.pos_exchange_vouchers (
        token, return_id, customer_id, customer_phone, customer_name,
        original_amount, remaining_balance, status, expires_at, created_at
      ) VALUES (
        v_voucher.token, v_voucher.return_id, v_voucher.customer_id, v_voucher.customer_phone, v_voucher.customer_name,
        v_voucher.original_amount, v_voucher.remaining_balance, v_voucher.status, v_voucher.expires_at, v_voucher.created_at
      )
      ON CONFLICT (UPPER(token)) DO UPDATE
      SET remaining_balance = EXCLUDED.remaining_balance, status = EXCLUDED.status;
    END IF;
  END IF;

  IF v_voucher.token IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'error', 'Voucher token ' || v_clean_token || ' not found',
      'token', v_clean_token
    );
  END IF;

  v_remaining := COALESCE(v_voucher.remaining_balance, 0);

  -- Check expiry
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    UPDATE public.pos_exchange_vouchers SET status = 'expired', updated_at = now() WHERE UPPER(token) = v_clean_token;
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Voucher ' || v_clean_token || ' has expired',
      'status', 'expired',
      'expired', true,
      'token', v_clean_token,
      'expires_at', v_voucher.expires_at,
      'remaining_balance', 0
    );
  END IF;

  -- Check redeemed
  IF v_voucher.status = 'redeemed' OR v_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Voucher ' || v_clean_token || ' has already been fully redeemed (Balance ₹0)',
      'status', 'redeemed',
      'token', v_clean_token,
      'remaining_balance', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'voucher_id', v_voucher.id,
    'token', v_voucher.token,
    'customer_id', v_voucher.customer_id,
    'customer_name', v_voucher.customer_name,
    'customer_phone', v_voucher.customer_phone,
    'original_amount', v_voucher.original_amount,
    'remaining_balance', v_remaining,
    'available_credit', v_remaining,
    'status', 'active',
    'expired', false,
    'expires_at', v_voucher.expires_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_credit_voucher(text, uuid, text, uuid) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
