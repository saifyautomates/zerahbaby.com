-- Migration: 20260928000175_unify_pos_customers_with_profiles.sql
-- Description: Unify offline POS customer system with authoritative Supabase profiles table

-- 1. Ensure profiles table allows creation of offline customers directly if no auth user exists
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
  ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ALTER TABLE public.profiles ALTER COLUMN full_name SET DEFAULT '';
  ALTER TABLE public.profiles ALTER COLUMN phone SET DEFAULT '';
  ALTER TABLE public.profiles ALTER COLUMN email SET DEFAULT '';
  ALTER TABLE public.profiles ALTER COLUMN city SET DEFAULT '';
  ALTER TABLE public.profiles ALTER COLUMN address SET DEFAULT '';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Ensure pos_customers has city, address, state, pincode columns
ALTER TABLE public.pos_customers
  ADD COLUMN IF NOT EXISTS city text DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS state text DEFAULT '',
  ADD COLUMN IF NOT EXISTS pincode text DEFAULT '';

-- 3. Drop unique phone index on pos_customers to allow multi-customer accounts with formatted variants
DROP INDEX IF EXISTS public.idx_pos_customers_phone;
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON public.pos_customers(phone);
CREATE INDEX IF NOT EXISTS idx_pos_customers_email ON public.pos_customers(email);
CREATE INDEX IF NOT EXISTS idx_pos_customers_city ON public.pos_customers(city);

-- 4. Backfill ALL existing profiles into pos_customers FIRST (so all profile IDs exist in pos_customers)
INSERT INTO public.pos_customers (
  id, name, phone, email, city, address, state, pincode, store_credit_balance, created_at, updated_at
)
SELECT 
  p.id,
  COALESCE(NULLIF(trim(p.full_name), ''), 'Guest Customer'),
  COALESCE(p.phone, ''),
  COALESCE(p.email, ''),
  COALESCE(p.city, ''),
  COALESCE(p.address, ''),
  COALESCE(p.state, ''),
  COALESCE(p.pincode, ''),
  COALESCE(p.store_credit_balance, 0),
  p.created_at,
  p.updated_at
FROM public.profiles p
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  city = EXCLUDED.city,
  address = EXCLUDED.address,
  state = EXCLUDED.state,
  pincode = EXCLUDED.pincode,
  store_credit_balance = EXCLUDED.store_credit_balance,
  updated_at = now();

-- 5. Re-link any legacy offline sales if matching customer exists in profiles
DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Find any legacy pos_customers where phone matches a profile in public.profiles
  FOR rec IN
    SELECT pc.id AS legacy_id, p.id AS profile_id
    FROM public.pos_customers pc
    JOIN public.profiles p ON (
      regexp_replace(COALESCE(pc.phone, ''), '[^0-9]', '', 'g') = regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g')
      AND regexp_replace(COALESCE(pc.phone, ''), '[^0-9]', '', 'g') != ''
    )
    WHERE pc.id != p.id
  LOOP
    -- Update offline_sales customer_id to point to the authoritative profile ID
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_sales') THEN
      UPDATE public.offline_sales
      SET customer_id = rec.profile_id
      WHERE customer_id = rec.legacy_id;
    END IF;

    -- Update offline_returns customer_id if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'offline_returns') THEN
      UPDATE public.offline_returns
      SET customer_id = rec.profile_id
      WHERE customer_id = rec.legacy_id;
    END IF;

    -- Update store_credit_ledger customer_id if exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'store_credit_ledger') THEN
      UPDATE public.store_credit_ledger
      SET customer_id = rec.profile_id
      WHERE customer_id = rec.legacy_id;
    END IF;

    -- Delete legacy duplicate row
    DELETE FROM public.pos_customers WHERE id = rec.legacy_id;
  END LOOP;
END $$;

-- 6. Trigger from profiles -> pos_customers
CREATE OR REPLACE FUNCTION public.fn_sync_profile_to_pos_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pos_customers (
    id, name, phone, email, city, address, state, pincode, store_credit_balance, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.full_name), ''), 'Guest Customer'),
    COALESCE(NEW.phone, ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.city, ''),
    COALESCE(NEW.address, ''),
    COALESCE(NEW.state, ''),
    COALESCE(NEW.pincode, ''),
    COALESCE(NEW.store_credit_balance, 0),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(NULLIF(trim(EXCLUDED.name), ''), public.pos_customers.name),
    phone = CASE WHEN EXCLUDED.phone != '' THEN EXCLUDED.phone ELSE public.pos_customers.phone END,
    email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE public.pos_customers.email END,
    city = CASE WHEN EXCLUDED.city != '' THEN EXCLUDED.city ELSE public.pos_customers.city END,
    address = CASE WHEN EXCLUDED.address != '' THEN EXCLUDED.address ELSE public.pos_customers.address END,
    state = CASE WHEN EXCLUDED.state != '' THEN EXCLUDED.state ELSE public.pos_customers.state END,
    pincode = CASE WHEN EXCLUDED.pincode != '' THEN EXCLUDED.pincode ELSE public.pos_customers.pincode END,
    store_credit_balance = COALESCE(EXCLUDED.store_credit_balance, public.pos_customers.store_credit_balance),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_to_pos_customer ON public.profiles;
