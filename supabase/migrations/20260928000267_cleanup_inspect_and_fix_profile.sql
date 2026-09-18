-- Migration: 20260928000267_cleanup_inspect_and_fix_profile.sql
-- Fix any profile phone inconsistencies and drop temporary inspection function

UPDATE public.profiles
SET phone = '+919928010786'
WHERE id = '0981b556-995a-4a06-8af9-07a599ec425b' AND (phone = '07014098198' OR phone = '7014098198');

UPDATE public.profiles
SET phone = '+917014098198'
WHERE id = '57360b7b-9a4f-405e-bc8a-0078828bd6ab';

DROP FUNCTION IF EXISTS public.inspect_user_auth_status(text);
