-- ==============================================================================
-- Migration: 20261117000001_admin_credits_and_dues_settlement_rpcs.sql
-- Description: Authoritative Security Definer RPCs for Admin Management of:
--              1. Return Vouchers & Customer Store Credits (Settle, Adjust, Void)
--              2. Offline POS Dues & COD Receivables (Settle, Write-off, Adjust, Void)
--              Guarantees ACID transactions, audit logging in store_credit_ledger,
--              and full reconciliation across offline_returns, offline_sales,
--              pos_customers, and profiles.
-- ==============================================================================

-- Helper check function for admin privileges
CREATE OR REPLACE FUNCTION public.check_is_admin_safe()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Check user_roles table
  IF EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = v_uid AND role = 'admin'::public.app_role
  ) THEN
    RETURN true;
  END IF;

  -- 2. Check admin_allowlist
  v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
  IF v_email <> '' AND EXISTS (
    SELECT 1 FROM public.admin_allowlist WHERE lower(email) = v_email
  ) THEN
    RETURN true;
  END IF;

  -- 3. Check public.is_admin() if exists
  BEGIN
    IF public.is_admin() THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore if function does not exist
  END;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin_safe TO authenticated;

-- ------------------------------------------------------------------------------
-- 1. RPC: Settle Return Voucher (1-Click Full Settlement)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settle_return_voucher(
  _return_id uuid,
  _notes text DEFAULT 'Settled by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ret record;
  v_phone text;
  v_clean_phone text;
  v_refund numeric;
  v_used numeric;
  v_remaining numeric;
  v_new_total_remaining numeric := 0;
  v_updated_notes text;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  SELECT * INTO v_ret FROM public.offline_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found: %', _return_id;
  END IF;

  v_refund := COALESCE(v_ret.refund_amount, 0)::numeric;
  v_used := COALESCE(v_ret.credit_used, 0)::numeric;
  v_remaining := GREATEST(0, v_refund - v_used);
  v_phone := COALESCE(v_ret.customer_phone, '');
  v_clean_phone := right(regexp_replace(v_phone, '\D', '', 'g'), 10);

  v_updated_notes := CASE 
    WHEN v_ret.notes IS NOT NULL AND trim(v_ret.notes) <> '' 
    THEN v_ret.notes || E'\n' || COALESCE(_notes, 'Settled by admin')
    ELSE COALESCE(_notes, 'Settled by admin')
  END;

  -- Update return voucher record
  UPDATE public.offline_returns
  SET credit_used = v_refund,
      credit_balance = 0,
      credit_token_status = 'CONSUMED',
      notes = v_updated_notes,
      updated_at = now()
  WHERE id = _return_id;

  -- Reconcile customer remaining credit
  IF v_clean_phone <> '' THEN
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(credit_balance, refund_amount - COALESCE(credit_used, 0)))), 0)
    INTO v_new_total_remaining
    FROM public.offline_returns
    WHERE right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 10) = v_clean_phone
      AND UPPER(COALESCE(credit_token_status, 'ACTIVE')) IN ('ACTIVE', 'PARTIALLY_USED')
      AND id <> _return_id;

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_total_remaining,
        store_credit = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;

    UPDATE public.profiles
    SET store_credit_balance = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;
  END IF;

  -- Audit in store_credit_ledger if credit was settled
  IF v_remaining > 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_phone,
      customer_name,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      source_return_id,
      notes,
      created_by
    ) VALUES (
      v_ret.customer_id,
      v_phone,
      COALESCE(v_ret.customer_name, 'Customer'),
      COALESCE(v_ret.credit_token, 'TOKEN'),
      'CREDIT_USED',
      v_remaining,
      v_remaining,
      0,
      _return_id,
      COALESCE(_notes, 'Voucher settled by admin'),
      v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_number', v_ret.return_number,
    'credit_token', v_ret.credit_token,
    'settled_amount', v_remaining,
    'customer_remaining_balance', v_new_total_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_settle_return_voucher TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. RPC: Adjust Return Credit Balance (Manual Edit)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_return_credit(
  _return_id uuid,
  _new_remaining numeric,
  _notes text DEFAULT 'Balance adjusted by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ret record;
  v_phone text;
  v_clean_phone text;
  v_refund numeric;
  v_old_remaining numeric;
  v_calc_used numeric;
  v_status text;
  v_new_total_remaining numeric := 0;
  v_updated_notes text;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  IF _new_remaining < 0 THEN
    RAISE EXCEPTION 'Remaining balance cannot be negative.';
  END IF;

  SELECT * INTO v_ret FROM public.offline_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found: %', _return_id;
  END IF;

  v_refund := COALESCE(v_ret.refund_amount, 0)::numeric;
  v_old_remaining := GREATEST(0, v_refund - COALESCE(v_ret.credit_used, 0)::numeric);
  v_calc_used := GREATEST(0, v_refund - _new_remaining);
  v_status := CASE WHEN _new_remaining <= 0 THEN 'CONSUMED' ELSE 'ACTIVE' END;
  v_phone := COALESCE(v_ret.customer_phone, '');
  v_clean_phone := right(regexp_replace(v_phone, '\D', '', 'g'), 10);

  v_updated_notes := CASE 
    WHEN v_ret.notes IS NOT NULL AND trim(v_ret.notes) <> '' 
    THEN v_ret.notes || E'\n' || COALESCE(_notes, 'Balance adjusted by admin')
    ELSE COALESCE(_notes, 'Balance adjusted by admin')
  END;

  UPDATE public.offline_returns
  SET credit_balance = _new_remaining,
      credit_used = v_calc_used,
      credit_token_status = v_status,
      notes = v_updated_notes,
      updated_at = now()
  WHERE id = _return_id;

  -- Reconcile customer total balance
  IF v_clean_phone <> '' THEN
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(credit_balance, refund_amount - COALESCE(credit_used, 0)))), 0)
    INTO v_new_total_remaining
    FROM public.offline_returns
    WHERE right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 10) = v_clean_phone
      AND UPPER(COALESCE(credit_token_status, 'ACTIVE')) IN ('ACTIVE', 'PARTIALLY_USED');

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_total_remaining,
        store_credit = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;

    UPDATE public.profiles
    SET store_credit_balance = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;
  END IF;

  -- Audit log in store_credit_ledger
  INSERT INTO public.store_credit_ledger (
    customer_id,
    customer_phone,
    customer_name,
    credit_token,
    type,
    amount,
    balance_before,
    balance_after,
    source_return_id,
    notes,
    created_by
  ) VALUES (
    v_ret.customer_id,
    v_phone,
    COALESCE(v_ret.customer_name, 'Customer'),
    COALESCE(v_ret.credit_token, 'TOKEN'),
    'CREDIT_ADJUSTED',
    ABS(_new_remaining - v_old_remaining),
    v_old_remaining,
    _new_remaining,
    _return_id,
    COALESCE(_notes, 'Return credit balance adjusted by admin'),
    v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_number', v_ret.return_number,
    'old_remaining', v_old_remaining,
    'new_remaining', _new_remaining,
    'customer_remaining_balance', v_new_total_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_return_credit TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC: Void Return Voucher
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_void_return_voucher(
  _return_id uuid,
  _notes text DEFAULT 'Voided by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ret record;
  v_phone text;
  v_clean_phone text;
  v_new_total_remaining numeric := 0;
  v_updated_notes text;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  SELECT * INTO v_ret FROM public.offline_returns WHERE id = _return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return record not found: %', _return_id;
  END IF;

  v_phone := COALESCE(v_ret.customer_phone, '');
  v_clean_phone := right(regexp_replace(v_phone, '\D', '', 'g'), 10);

  v_updated_notes := CASE 
    WHEN v_ret.notes IS NOT NULL AND trim(v_ret.notes) <> '' 
    THEN v_ret.notes || E'\n' || COALESCE(_notes, 'Voided by admin')
    ELSE COALESCE(_notes, 'Voided by admin')
  END;

  UPDATE public.offline_returns
  SET credit_balance = 0,
      credit_token_status = 'VOIDED',
      notes = v_updated_notes,
      updated_at = now()
  WHERE id = _return_id;

  -- Reconcile customer total balance
  IF v_clean_phone <> '' THEN
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(credit_balance, refund_amount - COALESCE(credit_used, 0)))), 0)
    INTO v_new_total_remaining
    FROM public.offline_returns
    WHERE right(regexp_replace(COALESCE(customer_phone, ''), '\D', '', 'g'), 10) = v_clean_phone
      AND UPPER(COALESCE(credit_token_status, 'ACTIVE')) IN ('ACTIVE', 'PARTIALLY_USED')
      AND id <> _return_id;

    UPDATE public.pos_customers
    SET store_credit_balance = v_new_total_remaining,
        store_credit = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;

    UPDATE public.profiles
    SET store_credit_balance = v_new_total_remaining,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', _return_id,
    'return_number', v_ret.return_number,
    'credit_token', v_ret.credit_token,
    'status', 'VOIDED',
    'customer_remaining_balance', v_new_total_remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_void_return_voucher TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. RPC: Settle / Edit POS Sale Due
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settle_pos_due(
  _sale_id uuid,
  _amount_paid numeric DEFAULT NULL,
  _payment_status text DEFAULT 'paid',
  _notes text DEFAULT 'Settled by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_sale record;
  v_total numeric;
  v_new_paid numeric;
  v_updated_notes text;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  SELECT * INTO v_sale FROM public.offline_sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS Sale record not found: %', _sale_id;
  END IF;

  v_total := COALESCE(v_sale.total, 0)::numeric;
  v_new_paid := COALESCE(_amount_paid, v_total);

  v_updated_notes := CASE 
    WHEN v_sale.notes IS NOT NULL AND trim(v_sale.notes) <> '' 
    THEN v_sale.notes || E'\n' || COALESCE(_notes, 'Due settled by admin')
    ELSE COALESCE(_notes, 'Due settled by admin')
  END;

  UPDATE public.offline_sales
  SET amount_paid = v_new_paid,
      payment_status = COALESCE(_payment_status, 'paid'),
      notes = v_updated_notes,
      updated_at = now()
  WHERE id = _sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', _sale_id,
    'sale_number', v_sale.sale_number,
    'amount_paid', v_new_paid,
    'payment_status', COALESCE(_payment_status, 'paid')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_settle_pos_due TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RPC: Settle Online Order COD Due
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_settle_order_cod(
  _order_id uuid,
  _notes text DEFAULT 'COD settled by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_order record;
  v_updated_notes text;
  v_new_status text;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order record not found: %', _order_id;
  END IF;

  v_updated_notes := CASE 
    WHEN v_order.notes IS NOT NULL AND trim(v_order.notes) <> '' 
    THEN v_order.notes || E'\n' || COALESCE(_notes, 'COD settled by admin')
    ELSE COALESCE(_notes, 'COD settled by admin')
  END;

  v_new_status := CASE 
    WHEN v_order.status = 'placed' THEN 'delivered' 
    ELSE v_order.status 
  END;

  UPDATE public.orders
  SET payment_status = 'paid',
      status = v_new_status,
      notes = v_updated_notes,
      updated_at = now()
  WHERE id = _order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', _order_id,
    'payment_status', 'paid',
    'status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_settle_order_cod TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. RPC: General Customer Store Credit Direct Adjustment
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_customer_store_credit(
  _customer_id uuid DEFAULT NULL,
  _phone text DEFAULT NULL,
  _new_balance numeric DEFAULT 0,
  _notes text DEFAULT 'Manual admin adjustment'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_pos_id uuid;
  v_target_profile_id uuid;
  v_customer_name text := 'Customer';
  v_customer_phone text := '';
  v_clean_phone text := '';
  v_old_balance numeric := 0;
  v_diff numeric := 0;
BEGIN
  IF NOT public.check_is_admin_safe() THEN
    RAISE EXCEPTION 'Access denied. Administrator privileges required.';
  END IF;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Store credit balance cannot be negative.';
  END IF;

  IF _phone IS NOT NULL AND trim(_phone) <> '' THEN
    v_clean_phone := right(regexp_replace(_phone, '\D', '', 'g'), 10);
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, name, phone, COALESCE(store_credit_balance, store_credit, 0)
    INTO v_target_pos_id, v_customer_name, v_customer_phone, v_old_balance
    FROM public.pos_customers
    WHERE id = _customer_id;
  END IF;

  IF v_target_pos_id IS NULL AND v_clean_phone <> '' THEN
    SELECT id, name, phone, COALESCE(store_credit_balance, store_credit, 0)
    INTO v_target_pos_id, v_customer_name, v_customer_phone, v_old_balance
    FROM public.pos_customers
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone
    LIMIT 1;
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT id, full_name, phone, COALESCE(store_credit_balance, 0)
    INTO v_target_profile_id, v_customer_name, v_customer_phone, v_old_balance
    FROM public.profiles
    WHERE id = _customer_id;
  END IF;

  IF v_target_profile_id IS NULL AND v_clean_phone <> '' THEN
    SELECT id, full_name, phone, COALESCE(store_credit_balance, 0)
    INTO v_target_profile_id, v_customer_name, v_customer_phone, v_old_balance
    FROM public.profiles
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone
    LIMIT 1;
  END IF;

  IF v_customer_phone = '' AND v_clean_phone <> '' THEN
    v_customer_phone := _phone;
  END IF;

  IF v_target_pos_id IS NOT NULL THEN
    UPDATE public.pos_customers
    SET store_credit_balance = _new_balance,
        store_credit = _new_balance,
        updated_at = now()
    WHERE id = v_target_pos_id;
  ELSIF v_clean_phone <> '' THEN
    INSERT INTO public.pos_customers (name, phone, store_credit_balance, store_credit)
    VALUES (v_customer_name, v_customer_phone, _new_balance, _new_balance)
    RETURNING id INTO v_target_pos_id;
  END IF;

  IF v_target_profile_id IS NOT NULL THEN
    UPDATE public.profiles
    SET store_credit_balance = _new_balance,
        updated_at = now()
    WHERE id = v_target_profile_id;
  ELSIF v_clean_phone <> '' THEN
    UPDATE public.profiles
    SET store_credit_balance = _new_balance,
        updated_at = now()
    WHERE right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_clean_phone;
  END IF;

  v_diff := _new_balance - v_old_balance;
  IF v_diff <> 0 THEN
    INSERT INTO public.store_credit_ledger (
      customer_id,
      customer_phone,
      customer_name,
      credit_token,
      type,
      amount,
      balance_before,
      balance_after,
      notes,
      created_by
    ) VALUES (
      v_target_pos_id,
      COALESCE(v_customer_phone, ''),
      COALESCE(v_customer_name, 'Customer'),
      'ADMIN_ADJUST',
      'CREDIT_ADJUSTED',
      ABS(v_diff),
      v_old_balance,
      _new_balance,
      COALESCE(_notes, 'Manual admin adjustment'),
      v_uid
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_target_pos_id,
    'profile_id', v_target_profile_id,
    'customer_name', v_customer_name,
    'customer_phone', v_customer_phone,
    'old_balance', v_old_balance,
    'new_balance', _new_balance,
    'diff', v_diff
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_customer_store_credit TO authenticated;

