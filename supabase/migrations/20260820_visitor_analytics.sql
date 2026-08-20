CREATE TABLE IF NOT EXISTS public.website_visitors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    city TEXT,
    region TEXT,
    country TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.website_visitors ENABLE ROW LEVEL SECURITY;

-- Allow anonymous and authenticated users to insert records (for tracking)
CREATE POLICY "Allow public insert to website_visitors"
    ON public.website_visitors
    FOR INSERT
    WITH CHECK (true);

-- Allow only admins to select (view) records
CREATE POLICY "Allow admins to view website_visitors"
    ON public.website_visitors
    FOR SELECT
    USING (
        public.has_role('admin', auth.uid())
    );

-- Grant privileges
GRANT SELECT, INSERT ON public.website_visitors TO anon;
GRANT SELECT, INSERT ON public.website_visitors TO authenticated;
GRANT ALL ON public.website_visitors TO service_role;
