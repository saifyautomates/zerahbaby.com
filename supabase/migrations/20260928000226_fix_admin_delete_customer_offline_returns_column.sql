-- ==============================================================================
-- Migration: 20260928000226_fix_admin_delete_customer_offline_returns_column.sql
-- Description:
-- Fix admin_delete_customer RPC: offline_returns uses 'created_by' instead of 'cashier_id'.
-- Ensures safe nullification of customer references across offline_returns without column errors.
-- ==============================================================================

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
  -- 1. DECOUPLE HISTORICAL ACCOUNTING & TRANSACTION RECORDS
  -- ==========================================================================

  -- Orders: keep all sales history intact with user_id = NULL
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
    UPDATE public.orders SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Payments: keep payment records intact with user_id = NULL
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
    UPDATE public.payments SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Coupon usage: keep coupon records intact with user_id = NULL
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coupon_usage') THEN
    UPDATE public.coupon_usage SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Order status history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_status_history') THEN
    UPDATE public.order_status_history SET changed_by = NULL WHERE changed_by = target_customer_id;
  END IF;

  -- Online returns & timeline
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'online_returns') THEN
    UPDATE public.online_returns 
    SET user_id = NULL,
        created_by = CASE WHEN created_by = target_customer_id THEN NULL ELSE created_by END,
        updated_by = CASE WHEN updated_by = target_customer_id THEN NULL ELSE updated_by END
    WHERE user_id = target_customer_id OR created_by = target_customer_id OR updated_by = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'online_return_timeline_events') THEN
    UPDATE public.online_return_timeline_events SET actor_id = NULL WHERE actor_id = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'open_box_otp_logs') THEN
    UPDATE public.open_box_otp_logs SET actor_id = NULL WHERE actor_id = target_customer_id;
  END IF;

  -- Offline sales & returns: keep all receipts and financial totals intact
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_sales') THEN
    UPDATE public.offline_sales 
    SET cashier_id = CASE WHEN cashier_id = target_customer_id THEN NULL ELSE cashier_id END,
        customer_id = CASE WHEN customer_id = target_customer_id THEN NULL ELSE customer_id END
    WHERE cashier_id = target_customer_id OR customer_id = target_customer_id;
  END IF;

  -- Offline returns: note offline_returns uses 'created_by' (cashier) and 'customer_id'
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_returns') THEN
    UPDATE public.offline_returns 
    SET customer_id = CASE WHEN customer_id = target_customer_id THEN NULL ELSE customer_id END,
        created_by = CASE WHEN created_by = target_customer_id THEN NULL ELSE created_by END
    WHERE customer_id = target_customer_id OR created_by = target_customer_id;
  END IF;

  -- Store credit ledger
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
    UPDATE public.store_credit_ledger 
    SET user_id = CASE WHEN user_id = target_customer_id THEN NULL ELSE user_id END,
        customer_id = CASE WHEN customer_id = target_customer_id THEN NULL ELSE customer_id END
    WHERE user_id = target_customer_id OR customer_id = target_customer_id;
  END IF;

  -- Checkout sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checkout_sessions') THEN
    UPDATE public.checkout_sessions SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- POS multi-cart cashier sessions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions') THEN
    UPDATE public.pos_cart_sessions SET cashier_id = NULL WHERE cashier_id = target_customer_id;
  END IF;

  -- Inventory transactions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_transactions') THEN
    UPDATE public.inventory_transactions SET changed_by = NULL WHERE changed_by = target_customer_id;
  END IF;

  -- Audit logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    UPDATE public.audit_logs SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Homepage CMS sections
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'homepage_sections') THEN
    UPDATE public.homepage_sections 
    SET created_by = CASE WHEN created_by = target_customer_id THEN NULL ELSE created_by END,
        updated_by = CASE WHEN updated_by = target_customer_id THEN NULL ELSE updated_by END
    WHERE created_by = target_customer_id OR updated_by = target_customer_id;
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
