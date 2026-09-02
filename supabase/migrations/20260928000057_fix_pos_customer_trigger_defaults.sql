-- Migration: 20260928000057_fix_pos_customer_trigger_defaults.sql
-- Fix pos_customers trigger for store_credit and store_credit_balance defaults

ALTER TABLE public.pos_customers 
  ALTER COLUMN store_credit_balance SET DEFAULT 0,
  ALTER COLUMN store_credit SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_pos_customer_store_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.store_credit_balance IS NOT NULL AND NEW.store_credit IS NULL THEN
      NEW.store_credit := NEW.store_credit_balance;
    ELSIF NEW.store_credit IS NOT NULL AND NEW.store_credit_balance IS NULL THEN
      NEW.store_credit_balance := NEW.store_credit;
    ELSIF NEW.store_credit_balance IS NULL AND NEW.store_credit IS NULL THEN
      NEW.store_credit_balance := 0;
      NEW.store_credit := 0;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.store_credit_balance IS DISTINCT FROM OLD.store_credit_balance THEN
      NEW.store_credit := COALESCE(NEW.store_credit_balance, 0);
    ELSIF NEW.store_credit IS DISTINCT FROM OLD.store_credit THEN
      NEW.store_credit_balance := COALESCE(NEW.store_credit, 0);
    END IF;
  END IF;

  NEW.store_credit_balance := COALESCE(NEW.store_credit_balance, 0);
  NEW.store_credit := COALESCE(NEW.store_credit, 0);

  RETURN NEW;
END;
$$;
