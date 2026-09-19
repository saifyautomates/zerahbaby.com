-- Migration: 20260928000301_add_subtotal_total_to_offline_return_items.sql
-- Description: Add subtotal and total columns to offline_return_items and ensure process_offline_return works seamlessly.

ALTER TABLE public.offline_return_items
  ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0;
