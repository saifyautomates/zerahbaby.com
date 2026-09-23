-- ============================================================================
-- Migration: 20260928000317_secure_checkout_order_data_and_mutations.sql
-- Purpose:
--   Security hardening only. Preserve existing storefront/admin behavior while
--   closing the public read/mutation surfaces identified in the repository audit.
--   No catalog, variant, pricing, inventory-calculation, UI, or shipment logic
--   is changed by this migration.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- 1. Remove public access to private checkout/payment/order data.
-- -----------------------------------------------------------------------------

REVOKE SELECT ON public.checkout_sessions FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.checkout_sessions TO service_role;
GRANT SELECT ON public.payment_attempts TO service_role;

REVOKE SELECT ON public.orders FROM PUBLIC, anon;
GRANT SELECT ON public.orders TO authenticated, service_role;

REVOKE SELECT ON public.order_items FROM PUBLIC, anon;
GRANT SELECT ON public.order_items TO authenticated, service_role;

DROP POLICY IF EXISTS "public read own checkout_sessions" ON public.checkout_sessions;
DROP POLICY IF EXISTS "allow_read_checkout_sessions" ON public.checkout_sessions;
DROP POLICY IF EXISTS "public read payment_attempts" ON public.payment_attempts;
DROP POLICY IF EXISTS "allow_read_payment_attempts" ON public.payment_attempts;
DROP POLICY IF EXISTS "allow_read_orders" ON public.orders;
DROP POLICY IF EXISTS "allow_read_order_items" ON public.order_items;

-- Defense-in-depth restrictive policies ensure that even if another permissive
-- SELECT policy is introduced later, authenticated customers can only see
-- orders belonging to their account/verified contact identity or admin scope.
DROP POLICY IF EXISTS "restrict_customer_order_visibility" ON public.orders;
CREATE POLICY "restrict_customer_order_visibility"
  ON public.orders AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL AND (
        (
          NULLIF(auth.jwt()->>'phone', '') IS NOT NULL
          AND (
            phone = auth.jwt()->>'phone'
            OR phone = replace(auth.jwt()->>'phone', '+91', '')
            OR phone = right(auth.jwt()->>'phone', 10)
          )
        )
        OR (
          NULLIF(auth.jwt()->>'email', '') IS NOT NULL
          AND lower(email) = lower(auth.jwt()->>'email')
        )
      )
    )
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "restrict_customer_order_item_visibility" ON public.order_items;
CREATE POLICY "restrict_customer_order_item_visibility"
  ON public.order_items AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR (
            o.user_id IS NULL AND (
              (
                NULLIF(auth.jwt()->>'phone', '') IS NOT NULL
                AND (
                  o.phone = auth.jwt()->>'phone'
                  OR o.phone = replace(auth.jwt()->>'phone', '+91', '')
                  OR o.phone = right(auth.jwt()->>'phone', 10)
                )
              )
              OR (
                NULLIF(auth.jwt()->>'email', '') IS NOT NULL
                AND lower(o.email) = lower(auth.jwt()->>'email')
              )
            )
          )
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Lock down checkout-session/payment mutation RPCs.
--    Existing implementations are preserved under private legacy names and
--    wrapped with authorization-only entry points.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.record_payment_attempt(text, text, numeric, text)
  RENAME TO record_payment_attempt_legacy_v00317;

ALTER FUNCTION public.update_payment_attempt_status(text, text, text, jsonb, text)
  RENAME TO update_payment_attempt_status_legacy_v00317;

ALTER FUNCTION public.finalize_paid_order(text, text, text, text, numeric)
  RENAME TO finalize_paid_order_legacy_v00317;

