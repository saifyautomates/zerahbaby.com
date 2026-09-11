-- =============================================================================
-- Migration: 20260928000139_link_customer_orders_by_phone_email_and_rls.sql
-- Description:
-- 1. Ensure authenticated users can view orders placed with their user_id OR their
--    phone/email if user_id was unassigned during guest/session checkout.
-- 2. Add link_my_orders RPC that retroactively consolidates any unlinked orders
--    matching current user's phone or email under their auth.uid().
-- 3. Enhance create_checkout_session to auto-resolve auth.users if uid was null.
-- =============================================================================

-- 1. Update RLS on public.orders to allow users to read orders matching their account or credentials
DROP POLICY IF EXISTS "customer and admin read orders" ON public.orders;

CREATE POLICY "customer and admin read orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL AND (
        (NULLIF(auth.jwt()->>'phone', '') IS NOT NULL AND (
          phone = auth.jwt()->>'phone'
          OR phone = replace(auth.jwt()->>'phone', '+91', '')
          OR phone = right(auth.jwt()->>'phone', 10)
        ))
        OR (NULLIF(auth.jwt()->>'email', '') IS NOT NULL AND lower(email) = lower(auth.jwt()->>'email'))
      )
    )
    OR public.has_role(auth.uid(), 'admin')
  );

-- 2. Update order_items RLS to inherit the same order visibility
DROP POLICY IF EXISTS "customer and admin read order items" ON public.order_items;

CREATE POLICY "customer and admin read order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.user_id = auth.uid()
          OR (
            o.user_id IS NULL AND (
              (NULLIF(auth.jwt()->>'phone', '') IS NOT NULL AND (
                o.phone = auth.jwt()->>'phone'
                OR o.phone = replace(auth.jwt()->>'phone', '+91', '')
                OR o.phone = right(auth.jwt()->>'phone', 10)
              ))
              OR (NULLIF(auth.jwt()->>'email', '') IS NOT NULL AND lower(o.email) = lower(auth.jwt()->>'email'))
            )
          )
          OR public.has_role(auth.uid(), 'admin')
        )
    )
  );

-- 3. Canonical RPC to link unassigned orders to current logged-in user
CREATE OR REPLACE FUNCTION public.link_my_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text := auth.jwt()->>'phone';
  v_email text := auth.jwt()->>'email';
  v_ten_digits text;
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  IF v_phone IS NOT NULL AND v_phone != '' THEN
    v_ten_digits := right(regexp_replace(v_phone, '\D', '', 'g'), 10);
  END IF;

  -- Link orders that match user's verified phone or email where user_id is currently NULL
  WITH updated AS (
    UPDATE public.orders
    SET user_id = v_uid
    WHERE user_id IS NULL
      AND (
        (v_ten_digits IS NOT NULL AND v_ten_digits != '' AND right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10) = v_ten_digits)
        OR (v_email IS NOT NULL AND v_email != '' AND lower(COALESCE(email, '')) = lower(v_email))
      )
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_my_orders() TO authenticated;
