-- Migration: Truncate Sales Data
TRUNCATE TABLE public.orders CASCADE;
TRUNCATE TABLE public.offline_sales CASCADE;
TRUNCATE TABLE public.website_visitors CASCADE;
