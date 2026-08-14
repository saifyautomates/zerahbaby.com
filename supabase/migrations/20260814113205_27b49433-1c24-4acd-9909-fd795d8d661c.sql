CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT email INTO mail FROM auth.users WHERE id = uid;

  -- Bootstrap: the first signed-in account becomes the store admin.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    IF mail IS NOT NULL THEN
      INSERT INTO public.admin_allowlist (email, added_by) VALUES (lower(mail), uid) ON CONFLICT (email) DO NOTHING;
    END IF;
    RETURN true;
  END IF;

  IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;

  RETURN false;
END; $$;

REVOKE EXECUTE ON FUNCTION public.sync_admin_from_allowlist() FROM anon;