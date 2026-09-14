-- ==============================================================================
-- Migration: 20260928000224_harden_admin_bulk_delete_customers.sql
-- Description:
-- Harden admin_bulk_delete_customers with upfront caller authentication
-- and admin authorization checks before processing customer array.
-- ==============================================================================

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

GRANT EXECUTE ON FUNCTION public.admin_bulk_delete_customers(uuid[]) TO authenticated;
