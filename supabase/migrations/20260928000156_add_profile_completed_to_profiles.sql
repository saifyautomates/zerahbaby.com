-- Migration: 20260928000156_add_profile_completed_to_profiles.sql
-- Description: Add authoritative profile_completed and profile_completed_at fields to profiles table

-- 1. Add authoritative completion status columns
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz DEFAULT NULL;

-- 2. Backfill existing completed profiles that have all 6 core required fields
UPDATE public.profiles
SET 
  profile_completed = true,
  profile_completed_at = COALESCE(updated_at, now())
WHERE 
  profile_completed = false
  AND full_name IS NOT NULL AND TRIM(full_name) != ''
  AND phone IS NOT NULL AND TRIM(phone) != ''
  AND address IS NOT NULL AND TRIM(address) != ''
  AND city IS NOT NULL AND TRIM(city) != ''
  AND state IS NOT NULL AND TRIM(state) != ''
  AND pincode IS NOT NULL AND TRIM(pincode) != '';

-- 3. Update ensure_profile to preserve profile_completed status
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.profiles (id, email, phone, profile_completed)
  VALUES (
    uid,
    COALESCE((SELECT email FROM auth.users WHERE id = uid), ''),
    COALESCE((SELECT phone FROM auth.users WHERE id = uid), ''),
    false
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

-- 4. Reaffirm permissions
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
