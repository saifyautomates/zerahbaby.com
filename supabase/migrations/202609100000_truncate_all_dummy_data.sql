-- Migration to completely wipe all products, offline sales, and online orders
-- so the user can start from a clean slate tomorrow.

TRUNCATE TABLE public.offline_sales CASCADE;
TRUNCATE TABLE public.orders CASCADE;
TRUNCATE TABLE public.products CASCADE;
