-- Migration: 20260928000257_fix_customer_product_sales_deletion_and_performance.sql
-- Description: Comprehensive fix for Customer Deletion, Product Deletion, POS Sales Deletion,
--              FK cascade safety, and database performance indexing.

-- ============================================================================
-- 1. SCHEMA SAFETY & NULLABILITY FOR DECOUPLING HISTORICAL DATA
-- ============================================================================

-- Ensure created_by on offline_sales is nullable so cashier/staff deletion does not violate NOT NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.offline_sales ALTER COLUMN created_by DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE public.payments ALTER COLUMN updated_by DROP NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. CANONICAL CUSTOMER DELETION RPCS (admin_delete_customer & admin_bulk_delete_customers)
-- ============================================================================

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
  -- 1. Authorization check
  IF v_caller IS NOT NULL THEN
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
  END IF;

  IF target_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid customer ID');
  END IF;

  -- 2. Target lookup
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
    OR (v_caller IS NOT NULL AND target_customer_id = v_caller)
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

  -- 3. Decouple historical transaction and accounting records
  -- Orders
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'user_id') THEN
    UPDATE public.orders SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_by') THEN
    EXECUTE 'UPDATE public.orders SET cancelled_by = NULL WHERE cancelled_by = $1' USING target_customer_id;
  END IF;

  -- Payments
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'user_id') THEN
    UPDATE public.payments SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_by') THEN
    UPDATE public.payments SET updated_by = NULL WHERE updated_by = target_customer_id;
  END IF;

  -- Coupon usage
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'coupon_usage' AND column_name = 'user_id') THEN
    UPDATE public.coupon_usage SET user_id = NULL WHERE user_id = target_customer_id;
  END IF;

  -- Order status history
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

  -- Offline sales & returns
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_sales') THEN
    EXECUTE $dyn$
      UPDATE public.offline_sales 
      SET cashier_id = CASE WHEN cashier_id = $1 THEN NULL ELSE cashier_id END,
          customer_id = CASE WHEN customer_id = $1 THEN NULL ELSE customer_id END,
          created_by = CASE WHEN created_by = $1 THEN NULL ELSE created_by END
      WHERE cashier_id = $1 OR customer_id = $1 OR created_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'offline_sales' AND column_name = 'voided_by') THEN
    EXECUTE 'UPDATE public.offline_sales SET voided_by = NULL WHERE voided_by = $1' USING target_customer_id;
  END IF;

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
          customer_id = CASE WHEN customer_id = $1 THEN NULL ELSE customer_id END,
          created_by = CASE WHEN created_by = $1 THEN NULL ELSE created_by END
      WHERE user_id = $1 OR customer_id = $1 OR created_by = $1
    $dyn$ USING target_customer_id;
  END IF;

  -- Checkout sessions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'checkout_sessions' AND column_name = 'user_id') THEN
    EXECUTE 'UPDATE public.checkout_sessions SET user_id = NULL WHERE user_id = $1' USING target_customer_id;
  END IF;

  -- POS cart sessions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pos_cart_sessions' AND column_name = 'cashier_id') THEN
    EXECUTE 'UPDATE public.pos_cart_sessions SET cashier_id = NULL WHERE cashier_id = $1' USING target_customer_id;
  END IF;

  -- Inventory transactions
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_transactions' AND column_name = 'created_by') THEN
    EXECUTE 'UPDATE public.inventory_transactions SET created_by = NULL WHERE created_by = $1' USING target_customer_id;
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

  -- 4. Purge customer owned data
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

  -- Supabase auth user (safely handled so external identity constraint never crashes RPC)
  BEGIN
    DELETE FROM auth.users WHERE id = target_customer_id;
  EXCEPTION WHEN OTHERS THEN
    -- In case of cascade or system restriction on auth.users, profile is already removed
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Customer profile successfully removed while preserving order accounting history', 
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
  v_cid uuid;
  v_count integer := 0;
BEGIN
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

