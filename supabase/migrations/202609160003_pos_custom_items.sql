-- Restore custom items support in place_offline_sale and sync_offline_sales

-- 1. place_offline_sale
CREATE OR REPLACE FUNCTION public.place_offline_sale(
  _items jsonb, -- Expects { variant_id: uuid, product_slug: text, qty: int, custom_price: numeric }
  _payment_method text,
  _customer_name text,
  _customer_phone text,
  _customer_email text,
  _notes text,
  _discount numeric,
  _discount_type text,
  _discount_value numeric,
  _customer_id uuid,
  _idempotency_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  item record;
  variant record;
  new_sale_id uuid;
  new_receipt_number text;
  sale_subtotal numeric := 0;
  final_discount_amount numeric := 0;
  final_total numeric := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'pos') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO new_sale_id FROM public.offline_sales WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id, 'duplicate', true);
    END IF;
  END IF;

  new_sale_id := gen_random_uuid();
  new_receipt_number := public.generate_pos_sale_number();

  INSERT INTO public.offline_sales (
    id, receipt_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
    subtotal, discount_type, discount_value, discount_amount, total_amount, payment_method, notes, idempotency_key
  ) VALUES (
    new_sale_id, new_receipt_number, uid, _customer_id, _customer_name, _customer_phone, _customer_email,
    0, _discount_type, _discount_value, 0, 0, _payment_method, _notes, _idempotency_key
  );

  FOR item IN SELECT * FROM jsonb_to_recordset(_items) AS x(variant_id uuid, product_slug text, qty int, custom_price numeric) LOOP
    IF item.variant_id IS NOT NULL THEN
      SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku, p.slug AS product_slug, p.id AS p_id
      INTO variant
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
      WHERE v.id = item.variant_id FOR UPDATE OF v;

      IF variant.variant_id IS NOT NULL THEN
        IF variant.stock < item.qty THEN
          UPDATE public.product_variants SET conflict_reconciliation_needed = true WHERE id = variant.variant_id;
        END IF;

        sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);

        INSERT INTO public.offline_sale_items (
          sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot
        ) VALUES (
          new_sale_id, variant.product_slug, variant.variant_id, item.qty, COALESCE(item.custom_price, variant.price), (COALESCE(item.custom_price, variant.price) * item.qty), variant.variant_sku
        );

        UPDATE public.product_variants SET stock = stock - item.qty WHERE id = variant.variant_id;
        UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

        INSERT INTO public.inventory_transactions (
          product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
        ) VALUES (
          variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', new_sale_id, 'Offline POS sale', uid
        );
      ELSE
        -- Fallback if variant not found (treat as custom)
        sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
        INSERT INTO public.offline_sale_items (
          sale_id, product_slug, qty, unit_price, subtotal
        ) VALUES (
          new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
        );
      END IF;
    ELSE
      -- Custom Item
      sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
      INSERT INTO public.offline_sale_items (
        sale_id, product_slug, qty, unit_price, subtotal
      ) VALUES (
        new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
      );
    END IF;
  END LOOP;

  -- Calculate totals
  IF _discount_type = 'percentage' THEN
    final_discount_amount := round((sale_subtotal * _discount_value) / 100, 2);
  ELSIF _discount_type = 'fixed' THEN
    final_discount_amount := _discount_value;
  ELSE
    final_discount_amount := 0;
  END IF;

  IF final_discount_amount > sale_subtotal THEN
    final_discount_amount := sale_subtotal;
  END IF;

  final_total := sale_subtotal - final_discount_amount;

  UPDATE public.offline_sales
  SET subtotal = sale_subtotal, discount_amount = final_discount_amount, total_amount = final_total
  WHERE id = new_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', new_sale_id,
    'receipt_number', new_receipt_number,
    'duplicate', false,
    'total', final_total,
    'subtotal', sale_subtotal,
    'discount', final_discount_amount
  );
END;
$$;

