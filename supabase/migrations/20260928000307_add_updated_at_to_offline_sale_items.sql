-- Migration: 20260928000307_add_updated_at_to_offline_sale_items.sql
-- Description: Add updated_at column to public.offline_sale_items and public.offline_return_items to fix "column updated_at of relation offline_sale_items does not exist" in admin_void_offline_sale.

-- 1. Add updated_at column to offline_sale_items
ALTER TABLE public.offline_sale_items 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Populate updated_at from created_at where missing
UPDATE public.offline_sale_items
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

-- 3. Also safeguard offline_return_items with updated_at if missing
ALTER TABLE public.offline_return_items 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 4. Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.offline_sale_items TO authenticated, service_role, anon;
GRANT SELECT, INSERT, UPDATE ON public.offline_return_items TO authenticated, service_role, anon;
