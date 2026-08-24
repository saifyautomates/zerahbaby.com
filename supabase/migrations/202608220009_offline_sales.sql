-- ======================== OFFLINE SALES (POS) =====================

CREATE TABLE public.offline_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number text NOT NULL UNIQUE DEFAULT ('POS-' || upper(substr(md5(random()::text), 1, 8))),
  customer_name text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_offline_sales_created_at ON public.offline_sales(created_at);
CREATE INDEX idx_offline_sales_created_by ON public.offline_sales(created_by);

GRANT SELECT, INSERT, UPDATE ON public.offline_sales TO authenticated;
GRANT ALL ON public.offline_sales TO service_role;
ALTER TABLE public.offline_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage offline sales" ON public.offline_sales;
CREATE POLICY "admins manage offline sales" ON public.offline_sales FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER offline_sales_touch BEFORE UPDATE ON public.offline_sales FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== OFFLINE SALE ITEMS =====================

CREATE TABLE public.offline_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.offline_sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id), -- Nullable for custom items
  product_slug text NOT NULL,
  name text NOT NULL,
  sku text NOT NULL DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_offline_sale_items_sale ON public.offline_sale_items(sale_id);
CREATE INDEX idx_offline_sale_items_product ON public.offline_sale_items(product_id);

GRANT SELECT, INSERT, UPDATE ON public.offline_sale_items TO authenticated;
GRANT ALL ON public.offline_sale_items TO service_role;
ALTER TABLE public.offline_sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins manage offline sale items" ON public.offline_sale_items;
CREATE POLICY "admins manage offline sale items" ON public.offline_sale_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ======================== OFFLINE STOCK DEDUCTION =====================

CREATE OR REPLACE FUNCTION public.deduct_stock_per_offline_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    -- Atomically deduct stock for this specific item
    UPDATE public.products
    SET stock = stock - NEW.qty
    WHERE id = NEW.product_id;

    -- Create inventory transaction record
    INSERT INTO public.inventory_transactions 
      (product_id, transaction_type, quantity_change, reference_type, reference_id, notes, created_by)
    VALUES 
      (NEW.product_id, 'sale', -NEW.qty, 'offline_sale', NEW.sale_id, 'Auto-deducted on POS sale', auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER offline_sale_items_deduct_stock
  AFTER INSERT ON public.offline_sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.deduct_stock_per_offline_item();

-- ======================== PLACE OFFLINE SALE RPC =====================

CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _payment_method text,
  _notes text,
  _discount numeric,
  _items jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  computed_subtotal numeric := 0;
  computed_total numeric := 0;
  item record;
  prod record;
  new_sale_id uuid;
  new_sale_number text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Only admins can create offline sales';
  END IF;

  -- Validate and compute subtotal from actual DB prices
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, qty int, custom_price numeric) LOOP
    IF item.product_slug LIKE 'custom-%' THEN
      computed_subtotal := computed_subtotal + (item.custom_price * item.qty);
    ELSE
      SELECT id, slug, price, stock, name, sku INTO prod
      FROM public.products
      WHERE slug = item.product_slug AND is_active = true;
      
      IF prod.id IS NULL THEN
        RAISE EXCEPTION 'Product % not found or inactive', item.product_slug;
      END IF;
      
      IF prod.stock < item.qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available: %, requested: %', prod.name, prod.stock, item.qty;
      END IF;
  
      IF item.qty <= 0 OR item.qty > 1000 THEN
        RAISE EXCEPTION 'Invalid quantity for %: %', prod.name, item.qty;
      END IF;
      
      computed_subtotal := computed_subtotal + (prod.price * item.qty);
    END IF;
  END LOOP;

  IF computed_subtotal = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item or a total > 0';
  END IF;

  -- Compute final total
  computed_total := GREATEST(0, computed_subtotal - _discount);

  -- Insert the sale
  INSERT INTO public.offline_sales (
    customer_name, customer_phone, customer_email,
    payment_method, notes, subtotal, discount, total, created_by
  ) VALUES (
    _customer_name, _customer_phone, _customer_email,
    _payment_method, _notes, computed_subtotal, _discount, computed_total, uid
  )
  RETURNING id, sale_number INTO new_sale_id, new_sale_number;

  -- Insert sale items
  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(product_slug text, name text, sku text, qty int, custom_price numeric) LOOP
    IF item.product_slug LIKE 'custom-%' THEN
       INSERT INTO public.offline_sale_items (
         sale_id, product_id, product_slug, name, sku, price, qty, subtotal
       ) VALUES (
         new_sale_id, NULL, item.product_slug, item.name, 'CUSTOM', item.custom_price, item.qty, (item.custom_price * item.qty)
       );
    ELSE
       SELECT id, slug, price, stock, name, sku INTO prod
       FROM public.products
       WHERE slug = item.product_slug AND is_active = true;
       
       INSERT INTO public.offline_sale_items (
         sale_id, product_id, product_slug, name, sku, price, qty, subtotal
       ) VALUES (
         new_sale_id, prod.id, prod.slug, prod.name, COALESCE(prod.sku, ''), prod.price, item.qty, (prod.price * item.qty)
       );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sale_id', new_sale_id,
    'sale_number', new_sale_number,
    'total', computed_total,
    'subtotal', computed_subtotal,
    'discount', _discount
  );
END; $$;