REVOKE EXECUTE ON FUNCTION public.record_payment_attempt_legacy_v00317(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_payment_attempt_status_legacy_v00317(text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_paid_order_legacy_v00317(text, text, text, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_payment_attempt(
  _session_id text,
  _razorpay_order_id text,
  _amount numeric,
  _currency text DEFAULT 'INR'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  RETURN public.record_payment_attempt_legacy_v00317(
    _session_id,
    _razorpay_order_id,
    _amount,
    _currency
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payment_attempt_status(
  _razorpay_order_id text,
  _status text,
  _failure_reason text DEFAULT NULL,
  _gateway_response jsonb DEFAULT NULL,
  _error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  RETURN public.update_payment_attempt_status_legacy_v00317(
    _razorpay_order_id,
    _status,
    _failure_reason,
    _gateway_response,
    _error_message
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text DEFAULT NULL,
  _razorpay_order_id text DEFAULT NULL,
  _razorpay_payment_id text DEFAULT NULL,
  _razorpay_signature text DEFAULT NULL,
  _verified_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  RETURN public.finalize_paid_order_legacy_v00317(
    _session_id,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature,
    _verified_amount
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_payment_attempt(text, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_payment_attempt_status(text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_payment_attempt(text, text, numeric, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_attempt_status(text, text, text, jsonb, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order(text, text, text, text, numeric)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Checkout session ownership.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.cancel_checkout_session(text, text)
  RENAME TO cancel_checkout_session_legacy_v00317;

REVOKE EXECUTE ON FUNCTION public.cancel_checkout_session_legacy_v00317(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_checkout_session(
  _session_id text,
  _reason text DEFAULT 'User closed payment modal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  session_rec record;
  is_privileged boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    PERFORM public.cancel_checkout_session_legacy_v00317(_session_id, _reason);
    RETURN jsonb_build_object(
      'success', true,
      'session_id', _session_id,
      'status', 'payment_cancelled'
    );
  END IF;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  is_privileged :=
    public.has_role(uid, 'admin')
    OR public.has_role(uid, 'owner')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'staff')
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = uid AND is_admin = true
    )
    OR EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
      WHERE u.id = uid
    )
    OR public.is_admin();

  SELECT id, user_id, status
  INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found';
  END IF;

  IF session_rec.user_id IS NULL
     OR (session_rec.user_id <> uid AND NOT is_privileged) THEN
    RAISE EXCEPTION 'Unauthorized access to this checkout session';
  END IF;

  UPDATE public.checkout_sessions
  SET status = 'payment_cancelled',
      updated_at = now()
  WHERE id = session_rec.id
    AND status <> 'converted';

  UPDATE public.payment_attempts
  SET status = 'cancelled',
      failure_reason = COALESCE(_reason, failure_reason),
      updated_at = now()
  WHERE checkout_session_id = session_rec.id
    AND status <> 'captured';

  RETURN jsonb_build_object(
    'success', true,
    'session_id', _session_id,
    'status', 'payment_cancelled'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_checkout_session(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_session(text, text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. COD order ownership.
--    Existing order creation/deduction body is preserved under a private name.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.place_cod_order(text)
  RENAME TO place_cod_order_legacy_v00317;

REVOKE EXECUTE ON FUNCTION public.place_cod_order_legacy_v00317(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.place_cod_order(
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  session_user_id uuid;
  is_privileged boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN public.place_cod_order_legacy_v00317(_session_id);
  END IF;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  is_privileged :=
    public.has_role(uid, 'admin')
    OR public.has_role(uid, 'owner')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'staff')
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = uid AND is_admin = true
    )
    OR public.is_admin();

  SELECT user_id
  INTO session_user_id
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_user_id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found or not owned by an authenticated customer';
  END IF;

  IF session_user_id <> uid AND NOT is_privileged THEN
    RAISE EXCEPTION 'Unauthorized access to this checkout session';
  END IF;

  RETURN public.place_cod_order_legacy_v00317(_session_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_cod_order(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_cod_order(text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Customer abandoned-payment cancellation ownership.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.cancel_abandoned_order(uuid)
  RENAME TO cancel_abandoned_order_legacy_v00317;

REVOKE EXECUTE ON FUNCTION public.cancel_abandoned_order_legacy_v00317(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_abandoned_order(order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  ord public.orders%ROWTYPE;
  is_privileged boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    PERFORM public.cancel_abandoned_order_legacy_v00317(order_id);
    RETURN;
  END IF;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  is_privileged :=
    public.has_role(uid, 'admin')
    OR public.has_role(uid, 'owner')
    OR public.has_role(uid, 'manager')
    OR public.has_role(uid, 'staff')
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = uid AND is_admin = true
    )
    OR public.is_admin();

  SELECT *
  INTO ord
  FROM public.orders
  WHERE id = order_id
  FOR UPDATE;

  IF ord.id IS NULL THEN
    RETURN;
  END IF;

  IF (ord.user_id IS NULL OR ord.user_id <> uid) AND NOT is_privileged THEN
    RAISE EXCEPTION 'Unauthorized to cancel this order';
  END IF;

  PERFORM public.cancel_abandoned_order_legacy_v00317(order_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_abandoned_order(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Admin cancellation/deletion authorization.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.admin_cancel_order(uuid, text)
  RENAME TO admin_cancel_order_legacy_v00317;

ALTER FUNCTION public.admin_cancel_orders_bulk(uuid[], text)
  RENAME TO admin_cancel_orders_bulk_legacy_v00317;

ALTER FUNCTION public.admin_delete_order(uuid, boolean)
  RENAME TO admin_delete_order_legacy_v00317;

ALTER FUNCTION public.delete_cancelled_order(uuid)
  RENAME TO delete_cancelled_order_legacy_v00317;

ALTER FUNCTION public.delete_cancelled_orders_bulk(uuid[])
  RENAME TO delete_cancelled_orders_bulk_legacy_single_v00317;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_order_legacy_v00317(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_orders_bulk_legacy_v00317(uuid[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_delete_order_legacy_v00317(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.delete_cancelled_order_legacy_v00317(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.delete_cancelled_orders_bulk_legacy_single_v00317(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  order_id uuid,
  reason text DEFAULT 'Cancelled by Administrator'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = uid AND is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to cancel orders';
  END IF;

  RETURN public.admin_cancel_order_legacy_v00317(order_id, reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_orders_bulk(
  _order_ids uuid[],
  _reason text DEFAULT 'Bulk cancelled by Admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
  v_id uuid;
  v_res jsonb;
  v_cancelled_count int := 0;
  v_skipped_count int := 0;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
      OR EXISTS (
        SELECT 1 FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required';
  END IF;

  FOREACH v_id IN ARRAY _order_ids LOOP
    BEGIN
      v_res := public.admin_cancel_order_legacy_v00317(v_id, COALESCE(NULLIF(trim(_reason), ''), 'Bulk cancelled by Admin'));
      IF COALESCE((v_res->>'success')::boolean, false) THEN
        v_cancelled_count := v_cancelled_count + 1;
      ELSE
        v_skipped_count := v_skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', v_cancelled_count,
    'skipped_count', v_skipped_count,
    'total_requested', COALESCE(array_length(_order_ids, 1), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_order(
  _order_id uuid,
  _force boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = uid AND is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required';
  END IF;

  RETURN public.admin_delete_order_legacy_v00317(_order_id, _force);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cancelled_order(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.admin_delete_order(_order_id, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cancelled_orders_bulk(
  _order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
  v_id uuid;
  v_res jsonb;
  v_deleted_count int := 0;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_admin = true)
      OR EXISTS (
        SELECT 1 FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required';
  END IF;

  FOREACH v_id IN ARRAY _order_ids LOOP
    BEGIN
      v_res := public.admin_delete_order_legacy_v00317(v_id, true);
      IF COALESCE((v_res->>'success')::boolean, false) THEN
        v_deleted_count := v_deleted_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Preserve legacy bulk behavior: continue processing remaining orders.
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'total_requested', COALESCE(array_length(_order_ids, 1), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_cancelled_orders_bulk(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = uid AND is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required';
  END IF;

  RETURN public.delete_cancelled_orders_bulk_legacy_single_v00317(_order_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_order(uuid, text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_orders_bulk(uuid[], text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_order(uuid, boolean)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cancelled_order(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cancelled_orders_bulk(uuid[])
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_orders_bulk(uuid[], text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_order(uuid, boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_cancelled_order(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_cancelled_orders_bulk(uuid[])
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Secure POS customer/return administrative RPC entry points without
--    changing their existing implementations.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'search_pos_customers',
        'get_pos_customer_intel',
        'admin_hard_delete_offline_returns'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Secure store-credit lookup behind authenticated staff/admin access.
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.get_customer_store_credit(uuid, text, text)
  RENAME TO get_customer_store_credit_legacy_v00317;

REVOKE EXECUTE ON FUNCTION public.get_customer_store_credit_legacy_v00317(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT '',
  _token text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  is_authorized boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    is_authorized := true;
  ELSIF uid IS NOT NULL THEN
    is_authorized :=
      public.has_role(uid, 'admin')
      OR public.has_role(uid, 'owner')
      OR public.has_role(uid, 'manager')
      OR public.has_role(uid, 'staff')
      OR EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = uid AND is_admin = true
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        JOIN public.admin_allowlist a ON lower(u.email) = lower(a.email)
        WHERE u.id = uid
      )
      OR public.is_admin();
  END IF;

  IF NOT is_authorized THEN
    RAISE EXCEPTION 'Unauthorized: staff or administrator access required';
  END IF;

  RETURN public.get_customer_store_credit_legacy_v00317(
    _customer_id,
    _phone,
    _token
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_store_credit(uuid, text, text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Keep checkout session creation authenticated; retain service-role access.
-- -----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.create_checkout_session(
  jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_checkout_session(
  jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated, service_role;

-- Legacy customer-order creation remains available to authenticated users only.
REVOKE EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.place_order(
  text, text, text, text, text, text, text, jsonb, text, text, text, text, text, text, text
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
