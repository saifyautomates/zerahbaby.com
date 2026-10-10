-- Ensure the canonical return RPC loads the sale-level bill and coupon discounts
-- used by the discounted-price fallback. Safe if the preceding migration already
-- added these columns to the SELECT list.
DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_old text := $old$
    SELECT id, sale_number, total, return_status, amount_paid, payment_status, store_credit_used
    INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id
    FOR UPDATE;
$old$;
  v_new text := $new$
    SELECT id, sale_number, total, subtotal, discount, coupon_discount,
           return_status, amount_paid, payment_status, store_credit_used
    INTO v_orig_sale
    FROM public.offline_sales
    WHERE id = _original_sale_id
    FOR UPDATE;
$new$;
BEGIN
  v_old := substring(v_old FROM 2);
  v_new := substring(v_new FROM 2);

  SELECT p.oid::regprocedure
    INTO v_function
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_offline_return'
    AND p.pronargs = 16
    AND p.proargnames[1] = '_customer_name'
  LIMIT 1;

  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Canonical 16-argument process_offline_return function not found';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF position(v_old IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  ELSIF position(v_new IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not verify original sale SELECT; refusing unsafe patch';
  END IF;
END
$migration$;
