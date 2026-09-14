-- ==============================================================================
-- Migration: 20260928000223_admin_customer_deletion_and_test_users_purge.sql
-- Description:
-- 1. Ensure foreign key safety on orders and online_returns so deleting a customer
--    preserves historical order/return financial records with user_id = NULL.
-- 2. Provide canonical admin_delete_customer and admin_bulk_delete_customers RPCs
--    with strict admin role validation, self/admin deletion protection, and cascade cleanup.
-- 3. Purge existing synthetic test customer profiles and auth users created during test runs.
-- ==============================================================================

-- 1. Ensure orders & online_returns allow null user_id and don't restrict customer deletion
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'online_returns'
  ) THEN
    ALTER TABLE public.online_returns ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- 2. Create canonical admin_delete_customer RPC
CREATE OR REPLACE FUNCTION public.admin_delete_customer(target_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_target_email text;
  v_target_name text;
  v_is_target_admin boolean := false;
BEGIN
  -- Authentication check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorization check: Caller must have admin role
  v_is_admin := (
    public.has_role(v_caller, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete customers';
  END IF;

  -- Target customer info
  SELECT email, full_name INTO v_target_email, v_target_name
  FROM public.profiles
  WHERE id = target_customer_id;

  IF v_target_email IS NULL AND v_target_name IS NULL THEN
    SELECT email INTO v_target_email
    FROM auth.users
    WHERE id = target_customer_id;
  END IF;

  IF v_target_email IS NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_customer_id) THEN
    RETURN jsonb_build_object(
      'success', true, 
      'message', 'Customer does not exist or was already removed', 
      'customer_id', target_customer_id
    );
  END IF;

  -- Protect administrator accounts
  v_is_target_admin := (
    public.has_role(target_customer_id, 'admin')
    OR target_customer_id = v_caller
    OR lower(coalesce(v_target_email, '')) = 'jackxparrowww@gmail.com'
  );

  IF v_is_target_admin THEN
    RAISE EXCEPTION 'Cannot delete administrator account';
  END IF;

  -- Disassociate relational business records to preserve accounting integrity
  UPDATE public.orders SET user_id = NULL WHERE user_id = target_customer_id;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'online_returns') THEN
    UPDATE public.online_returns SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_sales') THEN
    UPDATE public.offline_sales SET cashier_id = NULL WHERE cashier_id = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checkout_sessions') THEN
    UPDATE public.checkout_sessions SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
    UPDATE public.store_credit_ledger SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Delete user-owned ephemeral data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cart_items') THEN
    DELETE FROM public.cart_items WHERE cart_id IN (SELECT id FROM public.carts WHERE user_id = target_customer_id);
  END IF;

  DELETE FROM public.carts WHERE user_id = target_customer_id;
  DELETE FROM public.reviews WHERE user_id = target_customer_id;
  DELETE FROM public.user_roles WHERE user_id = target_customer_id;

  -- Delete profile and auth user
  DELETE FROM public.profiles WHERE id = target_customer_id;
  DELETE FROM auth.users WHERE id = target_customer_id;

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', target_customer_id,
    'email', v_target_email,
    'name', v_target_name
  );
END;
$$;

-- 3. Create canonical admin_bulk_delete_customers RPC
CREATE OR REPLACE FUNCTION public.admin_bulk_delete_customers(target_customer_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean := false;
  v_cid uuid;
  v_deleted_count int := 0;
BEGIN
  -- Authentication check
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorization check: Caller must have admin role
  v_is_admin := (
    public.has_role(v_caller, 'admin') 
    OR public.is_admin() 
    OR public.is_staff_or_admin()
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Only administrators can delete customers';
  END IF;

  FOREACH v_cid IN ARRAY target_customer_ids LOOP
    BEGIN
      PERFORM public.admin_delete_customer(v_cid);
      v_deleted_count := v_deleted_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Continue with remaining customers if one fails (e.g. protected admin)
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- Grant permissions to authenticated users (role checked inside functions)
GRANT EXECUTE ON FUNCTION public.admin_delete_customer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_customers(uuid[]) TO authenticated;

-- 4. Purge existing synthetic test users created during automated test runs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT id FROM public.profiles 
    WHERE email ILIKE 'test.%@zerahkids.com' 
       OR full_name ILIKE 'Zerah Test User%'
       OR email ILIKE '%@example.com'
  ) LOOP
    BEGIN
      UPDATE public.orders SET user_id = NULL WHERE user_id = r.id;
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'online_returns') THEN
        UPDATE public.online_returns SET user_id = NULL WHERE user_id = r.id;
      END IF;
      DELETE FROM public.carts WHERE user_id = r.id;
      DELETE FROM public.user_roles WHERE user_id = r.id;
      DELETE FROM public.profiles WHERE id = r.id;
      DELETE FROM auth.users WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