CREATE TRIGGER trg_sync_profile_to_pos_customer
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_profile_to_pos_customer();

-- 7. Trigger from pos_customers -> profiles
CREATE OR REPLACE FUNCTION public.fn_sync_pos_customer_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (
    id, full_name, phone, email, city, address, state, pincode, store_credit_balance, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(NULLIF(trim(NEW.name), ''), 'Guest Customer'),
    COALESCE(NEW.phone, ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.city, ''),
    COALESCE(NEW.address, ''),
    COALESCE(NEW.state, ''),
    COALESCE(NEW.pincode, ''),
    COALESCE(NEW.store_credit_balance, 0),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(trim(EXCLUDED.full_name), ''), public.profiles.full_name),
    phone = CASE WHEN EXCLUDED.phone != '' THEN EXCLUDED.phone ELSE public.profiles.phone END,
    email = CASE WHEN EXCLUDED.email != '' THEN EXCLUDED.email ELSE public.profiles.email END,
    city = CASE WHEN EXCLUDED.city != '' THEN EXCLUDED.city ELSE public.profiles.city END,
    address = CASE WHEN EXCLUDED.address != '' THEN EXCLUDED.address ELSE public.profiles.address END,
    state = CASE WHEN EXCLUDED.state != '' THEN EXCLUDED.state ELSE public.profiles.state END,
    pincode = CASE WHEN EXCLUDED.pincode != '' THEN EXCLUDED.pincode ELSE public.profiles.pincode END,
    store_credit_balance = COALESCE(EXCLUDED.store_credit_balance, public.profiles.store_credit_balance),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pos_customer_to_profile ON public.pos_customers;
CREATE TRIGGER trg_sync_pos_customer_to_profile
AFTER INSERT OR UPDATE ON public.pos_customers
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_pos_customer_to_profile();

-- 8. Drop old search_pos_customers function signature and create unified authoritative search
DROP FUNCTION IF EXISTS public.search_pos_customers(text);

