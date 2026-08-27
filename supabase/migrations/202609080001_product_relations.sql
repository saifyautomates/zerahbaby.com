-- =====================================================================
-- Migration: Advanced Product Recommendations & Relations
-- Provides two-way product relations with intelligent merchandising controls
-- =====================================================================

-- 1. Add recommendation mode to products
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS recommendation_mode text NOT NULL DEFAULT 'manual_fallback'
CHECK (recommendation_mode IN ('manual', 'auto', 'manual_fallback'));

-- 2. Create the unified product_relations table
CREATE TABLE public.product_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_1_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_2_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order_1 integer NOT NULL DEFAULT 0,
  sort_order_2 integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_relations_order_check CHECK (product_1_id < product_2_id),
  CONSTRAINT product_relations_unique UNIQUE (product_1_id, product_2_id)
);

-- Indexes for fast symmetric lookups
CREATE INDEX idx_product_relations_1 ON public.product_relations(product_1_id);
CREATE INDEX idx_product_relations_2 ON public.product_relations(product_2_id);

-- RLS Policies
ALTER TABLE public.product_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "everyone can view product relations" 
  ON public.product_relations FOR SELECT 
  USING (true);

CREATE POLICY "admins can insert product relations" 
  ON public.product_relations FOR INSERT 
  TO authenticated 
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update product relations" 
  ON public.product_relations FOR UPDATE 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete product relations" 
  ON public.product_relations FOR DELETE 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. RPC to sync relationships from Admin panel
CREATE OR REPLACE FUNCTION public.sync_product_relations(
  p_product_id uuid,
  p_related_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_related_id uuid;
  v_idx integer;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  -- Verify admin
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Remove relations that are no longer in the list for this product
  DELETE FROM public.product_relations
  WHERE (product_1_id = p_product_id AND product_2_id != ALL(p_related_ids))
     OR (product_2_id = p_product_id AND product_1_id != ALL(p_related_ids));

  -- Insert or Update the provided relations
  IF array_length(p_related_ids, 1) IS NOT NULL THEN
    FOR v_idx IN 1..array_length(p_related_ids, 1) LOOP
      v_related_id := p_related_ids[v_idx];
      
      -- Enforce product_1_id < product_2_id
      IF p_product_id < v_related_id THEN
        v_p1 := p_product_id;
        v_p2 := v_related_id;
        
        INSERT INTO public.product_relations (product_1_id, product_2_id, sort_order_1, sort_order_2)
        VALUES (v_p1, v_p2, v_idx, 0)
        ON CONFLICT (product_1_id, product_2_id) DO UPDATE
        SET sort_order_1 = v_idx;
        
      ELSE
        v_p1 := v_related_id;
        v_p2 := p_product_id;
        
        INSERT INTO public.product_relations (product_1_id, product_2_id, sort_order_1, sort_order_2)
        VALUES (v_p1, v_p2, 0, v_idx)
        ON CONFLICT (product_1_id, product_2_id) DO UPDATE
        SET sort_order_2 = v_idx;
      END IF;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_product_relations TO authenticated;

-- 4. RPC to get related products intelligently for the storefront
CREATE OR REPLACE FUNCTION public.get_related_products(
  p_product_id uuid,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  price numeric,
  mrp numeric,
  image_url text,
  images text[],
  category text,
  brand text,
  stock integer,
  low_stock_at integer,
  is_active boolean,
  relation_source text,
  sort_order integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mode text;
  v_category text;
  v_brand text;
  v_manual_count integer := 0;
BEGIN
  -- Get current product info
  SELECT recommendation_mode, category, brand 
  INTO v_mode, v_category, v_brand
  FROM public.products 
  WHERE products.id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 1. Fetch Manual Relations
  RETURN QUERY
  SELECT 
    p.id, p.name, p.slug, p.price, p.mrp, p.image_url, p.images, p.category, p.brand, p.stock, p.low_stock_at, p.is_active,
    'manual'::text AS relation_source,
    CASE 
      WHEN pr.product_1_id = p_product_id THEN pr.sort_order_1 
      ELSE pr.sort_order_2 
    END AS sort_order
  FROM public.product_relations pr
  JOIN public.products p ON (p.id = pr.product_1_id OR p.id = pr.product_2_id) AND p.id != p_product_id
  WHERE (pr.product_1_id = p_product_id OR pr.product_2_id = p_product_id)
    AND p.is_active = true
  ORDER BY sort_order ASC
  LIMIT p_limit;

  -- 2. Fetch Automatic Fallback (if applicable)
  IF v_mode IN ('auto', 'manual_fallback') THEN
    -- Check how many we already yielded
    SELECT count(*) INTO v_manual_count 
    FROM public.product_relations pr
    JOIN public.products p ON (p.id = pr.product_1_id OR p.id = pr.product_2_id) AND p.id != p_product_id
    WHERE (pr.product_1_id = p_product_id OR pr.product_2_id = p_product_id)
      AND p.is_active = true;

    IF v_manual_count < p_limit THEN
      RETURN QUERY
      SELECT 
        p.id, p.name, p.slug, p.price, p.mrp, p.image_url, p.images, p.category, p.brand, p.stock, p.low_stock_at, p.is_active,
        'auto'::text AS relation_source,
        999 AS sort_order
      FROM public.products p
      WHERE p.id != p_product_id
        AND p.is_active = true
        AND (p.category = v_category OR p.brand = v_brand)
        AND p.id NOT IN (
          SELECT CASE WHEN product_1_id = p_product_id THEN product_2_id ELSE product_1_id END 
          FROM public.product_relations 
          WHERE product_1_id = p_product_id OR product_2_id = p_product_id
        )
      ORDER BY 
        CASE WHEN p.category = v_category AND p.brand = v_brand THEN 0 ELSE 1 END,
        p.created_at DESC
      LIMIT (p_limit - v_manual_count);
    END IF;
  END IF;
END;
$$;
