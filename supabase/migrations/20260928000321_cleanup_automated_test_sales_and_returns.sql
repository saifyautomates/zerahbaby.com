-- Migration: 20260928000321_cleanup_automated_test_sales_and_returns.sql
-- Description: Clean up automated test sales & test returns created during testing,
--              restore the 1 genuine store sale (GIRLS DENIM FROCK, ₹750), and maintain all 72 product stocks.

DO $$
BEGIN
  -- 1. Remove all automated test returns and items
  DELETE FROM public.offline_return_items 
  WHERE return_id IN (
    SELECT id FROM public.offline_returns 
    WHERE return_reason ILIKE '%test%' 
       OR return_reason ILIKE '%rollback%' 
       OR return_reason ILIKE '%playwright%'
       OR created_at > '2026-09-26 18:00:00+00'
  );

  DELETE FROM public.offline_returns 
  WHERE return_reason ILIKE '%test%' 
     OR return_reason ILIKE '%rollback%' 
     OR return_reason ILIKE '%playwright%'
     OR created_at > '2026-09-26 18:00:00+00';

  -- 2. Remove automated test sale items created by automated tests
  DELETE FROM public.offline_sale_items
  WHERE id IN (
    'dd673e97-2a9e-4ece-8658-c0eb10728753',
    'c78f83b5-05c3-49ac-b104-adf9c16ca6de',
    '42ac34d1-691f-4015-9f89-dbf02c42b88d',
    '50ba9375-7e24-43ae-b9ac-867a16c3e457'
  )
  OR created_at > '2026-09-26 18:00:00+00';

  -- 3. Remove any test offline_sales rows from the test runs
  DELETE FROM public.offline_sales
  WHERE id IN (
    '32f6fab7-d542-4f67-9f64-27d6e64fdc30',
    'c728edf7-46a5-476a-8f72-eb4a592308af',
    'c9fab103-b1ea-4237-ab47-ec6509a0b984',
    'e9771a57-67f9-4751-932e-d9e7bc9340a3'
  )
  OR customer_name ILIKE '%Automated Inventory Test%'
  OR customer_name ILIKE '%Test Customer%'
  OR created_at > '2026-09-26 18:00:00+00';

  -- 4. Ensure the 1 genuine sale (GIRLS DENIM FROCK, ₹750) is preserved and active
  INSERT INTO public.offline_sales (
    id,
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    discount_type,
    discount_value,
    total,
    payment_method,
    status,
    notes,
    pos_token_number,
    pos_token_date,
    created_at,
    updated_at
  ) VALUES (
    'fdbd14d7-5806-45db-a512-7f9fffa69564',
    'POS-260926-0001',
    'Walk-in Customer',
    '',
    '',
    750,
    0,
    'none',
    0,
    750,
    'cash',
    'completed',
    'In-store sale',
    1,
    '2026-09-26',
    '2026-09-26 13:39:48.866461+00',
    '2026-09-26 13:39:48.866461+00'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'completed',
    total = 750,
    subtotal = 750,
    is_voided = false,
    return_status = 'none',
    returned_amount = 0,
    returned_units = 0;

  -- 5. Ensure the 1 genuine sale item is linked to this sale
  UPDATE public.offline_sale_items
  SET sale_id = 'fdbd14d7-5806-45db-a512-7f9fffa69564',
      return_status = 'NONE',
      quantity_returned = 0,
      returned_quantity = 0
  WHERE id = 'f31f3cf2-bf22-4387-bc0b-5c16ccd1daff';

END $$;

CREATE OR REPLACE FUNCTION public.cleanup_test_sales_and_returns()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- 1. Remove all automated test returns and items
  DELETE FROM public.offline_return_items 
  WHERE return_id IN (
    SELECT id FROM public.offline_returns 
    WHERE return_reason ILIKE '%test%' 
       OR return_reason ILIKE '%rollback%' 
       OR return_reason ILIKE '%playwright%'
       OR created_at > '2026-09-26 18:00:00+00'
  );

  DELETE FROM public.offline_returns 
  WHERE return_reason ILIKE '%test%' 
     OR return_reason ILIKE '%rollback%' 
     OR return_reason ILIKE '%playwright%'
     OR created_at > '2026-09-26 18:00:00+00';

  -- 2. Remove automated test sale items created by automated tests
  DELETE FROM public.offline_sale_items
  WHERE id IN (
    'dd673e97-2a9e-4ece-8658-c0eb10728753',
    'c78f83b5-05c3-49ac-b104-adf9c16ca6de',
    '42ac34d1-691f-4015-9f89-dbf02c42b88d',
    '50ba9375-7e24-43ae-b9ac-867a16c3e457'
  )
  OR created_at > '2026-09-26 18:00:00+00';

  -- 3. Remove any test offline_sales rows from the test runs
  DELETE FROM public.offline_sales
  WHERE id IN (
    '32f6fab7-d542-4f67-9f64-27d6e64fdc30',
    'c728edf7-46a5-476a-8f72-eb4a592308af',
    'c9fab103-b1ea-4237-ab47-ec6509a0b984',
    'e9771a57-67f9-4751-932e-d9e7bc9340a3'
  )
  OR customer_name ILIKE '%Automated Inventory Test%'
  OR customer_name ILIKE '%Test Customer%'
  OR created_at > '2026-09-26 18:00:00+00';

  -- 4. Ensure the 1 genuine sale (GIRLS DENIM FROCK, ₹750) is preserved and active
  INSERT INTO public.offline_sales (
    id,
    sale_number,
    customer_name,
    customer_phone,
    customer_email,
    subtotal,
    discount,
    discount_type,
    discount_value,
    total,
    payment_method,
    status,
    notes,
    pos_token_number,
    pos_token_date,
    created_at,
    updated_at
  ) VALUES (
    'fdbd14d7-5806-45db-a512-7f9fffa69564',
    'POS-260926-0001',
    'Walk-in Customer',
    '',
    '',
    750,
    0,
    'none',
    0,
    750,
    'cash',
    'completed',
    'In-store sale',
    1,
    '2026-09-26',
    '2026-09-26 13:39:48.866461+00',
    '2026-09-26 13:39:48.866461+00'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'completed',
    total = 750,
    subtotal = 750,
    is_voided = false,
    return_status = 'none',
    returned_amount = 0,
    returned_units = 0;

  -- 5. Ensure the 1 genuine sale item is linked to this sale
  UPDATE public.offline_sale_items
  SET sale_id = 'fdbd14d7-5806-45db-a512-7f9fffa69564',
      return_status = 'NONE',
      quantity_returned = 0,
      returned_quantity = 0
  WHERE id = 'f31f3cf2-bf22-4387-bc0b-5c16ccd1daff';

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Cleaned up all automated test records and restored 1 genuine store sale'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_test_sales_and_returns() TO authenticated, anon, service_role;
