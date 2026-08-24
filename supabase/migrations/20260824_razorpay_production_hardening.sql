-- ============================================================
-- ZERAH BABY & KIDS — RAZORPAY PRODUCTION HARDENING & INDEXES
-- ============================================================

-- 1. Ensure Razorpay columns exist on orders table
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS razorpay_order_id text,
ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
ADD COLUMN IF NOT EXISTS razorpay_signature text;

-- 2. Add performance index on razorpay_order_id for fast verification and webhook lookups
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON public.orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id ON public.orders (razorpay_payment_id);

-- 3. Upsert safe public Razorpay Key ID into site_settings
INSERT INTO public.site_settings (key, value)
VALUES ('razorpay_key_id', '"rzp_live_TSOPbz5nCb4pLb"'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;
