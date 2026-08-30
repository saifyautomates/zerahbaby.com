-- Fix 401 Unauthorized for analytics_events inserts
CREATE POLICY "Allow anonymous inserts for analytics"
  ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Ensure get_related_products is executable by anon users (fixing 400 Bad Request if missing grants)
GRANT EXECUTE ON FUNCTION public.get_related_products(uuid, integer) TO anon, authenticated;
