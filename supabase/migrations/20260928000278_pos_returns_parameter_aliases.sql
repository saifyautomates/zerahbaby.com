-- ==============================================================================
-- Migration: 20260928000278_pos_returns_parameter_aliases.sql
-- Description: Ensure canonical grants and execution permissions for process_offline_return
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.process_offline_return(
  text, text, text, uuid, text, text, text, text, uuid, jsonb, text, text, text
) TO authenticated, anon, service_role;
