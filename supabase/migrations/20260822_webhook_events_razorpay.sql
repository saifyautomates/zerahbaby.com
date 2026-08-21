-- ============================================================
-- ZERAH BABY — RAZORPAY WEBHOOK IDEMPOTENCY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE NOT NULL, -- Razorpay event ID (e.g. ev_xxx)
  event_type text NOT NULL,      -- e.g., payment.captured
  payload jsonb NOT NULL,
  processed boolean DEFAULT false,
  error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

-- RLS: Only admins/service role can access
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage webhook_events" 
ON public.webhook_events 
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) 
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ensure webhook events table is accessible to the service_role
GRANT ALL ON public.webhook_events TO service_role;
