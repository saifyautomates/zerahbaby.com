-- ============================================================================
-- Migration: 20260928000099_comprehensive_schema_safety_net.sql
-- Description:
-- Comprehensive safety-net migration that ensures ALL columns referenced in
-- edge functions, RPCs, and frontend code actually exist in the database.
-- Uses ADD COLUMN IF NOT EXISTS throughout — fully idempotent and safe to run
-- on a DB that already has these columns (no-op for existing ones).
-- ============================================================================

-- ── 1. pos_customers: ensure all referenced columns exist ────────────────────

ALTER TABLE public.pos_customers
  ADD COLUMN IF NOT EXISTS last_visit_date timestamptz,
  ADD COLUMN IF NOT EXISTS total_visits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS store_credit_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS store_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spend numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_purchases integer NOT NULL DEFAULT 0;

-- ── 2. orders: ensure all Shiprocket & notification columns exist ─────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shiprocket_order_id bigint,
  ADD COLUMN IF NOT EXISTS shiprocket_shipment_id bigint,
  ADD COLUMN IF NOT EXISTS awb_code text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS shiprocket_status text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS razorpay_refund_id text,
  ADD COLUMN IF NOT EXISTS razorpay_refund_status text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric,
  ADD COLUMN IF NOT EXISTS refund_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_notes text,
  ADD COLUMN IF NOT EXISTS owner_notification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_notification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_no text,
  ADD COLUMN IF NOT EXISTS invoice_date date;

-- ── 3. offline_sales: ensure all notification & POS token columns exist ───────

ALTER TABLE public.offline_sales
  ADD COLUMN IF NOT EXISTS owner_notification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pos_token_number integer,
  ADD COLUMN IF NOT EXISTS pos_token_date date,
  ADD COLUMN IF NOT EXISTS store_credit_used numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_token_used text,
  ADD COLUMN IF NOT EXISTS return_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS returned_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_units integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 4. online_returns: ensure all Shiprocket return columns exist ─────────────

ALTER TABLE public.online_returns
  ADD COLUMN IF NOT EXISTS shiprocket_return_order_id bigint,
  ADD COLUMN IF NOT EXISTS shiprocket_return_shipment_id bigint,
  ADD COLUMN IF NOT EXISTS shiprocket_return_awb text,
  ADD COLUMN IF NOT EXISTS shiprocket_return_status text,
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at timestamptz;

-- ── 5. order_items: ensure snapshot columns exist ─────────────────────────────

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sku_snapshot text,
  ADD COLUMN IF NOT EXISTS color_snapshot text,
  ADD COLUMN IF NOT EXISTS size_snapshot text;

-- ── 6. offline_sale_items: ensure snapshot and cost columns exist ─────────────

ALTER TABLE public.offline_sale_items
  ADD COLUMN IF NOT EXISTS sku_snapshot text,
  ADD COLUMN IF NOT EXISTS cost_price numeric,
  ADD COLUMN IF NOT EXISTS color_snapshot text,
  ADD COLUMN IF NOT EXISTS size_snapshot text;

-- ── 7. shiprocket_tokens: ensure table exists for token caching ───────────────

CREATE TABLE IF NOT EXISTS public.shiprocket_tokens (
  id integer PRIMARY KEY DEFAULT 1,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only 1 row allowed (the singleton token)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shiprocket_tokens_singleton ON public.shiprocket_tokens(id);

GRANT SELECT, INSERT, UPDATE ON public.shiprocket_tokens TO authenticated, service_role;

-- ── 8. Indexes for performance ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_awb_code ON public.orders(awb_code) WHERE awb_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_refund_id ON public.orders(razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_order ON public.orders(shiprocket_order_id) WHERE shiprocket_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_online_returns_sr_return_awb ON public.online_returns(shiprocket_return_awb) WHERE shiprocket_return_awb IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_customers_last_visit ON public.pos_customers(last_visit_date DESC) WHERE last_visit_date IS NOT NULL;
