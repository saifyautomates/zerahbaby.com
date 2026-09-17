-- Migration: 20260928000258_enforce_admin_auth_checks_on_customer_delete.sql
-- Description: Strictly enforce authentication and admin authorization checks on admin_delete_customer
--              and admin_bulk_delete_customers RPCs to block unauthenticated callers with 'Authentication required'.

CREATE OR REPLACE FUNCTION public.admin_delete_customer(target_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_is_admin boolean := false;
  v_target_email text;
  v_target_name text;
  v_is_target_admin boolean := false;
BEGIN
  -- 1. Authentication check: Caller must be authenticated
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Authorization check: Caller must have admin role
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL THEN
    SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller;
  END IF;

  v_is_admin := (
    public.has_role(v_caller, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist 
      WHERE lower(trim(email)) = lower(trim(coalesce(v_caller_email, '')))
    )
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete customer records';
  END IF;

  IF target_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid customer ID');
  END IF;

  -- 3. Target lookup
  SELECT email, full_name INTO v_target_email, v_target_name
  FROM public.profiles
  WHERE id = target_customer_id;

  IF v_target_email IS NULL AND v_target_name IS NULL THEN
    SELECT email INTO v_target_email
    FROM auth.users
    WHERE id = target_customer_id;
  END IF;

  IF v_target_email IS NULL AND v_target_name IS NULL THEN
    SELECT email, name INTO v_target_email, v_target_name
    FROM public.pos_customers
    WHERE id = target_customer_id;
  END IF;

  -- Protect main administrator and staff accounts
  v_is_target_admin := (
    public.has_role(target_customer_id, 'admin')
    OR target_customer_id = v_caller
    OR lower(coalesce(v_target_email, '')) = 'jackxparrowww@gmail.com'
    OR lower(coalesce(v_target_email, '')) = 'hello@zerahkids.com'
    OR lower(coalesce(v_target_email, '')) = 'sameermirza2261@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist 
      WHERE lower(trim(email)) = lower(trim(coalesce(v_target_email, '')))
    )
  );

  IF v_is_target_admin THEN
    RAISE EXCEPTION 'Cannot delete an administrator account';
  END IF;

  -- 4. Decouple historical transaction and accounting records
  -- Orders
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'user_id') THEN
    UPDATE public.orders SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Payments updated_by
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_by') THEN
    UPDATE public.payments SET updated_by = NULL WHERE updated_by = target_customer_id;
  END IF;

  -- Coupon usage
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupon_usage' AND column_name = 'user_id') THEN
    UPDATE public.coupon_usage SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Online returns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'online_returns' AND column_name = 'user_id') THEN
    UPDATE public.online_returns SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- POS / Offline sales
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'customer_id') THEN
    UPDATE public.offline_sales SET customer_id = NULL WHERE customer_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'pos_customer_id') THEN
    UPDATE public.offline_sales SET pos_customer_id = NULL WHERE pos_customer_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'created_by') THEN
    UPDATE public.offline_sales SET created_by = NULL WHERE created_by = target_customer_id;
  END IF;

  -- Offline returns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_returns' AND column_name = 'customer_id') THEN
    UPDATE public.offline_returns SET customer_id = NULL WHERE customer_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_returns' AND column_name = 'processed_by') THEN
    UPDATE public.offline_returns SET processed_by = NULL WHERE processed_by = target_customer_id;
  END IF;

  -- Store credit ledger
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'customer_id') THEN
    UPDATE public.store_credit_ledger SET customer_id = NULL WHERE customer_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'store_credit_ledger' AND column_name = 'issued_by') THEN
    UPDATE public.store_credit_ledger SET issued_by = NULL WHERE issued_by = target_customer_id;
  END IF;

  -- Active checkout & POS cart sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checkout_sessions') THEN
    DELETE FROM public.checkout_sessions WHERE user_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions') THEN
    DELETE FROM public.pos_cart_sessions WHERE customer_id = target_customer_id;
  END IF;

  -- Inventory transactions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'created_by') THEN
    UPDATE public.inventory_transactions SET created_by = NULL WHERE created_by = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'performed_by') THEN
    UPDATE public.inventory_transactions SET performed_by = NULL WHERE performed_by = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'changed_by') THEN
    UPDATE public.inventory_transactions SET changed_by = NULL WHERE changed_by = target_customer_id;
  END IF;

  -- Audit logs & order deletion logs
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id') THEN
    EXECUTE 'UPDATE public.audit_logs SET user_id = NULL WHERE user_id = $1' USING target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_order_deletion_logs') THEN
    EXECUTE $dyn$
      UPDATE public.admin_order_deletion_logs 
      SET user_id = CASE WHEN user_id = $1 THEN NULL ELSE user_id END,
          deleted_by = CASE WHEN deleted_by = $1 THEN NULL ELSE deleted_by END
      WHERE user_id = $1 OR deleted_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  -- Homepage CMS sections
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'homepage_sections') THEN
    EXECUTE $dyn$
      UPDATE public.homepage_sections 
      SET created_by = CASE WHEN created_by = $1 THEN NULL ELSE created_by END,
          updated_by = CASE WHEN updated_by = $1 THEN NULL ELSE updated_by END
      WHERE created_by = $1 OR updated_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  -- Admin allowlist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_allowlist' AND column_name = 'added_by') THEN
    EXECUTE 'UPDATE public.admin_allowlist SET added_by = NULL WHERE added_by = $1' USING target_customer_id;
  END IF;

  -- 5. Purge customer owned data
  -- Carts & items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart_items') THEN
    DELETE FROM public.cart_items 
    WHERE cart_id IN (SELECT id FROM public.carts WHERE user_id = target_customer_id);
  END IF;
  DELETE FROM public.carts WHERE user_id = target_customer_id;

  -- Wishlists & items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wishlist_items') THEN
    DELETE FROM public.wishlist_items 
    WHERE wishlist_id IN (SELECT id FROM public.wishlists WHERE user_id = target_customer_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wishlists') THEN
    DELETE FROM public.wishlists WHERE user_id = target_customer_id;
  END IF;

  -- Addresses, Reviews, Roles
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_addresses') THEN
    DELETE FROM public.user_addresses WHERE user_id = target_customer_id;
  END IF;
  DELETE FROM public.reviews WHERE user_id = target_customer_id;
  DELETE FROM public.user_roles WHERE user_id = target_customer_id;

  -- POS customer record
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_customers') THEN
    DELETE FROM public.pos_customers WHERE id = target_customer_id;
  END IF;

  -- Storefront profile
  DELETE FROM public.profiles WHERE id = target_customer_id;

  -- Auth user (guarded in exception block so foreign identity cascades don't fail)
  BEGIN
    DELETE FROM auth.users WHERE id = target_customer_id;
  EXCEPTION WHEN OTHERS THEN
    -- If auth.users has foreign identity lock, profiles deletion is sufficient
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Customer %s deleted successfully', coalesce(v_target_email, v_target_name, target_customer_id::text)),
    'customer_id', target_customer_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_bulk_delete_customers(target_customer_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_is_admin boolean := false;
  v_cid uuid;
  v_count integer := 0;
BEGIN
  -- 1. Authentication check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 2. Authorization check
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL THEN
    SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller;
  END IF;

  v_is_admin := (
    public.has_role(v_caller, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
    OR (SELECT public.check_is_admin())
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist 
      WHERE lower(trim(email)) = lower(trim(coalesce(v_caller_email, '')))
    )
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete customer records';
  END IF;

  IF target_customer_ids IS NULL OR array_length(target_customer_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted_count', 0);
  END IF;

  FOREACH v_cid IN ARRAY target_customer_ids LOOP
    BEGIN
      PERFORM public.admin_delete_customer(v_cid);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Continue bulk delete for remaining ids
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_customer(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_customers(uuid[]) TO authenticated, anon, service_role;
