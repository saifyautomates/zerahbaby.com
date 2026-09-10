-- Migration: 20260928000153_auth_otps_table.sql
-- Description: Secure server-side hashed OTP storage for MSG91 SMS Flow login

CREATE TABLE IF NOT EXISTS public.auth_otps (
  phone text PRIMARY KEY,
  otp_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;

-- Allow only service_role full access (Edge Functions use service role)
DROP POLICY IF EXISTS "Service role full access on auth_otps" ON public.auth_otps;
CREATE POLICY "Service role full access on auth_otps"
  ON public.auth_otps
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_auth_otps_expires_at ON public.auth_otps(expires_at);
