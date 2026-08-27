-- ============================================================
-- ZÉRAH BABY & KIDS — WORLD-CLASS CUSTOMER QUERIES SYSTEM
-- Migration: 202609110004_customer_queries_system.sql
-- ============================================================

-- 1. Ensure public.contact_messages exists and has full normalized schema
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  order_number TEXT,
  message TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  admin_notes TEXT,
  handled BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add any missing columns to contact_messages
ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS admin_notes TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- Ensure status and priority constraints
ALTER TABLE public.contact_messages DROP CONSTRAINT IF EXISTS contact_messages_status_check;
ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_status_check
  CHECK (status IN ('new', 'in_progress', 'resolved', 'closed'));

ALTER TABLE public.contact_messages DROP CONSTRAINT IF EXISTS contact_messages_priority_check;
ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

-- Table-level unique constraint on idempotency_key
ALTER TABLE public.contact_messages DROP CONSTRAINT IF EXISTS contact_messages_idempotency_key_key;
ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_idempotency_key_key UNIQUE (idempotency_key);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON public.contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON public.contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON public.contact_messages(lower(email));
CREATE INDEX IF NOT EXISTS idx_contact_messages_order_number ON public.contact_messages(order_number);

-- 2. Grants & RLS
GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit a contact message" ON public.contact_messages;
CREATE POLICY "Anyone can submit a contact message"
  ON public.contact_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can read contact messages" ON public.contact_messages;
CREATE POLICY "Admins can read contact messages"
  ON public.contact_messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete contact messages" ON public.contact_messages;
CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Stored Procedure: submit_customer_query (Server-side validation & anti-spam)
CREATE OR REPLACE FUNCTION public.submit_customer_query(
  _name TEXT,
  _email TEXT,
  _message TEXT,
  _order_number TEXT DEFAULT NULL,
  _phone TEXT DEFAULT NULL,
  _idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_name TEXT;
  clean_email TEXT;
  clean_message TEXT;
  clean_order TEXT;
  clean_phone TEXT;
  clean_idempotency TEXT;
  recent_submissions_count INT;
  existing_id UUID;
  new_id UUID;
BEGIN
  -- Whitespace trimming and normalization
  clean_name := trim(COALESCE(_name, ''));
  clean_email := lower(trim(COALESCE(_email, '')));
  clean_message := trim(COALESCE(_message, ''));
  clean_order := NULLIF(trim(COALESCE(_order_number, '')), '');
  clean_phone := NULLIF(trim(COALESCE(_phone, '')), '');
  clean_idempotency := NULLIF(trim(COALESCE(_idempotency_key, '')), '');

  -- Server-Side Validation
  IF length(clean_name) < 2 THEN
    RAISE EXCEPTION 'Please provide your full name (minimum 2 characters)';
  END IF;
  IF length(clean_name) > 150 THEN
    RAISE EXCEPTION 'Name must not exceed 150 characters';
  END IF;

  IF clean_email = '' OR clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Please provide a valid email address';
  END IF;
  IF length(clean_email) > 255 THEN
    RAISE EXCEPTION 'Email must not exceed 255 characters';
  END IF;

  IF length(clean_message) < 5 THEN
    RAISE EXCEPTION 'Please enter your message (minimum 5 characters)';
  END IF;
  IF length(clean_message) > 3000 THEN
    RAISE EXCEPTION 'Message must not exceed 3000 characters';
  END IF;

  -- Optional Phone length safety
  IF clean_phone IS NOT NULL AND length(clean_phone) > 30 THEN
    clean_phone := substring(clean_phone from 1 for 30);
  END IF;

  -- Anti-Spam / Rate-Limiting: Max 5 submissions per email within 10 minutes
  SELECT count(*) INTO recent_submissions_count
  FROM public.contact_messages
  WHERE lower(email) = clean_email
    AND created_at > (now() - interval '10 minutes');

  IF recent_submissions_count >= 5 THEN
    RAISE EXCEPTION 'Too many submissions received. Please wait a few minutes before sending another inquiry.';
  END IF;

  -- Idempotency Check: if identical idempotency_key was already processed
  IF clean_idempotency IS NOT NULL THEN
    SELECT id INTO existing_id
    FROM public.contact_messages
    WHERE idempotency_key = clean_idempotency;

    IF existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'query_id', existing_id,
        'status', 'new',
        'already_submitted', true,
        'message', 'Query has already been received.'
      );
    END IF;
  END IF;

  -- Authoritative Insert
  INSERT INTO public.contact_messages (
    name,
    email,
    message,
    order_number,
    phone,
    idempotency_key,
    status,
    priority,
    handled,
    created_at,
    updated_at
  ) VALUES (
    clean_name,
    clean_email,
    clean_message,
    clean_order,
    clean_phone,
    clean_idempotency,
    'new',
    'normal',
    false,
    now(),
    now()
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'success', true,
    'query_id', new_id,
    'status', 'new',
    'already_submitted', false,
    'message', 'Query received successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_customer_query TO anon, authenticated, service_role;

-- 4. Stored Procedure: get_admin_queries (Bulletproof admin retrieval)
CREATE OR REPLACE FUNCTION public.get_admin_queries(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS SETOF public.contact_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required to access customer queries';
  END IF;

  RETURN QUERY
  SELECT * FROM public.contact_messages
  WHERE (p_status IS NULL OR p_status = 'ALL' OR status = p_status)
    AND (
      p_search IS NULL
      OR p_search = ''
      OR name ILIKE '%' || p_search || '%'
      OR email ILIKE '%' || p_search || '%'
      OR COALESCE(order_number, '') ILIKE '%' || p_search || '%'
      OR message ILIKE '%' || p_search || '%'
      OR id::text ILIKE '%' || p_search || '%'
    )
  ORDER BY created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_queries(TEXT, TEXT, INT) TO authenticated;

-- 5. Stored Procedure: update_query_status (Admin mutation)
CREATE OR REPLACE FUNCTION public.update_query_status(
  p_query_id UUID,
  p_status TEXT,
  p_priority TEXT DEFAULT NULL,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS public.contact_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.contact_messages;
  is_handled BOOLEAN;
  res_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required';
  END IF;

  IF p_status NOT IN ('new', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Invalid status value: %', p_status;
  END IF;

  IF p_status IN ('resolved', 'closed') THEN
    is_handled := true;
    res_at := now();
  ELSE
    is_handled := false;
    res_at := NULL;
  END IF;

  UPDATE public.contact_messages
  SET
    status = p_status,
    priority = COALESCE(p_priority, priority),
    admin_notes = COALESCE(p_admin_notes, admin_notes),
    handled = is_handled,
    resolved_at = COALESCE(res_at, resolved_at),
    updated_at = now()
  WHERE id = p_query_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Query record not found with id: %', p_query_id;
  END IF;

  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_query_status(UUID, TEXT, TEXT, TEXT) TO authenticated;
