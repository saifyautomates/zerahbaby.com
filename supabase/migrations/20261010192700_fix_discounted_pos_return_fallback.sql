-- Fix discounted POS return pricing when historical per-item snapshots are
-- missing or were stored before discount allocation was applied.
-- Preserve valid snapshots; only rebuild missing or visibly undiscounted prices.
DO $migration$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_old_calc text := $old$
      item_refund_price := COALESCE(
        NULLIF(v_orig_item.final_unit_paid_price, 0),
        NULLIF(v_orig_item.unit_selling_price, 0),
        NULLIF(v_orig_item.price, 0),
        (elem->>'refund_price')::numeric,
        (elem->>'price')::numeric,
        0
      );
$old$;
  v_new_calc text := $new$
      item_refund_price := COALESCE(
        NULLIF(v_orig_item.final_unit_paid_price, 0),
        NULLIF(v_orig_item.unit_selling_price, 0),
        NULLIF(v_orig_item.price, 0),
        (elem->>'refund_price')::numeric,
        (elem->>'price')::numeric,
        0
      );

      -- Older sales may have a missing/zero snapshot or a positive snapshot
      -- equal to the undiscounted unit price. Rebuild that price using the
      -- entire bill + coupon discount proportionally across the sale subtotal.
      IF COALESCE(v_orig_sale.discount, 0) + COALESCE(v_orig_sale.coupon_discount, 0) > 0
         AND COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0) > 0
         AND (
           item_refund_price <= 0
           OR ABS(
             item_refund_price
             - COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0)
           ) < 0.001
         )
         AND COALESCE(v_orig_sale.subtotal, 0) > 0
      THEN
        item_refund_price := GREATEST(
          0,
          ROUND(
            COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0)
            * (
              1 - LEAST(
                1,
                (COALESCE(v_orig_sale.discount, 0) + COALESCE(v_orig_sale.coupon_discount, 0))
                / v_orig_sale.subtotal
              )
            ),
            4
          )
        );
      END IF;
$new$;
  v_old_insert text := $old$
        item_refund_price := COALESCE(
          NULLIF(v_orig_item.final_unit_paid_price, 0),
          NULLIF(v_orig_item.unit_selling_price, 0),
          NULLIF(v_orig_item.price, 0),
          item_refund_price
        );
$old$;
  v_new_insert text := $new$
        item_refund_price := COALESCE(
          NULLIF(v_orig_item.final_unit_paid_price, 0),
          NULLIF(v_orig_item.unit_selling_price, 0),
          NULLIF(v_orig_item.price, 0),
          item_refund_price
        );

        -- Keep the return detail row at the same discounted amount used by
        -- the authoritative refund calculation above.
        IF COALESCE(v_orig_sale.discount, 0) + COALESCE(v_orig_sale.coupon_discount, 0) > 0
           AND COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0) > 0
           AND (
             item_refund_price <= 0
             OR ABS(
               item_refund_price
               - COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0)
             ) < 0.001
           )
           AND COALESCE(v_orig_sale.subtotal, 0) > 0
        THEN
          item_refund_price := GREATEST(
            0,
            ROUND(
              COALESCE(NULLIF(v_orig_item.unit_selling_price, 0), NULLIF(v_orig_item.price, 0), 0)
              * (
                1 - LEAST(
                  1,
                  (COALESCE(v_orig_sale.discount, 0) + COALESCE(v_orig_sale.coupon_discount, 0))
                  / v_orig_sale.subtotal
                )
              ),
              4
            )
          );
        END IF;
$new$;
BEGIN
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
    RAISE EXCEPTION 'Canonical process_offline_return(text,...,16 args) function not found';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF position(v_old_calc IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Return-calculation pricing block did not match; aborting safely';
  END IF;
  IF position(v_old_insert IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Return-detail pricing block did not match; aborting safely';
  END IF;

  v_definition := replace(v_definition, v_old_calc, v_new_calc);
  v_definition := replace(v_definition, v_old_insert, v_new_insert);

  EXECUTE v_definition;
END
$migration$;

COMMENT ON FUNCTION public.process_offline_return(text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text, uuid, text, text)
IS 'Canonical POS return processing with historical discounted-price fallback across bill and coupon discounts, due-offset refund reconciliation, idempotency, and atomic restocking.';
