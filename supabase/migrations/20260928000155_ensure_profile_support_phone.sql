-- Migration: 20260928000155_ensure_profile_support_phone.sql
-- Description: Update ensure_profile to copy phone number and email from auth.users

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.profiles (id, email, phone)
  VALUES (
    uid,
    COALESCE((SELECT email FROM auth.users WHERE id = uid), ''),
    COALESCE((SELECT phone FROM auth.users WHERE id = uid), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    phone = CASE 
      WHEN public.profiles.phone IS NULL OR public.profiles.phone = '' 
      THEN COALESCE((SELECT phone FROM auth.users WHERE id = uid), '')
      ELSE public.profiles.phone 
    END,
    email = CASE 
      WHEN public.profiles.email IS NULL OR public.profiles.email = '' 
      THEN COALESCE((SELECT email FROM auth.users WHERE id = uid), '')
      ELSE public.profiles.email 
    END;
END; $$;
