-- =====================================================================
-- Migration: 20260928000174_full_shiprocket_integration_lifecycle.sql
-- Adds normalized shipping lifecycle columns to orders and creates
-- shipping_events audit trail table for authoritative tracking.
-- =====================================================================

-- 1. Add normalized shipping lifecycle columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shiprocket_label_url text,
  ADD COLUMN IF NOT EXISTS shiprocket_manifest_url text,
  ADD COLUMN IF NOT EXISTS shipping_cancellation_status text DEFAULT 'NOT_REQUESTED',
  ADD COLUMN IF NOT EXISTS shipping_cancellation_reason text,
  ADD COLUMN IF NOT EXISTS shipping_cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_cancellation_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_error text,
  ADD COLUMN IF NOT EXISTS shipping_tracking_history jsonb DEFAULT '[]'::jsonb;

-- 2. Create shipping_events audit table
CREATE TABLE IF NOT EXISTS public.shipping_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  shiprocket_order_id bigint,
  shiprocket_shipment_id bigint,
  awb_code text,
  provider_status text,
  details jsonb DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance and webhook reconciliation
CREATE INDEX IF NOT EXISTS idx_shipping_events_order_id ON public.shipping_events(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_events_awb ON public.shipping_events(awb_code) WHERE awb_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipping_events_created_at ON public.shipping_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_cancellation_status ON public.orders(shipping_cancellation_status);

-- 3. Row Level Security for shipping_events
ALTER TABLE public.shipping_events ENABLE ROW LEVEL SECURITY;

-- Admins can view all shipping events
DROP POLICY IF EXISTS "admins_manage_shipping_events" ON public.shipping_events;
CREATE POLICY "admins_manage_shipping_events"
  ON public.shipping_events
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'owner', 'manager', 'staff')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'owner', 'manager', 'staff')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- Customers can view shipping events for their own orders
DROP POLICY IF EXISTS "customers_view_own_shipping_events" ON public.shipping_events;
CREATE POLICY "customers_view_own_shipping_events"
  ON public.shipping_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = shipping_events.order_id
        AND o.user_id = auth.uid()
    )
  );

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_events TO service_role;
GRANT SELECT ON public.shipping_events TO authenticated;
GRANT SELECT ON public.shipping_events TO anon;

COMMENT ON TABLE public.shipping_events IS 'Audit history of Shiprocket shipping operations and status transitions';
