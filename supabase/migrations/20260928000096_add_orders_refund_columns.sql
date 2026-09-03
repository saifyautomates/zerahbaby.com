-- ==============================================================================
-- Migration: 20260928000096_add_orders_refund_columns.sql
-- Description:
-- Adds canonical refund tracking columns to public.orders table to support
-- automated Razorpay refunds for cancelled online orders and admin-initiated refunds.
-- ==============================================================================

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS razorpay_refund_id text,
ADD COLUMN IF NOT EXISTS razorpay_refund_status text,
ADD COLUMN IF NOT EXISTS refund_amount numeric,
ADD COLUMN IF NOT EXISTS refund_completed_at timestamptz,
ADD COLUMN IF NOT EXISTS refund_notes text;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay_refund_id ON public.orders (razorpay_refund_id);
