-- Migration: Add Delete RPCs and clear existing test data for queries and sms logs

-- 1. Wipe existing mock data
TRUNCATE TABLE contact_messages;
TRUNCATE TABLE sms_logs;

-- 2. Create RPC to delete a query
CREATE OR REPLACE FUNCTION admin_delete_query(p_query_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify admin
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete queries.';
  END IF;

  DELETE FROM contact_messages WHERE id = p_query_id;
  RETURN TRUE;
END;
$$;

-- 3. Create RPC to delete an SMS log
CREATE OR REPLACE FUNCTION admin_delete_sms_log(p_log_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify admin
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete SMS logs.';
  END IF;

  DELETE FROM sms_logs WHERE id = p_log_id;
  RETURN TRUE;
END;
$$;
