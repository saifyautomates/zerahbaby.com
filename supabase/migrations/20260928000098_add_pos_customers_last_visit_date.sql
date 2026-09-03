-- Migration: 20260928000098_add_pos_customers_last_visit_date.sql
-- Fix: add missing last_visit_date column to pos_customers table.
-- The place_offline_sale RPC (migrations 072, 077, 078) updates this column
-- but it was never added to the original table definition (202608220010_pos_complete.sql).

ALTER TABLE public.pos_customers
  ADD COLUMN IF NOT EXISTS last_visit_date timestamptz,
  ADD COLUMN IF NOT EXISTS total_visits integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pos_customers.last_visit_date IS
  'Timestamp of the most recent POS sale for this customer. Set by place_offline_sale RPC.';

COMMENT ON COLUMN public.pos_customers.total_visits IS
  'Total number of POS visits/purchases by this customer.';
