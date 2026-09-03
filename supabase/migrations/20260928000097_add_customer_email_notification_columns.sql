-- ==============================================================================
-- Migration: 20260928000097_add_customer_email_notification_columns.sql
-- Description:
-- Adds tracking columns for customer-facing order confirmation and invoice emails.
-- ==============================================================================

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS customer_notification_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS customer_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_customer_notification ON public.orders (customer_notification_status);
