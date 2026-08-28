-- Create RPC to delete a query
CREATE OR REPLACE FUNCTION admin_delete_query(p_query_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify admin using the standard role check
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete queries.';
  END IF;

  DELETE FROM contact_messages WHERE id = p_query_id;
  RETURN TRUE;
END;
$$;

-- Create RPC to delete an SMS log
CREATE OR REPLACE FUNCTION admin_delete_sms_log(p_log_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify admin using the standard role check
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete SMS logs.';
  END IF;

  DELETE FROM sms_logs WHERE id = p_log_id;
  RETURN TRUE;
END;
$$;
