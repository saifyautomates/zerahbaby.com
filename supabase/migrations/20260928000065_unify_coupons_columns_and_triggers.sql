-- Migration: 20260928000065_unify_coupons_columns_and_triggers.sql
-- Harmonize all coupon column names, limits, and synchronization triggers across Online & POS checkout

-- 1. Add alias/compatibility columns to public.coupons
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_uses integer,
  ADD COLUMN IF NOT EXISTS min_order_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_discount_amount numeric,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

-- Initial data synchronization
UPDATE public.coupons
SET 
  is_active = COALESCE(active, true),
  used_count = COALESCE(usage_count, 0),
  max_uses = usage_limit,
  min_order_amount = COALESCE(minimum_order_value, 0),
  max_discount_amount = maximum_discount,
  valid_from = starts_at,
  valid_until = expires_at;

-- 2. Bi-directional synchronization trigger for coupons table
CREATE OR REPLACE FUNCTION public.sync_coupon_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sync active <-> is_active
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    NEW.is_active := NEW.active;
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.active := NEW.is_active;
  ELSE
    NEW.active := COALESCE(NEW.active, NEW.is_active, true);
    NEW.is_active := COALESCE(NEW.is_active, NEW.active, true);
  END IF;

  -- Sync usage_count <-> used_count
  IF NEW.usage_count IS DISTINCT FROM OLD.usage_count THEN
    NEW.used_count := NEW.usage_count;
  ELSIF NEW.used_count IS DISTINCT FROM OLD.used_count THEN
    NEW.usage_count := NEW.used_count;
  ELSE
    NEW.usage_count := COALESCE(NEW.usage_count, NEW.used_count, 0);
    NEW.used_count := COALESCE(NEW.used_count, NEW.usage_count, 0);
  END IF;

  -- Sync usage_limit <-> max_uses
  IF NEW.usage_limit IS DISTINCT FROM OLD.usage_limit THEN
    NEW.max_uses := NEW.usage_limit;
  ELSIF NEW.max_uses IS DISTINCT FROM OLD.max_uses THEN
    NEW.usage_limit := NEW.max_uses;
  ELSE
    NEW.usage_limit := COALESCE(NEW.usage_limit, NEW.max_uses);
    NEW.max_uses := COALESCE(NEW.max_uses, NEW.usage_limit);
  END IF;

  -- Sync minimum_order_value <-> min_order_amount
  IF NEW.minimum_order_value IS DISTINCT FROM OLD.minimum_order_value THEN
    NEW.min_order_amount := NEW.minimum_order_value;
  ELSIF NEW.min_order_amount IS DISTINCT FROM OLD.min_order_amount THEN
    NEW.minimum_order_value := NEW.min_order_amount;
  ELSE
    NEW.minimum_order_value := COALESCE(NEW.minimum_order_value, NEW.min_order_amount, 0);
    NEW.min_order_amount := COALESCE(NEW.min_order_amount, NEW.minimum_order_value, 0);
  END IF;

  -- Sync maximum_discount <-> max_discount_amount
  IF NEW.maximum_discount IS DISTINCT FROM OLD.maximum_discount THEN
    NEW.max_discount_amount := NEW.maximum_discount;
  ELSIF NEW.max_discount_amount IS DISTINCT FROM OLD.max_discount_amount THEN
    NEW.maximum_discount := NEW.max_discount_amount;
  ELSE
    NEW.maximum_discount := COALESCE(NEW.maximum_discount, NEW.max_discount_amount);
    NEW.max_discount_amount := COALESCE(NEW.max_discount_amount, NEW.maximum_discount);
  END IF;

  -- Sync starts_at <-> valid_from
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
    NEW.valid_from := NEW.starts_at;
  ELSIF NEW.valid_from IS DISTINCT FROM OLD.valid_from THEN
    NEW.starts_at := NEW.valid_from;
  ELSE
    NEW.starts_at := COALESCE(NEW.starts_at, NEW.valid_from);
    NEW.valid_from := COALESCE(NEW.valid_from, NEW.starts_at);
  END IF;

  -- Sync expires_at <-> valid_until
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    NEW.valid_until := NEW.expires_at;
  ELSIF NEW.valid_until IS DISTINCT FROM OLD.valid_until THEN
    NEW.expires_at := NEW.valid_until;
  ELSE
    NEW.expires_at := COALESCE(NEW.expires_at, NEW.valid_until);
    NEW.valid_until := COALESCE(NEW.valid_until, NEW.expires_at);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_coupon_columns ON public.coupons;
CREATE TRIGGER trg_sync_coupon_columns
  BEFORE INSERT OR UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.sync_coupon_columns();
