-- Migration: 20260928000050_purge_fake_and_test_data.sql
-- Purge fake visitors, test return vouchers, test customers, and test analytics events

-- 1. Purge test offline return items & returns
DELETE FROM public.offline_return_items;
DELETE FROM public.offline_returns;

-- 2. Purge test store credit ledger entries
DELETE FROM public.store_credit_ledger;

-- 3. Delete fake test customers created during automated tests
DELETE FROM public.pos_customers
WHERE email LIKE '%@test.com'
   OR name ILIKE '%Test%'
   OR phone LIKE '98111%'
   OR phone = '9876543210';

-- 4. Reset store credit balance on any remaining genuine customer accounts
UPDATE public.pos_customers
SET store_credit_balance = 0;

-- 5. Purge test analytics events
DELETE FROM public.analytics_events;

-- 6. Purge fake / test website visitors
DELETE FROM public.website_visitors;

-- 7. Secure admin purge RPC for future maintenance
CREATE OR REPLACE FUNCTION public.admin_purge_test_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_returns int;
  v_customers int;
  v_events int;
  v_visitors int;
BEGIN
  DELETE FROM public.offline_return_items;

  WITH del_ret AS (
    DELETE FROM public.offline_returns RETURNING id
  )
  SELECT count(*) INTO v_returns FROM del_ret;

  DELETE FROM public.store_credit_ledger;

  WITH del_cust AS (
    DELETE FROM public.pos_customers
    WHERE email LIKE '%@test.com'
       OR name ILIKE '%Test%'
       OR phone LIKE '98111%'
       OR phone = '9876543210'
    RETURNING id
  )
  SELECT count(*) INTO v_customers FROM del_cust;

  UPDATE public.pos_customers
  SET store_credit_balance = 0;

  WITH del_ev AS (
    DELETE FROM public.analytics_events RETURNING id
  )
  SELECT count(*) INTO v_events FROM del_ev;

  WITH del_vis AS (
    DELETE FROM public.website_visitors RETURNING id
  )
  SELECT count(*) INTO v_visitors FROM del_vis;

  RETURN jsonb_build_object(
    'purged_returns', v_returns,
    'purged_customers', v_customers,
    'purged_events', v_events,
    'purged_visitors', v_visitors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_purge_test_data() TO anon, authenticated, service_role;
