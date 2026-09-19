-- ==============================================================================
-- Migration: 20260928000278_pos_returns_parameter_aliases.sql
-- Description: Provide parameter compatibility for process_offline_return RPC
-- ==============================================================================

-- 1. Ensure grants on canonical process_offline_return
GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text
) TO authenticated, anon, service_role;

-- 2. Create alias function supporting _offline_return_number and _offline_credit_token
CREATE OR REPLACE FUNCTION public.process_offline_return(
  _customer_name text DEFAULT 'Walk-in Customer',
  _customer_phone text DEFAULT '',
  _customer_email text DEFAULT '',
  _customer_id uuid DEFAULT NULL,
  _refund_method text DEFAULT 'exchange_credit',
  _refund_status text DEFAULT 'completed',
  _return_reason text DEFAULT 'Customer changed mind',
  _notes text DEFAULT '',
  _original_sale_id uuid DEFAULT NULL,
  _items jsonb DEFAULT '[]'::jsonb,
  _idempotency_key text DEFAULT NULL,
  _offline_return_number text DEFAULT NULL,
  _offline_credit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.process_offline_return(
    _customer_name => _customer_name,
    _customer_phone => _customer_phone,
    _customer_email => _customer_email,
    _customer_id => _customer_id,
    _refund_method => _refund_method,
    _refund_status => _refund_status,
    _return_reason => _return_reason,
    _notes => _notes,
    _original_sale_id => _original_sale_id,
    _items => _items,
    _idempotency_key => _idempotency_key,
    _custom_return_number => _offline_return_number,
    _custom_credit_token => _offline_credit_token
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text
) TO authenticated, anon, service_role;
