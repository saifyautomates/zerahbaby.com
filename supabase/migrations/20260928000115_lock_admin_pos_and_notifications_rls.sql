-- ==============================================================================
-- Migration: 20260928000115_lock_admin_pos_and_notifications_rls.sql
-- Description:
-- Strict RLS Lockdown of Administrative Data Tables:
-- 1. offline_sales & offline_sale_items: Restrict to store administrators
-- 2. store_credit_ledger: Close anonymous customer PII & voucher code leakage
-- 3. admin_notifications: Restrict viewing, updating, inserting & deleting to admins
-- 4. admin_order_deletion_logs: Restrict SELECT to admins
-- 5. shiprocket_tokens: Revoke authenticated & anon direct access; restrict to service_role and admins
-- ==============================================================================

-- 1. Lock down offline_sales
REVOKE ALL ON public.offline_sales FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sales TO authenticated;
GRANT ALL ON public.offline_sales TO service_role;

ALTER TABLE public.offline_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_offline_sales" ON public.offline_sales;
DROP POLICY IF EXISTS "admins select offline sales" ON public.offline_sales;
DROP POLICY IF EXISTS "admins manage offline sales" ON public.offline_sales;
DROP POLICY IF EXISTS "allow_delete_offline_sales" ON public.offline_sales;
DROP POLICY IF EXISTS "allow_delete_only_draft_offline_sales" ON public.offline_sales;

CREATE POLICY "admins manage offline sales"
  ON public.offline_sales FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());

-- 2. Lock down offline_sale_items
REVOKE ALL ON public.offline_sale_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_sale_items TO authenticated;
GRANT ALL ON public.offline_sale_items TO service_role;

ALTER TABLE public.offline_sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_offline_sale_items" ON public.offline_sale_items;
DROP POLICY IF EXISTS "allow_delete_offline_sale_items" ON public.offline_sale_items;
DROP POLICY IF EXISTS "admins manage offline sale items" ON public.offline_sale_items;

CREATE POLICY "admins manage offline sale items"
  ON public.offline_sale_items FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());

-- 3. Lock down store_credit_ledger (closes customer phone & voucher token leak)
REVOKE ALL ON public.store_credit_ledger FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_credit_ledger TO authenticated;
GRANT ALL ON public.store_credit_ledger TO service_role;

ALTER TABLE public.store_credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_read_store_credit_ledger" ON public.store_credit_ledger;
DROP POLICY IF EXISTS "allow select store_credit_ledger" ON public.store_credit_ledger;
DROP POLICY IF EXISTS "admins manage store credit ledger" ON public.store_credit_ledger;

CREATE POLICY "admins manage store credit ledger"
  ON public.store_credit_ledger FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());

-- 4. Lock down admin_notifications
REVOKE ALL ON public.admin_notifications FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can update notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "Admins can delete notifications" ON public.admin_notifications;
DROP POLICY IF EXISTS "admins manage notifications" ON public.admin_notifications;

CREATE POLICY "admins manage notifications"
  ON public.admin_notifications FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());

-- 5. Lock down admin_order_deletion_logs
REVOKE ALL ON public.admin_order_deletion_logs FROM anon;
GRANT SELECT, INSERT ON public.admin_order_deletion_logs TO authenticated;
GRANT ALL ON public.admin_order_deletion_logs TO service_role;

ALTER TABLE public.admin_order_deletion_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins view deletion logs" ON public.admin_order_deletion_logs;
DROP POLICY IF EXISTS "admins insert deletion logs" ON public.admin_order_deletion_logs;

CREATE POLICY "admins view deletion logs"
  ON public.admin_order_deletion_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin());

CREATE POLICY "admins insert deletion logs"
  ON public.admin_order_deletion_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());

-- 6. Lock down shiprocket_tokens
REVOKE ALL ON public.shiprocket_tokens FROM anon;
REVOKE ALL ON public.shiprocket_tokens FROM authenticated;
GRANT ALL ON public.shiprocket_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.shiprocket_tokens TO authenticated;

ALTER TABLE public.shiprocket_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage shiprocket tokens" ON public.shiprocket_tokens;

CREATE POLICY "admins manage shiprocket tokens"
  ON public.shiprocket_tokens FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_admin())
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_admin());
