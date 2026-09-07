-- ==============================================================================
-- Migration: 20260928000118_production_grade_payments_and_checkout_sessions.sql
-- Description:
-- Production-Grade Payment & Order Creation Architecture:
-- 1. Create checkout_sessions table for separating checkout intent from orders.
-- 2. Create payment_attempts table for tracking gateway lifecycle states.
-- 3. Create payment_settings table for authoritative Cash on Delivery configuration.
-- 4. Provide canonical RPCs:
--    - create_checkout_session
--    - record_payment_attempt
--    - update_payment_attempt_status
--    - finalize_paid_order (atomic order creation + stock deduction on verified payment)
--    - place_cod_order (atomic COD order creation + stock deduction)
--    - get_payment_settings / update_payment_settings
-- ==============================================================================

-- 1. Create checkout_sessions table
CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE NOT NULL DEFAULT ('cs_' || replace(gen_random_uuid()::text, '-', '')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',
    'payment_pending',
    'payment_cancelled',
    'payment_failed',
    'payment_verified',
    'expired',
    'converted'
  )),
  customer_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  coupon_code text,
  subtotal numeric NOT NULL DEFAULT 0,
  shipping_fee numeric NOT NULL DEFAULT 0,
  cod_fee numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  payment_method text NOT NULL DEFAULT 'online',
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  idempotency_key text UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_session_id ON public.checkout_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_id ON public.checkout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON public.checkout_sessions(status);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_expires_at ON public.checkout_sessions(expires_at);

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read own checkout_sessions" ON public.checkout_sessions;
CREATE POLICY "public read own checkout_sessions" ON public.checkout_sessions
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "service_role manage checkout_sessions" ON public.checkout_sessions;
CREATE POLICY "service_role manage checkout_sessions" ON public.checkout_sessions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. Create payment_attempts table
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL REFERENCES public.checkout_sessions(id) ON DELETE CASCADE,
  razorpay_order_id text UNIQUE NOT NULL,
  razorpay_payment_id text UNIQUE,
  razorpay_signature text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'created',
    'initiated',
    'authorized',
    'captured',
    'failed',
    'cancelled',
    'verification_failed',
    'refunded',
    'expired'
  )),
  failure_reason text,
  gateway_response jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_session ON public.payment_attempts(checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_rzp_order ON public.payment_attempts(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_rzp_payment ON public.payment_attempts(razorpay_payment_id);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read payment_attempts" ON public.payment_attempts;
CREATE POLICY "public read payment_attempts" ON public.payment_attempts
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "service_role manage payment_attempts" ON public.payment_attempts;
CREATE POLICY "service_role manage payment_attempts" ON public.payment_attempts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Create payment_settings table
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cod_enabled boolean NOT NULL DEFAULT false,
  cod_fee numeric NOT NULL DEFAULT 0,
  cod_min_order_value numeric NOT NULL DEFAULT 0,
  cod_max_order_value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read payment_settings" ON public.payment_settings;
CREATE POLICY "public read payment_settings" ON public.payment_settings
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "admins manage payment_settings" ON public.payment_settings;
CREATE POLICY "admins manage payment_settings" ON public.payment_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ensure single row exists and seed default values
INSERT INTO public.payment_settings (id, cod_enabled, cod_fee, cod_min_order_value, cod_max_order_value)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, false, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.payment_settings);

-- Sync initial COD settings to site_settings
INSERT INTO public.site_settings (key, value) VALUES
  ('cod_enabled', 'false'),
  ('cod_fee', '0'),
  ('cod_min_order_value', '0'),
  ('cod_max_order_value', '0')
ON CONFLICT (key) DO NOTHING;

-- Trigger to keep site_settings in sync with payment_settings
CREATE OR REPLACE FUNCTION public.sync_payment_settings_to_site_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_settings (key, value) VALUES
    ('cod_enabled', CASE WHEN NEW.cod_enabled THEN 'true' ELSE 'false' END),
    ('cod_fee', NEW.cod_fee::text),
    ('cod_min_order_value', NEW.cod_min_order_value::text),
    ('cod_max_order_value', NEW.cod_max_order_value::text)
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_payment_settings ON public.payment_settings;
CREATE TRIGGER trigger_sync_payment_settings
  AFTER INSERT OR UPDATE ON public.payment_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_payment_settings_to_site_settings();

-- 4. RPC: get_payment_settings
CREATE OR REPLACE FUNCTION public.get_payment_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  SELECT * INTO rec FROM public.payment_settings LIMIT 1;
  IF rec.id IS NULL THEN
    RETURN jsonb_build_object(
      'cod_enabled', false,
      'cod_fee', 0,
      'cod_min_order_value', 0,
      'cod_max_order_value', 0,
      'updated_at', now()
    );
  END IF;

  RETURN jsonb_build_object(
    'cod_enabled', rec.cod_enabled,
    'cod_fee', rec.cod_fee,
    'cod_min_order_value', rec.cod_min_order_value,
    'cod_max_order_value', rec.cod_max_order_value,
    'updated_at', rec.updated_at
  );
END;
$$;

-- 5. RPC: update_payment_settings (Admin only)
CREATE OR REPLACE FUNCTION public.update_payment_settings(
  _cod_enabled boolean,
  _cod_fee numeric DEFAULT 0,
  _cod_min_order_value numeric DEFAULT 0,
  _cod_max_order_value numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  rec record;
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only store administrators can modify payment settings.';
  END IF;

  IF _cod_fee < 0 OR _cod_min_order_value < 0 OR _cod_max_order_value < 0 THEN
    RAISE EXCEPTION 'Values cannot be negative.';
  END IF;

  IF _cod_max_order_value > 0 AND _cod_min_order_value > _cod_max_order_value THEN
    RAISE EXCEPTION 'Minimum order value cannot exceed maximum order value.';
  END IF;

  UPDATE public.payment_settings
  SET
    cod_enabled = _cod_enabled,
    cod_fee = COALESCE(_cod_fee, 0),
    cod_min_order_value = COALESCE(_cod_min_order_value, 0),
    cod_max_order_value = COALESCE(_cod_max_order_value, 0),
    updated_at = now(),
    updated_by = uid
  WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
  RETURNING * INTO rec;

  IF rec.id IS NULL THEN
    INSERT INTO public.payment_settings (
      id, cod_enabled, cod_fee, cod_min_order_value, cod_max_order_value, updated_at, updated_by
    ) VALUES (
      '00000000-0000-0000-0000-000000000001'::uuid,
      _cod_enabled, COALESCE(_cod_fee, 0), COALESCE(_cod_min_order_value, 0), COALESCE(_cod_max_order_value, 0), now(), uid
    ) RETURNING * INTO rec;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cod_enabled', rec.cod_enabled,
    'cod_fee', rec.cod_fee,
    'cod_min_order_value', rec.cod_min_order_value,
    'cod_max_order_value', rec.cod_max_order_value,
    'updated_at', rec.updated_at
  );
END;
$$;

-- 6. RPC: create_checkout_session
CREATE OR REPLACE FUNCTION public.create_checkout_session(
  _full_name text,
  _email text,
  _phone text,
  _address text,
  _city text,
  _state text,
  _pincode text,
  _items jsonb,
  _payment_method text DEFAULT 'online',
  _coupon_code text DEFAULT NULL,
  _notes text DEFAULT '',
  _idempotency_key text DEFAULT NULL,
  _alt_phone text DEFAULT '',
  _address_line2 text DEFAULT '',
  _landmark text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid;
  item record;
  variant record;
  computed_subtotal numeric := 0;
  computed_mrp_total numeric := 0;
  computed_discount numeric := 0;
  computed_total numeric := 0;
  shipping numeric := 0;
  cod_fee numeric := 0;
  net_subtotal numeric := 0;
  std_shipping numeric := 79;
  fd_threshold numeric := 999;
  is_fd_enabled boolean := true;
  coupon_record record;
  v_raw_val text;
  v_clean_idem text;
  v_session_id text;
  v_clean_payment_method text;
  existing_session record;
  validated_items jsonb := '[]'::jsonb;
  item_obj jsonb;
  item_image text;
  ps_rec record;
BEGIN
  -- 1. Authenticate or Resolve Anonymous User
  uid := auth.uid();
  IF uid IS NULL AND _email IS NOT NULL AND trim(_email) != '' THEN
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  END IF;

  -- 2. Idempotency Check
  v_clean_idem := NULLIF(trim(COALESCE(_idempotency_key, '')), '');
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO existing_session
    FROM public.checkout_sessions
    WHERE idempotency_key = v_clean_idem
      AND status IN ('active', 'payment_pending', 'payment_cancelled', 'payment_failed')
      AND expires_at > now()
    LIMIT 1;

    IF existing_session.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'session_id', existing_session.session_id,
        'subtotal', existing_session.subtotal,
        'shipping_fee', existing_session.shipping_fee,
        'cod_fee', existing_session.cod_fee,
        'discount', existing_session.discount,
        'total', existing_session.total,
        'currency', existing_session.currency,
        'payment_method', existing_session.payment_method,
        'status', existing_session.status,
        'expires_at', existing_session.expires_at,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Validate Items & Compute Authoritative Pricing
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Checkout must contain at least one item.';
  END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int) LOOP
    IF item.qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be greater than zero.';
    END IF;

    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id;
    ELSE
      SELECT v.id AS variant_id, COALESCE(v.price_override, p.price) AS price, COALESCE(p.mrp, p.price) AS mrp,
             v.sku AS variant_sku, v.barcode AS variant_barcode, v.color AS variant_color, v.size AS variant_size,
             v.name AS variant_name, v.image_url AS variant_image, v.stock AS stock,
             p.slug AS product_slug, p.name AS product_name, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug = item.product_slug OR p.id::text = item.product_slug
      LIMIT 1;
    END IF;

    IF variant.variant_id IS NULL THEN
      RAISE EXCEPTION 'Product variant not found for item: %', COALESCE(item.variant_id::text, item.product_slug);
    END IF;

    IF variant.stock < item.qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available: %, Requested: %', variant.product_name, variant.stock, item.qty;
    END IF;

    item_image := variant.variant_image;
    IF item_image IS NULL AND variant.variant_color IS NOT NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id AND color = variant.variant_color
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;
    IF item_image IS NULL THEN
      SELECT public_url INTO item_image
      FROM public.product_images
      WHERE product_id = variant.p_id
      ORDER BY is_primary DESC, sort_order ASC
      LIMIT 1;
    END IF;

    computed_subtotal := computed_subtotal + (variant.price * item.qty);
    computed_mrp_total := computed_mrp_total + (variant.mrp * item.qty);

    item_obj := jsonb_build_object(
      'variant_id', variant.variant_id,
      'product_id', variant.p_id,
      'product_slug', variant.product_slug,
      'product_name', variant.product_name,
      'variant_sku', variant.variant_sku,
      'variant_barcode', variant.variant_barcode,
      'variant_color', variant.variant_color,
      'variant_size', variant.variant_size,
      'price', variant.price,
      'mrp', variant.mrp,
      'qty', item.qty,
      'line_subtotal', (variant.price * item.qty),
      'image_url', item_image
    );

    validated_items := validated_items || jsonb_build_array(item_obj);
  END LOOP;

  -- 4. Dynamic Coupon Evaluation
  IF _coupon_code IS NOT NULL AND trim(_coupon_code) != '' THEN
    SELECT * INTO coupon_record
    FROM public.coupons
    WHERE UPPER(code) = UPPER(trim(_coupon_code))
      AND COALESCE(is_active, active, true) = true
    LIMIT 1;

    IF coupon_record.id IS NOT NULL THEN
      IF (coupon_record.valid_from IS NULL OR now() >= coupon_record.valid_from) AND
         (coupon_record.valid_until IS NULL OR now() <= coupon_record.valid_until) AND
         (coupon_record.usage_limit IS NULL OR coupon_record.usage_limit = 0 OR coupon_record.used_count < coupon_record.usage_limit) AND
         (COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0) <= 0 OR computed_subtotal >= COALESCE(coupon_record.min_order_amount, coupon_record.minimum_order_value, 0)) THEN

        IF lower(coupon_record.discount_type::text) IN ('percent', 'percentage') THEN
          computed_discount := ROUND((computed_subtotal * coupon_record.discount_value) / 100, 2);
          IF COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount, 0) > 0 THEN
            computed_discount := LEAST(computed_discount, COALESCE(coupon_record.max_discount_amount, coupon_record.maximum_discount));
          END IF;
        ELSE
          computed_discount := LEAST(coupon_record.discount_value, computed_subtotal);
        END IF;
      ELSE
        _coupon_code := NULL;
        computed_discount := 0;
      END IF;
    ELSE
      _coupon_code := NULL;
    END IF;
  END IF;

  net_subtotal := GREATEST(0, computed_subtotal - computed_discount);

  -- 5. Shipping Evaluation
  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'free_delivery_threshold';
  IF v_raw_val IS NOT NULL THEN fd_threshold := v_raw_val::numeric; END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'is_free_delivery_enabled';
  IF v_raw_val IS NOT NULL THEN is_fd_enabled := (v_raw_val = 'true'); END IF;

  SELECT value INTO v_raw_val FROM public.site_settings WHERE key = 'standard_shipping_fee';
  IF v_raw_val IS NOT NULL THEN std_shipping := v_raw_val::numeric; END IF;

  IF is_fd_enabled AND net_subtotal >= fd_threshold THEN
    shipping := 0;
  ELSE
    shipping := std_shipping;
  END IF;

  -- 6. Payment Method & COD Evaluation
  v_clean_payment_method := lower(trim(COALESCE(_payment_method, 'online')));
  IF v_clean_payment_method = 'cod' THEN
    SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
    IF ps_rec.id IS NULL OR NOT ps_rec.cod_enabled THEN
      RAISE EXCEPTION 'Cash on Delivery is currently unavailable. Please select online payment.';
    END IF;

    IF ps_rec.cod_min_order_value > 0 AND net_subtotal < ps_rec.cod_min_order_value THEN
      RAISE EXCEPTION 'Minimum cart value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
    END IF;

    IF ps_rec.cod_max_order_value > 0 AND net_subtotal > ps_rec.cod_max_order_value THEN
      RAISE EXCEPTION 'Maximum cart value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
    END IF;

    cod_fee := COALESCE(ps_rec.cod_fee, 0);
  ELSE
    v_clean_payment_method := 'online';
    cod_fee := 0;
  END IF;

  computed_total := net_subtotal + shipping + cod_fee;
  v_session_id := 'cs_' || replace(gen_random_uuid()::text, '-', '');

  -- 7. Insert checkout_session record
  INSERT INTO public.checkout_sessions (
    session_id, user_id, status, customer_details, items, pricing_breakdown,
    coupon_code, subtotal, shipping_fee, cod_fee, discount, total, currency,
    payment_method, idempotency_key, expires_at
  ) VALUES (
    v_session_id, uid, 'active',
    jsonb_build_object(
      'full_name', _full_name,
      'email', _email,
      'phone', _phone,
      'alt_phone', _alt_phone,
      'address', _address,
      'address_line2', _address_line2,
      'landmark', _landmark,
      'city', _city,
      'state', _state,
      'pincode', _pincode,
      'notes', _notes
    ),
    validated_items,
    jsonb_build_object(
      'subtotal', computed_subtotal,
      'mrp_total', computed_mrp_total,
      'product_savings', GREATEST(0, computed_mrp_total - computed_subtotal),
      'coupon_discount', computed_discount,
      'shipping_fee', shipping,
      'cod_fee', cod_fee,
      'total', computed_total
    ),
    _coupon_code, computed_subtotal, shipping, cod_fee, computed_discount, computed_total, 'INR',
    v_clean_payment_method, v_clean_idem, (now() + interval '30 minutes')
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'subtotal', computed_subtotal,
    'shipping_fee', shipping,
    'cod_fee', cod_fee,
    'discount', computed_discount,
    'total', computed_total,
    'currency', 'INR',
    'payment_method', v_clean_payment_method,
    'items', validated_items,
    'expires_at', (now() + interval '30 minutes'),
    'duplicate', false
  );
