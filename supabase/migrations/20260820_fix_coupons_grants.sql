-- Grant full access to authenticated users on the coupons table
-- (RLS policies will continue to enforce actual permissions)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
