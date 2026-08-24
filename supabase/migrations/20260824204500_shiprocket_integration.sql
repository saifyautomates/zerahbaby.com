-- =====================================================================
-- Migration: Shiprocket Integration
-- Adds Shiprocket specific fields to orders and a tokens table.
-- =====================================================================

-- 1. Create table for Shiprocket tokens
CREATE TABLE IF NOT EXISTS public.shiprocket_tokens (
  id integer PRIMARY KEY DEFAULT 1,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Shiprocket tokens expire in 10 days
  expires_at timestamptz NOT NULL,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Secure shiprocket_tokens
ALTER TABLE public.shiprocket_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shiprocket_tokens TO service_role;
REVOKE ALL ON public.shiprocket_tokens FROM authenticated, anon;
-- No policies needed because it's only accessed by service_role (Edge Functions)

-- 2. Alter orders table to include Shiprocket fields
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS shiprocket_order_id bigint,
  ADD COLUMN IF NOT EXISTS shiprocket_shipment_id bigint,
  ADD COLUMN IF NOT EXISTS awb_code text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS shiprocket_status text;

-- Create indexes for performance if looking up by shipment ID from webhooks
CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_shipment ON public.orders(shiprocket_shipment_id);
CREATE INDEX IF NOT EXISTS idx_orders_awb_code ON public.orders(awb_code);
