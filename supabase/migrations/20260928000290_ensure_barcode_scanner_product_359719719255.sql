-- Migration: 20260928000290_ensure_barcode_scanner_product_359719719255.sql
-- Description: Ensure barcode 359719719255 for product 'cord' (SKU ZR-CL-4189) exists in the database for instant POS scanning

DO $$
DECLARE
  v_prod_id uuid;
  v_cat_id uuid := '7b515ef1-a0fe-48a7-b579-004d23bcf870';
BEGIN
  -- 1. Look up existing product by barcode or SKU
  SELECT id INTO v_prod_id
  FROM public.products
  WHERE barcode = '359719719255' OR sku = 'ZR-CL-4189' OR slug = 'cord'
  LIMIT 1;

  IF v_prod_id IS NULL THEN
    INSERT INTO public.products (
      name,
      slug,
      brand,
      category,
      category_id,
      description,
      short_description,
      sku,
      barcode,
      price,
      mrp,
      rating,
      reviews,
      age_group,
      highlights,
      stock,
      low_stock_at,
      status,
      is_active,
      is_featured,
      bestseller,
      new_arrival,
      seo_title,
      seo_description,
      sort_order,
      recommendation_mode,
      sales_channel,
      created_at,
      updated_at
    ) VALUES (
      'cord',
      'cord',
      'Zérah Kids',
      'clothing',
      v_cat_id,
      'Premium soft breathable cotton corduroy collection for everyday comfort.',
      'Soft cotton corduroy daily wear',
      'ZR-CL-4189',
      '359719719255',
      250,
      499,
      5.0,
      1,
      '0-2Y',
      ARRAY['100% Breathable Cotton', 'Gentle on Sensitive Baby Skin'],
      25,
      5,
      'active'::public.product_status,
      true,
      false,
      false,
      true,
      'Cord - Zérah Baby & Kids',
      'Premium soft cotton corduroy baby wear.',
      1,
      'auto',
      'ONLINE_AND_OFFLINE',
      now(),
      now()
    ) RETURNING id INTO v_prod_id;
  ELSE
    UPDATE public.products
    SET barcode = '359719719255',
        sku = 'ZR-CL-4189',
        price = 250,
        mrp = 499,
        stock = GREATEST(stock, 25),
        is_active = true,
        updated_at = now()
    WHERE id = v_prod_id;
  END IF;

  -- 2. Ensure default variant exists with barcode 359719719255
  IF NOT EXISTS (
    SELECT 1 FROM public.product_variants
    WHERE barcode = '359719719255' OR (product_id = v_prod_id AND sku = 'ZR-CL-4189')
  ) THEN
    INSERT INTO public.product_variants (
      product_id,
      name,
      sku,
      barcode,
      stock,
      price_override,
      mrp_override,
      is_active,
      created_at,
      updated_at
    ) VALUES (
      v_prod_id,
      'Default',
      'ZR-CL-4189',
      '359719719255',
      25,
      250,
      499,
      true,
      now(),
      now()
    );
  ELSE
    UPDATE public.product_variants
    SET barcode = '359719719255',
        sku = 'ZR-CL-4189',
        stock = GREATEST(stock, 25),
        price_override = 250,
        mrp_override = 499,
        is_active = true,
        updated_at = now()
    WHERE barcode = '359719719255' OR (product_id = v_prod_id AND sku = 'ZR-CL-4189');
  END IF;
END $$;
