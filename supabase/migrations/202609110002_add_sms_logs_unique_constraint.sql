-- ============================================================
-- ADD TABLE-LEVEL UNIQUE CONSTRAINT ON idempotency_key
-- Migration: 202609110002_add_sms_logs_unique_constraint.sql
-- ============================================================

ALTER TABLE public.sms_logs DROP CONSTRAINT IF EXISTS sms_logs_idempotency_key_key;
ALTER TABLE public.sms_logs ADD CONSTRAINT sms_logs_idempotency_key_key UNIQUE (idempotency_key);
