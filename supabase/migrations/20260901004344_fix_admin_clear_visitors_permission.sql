-- Grant DELETE to authenticated users so the direct delete fallback works
GRANT DELETE ON public.website_visitors TO authenticated;

-- Also explicitly grant DELETE to admin users if they have a specific role
-- But the RLS policy already handles the restriction.

-- Ensure the RPC is completely robust
CREATE OR REPLACE FUNCTION public.clear_website_visitors()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can clear visitor telemetry.';
    END IF;
    DELETE FROM public.website_visitors;
END;
$$;
