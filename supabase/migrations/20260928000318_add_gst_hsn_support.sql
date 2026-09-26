-- Migration: 20260928000318_add_gst_hsn_support.sql
-- Additive nullable fields for GST & HSN support across products, sales, and order items.

-- 1. Add nullable HSN code and GST rate to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hsn_code text NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gst_rate numeric NULL;

-- 2. Add nullable HSN code and GST rate snapshot columns to offline_sale_items
ALTER TABLE public.offline_sale_items ADD COLUMN IF NOT EXISTS hsn_code text NULL;
ALTER TABLE public.offline_sale_items ADD COLUMN IF NOT EXISTS gst_rate numeric NULL;

-- 3. Add nullable HSN code and GST rate snapshot columns to order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS hsn_code text NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS gst_rate numeric NULL;

-- 4. Automatic snapshot triggers to preserve HSN and GST on sale/order creation without modifying existing RPCs
CREATE OR REPLACE FUNCTION public.snapshot_offline_sale_item_gst_hsn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (NEW.hsn_code IS NULL OR NEW.gst_rate IS NULL) THEN
    IF NEW.product_id IS NOT NULL THEN
      SELECT 
        COALESCE(NEW.hsn_code, p.hsn_code),
        COALESCE(NEW.gst_rate, p.gst_rate)
      INTO 
        NEW.hsn_code,
        NEW.gst_rate
      FROM public.products p
      WHERE p.id = NEW.product_id;
    ELSIF NEW.product_slug IS NOT NULL AND NEW.product_slug != '' THEN
      SELECT 
        COALESCE(NEW.hsn_code, p.hsn_code),
        COALESCE(NEW.gst_rate, p.gst_rate)
      INTO 
        NEW.hsn_code,
        NEW.gst_rate
      FROM public.products p
      WHERE p.slug = NEW.product_slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_offline_sale_item_gst_hsn ON public.offline_sale_items;
CREATE TRIGGER trg_snapshot_offline_sale_item_gst_hsn
BEFORE INSERT ON public.offline_sale_items
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_offline_sale_item_gst_hsn();

CREATE OR REPLACE FUNCTION public.snapshot_order_item_gst_hsn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (NEW.hsn_code IS NULL OR NEW.gst_rate IS NULL) THEN
    IF NEW.product_id IS NOT NULL THEN
      SELECT 
        COALESCE(NEW.hsn_code, p.hsn_code),
        COALESCE(NEW.gst_rate, p.gst_rate)
      INTO 
        NEW.hsn_code,
        NEW.gst_rate
      FROM public.products p
      WHERE p.id = NEW.product_id;
    ELSIF NEW.product_slug IS NOT NULL AND NEW.product_slug != '' THEN
      SELECT 
        COALESCE(NEW.hsn_code, p.hsn_code),
        COALESCE(NEW.gst_rate, p.gst_rate)
      INTO 
        NEW.hsn_code,
        NEW.gst_rate
      FROM public.products p
      WHERE p.slug = NEW.product_slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_order_item_gst_hsn ON public.order_items;
CREATE TRIGGER trg_snapshot_order_item_gst_hsn
BEFORE INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.snapshot_order_item_gst_hsn();
