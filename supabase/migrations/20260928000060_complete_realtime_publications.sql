-- Migration: 20260928000060_complete_realtime_publications.sql
-- Enable Realtime publication for all core e-commerce, inventory, orders, and POS tables

DO $$
BEGIN
  -- Add orders and order items
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Add offline sales and items
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_sales;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_sale_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Add offline returns and items
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_returns;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_return_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Add products and variants for live multi-cashier stock sync
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_variants;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_transactions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Add POS customers and queries
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_customers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reviews;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.website_visitors;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;