END;
$$;

-- 7. RPC: record_payment_attempt
CREATE OR REPLACE FUNCTION public.record_payment_attempt(
  _session_id text,
  _razorpay_order_id text,
  _amount numeric,
  _currency text DEFAULT 'INR'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  session_rec record;
  attempt_id uuid;
BEGIN
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found: %', _session_id;
  END IF;

  IF session_rec.expires_at < now() THEN
    UPDATE public.checkout_sessions SET status = 'expired', updated_at = now() WHERE id = session_rec.id;
    RAISE EXCEPTION 'Checkout session has expired. Please refresh your cart.';
  END IF;

  IF session_rec.status = 'converted' THEN
    RAISE EXCEPTION 'Order for this session has already been finalized.';
  END IF;

  -- Insert payment attempt
  INSERT INTO public.payment_attempts (
    checkout_session_id, razorpay_order_id, amount, currency, status
  ) VALUES (
    session_rec.id, _razorpay_order_id, _amount, COALESCE(_currency, 'INR'), 'initiated'
  )
  ON CONFLICT (razorpay_order_id) DO UPDATE SET
    updated_at = now()
  RETURNING id INTO attempt_id;

  -- Update session status
  UPDATE public.checkout_sessions
  SET status = 'payment_pending', updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'attempt_id', attempt_id,
    'session_id', _session_id,
    'razorpay_order_id', _razorpay_order_id
  );