-- ============================================================================
-- 3. CANONICAL PRODUCT DELETION RPCS (admin_delete_products & admin_delete_all_products)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_delete_products(_product_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text;
  v_is_admin boolean := false;
  v_deleted_count integer := 0;
  v_archived_count integer := 0;
  v_prod_id uuid;
  v_has_transactions boolean;
BEGIN
  -- Authorization check
  IF v_caller_id IS NOT NULL THEN
    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
    IF v_caller_email IS NULL THEN
      SELECT email INTO v_caller_email FROM public.profiles WHERE id = v_caller_id;
    END IF;

    v_is_admin := (
      public.has_role(v_caller_id, 'admin') 
      OR public.is_admin() 
      OR public.is_staff_or_admin()
      OR (SELECT public.check_is_admin())
      OR EXISTS (
        SELECT 1 FROM public.admin_allowlist 
        WHERE lower(trim(email)) = lower(trim(coalesce(v_caller_email, '')))
      )
    );

    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Unauthorized: Only administrators can delete products';
    END IF;
  END IF;

  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0, 'archived', 0);
  END IF;

  FOREACH v_prod_id IN ARRAY _product_ids LOOP
    -- 1. Check if product has historical order or POS sales transactions
    SELECT (
      EXISTS (SELECT 1 FROM public.order_items WHERE product_id = v_prod_id) OR
      EXISTS (SELECT 1 FROM public.offline_sale_items WHERE product_id = v_prod_id)
    ) INTO v_has_transactions;

    IF v_has_transactions THEN
      -- Product has financial history: archive it cleanly so orders are never corrupted
      UPDATE public.products 
      SET is_active = false, 
          stock = 0,
          updated_at = now() 
      WHERE id = v_prod_id;

      -- Deactivate all variants
      UPDATE public.product_variants
      SET is_active = false,
          stock = 0,
          updated_at = now()
      WHERE product_id = v_prod_id;

      -- Unlink from any curated homepage section items so storefront remains clean
      DELETE FROM public.homepage_section_items WHERE product_id = v_prod_id;

      v_archived_count := v_archived_count + 1;
    ELSE
      -- Product has NO transactions: cascade clean all dependent records safely
      DELETE FROM public.homepage_section_items WHERE product_id = v_prod_id;
      DELETE FROM public.product_images WHERE product_id = v_prod_id;
      DELETE FROM public.product_videos WHERE product_id = v_prod_id;
      DELETE FROM public.product_variants WHERE product_id = v_prod_id;
      DELETE FROM public.product_costs WHERE product_id = v_prod_id;
      DELETE FROM public.cart_items WHERE product_id = v_prod_id;
      DELETE FROM public.wishlist_items WHERE product_id = v_prod_id;
      DELETE FROM public.reviews WHERE product_id = v_prod_id;
      DELETE FROM public.product_relations WHERE product_1_id = v_prod_id OR product_2_id = v_prod_id;
      
      -- Physically delete product
      DELETE FROM public.products WHERE id = v_prod_id;
      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_deleted_count,
    'archived', v_archived_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_all_products(_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_all_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_all_ids FROM public.products;

  IF v_all_ids IS NULL OR array_length(v_all_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0, 'archived', 0);
  END IF;

  RETURN public.admin_delete_products(v_all_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_products(uuid[]) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_all_products(boolean) TO authenticated, anon, service_role;

-- ============================================================================
-- 4. CANONICAL POS SALES DELETION & VOIDING RPC (admin_hard_delete_offline_sales)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_hard_delete_offline_sales(
  _sale_ids uuid[],
  _restore_stock boolean DEFAULT false
)
RETURNS jsonb 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, auth, pg_temp 
AS $$
DECLARE
  uid uuid := auth.uid();
  v_sale_id uuid;
  v_sale record;
  v_item record;
  v_prod record;
  v_deleted_count int := 0;
  v_units_restored int := 0;
  v_items_restored int := 0;
  v_prev_stock int;
  v_new_stock int;
BEGIN
  IF _sale_ids IS NULL OR array_length(_sale_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted_count', 0,
      'message', 'No sales provided for deletion'
    );
  END IF;

  FOREACH v_sale_id IN ARRAY _sale_ids LOOP
    SELECT * INTO v_sale
    FROM public.offline_sales
    WHERE id = v_sale_id
    FOR UPDATE;

    IF v_sale.id IS NOT NULL THEN
      -- Optional stock restoration if sale was active (not already voided)
      IF _restore_stock = true AND v_sale.status NOT IN ('voided', 'cancelled') AND COALESCE(v_sale.is_voided, false) = false THEN
        FOR v_item IN
          SELECT product_id, variant_id, qty, sku, barcode, name
          FROM public.offline_sale_items
          WHERE sale_id = v_sale_id AND product_id IS NOT NULL
        LOOP
          SELECT id, stock INTO v_prod
          FROM public.products
          WHERE id = v_item.product_id
          FOR UPDATE;

          IF v_prod.id IS NOT NULL THEN
            v_prev_stock := v_prod.stock;
            v_new_stock := v_prev_stock + v_item.qty;

            UPDATE public.products
            SET stock = v_new_stock,
                updated_at = now()
            WHERE id = v_prod.id;

            IF v_item.variant_id IS NOT NULL THEN
              UPDATE public.product_variants
              SET stock = stock + v_item.qty,
                  updated_at = now()
              WHERE id = v_item.variant_id;
            ELSE
              UPDATE public.product_variants
              SET stock = stock + v_item.qty,
                  updated_at = now()
              WHERE product_id = v_prod.id
                AND (
                  (sku IS NOT NULL AND sku ILIKE v_item.sku)
                  OR (barcode IS NOT NULL AND barcode = v_item.barcode)
                  OR name = 'Default'
                );
            END IF;

            INSERT INTO public.inventory_transactions (
              product_id,
              variant_id,
              type,
              transaction_type,
              quantity,
              previous_quantity,
              new_quantity,
              reference_type,
              reference_id,
              note,
              notes,
              created_by
            ) VALUES (
              v_item.product_id,
              v_item.variant_id,
              'adjustment'::public.inventory_tx_type,
              'adjustment'::public.inventory_tx_type,
              v_item.qty,
              v_prev_stock,
              v_new_stock,
              'offline_sale_delete',
              v_sale_id,
              'Stock restoration from deleted POS sale #' || v_sale.sale_number,
              'Stock restoration from deleted POS sale #' || v_sale.sale_number,
              uid
            );

            v_items_restored := v_items_restored + 1;
            v_units_restored := v_units_restored + v_item.qty;
          END IF;
        END LOOP;
      END IF;

      -- Revert customer metrics if sale was active
      IF v_sale.customer_id IS NOT NULL AND v_sale.status NOT IN ('voided', 'cancelled') AND COALESCE(v_sale.is_voided, false) = false THEN
        UPDATE public.pos_customers
        SET total_purchases = GREATEST(0, COALESCE(total_purchases, 1) - 1),
            total_spend = GREATEST(0, COALESCE(total_spend, v_sale.total) - v_sale.total),
            total_spent = GREATEST(0, COALESCE(total_spent, v_sale.total) - v_sale.total),
            updated_at = now()
        WHERE id = v_sale.customer_id;
      END IF;

      -- Unlink any return items referencing these sale items before deleting sale items
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_return_items') THEN
        UPDATE public.offline_return_items
        SET original_sale_item_id = NULL
        WHERE original_sale_item_id IN (
          SELECT id FROM public.offline_sale_items WHERE sale_id = v_sale_id
        );
      END IF;

      -- Unlink any dependent records
      UPDATE public.offline_returns
      SET original_sale_id = NULL
      WHERE original_sale_id = v_sale_id;

      UPDATE public.offline_returns
      SET linked_sale_id = NULL
      WHERE linked_sale_id = v_sale_id;

      UPDATE public.store_credit_ledger
      SET used_in_sale_id = NULL
      WHERE used_in_sale_id = v_sale_id;

      UPDATE public.sms_logs
      SET offline_sale_id = NULL
      WHERE offline_sale_id = v_sale_id;

      -- Delete line items and sale
      DELETE FROM public.offline_sale_items WHERE sale_id = v_sale_id;
      DELETE FROM public.offline_sales WHERE id = v_sale_id;

      v_deleted_count := v_deleted_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'units_restored', v_units_restored,
    'items_restored', v_items_restored,
    'message', v_deleted_count || ' POS sale record(s) permanently deleted.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_hard_delete_offline_sales(uuid[], boolean) TO authenticated, anon, service_role;

-- ============================================================================
-- 5. PERFORMANCE DATABASE INDEXES
-- ============================================================================

-- Fast lookup for return items
CREATE INDEX IF NOT EXISTS idx_offline_return_items_sale_item
  ON public.offline_return_items (original_sale_item_id)
  WHERE original_sale_item_id IS NOT NULL;

-- Fast lookup for offline sale items by sale_id
CREATE INDEX IF NOT EXISTS idx_offline_sale_items_sale_id
  ON public.offline_sale_items (sale_id);

-- Fast lookup for active variants by product
CREATE INDEX IF NOT EXISTS idx_product_variants_active_prod
  ON public.product_variants (product_id, is_active);

-- Fast sorting on profiles for customer lists
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_desc
  ON public.profiles (created_at DESC);

-- Fast sorting on pos_customers
CREATE INDEX IF NOT EXISTS idx_pos_customers_created_desc
  ON public.pos_customers (created_at DESC);
