-- ==============================================================================
-- Migration: 20260928000227_fix_admin_delete_customer_changed_by_column.sql
-- Description:
-- Fix admin_delete_customer RPC:
-- 1. inventory_transactions uses 'created_by' (NOT 'changed_by').
-- 2. order_status_history uses 'changed_by' - ensured column exists and guarded.
-- 3. Dynamic schema-safe decoupling across all audit/transaction tables so that
--    customer deletion succeeds reliably without runtime column mismatch errors.
-- ==============================================================================

-- 1. Ensure columns exist and nullable where appropriate
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_status_history') THEN
    ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS changed_by uuid REFERENCES auth.users(id);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_transactions') THEN
    ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
    ALTER TABLE public.inventory_transactions ALTER COLUMN created_by DROP NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_order_deletion_logs' AND column_name = 'deleted_by') THEN
    ALTER TABLE public.admin_order_deletion_logs ALTER COLUMN deleted_by DROP NOT NULL;
  END IF;
END $$;

-- 2. Update canonical admin_delete_customer RPC
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
  -- Authentication check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Caller email lookup
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL THEN
    SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller;
  END IF;

  -- Authorization check: Caller must have admin role
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
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete customers';
  END IF;

  -- Target customer lookup
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

  -- If customer already does not exist anywhere, return clean success
  IF v_target_email IS NULL 
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_customer_id)
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_customer_id)
     AND NOT EXISTS (SELECT 1 FROM public.pos_customers WHERE id = target_customer_id) THEN
    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Customer does not exist or was already removed', 
      'customer_id', target_customer_id
    );
  END IF;

  -- Protect administrator and staff accounts
  v_is_target_admin := (
    public.has_role(target_customer_id, 'admin')
    OR target_customer_id = v_caller
    OR lower(coalesce(v_target_email, '')) = 'jackxparrowww@gmail.com'
    OR lower(coalesce(v_target_email, '')) = 'hello@zerahkids.com'
    OR EXISTS (
      SELECT 1 FROM public.admin_allowlist 
      WHERE lower(trim(email)) = lower(trim(coalesce(v_target_email, '')))
    )
  );

  IF v_is_target_admin THEN
    RAISE EXCEPTION 'Cannot delete an administrator account';
  END IF;

  -- ==========================================================================
  -- 1. DECOUPLE HISTORICAL ACCOUNTING & TRANSACTION RECORDS (DYNAMIC SQL)
  -- ==========================================================================

  -- Orders: preserve financial & sales history with user_id = NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'user_id') THEN
    UPDATE public.orders SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_by') THEN
    EXECUTE 'UPDATE public.orders SET cancelled_by = NULL WHERE cancelled_by = $1' USING target_customer_id;
  END IF;

  -- Payments: keep payment records intact
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'user_id') THEN
    UPDATE public.payments SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Coupon usage: keep coupon accounting intact
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupon_usage' AND column_name = 'user_id') THEN
    UPDATE public.coupon_usage SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Order status history: check for changed_by
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'order_status_history' AND column_name = 'changed_by') THEN
    EXECUTE 'UPDATE public.order_status_history SET changed_by = NULL WHERE changed_by = $1' USING target_customer_id;
  END IF;

  -- Online returns & timeline
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'online_returns') THEN
    EXECUTE $dyn$
      UPDATE public.online_returns 
      SET user_id = NULL,
          created_by = CASE WHEN created_by = $1 THEN NULL ELSE created_by END,
          updated_by = CASE WHEN updated_by = $1 THEN NULL ELSE updated_by END
      WHERE user_id = $1 OR created_by = $1 OR updated_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'online_return_timeline_events' AND column_name = 'actor_id') THEN
    EXECUTE 'UPDATE public.online_return_timeline_events SET actor_id = NULL WHERE actor_id = $1' USING target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'open_box_otp_logs' AND column_name = 'actor_id') THEN
    EXECUTE 'UPDATE public.open_box_otp_logs SET actor_id = NULL WHERE actor_id = $1' USING target_customer_id;
  END IF;

  -- Offline sales & returns: keep all receipts and financial totals intact
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_sales') THEN
    EXECUTE $dyn$
      UPDATE public.offline_sales 
      SET cashier_id = CASE WHEN cashier_id = $1 THEN NULL ELSE cashier_id END,
          customer_id = CASE WHEN customer_id = $1 THEN NULL ELSE customer_id END
      WHERE cashier_id = $1 OR customer_id = $1
    $dyn$ USING target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'voided_by') THEN
    EXECUTE 'UPDATE public.offline_sales SET voided_by = NULL WHERE voided_by = $1' USING target_customer_id;
  END IF;

  -- Offline returns: note offline_returns uses 'created_by' (cashier) and 'customer_id'
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_returns') THEN
    EXECUTE $dyn$
      UPDATE public.offline_returns 
      SET customer_id = CASE WHEN customer_id = $1 THEN NULL ELSE customer_id END,
          created_by = CASE WHEN created_by = $1 THEN NULL ELSE created_by END
      WHERE customer_id = $1 OR created_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  -- Store credit ledger
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
    EXECUTE $dyn$
      UPDATE public.store_credit_ledger 
      SET user_id = CASE WHEN user_id = $1 THEN NULL ELSE user_id END,
          customer_id = CASE WHEN customer_id = $1 THEN NULL ELSE customer_id END
      WHERE user_id = $1 OR customer_id = $1
    $dyn$ USING target_customer_id;
  END IF;

  -- Checkout sessions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_sessions' AND column_name = 'user_id') THEN
    EXECUTE 'UPDATE public.checkout_sessions SET user_id = NULL WHERE user_id = $1' USING target_customer_id;
  END IF;

  -- POS multi-cart cashier sessions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions' AND column_name = 'cashier_id') THEN
    EXECUTE 'UPDATE public.pos_cart_sessions SET cashier_id = NULL WHERE cashier_id = $1' USING target_customer_id;
  END IF;

  -- Inventory transactions: decouple created_by (NOT changed_by)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'created_by') THEN
    EXECUTE 'UPDATE public.inventory_transactions SET created_by = NULL WHERE created_by = $1' USING target_customer_id;
  END IF;

  -- Audit logs
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'user_id') THEN
    EXECUTE 'UPDATE public.audit_logs SET user_id = NULL WHERE user_id = $1' USING target_customer_id;
  END IF;

  -- Admin order deletion logs
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

  -- ==========================================================================
  -- 2. PURGE EPHEMERAL DATA OWNED BY TARGET CUSTOMER
  -- ==========================================================================

  -- Cart items & Carts
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart_items') THEN
    DELETE FROM public.cart_items 
    WHERE cart_id IN (SELECT id FROM public.carts WHERE user_id = target_customer_id);
  END IF;
  DELETE FROM public.carts WHERE user_id = target_customer_id;

  -- Wishlist items & Wishlists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wishlist_items') THEN
    DELETE FROM public.wishlist_items 
    WHERE wishlist_id IN (SELECT id FROM public.wishlists WHERE user_id = target_customer_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wishlists') THEN
    DELETE FROM public.wishlists WHERE user_id = target_customer_id;
  END IF;

  -- User addresses & Reviews
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_addresses') THEN
    DELETE FROM public.user_addresses WHERE user_id = target_customer_id;
  END IF;
  DELETE FROM public.reviews WHERE user_id = target_customer_id;

  -- User roles
  DELETE FROM public.user_roles WHERE user_id = target_customer_id;

  -- ==========================================================================
  -- 3. REMOVE CUSTOMER PROFILE, POS RECORD, AND AUTH USER
  -- ==========================================================================

  -- POS customer record
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_customers') THEN
    DELETE FROM public.pos_customers WHERE id = target_customer_id;
  END IF;

  -- Storefront profile
  DELETE FROM public.profiles WHERE id = target_customer_id;

  -- Supabase auth user
  DELETE FROM auth.users WHERE id = target_customer_id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', target_customer_id,
    'email', v_target_email,
    'name', v_target_name
  );
END;
$$;

-- Re-grant execute permissions
GRANT EXECUTE ON FUNCTION public.admin_delete_customer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_customers(uuid[]) TO authenticated;
