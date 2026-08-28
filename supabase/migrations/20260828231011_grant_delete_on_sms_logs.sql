-- Grant DELETE privilege on sms_logs to authenticated users so they can delete logs if they are admins.
GRANT DELETE ON public.sms_logs TO authenticated;
