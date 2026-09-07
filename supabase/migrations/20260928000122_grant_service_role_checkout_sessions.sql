-- ==============================================================================
-- Migration: 20260928000122_grant_service_role_checkout_sessions.sql
-- Description:
-- Grant full table permissions on checkout_sessions, payment_attempts, and
-- payment_settings to service_role and postgres so Edge Functions
-- (e.g. create-razorpay-order, razorpay-webhook, verify-razorpay-payment)
-- can authoritatively query and update checkout sessions.
-- ==============================================================================

-- 1. Table permissions
GRANT ALL ON public.checkout_sessions TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON public.checkout_sessions TO anon, authenticated;

GRANT ALL ON public.payment_attempts TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE ON public.payment_attempts TO anon, authenticated;

GRANT ALL ON public.payment_settings TO service_role, postgres;
GRANT SELECT ON public.payment_settings TO anon, authenticated;

-- 2. Ensure RLS policies exist for service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'checkout_sessions' AND policyname = 'service_role manage checkout_sessions'
  ) THEN
    CREATE POLICY "service_role manage checkout_sessions" ON public.checkout_sessions
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payment_attempts' AND policyname = 'service_role manage payment_attempts'
  ) THEN
    CREATE POLICY "service_role manage payment_attempts" ON public.payment_attempts
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'payment_settings' AND policyname = 'service_role manage payment_settings'
  ) THEN
    CREATE POLICY "service_role manage payment_settings" ON public.payment_settings
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Execute permissions on RPC functions
GRANT EXECUTE ON FUNCTION public.get_payment_settings TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_settings TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_session TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_attempt TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_attempt_status TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_cod_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_session TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_order_summary_by_session TO anon, authenticated, service_role;