END;
$$;

-- 8. RPC: update_payment_attempt_status
CREATE OR REPLACE FUNCTION public.update_payment_attempt_status(
  _razorpay_order_id text,
  _status text,
  _failure_reason text DEFAULT NULL,
  _gateway_response jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_rec record;
  new_session_status text;
BEGIN
  SELECT * INTO attempt_rec
  FROM public.payment_attempts
  WHERE razorpay_order_id = _razorpay_order_id
  FOR UPDATE;

  IF attempt_rec.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment attempt not found');
  END IF;

  IF attempt_rec.status = 'captured' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Payment already captured');
  END IF;

  UPDATE public.payment_attempts
  SET
    status = _status,
    failure_reason = COALESCE(_failure_reason, failure_reason),
    gateway_response = COALESCE(_gateway_response, gateway_response),
    updated_at = now()
  WHERE id = attempt_rec.id;

  IF _status = 'cancelled' THEN
    new_session_status := 'payment_cancelled';
  ELSIF _status = 'failed' OR _status = 'verification_failed' THEN
    new_session_status := 'payment_failed';
  ELSE
    new_session_status := 'payment_pending';
  END IF;

  UPDATE public.checkout_sessions
  SET status = new_session_status, updated_at = now()
  WHERE id = attempt_rec.checkout_session_id
    AND status != 'converted';

  RETURN jsonb_build_object('success', true, 'status', _status);
END;
$$;

-- 9. RPC: finalize_paid_order (Atomic order creation on verified payment)
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  _session_id text,
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _razorpay_signature text,
  _verified_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  attempt_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  v_buying_price numeric := 0;
  v_prev_stock int;
  v_new_stock int;
  cust jsonb;
BEGIN
  -- 1. Fetch & Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
     OR id IN (SELECT checkout_session_id FROM public.payment_attempts WHERE razorpay_order_id = _razorpay_order_id)
  LIMIT 1
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found for order reference: %', _razorpay_order_id;
  END IF;

  -- 2. Idempotency Check: Order already finalized
  IF session_rec.status = 'converted' AND session_rec.order_id IS NOT NULL THEN
    SELECT * INTO existing_order FROM public.orders WHERE id = session_rec.order_id;
    IF existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', existing_order.id,
        'order_number', existing_order.order_number,
        'invoice_no', existing_order.invoice_no,
        'total', existing_order.total,
        'payment_status', existing_order.payment_status,
        'status', existing_order.status,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Check if order with this razorpay_order_id already exists
  SELECT * INTO existing_order FROM public.orders WHERE razorpay_order_id = _razorpay_order_id LIMIT 1;
  IF existing_order.id IS NOT NULL THEN
    UPDATE public.checkout_sessions
    SET status = 'converted', order_id = existing_order.id, updated_at = now()
    WHERE id = session_rec.id;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', existing_order.id,
      'order_number', existing_order.order_number,
      'invoice_no', existing_order.invoice_no,
      'total', existing_order.total,
      'payment_status', existing_order.payment_status,
      'status', existing_order.status,
      'duplicate', true
    );
  END IF;

  -- 3. Verify Amount Match
  -- _verified_amount is in paise (INR * 100)
  IF _verified_amount IS NOT NULL AND _verified_amount > 0 THEN
    IF abs(ROUND(session_rec.total * 100) - _verified_amount) > 1 THEN
      RAISE EXCEPTION 'Payment amount mismatch: Expected ₹%, received ₹%', session_rec.total, (_verified_amount / 100);
    END IF;
  END IF;

  cust := session_rec.customer_details;

  -- 4. Atomic Stock Validation & Deduction FOR UPDATE
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, qty int, price numeric, mrp numeric, product_name text
  ) LOOP
    SELECT v.id, v.stock AS v_stock, p.stock AS p_stock, p.id AS p_id, p.name AS p_name
    INTO variant_rec
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item_rec.variant_id
    FOR UPDATE OF v, p;

    IF variant_rec.id IS NULL THEN
      RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
    END IF;

    IF variant_rec.v_stock < item_rec.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (Available: %, Requested: %)', variant_rec.p_name, variant_rec.v_stock, item_rec.qty;
    END IF;
  END LOOP;

  -- 5. Create Order Record
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping, discount, total,
    coupon_code, status, payment_method, payment_status, full_name, email, phone,
    alt_phone, address, address_line2, landmark, city, state, pincode, notes,
    idempotency_key, razorpay_order_id, razorpay_payment_id, razorpay_signature
  ) VALUES (
    new_order_id,
    session_rec.user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    session_rec.shipping_fee,
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'processing'::public.order_status,
    'razorpay',
    'paid'::public.payment_status,
    COALESCE(cust->>'full_name', ''),
    COALESCE(cust->>'email', ''),
    COALESCE(cust->>'phone', ''),
    COALESCE(cust->>'alt_phone', ''),
    COALESCE(cust->>'address', ''),
    COALESCE(cust->>'address_line2', ''),
    COALESCE(cust->>'landmark', ''),
    COALESCE(cust->>'city', ''),
    COALESCE(cust->>'state', ''),
    COALESCE(cust->>'pincode', ''),
    COALESCE(cust->>'notes', ''),
    session_rec.idempotency_key,
    _razorpay_order_id,
    _razorpay_payment_id,
    _razorpay_signature
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'processing', 'Payment verified and order placed successfully', session_rec.user_id);

  -- 6. Insert Order Items & Deduct Inventory Exactly Once
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, product_slug text, product_name text, variant_sku text,
    variant_barcode text, variant_color text, variant_size text, price numeric, mrp numeric,
    qty int, line_subtotal numeric, image_url text
  ) LOOP
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, item_rec.product_id, item_rec.variant_id, item_rec.product_slug, item_rec.qty,
      item_rec.price, item_rec.line_subtotal, item_rec.variant_sku, item_rec.variant_color,
      item_rec.variant_size, item_rec.variant_barcode, item_rec.image_url, item_rec.image_url,
      item_rec.product_name, item_rec.product_name, COALESCE(v_buying_price, 0)
    );

    SELECT p.stock INTO v_prev_stock FROM public.products p WHERE id = item_rec.product_id;
    v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);

    UPDATE public.product_variants
    SET stock = GREATEST(0, stock - item_rec.qty)
    WHERE id = item_rec.variant_id;

    UPDATE public.products
    SET stock = v_new_stock
    WHERE id = item_rec.product_id;

    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      item_rec.product_id, item_rec.variant_id, 'sale'::public.inventory_tx_type, -item_rec.qty,
      v_prev_stock, v_new_stock, 'order', new_order_id, 'Order ' || new_order_number, session_rec.user_id
    );
  END LOOP;

  -- 7. Record into public.payments
  INSERT INTO public.payments (
    order_id, user_id, provider, payment_id, order_reference, amount, currency, status, method
  ) VALUES (
    new_order_id,
    COALESCE(session_rec.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    'razorpay',
    _razorpay_payment_id,
    _razorpay_order_id,
    session_rec.total,
    'INR',
    'paid'::public.payment_status,
    'online'
  );

  -- 8. Increment Coupon Usage if applicable
  IF session_rec.coupon_code IS NOT NULL AND trim(session_rec.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = used_count + 1
    WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));

    IF session_rec.user_id IS NOT NULL THEN
      INSERT INTO public.coupon_usage (coupon_id, user_id, order_id)
      SELECT id, session_rec.user_id, new_order_id
      FROM public.coupons
      WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));
    END IF;
  END IF;

  -- 9. Update Payment Attempt & Checkout Session Status
  UPDATE public.payment_attempts
  SET
    status = 'captured',
    razorpay_payment_id = _razorpay_payment_id,
    razorpay_signature = _razorpay_signature,
    verified_at = now(),
    updated_at = now()
  WHERE razorpay_order_id = _razorpay_order_id;

  UPDATE public.checkout_sessions
  SET
    status = 'converted',
    order_id = new_order_id,
    updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'paid',
    'status', 'processing',
    'duplicate', false
  );
