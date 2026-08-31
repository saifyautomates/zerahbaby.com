-- Allow admins to delete website_visitors records
DROP POLICY IF EXISTS "Allow admins to delete website_visitors" ON public.website_visitors;
CREATE POLICY "Allow admins to delete website_visitors"
    ON public.website_visitors
    FOR DELETE
    TO authenticated
    USING (
        public.has_role(auth.uid(), 'admin')
    );

-- Create RPC to clear website visitors
CREATE OR REPLACE FUNCTION public.clear_website_visitors()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can clear visitor telemetry.';
    END IF;
    DELETE FROM public.website_visitors;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_website_visitors() TO authenticated;
