-- Add customer_name column for logged in visitors
ALTER TABLE public.website_visitors 
ADD COLUMN IF NOT EXISTS customer_name TEXT;