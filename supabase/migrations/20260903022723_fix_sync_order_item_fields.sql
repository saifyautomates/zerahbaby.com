CREATE OR REPLACE FUNCTION public.sync_order_item_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.product_name_snapshot = COALESCE(NULLIF(NEW.product_name_snapshot, ''), NEW.name);
  NEW.image_url_snapshot = COALESCE(NEW.image_url_snapshot, NEW.image_url);
  NEW.subtotal = NEW.price * NEW.qty;
  NEW.product_slug = COALESCE(NULLIF(NEW.product_slug, ''), NEW.product_slug);
  RETURN NEW;
END;
$$;
