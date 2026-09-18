CREATE TEMP TABLE IF NOT EXISTS temp_test_results (
  test_num int,
  test_name text,
  passed boolean,
  details text
);
TRUNCATE temp_test_results;

DO $$
DECLARE
  v_token_a text := 'TEST-VOUCHER-A-' || to_char(now(), 'HH24MISS');
  v_token_guest text := 'TEST-VOUCHER-G-' || to_char(now(), 'HH24MISS');
  v_token_exp text := 'TEST-VOUCHER-EXP-' || to_char(now(), 'HH24MISS');
  v_token_used text := 'TEST-VOUCHER-USED-' || to_char(now(), 'HH24MISS');

  v_cust_a_id uuid := gen_random_uuid();
  v_cust_b_id uuid := gen_random_uuid();
  v_phone_a text := '9876543210';
  v_phone_b text := '9123456780';
  v_phone_guest text := '9998887770';
  v_phone_wrong_guest text := '9991112220';

  v_res jsonb;
  v_rem numeric;
BEGIN
  -- 0. Seed test customers into pos_customers
  INSERT INTO public.pos_customers (id, name, phone, store_credit)
  VALUES 
    (v_cust_a_id, 'Customer Alpha', v_phone_a, 0),
    (v_cust_b_id, 'Customer Beta', v_phone_b, 0);

  -- Seed Active Voucher for Customer A (₹500)
  INSERT INTO public.pos_exchange_vouchers (
    token, customer_id, customer_name, customer_phone,
    original_amount, remaining_balance, status, expires_at
  ) VALUES (
    v_token_a, v_cust_a_id, 'Customer Alpha', v_phone_a,
    500.00, 500.00, 'active', now() + interval '30 days'
  );

  -- Seed Guest Voucher (₹400, linked to phone only)
  INSERT INTO public.pos_exchange_vouchers (
    token, customer_id, customer_name, customer_phone,
    original_amount, remaining_balance, status, expires_at
  ) VALUES (
    v_token_guest, NULL, 'Guest Customer', v_phone_guest,
    400.00, 400.00, 'active', now() + interval '30 days'
  );

  -- Seed Expired Voucher (₹300)
  INSERT INTO public.pos_exchange_vouchers (
    token, customer_id, customer_name, customer_phone,
    original_amount, remaining_balance, status, expires_at
  ) VALUES (
    v_token_exp, v_cust_a_id, 'Customer Alpha', v_phone_a,
    300.00, 300.00, 'expired', now() - interval '1 day'
  );

  -- Seed Fully Used Voucher (₹0 balance)
  INSERT INTO public.pos_exchange_vouchers (
    token, customer_id, customer_name, customer_phone,
    original_amount, remaining_balance, status, expires_at
  ) VALUES (
    v_token_used, v_cust_a_id, 'Customer Alpha', v_phone_a,
    250.00, 0.00, 'redeemed', now() + interval '30 days'
  );

  -- TEST 1: Customer A ka voucher -> Customer A use kare -> SUCCESS
  v_res := public.get_store_credit_voucher(v_token_a, v_cust_a_id, v_phone_a);
  IF (v_res->>'valid')::boolean = true AND (v_res->>'remaining_balance')::numeric = 500 THEN
    INSERT INTO temp_test_results VALUES (1, 'Customer A accesses own voucher', true, 'Remaining: ' || (v_res->>'remaining_balance'));
  ELSE
    INSERT INTO temp_test_results VALUES (1, 'Customer A accesses own voucher', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 2: Customer A ka voucher -> Customer B use kare -> FAIL (No PII leak)
  v_res := public.get_store_credit_voucher(v_token_a, v_cust_b_id, v_phone_b);
  IF (v_res->>'valid')::boolean = false 
     AND v_res->>'error' = 'This voucher is not available for this customer.'
     AND v_res::text NOT LIKE '%Customer Alpha%'
     AND v_res::text NOT LIKE '%' || v_phone_a || '%' THEN
    INSERT INTO temp_test_results VALUES (2, 'Customer B blocked with no PII leak', true, 'Blocked: ' || (v_res->>'error'));
  ELSE
    INSERT INTO temp_test_results VALUES (2, 'Customer B blocked with no PII leak', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 3: POS Customer A + Voucher A -> SUCCESS (Phone Normalization +91)
  v_res := public.get_store_credit_voucher(v_token_a, NULL, '+91 ' || v_phone_a);
  IF (v_res->>'valid')::boolean = true AND (v_res->>'remaining_balance')::numeric = 500 THEN
    INSERT INTO temp_test_results VALUES (3, 'POS Customer A with +91 phone', true, 'Remaining: ' || (v_res->>'remaining_balance'));
  ELSE
    INSERT INTO temp_test_results VALUES (3, 'POS Customer A with +91 phone', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 4: POS Customer B + Voucher A -> FAIL
  v_res := public.get_store_credit_voucher(v_token_a, v_cust_b_id, v_phone_b);
  IF (v_res->>'valid')::boolean = false AND v_res->>'error' = 'This voucher is not available for this customer.' THEN
    INSERT INTO temp_test_results VALUES (4, 'POS Customer B blocked', true, 'Blocked: ' || (v_res->>'error'));
  ELSE
    INSERT INTO temp_test_results VALUES (4, 'POS Customer B blocked', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 5: Guest customer verified voucher -> SUCCESS
  v_res := public.get_store_credit_voucher(v_token_guest, NULL, v_phone_guest);
  IF (v_res->>'valid')::boolean = true AND (v_res->>'remaining_balance')::numeric = 400 THEN
    INSERT INTO temp_test_results VALUES (5, 'Guest verified voucher', true, 'Remaining: ' || (v_res->>'remaining_balance'));
  ELSE
    INSERT INTO temp_test_results VALUES (5, 'Guest verified voucher', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 6: Wrong / unverified guest -> FAIL
  v_res := public.get_store_credit_voucher(v_token_guest, NULL, v_phone_wrong_guest);
  IF (v_res->>'valid')::boolean = false AND v_res->>'error' = 'This voucher is not available for this customer.' THEN
    INSERT INTO temp_test_results VALUES (6, 'Wrong guest phone blocked', true, 'Blocked: ' || (v_res->>'error'));
  ELSE
    INSERT INTO temp_test_results VALUES (6, 'Wrong guest phone blocked', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 7: Partial voucher balance -> Customer A uses ₹200 out of ₹500
  -- Deduct ₹200 from pos_exchange_vouchers for Customer A
  UPDATE public.pos_exchange_vouchers
  SET remaining_balance = remaining_balance - 200.00
  WHERE token = v_token_a;

  v_res := public.get_store_credit_voucher(v_token_a, v_cust_a_id, v_phone_a);
  IF (v_res->>'valid')::boolean = true AND (v_res->>'remaining_balance')::numeric = 300.00 THEN
    -- Check if Customer B can access remaining ₹300
    v_res := public.get_store_credit_voucher(v_token_a, v_cust_b_id, v_phone_b);
    IF (v_res->>'valid')::boolean = false AND v_res->>'error' = 'This voucher is not available for this customer.' THEN
      INSERT INTO temp_test_results VALUES (7, 'Partial balance remains customer-locked', true, 'Remaining ₹300 accessible only by Customer A');
    ELSE
      INSERT INTO temp_test_results VALUES (7, 'Partial balance remains customer-locked', false, 'Customer B accessed: ' || v_res::text);
    END IF;
  ELSE
    INSERT INTO temp_test_results VALUES (7, 'Partial balance remains customer-locked', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 8: Expired voucher -> FAIL
  v_res := public.get_store_credit_voucher(v_token_exp, v_cust_a_id, v_phone_a);
  IF (v_res->>'valid')::boolean = false AND (v_res->>'status' = 'expired' OR v_res->>'error' LIKE '%expired%') THEN
    INSERT INTO temp_test_results VALUES (8, 'Expired voucher rejected', true, 'Error: ' || (v_res->>'error'));
  ELSE
    INSERT INTO temp_test_results VALUES (8, 'Expired voucher rejected', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 9: Already used voucher -> FAIL
  v_res := public.get_store_credit_voucher(v_token_used, v_cust_a_id, v_phone_a);
  IF (v_res->>'valid')::boolean = false AND (v_res->>'status' = 'redeemed' OR v_res->>'error' LIKE '%fully redeemed%') THEN
    INSERT INTO temp_test_results VALUES (9, 'Fully used voucher rejected', true, 'Error: ' || (v_res->>'error'));
  ELSE
    INSERT INTO temp_test_results VALUES (9, 'Fully used voucher rejected', false, 'Result: ' || v_res::text);
  END IF;

  -- TEST 10: Browser refresh / re-query -> ownership stays correct
  v_res := public.get_customer_store_credit(v_cust_a_id, v_phone_a, v_token_a);
  IF (v_res->>'available_credit')::numeric = 300.00 THEN
    v_res := public.get_customer_store_credit(v_cust_b_id, v_phone_b, v_token_a);
    IF (v_res->>'available_credit')::numeric = 0 AND (v_res->>'ownership_mismatch')::boolean = true THEN
      INSERT INTO temp_test_results VALUES (10, 'Re-query maintains ownership', true, 'Customer A ₹300, Customer B 0 (mismatch)');
    ELSE
      INSERT INTO temp_test_results VALUES (10, 'Re-query maintains ownership', false, 'Customer B result: ' || v_res::text);
    END IF;
  ELSE
    INSERT INTO temp_test_results VALUES (10, 'Re-query maintains ownership', false, 'Customer A result: ' || v_res::text);
  END IF;

  -- TEST 11: POS multiple carts isolation
  v_res := public.get_store_credit_voucher(v_token_a, v_cust_a_id, v_phone_a);
  IF (v_res->>'valid')::boolean = true THEN
    v_res := public.get_store_credit_voucher(v_token_a, v_cust_b_id, v_phone_b);
    IF (v_res->>'valid')::boolean = false AND (v_res->>'ownership_mismatch')::boolean = true THEN
      INSERT INTO temp_test_results VALUES (11, 'POS multi-cart isolation', true, 'Cart 1 valid, Cart 2 blocked');
    ELSE
      INSERT INTO temp_test_results VALUES (11, 'POS multi-cart isolation', false, 'Cart 2 result: ' || v_res::text);
    END IF;
  ELSE
    INSERT INTO temp_test_results VALUES (11, 'POS multi-cart isolation', false, 'Cart 1 result: ' || v_res::text);
  END IF;

  -- Cleanup test data
  DELETE FROM public.pos_exchange_vouchers WHERE token IN (v_token_a, v_token_guest, v_token_exp, v_token_used);
  DELETE FROM public.pos_customers WHERE id IN (v_cust_a_id, v_cust_b_id);
END;
$$;

SELECT * FROM temp_test_results ORDER BY test_num;
