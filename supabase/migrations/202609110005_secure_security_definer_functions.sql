-- Secure all SECURITY DEFINER functions by setting search_path TO 'public' to prevent injection attacks

ALTER FUNCTION public.admin_delete_query(uuid) SET search_path TO 'public';
ALTER FUNCTION public.admin_delete_sms_log(uuid) SET search_path TO 'public';
ALTER FUNCTION public.delete_storage_object(text, text) SET search_path TO 'public';
ALTER FUNCTION public.get_related_products(uuid, integer) SET search_path TO 'public';
ALTER FUNCTION public.sync_product_relations(uuid, uuid[]) SET search_path TO 'public';
ALTER FUNCTION public.trigger_offline_transactional_sms() SET search_path TO 'public';
ALTER FUNCTION public.trigger_transactional_sms() SET search_path TO 'public';
