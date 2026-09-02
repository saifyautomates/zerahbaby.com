-- ==============================================================================
-- SYNCHRONIZE PRODUCT AND VARIANT STOCK IN LOCKSTEP
-- Prevents drift between products.stock and product_variants.stock
-- ==============================================================================

-- 1. Function to sync variant stock when parent product stock changes
CREATE OR REPLACE FUNCTION public.fn_sync_product_to_variant_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  var_count int;
BEGIN
  -- Check if this update was triggered by the variant sync to avoid recursion
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO var_count
  FROM public.product_variants
  WHERE product_id = NEW.id;

  -- If product has only 1 variant or a 'Default' variant, keep them strictly identical
  IF var_count = 1 THEN
    UPDATE public.product_variants
    SET stock = NEW.stock,
        updated_at = now()
    WHERE product_id = NEW.id;
  ELSIF var_count > 1 THEN
    -- If there is a variant explicitly named 'Default', sync to it if others don't exist
    UPDATE public.product_variants
    SET stock = NEW.stock,
        updated_at = now()
    WHERE product_id = NEW.id AND name = 'Default';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Function to sync parent product stock when variant stock changes
CREATE OR REPLACE FUNCTION public.fn_sync_variant_to_product_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_variant_stock int;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_total_variant_stock
  FROM public.product_variants
  WHERE product_id = NEW.product_id;

  UPDATE public.products
  SET stock = v_total_variant_stock,
      updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;

-- 3. Attach Triggers
DROP TRIGGER IF EXISTS trg_sync_product_to_variant_stock ON public.products;
CREATE TRIGGER trg_sync_product_to_variant_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_product_to_variant_stock();

DROP TRIGGER IF EXISTS trg_sync_variant_to_product_stock ON public.product_variants;
CREATE TRIGGER trg_sync_variant_to_product_stock
  AFTER UPDATE OF stock ON public.product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_variant_to_product_stock();