CREATE OR REPLACE FUNCTION public.search_pos_customers(_query text)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  state text,
  pincode text,
  notes text,
  total_purchases integer,
  total_spend numeric,
  store_credit_balance numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := trim(COALESCE(_query, ''));
  v_digits text := regexp_replace(v_clean, '[^0-9]', '', 'g');
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    p.id,
    COALESCE(NULLIF(trim(p.full_name), ''), 'Guest Customer') AS name,
    COALESCE(p.phone, '') AS phone,
    COALESCE(p.email, '') AS email,
    COALESCE(p.city, '') AS city,
    COALESCE(p.address, '') AS address,
    COALESCE(p.state, '') AS state,
    COALESCE(p.pincode, '') AS pincode,
    ''::text AS notes,
    (
      COALESCE((SELECT COUNT(*)::integer FROM public.orders o WHERE o.user_id = p.id AND o.status != 'cancelled'), 0)
      + COALESCE((SELECT COUNT(*)::integer FROM public.offline_sales s WHERE s.customer_id = p.id AND s.status != 'cancelled'), 0)
    )::integer AS total_purchases,
    (
      COALESCE((SELECT SUM(o.total)::numeric FROM public.orders o WHERE o.user_id = p.id AND o.status != 'cancelled'), 0)
      + COALESCE((SELECT SUM(s.total)::numeric FROM public.offline_sales s WHERE s.customer_id = p.id AND s.status != 'cancelled'), 0)
    )::numeric AS total_spend,
    COALESCE(p.store_credit_balance, 0)::numeric AS store_credit_balance,
    p.created_at,
    p.updated_at
  FROM public.profiles p
  WHERE 
    p.full_name ILIKE '%' || v_clean || '%'
    OR (v_digits != '' AND regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%')
    OR p.phone ILIKE '%' || v_clean || '%'
    OR p.email ILIKE '%' || v_clean || '%'
    OR p.city ILIKE '%' || v_clean || '%'
    OR p.address ILIKE '%' || v_clean || '%'
    OR p.id::text ILIKE '%' || v_clean || '%'
  ORDER BY 
    CASE 
      WHEN lower(trim(p.full_name)) = lower(v_clean) THEN 1
      WHEN regexp_replace(COALESCE(p.phone, ''), '[^0-9]', '', 'g') = v_digits AND v_digits != '' THEN 1
      WHEN lower(trim(p.full_name)) ILIKE lower(v_clean) || '%' THEN 2
      ELSE 3
    END,
    p.updated_at DESC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pos_customers(text) TO authenticated, anon, service_role;

-- 9. Canonical Customer Upsert Function
CREATE OR REPLACE FUNCTION public.upsert_authoritative_customer(
  _id uuid DEFAULT NULL,
  _name text DEFAULT '',
  _phone text DEFAULT '',
  _email text DEFAULT '',
  _city text DEFAULT '',
  _address text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust_id uuid := _id;
  v_clean_name text := trim(COALESCE(_name, ''));
  v_clean_phone text := trim(COALESCE(_phone, ''));
  v_clean_email text := lower(trim(COALESCE(_email, '')));
  v_clean_city text := trim(COALESCE(_city, ''));
  v_clean_address text := trim(COALESCE(_address, ''));
  v_clean_digits text := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  v_res record;
BEGIN
  IF v_clean_name = '' AND v_clean_phone = '' THEN
    RAISE EXCEPTION 'Customer name or phone is required';
  END IF;

  -- 1. If ID is provided, update
  IF v_cust_id IS NOT NULL THEN
    UPDATE public.profiles
    SET full_name = CASE WHEN v_clean_name != '' THEN v_clean_name ELSE full_name END,
        phone = CASE WHEN v_clean_phone != '' THEN v_clean_phone ELSE phone END,
        email = CASE WHEN v_clean_email != '' THEN v_clean_email ELSE email END,
        city = CASE WHEN v_clean_city != '' THEN v_clean_city ELSE city END,
        address = CASE WHEN v_clean_address != '' THEN v_clean_address ELSE address END,
        updated_at = now()
    WHERE id = v_cust_id;

    UPDATE public.pos_customers
    SET name = CASE WHEN v_clean_name != '' THEN v_clean_name ELSE name END,
        phone = CASE WHEN v_clean_phone != '' THEN v_clean_phone ELSE phone END,
        email = CASE WHEN v_clean_email != '' THEN v_clean_email ELSE email END,
        city = CASE WHEN v_clean_city != '' THEN v_clean_city ELSE city END,
        address = CASE WHEN v_clean_address != '' THEN v_clean_address ELSE address END,
        updated_at = now()
    WHERE id = v_cust_id;
  ELSE
    -- 2. Check existing by phone or email
    IF v_clean_digits != '' THEN
      SELECT id INTO v_cust_id
      FROM public.profiles
      WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_clean_digits
         OR (v_clean_email != '' AND lower(COALESCE(email, '')) = v_clean_email)
      LIMIT 1;

      IF v_cust_id IS NULL THEN
        SELECT id INTO v_cust_id
        FROM public.pos_customers
        WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_clean_digits
           OR (v_clean_email != '' AND lower(COALESCE(email, '')) = v_clean_email)
        LIMIT 1;
      END IF;
    ELSIF v_clean_email != '' THEN
      SELECT id INTO v_cust_id
      FROM public.profiles
      WHERE lower(COALESCE(email, '')) = v_clean_email
      LIMIT 1;
    END IF;

    IF v_cust_id IS NOT NULL THEN
      -- Update existing
      UPDATE public.profiles
      SET full_name = CASE WHEN v_clean_name != '' THEN v_clean_name ELSE full_name END,
          phone = CASE WHEN v_clean_phone != '' THEN v_clean_phone ELSE phone END,
          email = CASE WHEN v_clean_email != '' THEN v_clean_email ELSE email END,
          city = CASE WHEN v_clean_city != '' THEN v_clean_city ELSE city END,
          address = CASE WHEN v_clean_address != '' THEN v_clean_address ELSE address END,
          updated_at = now()
      WHERE id = v_cust_id;

      UPDATE public.pos_customers
      SET name = CASE WHEN v_clean_name != '' THEN v_clean_name ELSE name END,
          phone = CASE WHEN v_clean_phone != '' THEN v_clean_phone ELSE phone END,
          email = CASE WHEN v_clean_email != '' THEN v_clean_email ELSE email END,
          city = CASE WHEN v_clean_city != '' THEN v_clean_city ELSE city END,
          address = CASE WHEN v_clean_address != '' THEN v_clean_address ELSE address END,
          updated_at = now()
      WHERE id = v_cust_id;
    ELSE
      -- Brand new customer
      v_cust_id := gen_random_uuid();

      INSERT INTO public.profiles (
        id, full_name, phone, email, city, address, created_at, updated_at
      ) VALUES (
        v_cust_id,
        COALESCE(NULLIF(v_clean_name, ''), 'Guest Customer'),
        v_clean_phone,
        v_clean_email,
        v_clean_city,
        v_clean_address,
        now(),
        now()
      ) ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        city = EXCLUDED.city,
        address = EXCLUDED.address,
        updated_at = now();

      INSERT INTO public.pos_customers (
        id, name, phone, email, city, address, created_at, updated_at
      ) VALUES (
        v_cust_id,
        COALESCE(NULLIF(v_clean_name, ''), 'Guest Customer'),
        v_clean_phone,
        v_clean_email,
        v_clean_city,
        v_clean_address,
        now(),
        now()
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        city = EXCLUDED.city,
        address = EXCLUDED.address,
        updated_at = now();
    END IF;
  END IF;

  SELECT 
    p.id,
    COALESCE(NULLIF(p.full_name, ''), 'Guest Customer') AS name,
    COALESCE(p.phone, '') AS phone,
    COALESCE(p.email, '') AS email,
    COALESCE(p.city, '') AS city,
    COALESCE(p.address, '') AS address,
    COALESCE(p.store_credit_balance, 0) AS store_credit_balance
  INTO v_res
  FROM public.profiles p
  WHERE p.id = v_cust_id;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'name', v_res.name,
    'phone', v_res.phone,
    'email', v_res.email,
    'city', v_res.city,
    'address', v_res.address,
    'store_credit_balance', v_res.store_credit_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_authoritative_customer TO authenticated, anon, service_role;

-- 10. Canonical Customer Intel RPC
CREATE OR REPLACE FUNCTION public.get_pos_customer_intel(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof record;
  v_recent_sales jsonb;
  v_recent_orders jsonb;
  v_total_purchases integer;
  v_total_spend numeric;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = p_customer_id;
  IF v_prof.id IS NULL THEN
    SELECT 
      id, name AS full_name, phone, email, city, address, store_credit_balance
    INTO v_prof 
    FROM public.pos_customers WHERE id = p_customer_id;
  END IF;

  IF v_prof.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Combined total purchases and spend
  SELECT 
    (COALESCE((SELECT COUNT(*) FROM public.orders WHERE user_id = p_customer_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT COUNT(*) FROM public.offline_sales WHERE customer_id = p_customer_id AND status != 'cancelled'), 0)),
    (COALESCE((SELECT SUM(total) FROM public.orders WHERE user_id = p_customer_id AND status != 'cancelled'), 0)
     + COALESCE((SELECT SUM(total) FROM public.offline_sales WHERE customer_id = p_customer_id AND status != 'cancelled'), 0))
  INTO v_total_purchases, v_total_spend;

  -- Recent POS Sales
  SELECT jsonb_agg(sub) INTO v_recent_sales
  FROM (
    SELECT id, sale_number, total, payment_method, return_status, created_at
    FROM public.offline_sales
    WHERE customer_id = p_customer_id
    ORDER BY created_at DESC
    LIMIT 3
  ) sub;

  -- Recent Online Orders
  SELECT jsonb_agg(sub) INTO v_recent_orders
  FROM (
    SELECT id, order_number, total, payment_method, status, created_at
    FROM public.orders
    WHERE user_id = p_customer_id
    ORDER BY created_at DESC
    LIMIT 3
  ) sub;

  RETURN jsonb_build_object(
    'id', v_prof.id,
    'name', COALESCE(NULLIF(v_prof.full_name, ''), 'Guest Customer'),
    'phone', COALESCE(v_prof.phone, ''),
    'email', COALESCE(v_prof.email, ''),
    'city', COALESCE(v_prof.city, ''),
    'address', COALESCE(v_prof.address, ''),
    'total_purchases', v_total_purchases,
    'total_spend', v_total_spend,
    'store_credit_balance', COALESCE(v_prof.store_credit_balance, 0),
    'recentSales', COALESCE(v_recent_sales, '[]'::jsonb),
    'recentOrders', COALESCE(v_recent_orders, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pos_customer_intel(uuid) TO authenticated, anon, service_role;
