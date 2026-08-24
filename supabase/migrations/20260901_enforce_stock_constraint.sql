-- Migration: Enforce Stock >= 0 to prevent concurrent negative stock races

ALTER TABLE public.products
ADD CONSTRAINT products_stock_check CHECK (stock >= 0);
