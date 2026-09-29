-- Fix POS fixed discount handling.
-- Existing `flat` behavior is preserved; canonical `fixed` is added.

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'place_offline_sale'
    AND pg_get_function_identity_arguments(p.oid) =
      '_customer_name text, _customer_phone text, _customer_email text, _payment_method text, _discount_type text, _discount_value numeric, _notes text, _items jsonb, _created_by uuid, _store_credit_used numeric, _coupon_code text, _cash_tendered numeric, _idempotency_key text, _customer_id uuid, _credit_token text'
  LIMIT 1;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Canonical place_offline_sale function not found';
  END IF;

  IF position(
    'ELSIF _discount_type = ''flat'' AND _discount_value > 0 THEN'
    IN v_definition
  ) = 0 THEN
    RAISE EXCEPTION 'Expected fixed-discount branch not found';
  END IF;

  v_definition := replace(
    v_definition,
    'ELSIF _discount_type = ''flat'' AND _discount_value > 0 THEN',
    'ELSIF _discount_type IN (''fixed'', ''flat'') AND _discount_value > 0 THEN'
  );

  EXECUTE v_definition;
END $$;