END;
$$;

-- 10. RPC: place_cod_order (Atomic COD order creation + stock deduction)
CREATE OR REPLACE FUNCTION public.place_cod_order(
  _session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  session_rec record;
  ps_rec record;
  existing_order record;
  new_order_id uuid;
  new_invoice text;
  new_order_number text;
  item_rec record;
  variant_rec record;
  v_buying_price numeric := 0;
  v_prev_stock int;
  v_new_stock int;
  cust jsonb;
BEGIN
  -- 1. Fetch & Lock Checkout Session
  SELECT * INTO session_rec
  FROM public.checkout_sessions
  WHERE session_id = _session_id
  FOR UPDATE;

  IF session_rec.id IS NULL THEN
    RAISE EXCEPTION 'Checkout session not found: %', _session_id;
  END IF;

  IF session_rec.expires_at < now() THEN
    UPDATE public.checkout_sessions SET status = 'expired', updated_at = now() WHERE id = session_rec.id;
    RAISE EXCEPTION 'Checkout session has expired. Please refresh your cart.';
  END IF;

  -- 2. Idempotency Guard
  IF session_rec.status = 'converted' AND session_rec.order_id IS NOT NULL THEN
    SELECT * INTO existing_order FROM public.orders WHERE id = session_rec.order_id;
    IF existing_order.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'order_id', existing_order.id,
        'order_number', existing_order.order_number,
        'invoice_no', existing_order.invoice_no,
        'total', existing_order.total,
        'payment_status', existing_order.payment_status,
        'status', existing_order.status,
        'duplicate', true
      );
    END IF;
  END IF;

  -- 3. Verify COD is Enabled in Admin Settings
  SELECT * INTO ps_rec FROM public.payment_settings LIMIT 1;
  IF ps_rec.id IS NULL OR NOT ps_rec.cod_enabled THEN
    RAISE EXCEPTION 'Cash on Delivery is currently disabled by store administration.';
  END IF;

  IF ps_rec.cod_min_order_value > 0 AND (session_rec.subtotal - session_rec.discount) < ps_rec.cod_min_order_value THEN
    RAISE EXCEPTION 'Minimum cart value for Cash on Delivery is ₹%', ps_rec.cod_min_order_value;
  END IF;

  IF ps_rec.cod_max_order_value > 0 AND (session_rec.subtotal - session_rec.discount) > ps_rec.cod_max_order_value THEN
    RAISE EXCEPTION 'Maximum cart value for Cash on Delivery is ₹%', ps_rec.cod_max_order_value;
  END IF;

  cust := session_rec.customer_details;

  -- 4. Atomic Stock Validation FOR UPDATE
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, qty int, price numeric, mrp numeric, product_name text
  ) LOOP
    SELECT v.id, v.stock AS v_stock, p.stock AS p_stock, p.id AS p_id, p.name AS p_name
    INTO variant_rec
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.id = item_rec.variant_id
    FOR UPDATE OF v, p;

    IF variant_rec.id IS NULL THEN
      RAISE EXCEPTION 'Product variant not found: %', item_rec.variant_id;
    END IF;

    IF variant_rec.v_stock < item_rec.qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (Available: %, Requested: %)', variant_rec.p_name, variant_rec.v_stock, item_rec.qty;
    END IF;
  END LOOP;

  -- 5. Create COD Order Record
  new_order_id := gen_random_uuid();
  new_invoice := public.generate_invoice_number();
  new_order_number := public.generate_order_number();

  INSERT INTO public.orders (
    id, user_id, invoice_no, order_number, subtotal, shipping, discount, total,
    coupon_code, status, payment_method, payment_status, full_name, email, phone,
    alt_phone, address, address_line2, landmark, city, state, pincode, notes,
    idempotency_key
  ) VALUES (
    new_order_id,
    session_rec.user_id,
    new_invoice,
    new_order_number,
    session_rec.subtotal,
    (session_rec.shipping_fee + session_rec.cod_fee),
    session_rec.discount,
    session_rec.total,
    session_rec.coupon_code,
    'placed'::public.order_status,
    'cod',
    'pending'::public.payment_status,
    COALESCE(cust->>'full_name', ''),
    COALESCE(cust->>'email', ''),
    COALESCE(cust->>'phone', ''),
    COALESCE(cust->>'alt_phone', ''),
    COALESCE(cust->>'address', ''),
    COALESCE(cust->>'address_line2', ''),
    COALESCE(cust->>'landmark', ''),
    COALESCE(cust->>'city', ''),
    COALESCE(cust->>'state', ''),
    COALESCE(cust->>'pincode', ''),
    COALESCE(cust->>'notes', ''),
    session_rec.idempotency_key
  );

  INSERT INTO public.order_status_history (order_id, new_status, note, changed_by)
  VALUES (new_order_id, 'placed', 'Order placed via Cash on Delivery (Unpaid)', session_rec.user_id);

  -- 6. Insert Order Items & Deduct Inventory Exactly Once
  FOR item_rec IN SELECT * FROM jsonb_to_recordset(session_rec.items) AS x(
    variant_id uuid, product_id uuid, product_slug text, product_name text, variant_sku text,
    variant_barcode text, variant_color text, variant_size text, price numeric, mrp numeric,
    qty int, line_subtotal numeric, image_url text
  ) LOOP
    SELECT COALESCE(buying_price, 0) INTO v_buying_price
    FROM public.product_costs
    WHERE product_id = item_rec.product_id
    LIMIT 1;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_slug, qty, price, subtotal, sku_snapshot,
      color, size, barcode_snapshot, image_url_snapshot, image_url, product_name_snapshot, name, buying_price
    ) VALUES (
      new_order_id, item_rec.product_id, item_rec.variant_id, item_rec.product_slug, item_rec.qty,
      item_rec.price, item_rec.line_subtotal, item_rec.variant_sku, item_rec.variant_color,
      item_rec.variant_size, item_rec.variant_barcode, item_rec.image_url, item_rec.image_url,
      item_rec.product_name, item_rec.product_name, COALESCE(v_buying_price, 0)
    );

    SELECT p.stock INTO v_prev_stock FROM public.products p WHERE id = item_rec.product_id;
    v_new_stock := GREATEST(0, v_prev_stock - item_rec.qty);

    UPDATE public.product_variants
    SET stock = GREATEST(0, stock - item_rec.qty)
    WHERE id = item_rec.variant_id;

    UPDATE public.products
    SET stock = v_new_stock
    WHERE id = item_rec.product_id;

    INSERT INTO public.inventory_transactions (
      product_id, variant_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id, note, created_by
    ) VALUES (
      item_rec.product_id, item_rec.variant_id, 'sale'::public.inventory_tx_type, -item_rec.qty,
      v_prev_stock, v_new_stock, 'order', new_order_id, 'COD Order ' || new_order_number, session_rec.user_id
    );
  END LOOP;

  -- 7. Increment Coupon Usage
  IF session_rec.coupon_code IS NOT NULL AND trim(session_rec.coupon_code) != '' THEN
    UPDATE public.coupons
    SET used_count = used_count + 1
    WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));

    IF session_rec.user_id IS NOT NULL THEN
      INSERT INTO public.coupon_usage (coupon_id, user_id, order_id)
      SELECT id, session_rec.user_id, new_order_id
      FROM public.coupons
      WHERE UPPER(code) = UPPER(trim(session_rec.coupon_code));
    END IF;
  END IF;

  -- 8. Mark Session Converted
  UPDATE public.checkout_sessions
  SET
    status = 'converted',
    order_id = new_order_id,
    updated_at = now()
  WHERE id = session_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_no', new_invoice,
    'total', session_rec.total,
    'payment_status', 'pending',
    'status', 'placed',
    'duplicate', false
  );
END;
$$;

-- 11. RPC: cancel_checkout_session
CREATE OR REPLACE FUNCTION public.cancel_checkout_session(
  _session_id text,
  _reason text DEFAULT 'User closed payment modal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.checkout_sessions
  SET
    status = 'payment_cancelled',
    updated_at = now()
  WHERE session_id = _session_id
    AND status != 'converted';

  UPDATE public.payment_attempts
  SET
    status = 'cancelled',
    failure_reason = _reason,
    updated_at = now()
  WHERE checkout_session_id IN (SELECT id FROM public.checkout_sessions WHERE session_id = _session_id)
    AND status != 'captured';

  RETURN jsonb_build_object('success', true, 'session_id', _session_id, 'status', 'payment_cancelled');
END;
$$;

-- Grant permissions to anon, authenticated and service_role
GRANT SELECT ON public.checkout_sessions TO anon, authenticated;
GRANT SELECT ON public.payment_attempts TO anon, authenticated;
GRANT SELECT ON public.payment_settings TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_payment_settings TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_settings TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_session TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_attempt TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_attempt_status TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.place_cod_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_checkout_session TO anon, authenticated, service_role;
