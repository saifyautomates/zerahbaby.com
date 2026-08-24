-- Migration: Add UNIQUE constraint for SKU and Barcode, with BEFORE INSERT/UPDATE trigger

-- 1. Create a unique index for SKU
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON public.products(sku) WHERE sku IS NOT NULL AND sku != '';

-- 2. Create the auto-generation function for SKU and Barcode
CREATE OR REPLACE FUNCTION public.auto_generate_product_codes()
RETURNS trigger AS $$
DECLARE
  base_sku text;
  new_sku text;
  base_barcode text;
  new_barcode text;
  counter integer;
BEGIN
  -- Auto-generate SKU if missing or empty
  IF NEW.sku IS NULL OR trim(NEW.sku) = '' THEN
    base_sku := 'ZR-' || 
      CASE 
        WHEN lower(NEW.category) = 'clothing' THEN 'CL'
        WHEN lower(NEW.category) = 'toys' THEN 'TY'
        WHEN lower(NEW.category) = 'care' THEN 'CR'
        WHEN lower(NEW.category) = 'gear' THEN 'GR'
        ELSE 'GN'
      END || '-' || floor(random() * 899999 + 100000)::text;
    NEW.sku := base_sku;
  END IF;

  -- Ensure SKU uniqueness (append -1, -2 if colliding)
  new_sku := trim(NEW.sku);
  counter := 1;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE sku = new_sku AND id != NEW.id) LOOP
    new_sku := trim(NEW.sku) || '-' || counter;
    counter := counter + 1;
  END LOOP;
  NEW.sku := new_sku;

  -- Auto-generate Barcode if missing or empty
  IF NEW.barcode IS NULL OR trim(NEW.barcode) = '' THEN
    base_barcode := lpad(floor(extract(epoch from now()) * 1000 + random() * 1000)::text, 12, '0');
    -- keep exactly 12 digits, taking rightmost if needed
    base_barcode := right(base_barcode, 12);
    NEW.barcode := base_barcode;
  END IF;

  -- Ensure Barcode uniqueness
  new_barcode := trim(NEW.barcode);
  counter := 1;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE barcode = new_barcode AND id != NEW.id) LOOP
    new_barcode := lpad(floor(extract(epoch from now()) * 1000 + random() * 1000)::text, 12, '0');
    new_barcode := right(new_barcode, 12);
    counter := counter + 1;
  END LOOP;
  NEW.barcode := new_barcode;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger
DROP TRIGGER IF EXISTS ensure_unique_product_codes ON public.products;
CREATE TRIGGER ensure_unique_product_codes
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.auto_generate_product_codes();