-- 2. sync_offline_sales
CREATE OR REPLACE FUNCTION public.sync_offline_sales(
  _sales jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  sale record;
  item record;
  variant record;
  sync_results jsonb := '[]'::jsonb;
  new_sale_id uuid;
  new_receipt_number text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_role(uid, 'admin') AND NOT public.has_role(uid, 'pos') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  FOR sale IN SELECT * FROM jsonb_to_recordset(_sales) AS x(
    idempotency_key text, items jsonb, payment_method text, customer_id uuid, customer_name text, customer_phone text, customer_email text, discount_type text, discount_value numeric, discount numeric, notes text
  ) LOOP
    
    SELECT id INTO new_sale_id FROM public.offline_sales WHERE idempotency_key = sale.idempotency_key;
    IF FOUND THEN
      sync_results := sync_results || jsonb_build_object('idempotency_key', sale.idempotency_key, 'sale_id', new_sale_id, 'status', 'skipped_exists');
      CONTINUE;
    END IF;

    new_sale_id := gen_random_uuid();
    new_receipt_number := public.generate_pos_sale_number();

    INSERT INTO public.offline_sales (
      id, receipt_number, cashier_id, customer_id, customer_name, customer_phone, customer_email,
      subtotal, discount_type, discount_value, discount_amount, total_amount, payment_method, notes, idempotency_key
    ) VALUES (
      new_sale_id, new_receipt_number, uid, sale.customer_id, sale.customer_name, sale.customer_phone, sale.customer_email,
      0, sale.discount_type, sale.discount_value, COALESCE(sale.discount, 0), 0, sale.payment_method, sale.notes, sale.idempotency_key
    );

    DECLARE
      sale_subtotal numeric := 0;
    BEGIN
      FOR item IN SELECT * FROM jsonb_to_recordset(sale.items) AS x(variant_id uuid, product_slug text, qty int, custom_price numeric) LOOP
        IF item.variant_id IS NOT NULL THEN
          SELECT v.id AS variant_id, v.stock, COALESCE(v.price_override, p.price) AS price, v.sku AS variant_sku, p.slug AS product_slug, p.id AS p_id
          INTO variant
          FROM public.product_variants v
          JOIN public.products p ON p.id = v.product_id
          WHERE v.id = item.variant_id FOR UPDATE OF v;

          IF variant.variant_id IS NOT NULL THEN
            IF variant.stock < item.qty THEN
              UPDATE public.product_variants SET conflict_reconciliation_needed = true WHERE id = variant.variant_id;
            END IF;

            sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, variant.price) * item.qty);

            INSERT INTO public.offline_sale_items (
              sale_id, product_slug, variant_id, qty, unit_price, subtotal, sku_snapshot
            ) VALUES (
              new_sale_id, variant.product_slug, variant.variant_id, item.qty, COALESCE(item.custom_price, variant.price), (COALESCE(item.custom_price, variant.price) * item.qty), variant.variant_sku
            );

            UPDATE public.product_variants SET stock = stock - item.qty WHERE id = variant.variant_id;
            UPDATE public.products SET stock = stock - item.qty WHERE id = variant.p_id;

            INSERT INTO public.inventory_transactions (
              product_id, variant_id, type, quantity, reference_type, reference_id, note, created_by
            ) VALUES (
              variant.p_id, variant.variant_id, 'sale', -item.qty, 'offline_sale', new_sale_id, 'Offline POS sale (sync)', uid
            );
          ELSE
            sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
            INSERT INTO public.offline_sale_items (
              sale_id, product_slug, qty, unit_price, subtotal
            ) VALUES (
              new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
            );
          END IF;
        ELSE
          sale_subtotal := sale_subtotal + (COALESCE(item.custom_price, 0) * item.qty);
          INSERT INTO public.offline_sale_items (
            sale_id, product_slug, qty, unit_price, subtotal
          ) VALUES (
            new_sale_id, COALESCE(item.product_slug, 'custom'), item.qty, COALESCE(item.custom_price, 0), (COALESCE(item.custom_price, 0) * item.qty)
          );
        END IF;
      END LOOP;

      DECLARE
        final_discount numeric := 0;
        final_total numeric := 0;
      BEGIN
        IF sale.discount_type = 'percentage' THEN
          final_discount := round((sale_subtotal * sale.discount_value) / 100, 2);
        ELSIF sale.discount_type = 'fixed' THEN
          final_discount := sale.discount_value;
        ELSE
          final_discount := 0;
        END IF;

        IF final_discount > sale_subtotal THEN final_discount := sale_subtotal; END IF;
        final_total := sale_subtotal - final_discount;

        UPDATE public.offline_sales
        SET subtotal = sale_subtotal, discount_amount = final_discount, total_amount = final_total
        WHERE id = new_sale_id;
      END;
    END;

    sync_results := sync_results || jsonb_build_object('idempotency_key', sale.idempotency_key, 'sale_id', new_sale_id, 'status', 'synced', 'receipt_number', new_receipt_number);
  END LOOP;

  RETURN sync_results;
END;
$$;
