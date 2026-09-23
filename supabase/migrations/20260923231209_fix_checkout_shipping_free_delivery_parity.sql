-- Exact production migration marker for the checkout shipping parity fix.
-- The same SQL is retained in 20260928000317 for the repository's chronological
-- migration stream; this file mirrors the migration version recorded in production.

DO $$
DECLARE
  v_def text;
  v_old text := $old$
  IF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSIF v_custom_shipping IS NOT NULL THEN
    shipping := v_custom_shipping;
  ELSE
    IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
      shipping := 0;
    ELSE
      shipping := std_shipping;
    END IF;
  END IF;
$old$;
  v_new text := $new$
  -- Keep server pricing exactly aligned with the storefront pricing engine:
  -- free delivery at/above the configured threshold takes precedence over
  -- product-level delivery fee overrides.
  IF free_delivery_enabled AND net_subtotal >= free_shipping_threshold THEN
    shipping := 0;
  ELSIF v_has_explicit_fee AND v_all_items_free THEN
    shipping := 0;
  ELSE
    shipping := COALESCE(v_custom_shipping, std_shipping);
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_checkout_session'
    AND pg_get_function_identity_arguments(p.oid) =
      'jsonb, text, text, text, text, text, text, text, text, text, text, text, text, text, text'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_checkout_session function not found';
  END IF;

  IF position(v_new IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Expected checkout shipping block not found';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END $$;
