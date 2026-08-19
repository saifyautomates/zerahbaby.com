-- ============================================================
-- ZERAH BABY & KIDS — COMPLETE PRODUCTION BACKEND
-- Run this ONCE on a fresh Supabase project.
-- ============================================================

-- ======================== RESET SCHEMA =======================
-- This ensures the script can be run multiple times safely
-- by wiping existing public tables first.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- ======================== ENUMS ============================
CREATE TYPE public.app_role AS ENUM ('admin','staff','customer');
CREATE TYPE public.product_status AS ENUM ('draft','active','out_of_stock','archived');
CREATE TYPE public.order_status AS ENUM ('pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled','returned');
CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded');
CREATE TYPE public.fulfillment_status AS ENUM ('unfulfilled','partially_fulfilled','fulfilled');
CREATE TYPE public.discount_type AS ENUM ('percentage','fixed');
CREATE TYPE public.inventory_tx_type AS ENUM ('purchase','sale','return','adjustment','damage','restock');
CREATE TYPE public.review_status AS ENUM ('pending','approved','rejected');

-- ======================== HELPER FUNCTIONS ===================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ======================== USER ROLES =========================

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'customer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ======================== ADMIN ALLOWLIST =====================

CREATE TABLE public.admin_allowlist (
  email text PRIMARY KEY,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_allowlist TO authenticated;
GRANT ALL ON public.admin_allowlist TO service_role;
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read allowlist" ON public.admin_allowlist FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ======================== PROFILES ===========================

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  avatar_url text,
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  pincode text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== BRANDS =============================

CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.brands TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands public read" ON public.brands FOR SELECT USING (true);
CREATE POLICY "admins manage brands" ON public.brands FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER brands_touch BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== CATEGORIES =========================

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  tagline text NOT NULL DEFAULT '',
  image_url text,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "admins manage categories" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER categories_touch BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== PRODUCTS ===========================

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  short_description text NOT NULL DEFAULT '',
  sku text NOT NULL DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  mrp numeric NOT NULL DEFAULT 0,
  compare_at_price numeric NOT NULL DEFAULT 0,
  cost_price numeric NOT NULL DEFAULT 0,
  rating numeric NOT NULL DEFAULT 0,
  reviews integer NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  age_group text NOT NULL DEFAULT '',
  image_url text,
  images text[] NOT NULL DEFAULT '{}',
  highlights text[] NOT NULL DEFAULT '{}',
  stock integer NOT NULL DEFAULT 0,
  stock_quantity integer NOT NULL DEFAULT 0,
  low_stock_at integer NOT NULL DEFAULT 5,
  low_stock_threshold integer NOT NULL DEFAULT 5,
  status public.product_status NOT NULL DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  bestseller boolean NOT NULL DEFAULT false,
  new_arrival boolean NOT NULL DEFAULT false,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_slug ON public.products(slug);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_products_brand ON public.products(brand);
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_is_active ON public.products(is_active);
CREATE INDEX idx_products_price ON public.products(price);
CREATE INDEX idx_products_sort ON public.products(sort_order);
CREATE INDEX idx_products_search ON public.products USING gin (to_tsvector('english', name || ' ' || brand || ' ' || description));

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active products public read" ON public.products FOR SELECT USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage products" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sync stock fields trigger
CREATE OR REPLACE FUNCTION public.sync_product_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.stock_quantity = NEW.stock;
  NEW.low_stock_threshold = NEW.low_stock_at;
  NEW.featured = NEW.is_featured;
  NEW.review_count = NEW.reviews;
  NEW.compare_at_price = NEW.mrp;
  RETURN NEW;
END; $$;
CREATE TRIGGER products_sync_stock BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock();

-- ======================== PRODUCT IMAGES =====================

CREATE TABLE public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path text NOT NULL DEFAULT '',
  public_url text NOT NULL DEFAULT '',
  alt_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_images_product ON public.product_images(product_id);
GRANT SELECT ON public.product_images TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_images TO authenticated;
GRANT ALL ON public.product_images TO service_role;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product images public read" ON public.product_images FOR SELECT USING (true);
CREATE POLICY "admins manage product images" ON public.product_images FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ======================== PRODUCT VIDEOS =====================

CREATE TABLE public.product_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path text NOT NULL DEFAULT '',
  video_url text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  duration integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_videos_product ON public.product_videos(product_id);
GRANT SELECT ON public.product_videos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_videos TO authenticated;
GRANT ALL ON public.product_videos TO service_role;
ALTER TABLE public.product_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product videos public read" ON public.product_videos FOR SELECT USING (true);
CREATE POLICY "admins manage product videos" ON public.product_videos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ======================== USER ADDRESSES =====================

CREATE TABLE public.user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address_line_1 text NOT NULL DEFAULT '',
  address_line_2 text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'India',
  landmark text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_addresses_user ON public.user_addresses(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_addresses TO authenticated;
GRANT ALL ON public.user_addresses TO service_role;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own addresses" ON public.user_addresses FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins read addresses" ON public.user_addresses FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER addresses_touch BEFORE UPDATE ON public.user_addresses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== WISHLISTS ==========================

CREATE TABLE public.wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlists TO authenticated;
GRANT ALL ON public.wishlists TO service_role;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wishlist" ON public.wishlists FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES public.wishlists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wishlist_id, product_id)
);
CREATE INDEX idx_wishlist_items_wishlist ON public.wishlist_items(wishlist_id);
GRANT SELECT, INSERT, DELETE ON public.wishlist_items TO authenticated;
GRANT ALL ON public.wishlist_items TO service_role;
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wishlist items" ON public.wishlist_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wishlists w WHERE w.id = wishlist_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.wishlists w WHERE w.id = wishlist_id AND w.user_id = auth.uid()));

-- ======================== CARTS (persistent) =================

CREATE TABLE public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carts TO authenticated;
GRANT ALL ON public.carts TO service_role;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cart" ON public.carts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER carts_touch BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_at_add numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id)
);
CREATE INDEX idx_cart_items_cart ON public.cart_items(cart_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cart_items TO authenticated;
GRANT ALL ON public.cart_items TO service_role;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cart items" ON public.cart_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carts c WHERE c.id = cart_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.carts c WHERE c.id = cart_id AND c.user_id = auth.uid()));
CREATE TRIGGER cart_items_touch BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== ORDERS =============================

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status public.order_status NOT NULL DEFAULT 'pending',
  payment_status public.payment_status NOT NULL DEFAULT 'pending',
  fulfillment_status public.fulfillment_status NOT NULL DEFAULT 'unfulfilled',
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  alt_phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  address_line2 text NOT NULL DEFAULT '',
  landmark text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  pincode text NOT NULL DEFAULT '',
  shipping_address_snapshot jsonb,
  billing_address_snapshot jsonb,
  customer_phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'cod',
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  shipping_fee numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  coupon_code text,
  invoice_no text,
  tracking_number text,
  tracking_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_user ON public.orders(user_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_created ON public.orders(created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orders read" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own orders insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins read all orders" ON public.orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update orders" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-generate order number
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  prefix text := 'ORD_';
  seq text;
BEGIN
  seq := upper(substr(NEW.id::text, 1, 4) || substr(NEW.id::text, 25, 4));
  NEW.order_number = prefix || seq;
  -- Also set shipping_address_snapshot
  NEW.shipping_address_snapshot = jsonb_build_object(
    'full_name', NEW.full_name,
    'phone', NEW.phone,
    'alt_phone', NEW.alt_phone,
    'address', NEW.address,
    'address_line2', NEW.address_line2,
    'landmark', NEW.landmark,
    'city', NEW.city,
    'state', NEW.state,
    'pincode', NEW.pincode
  );
  NEW.customer_phone = NEW.phone;
  NEW.shipping_fee = NEW.shipping;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_generate_number BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();

-- ======================== ORDER ITEMS ========================

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid,
  product_slug text NOT NULL DEFAULT '',
  product_name_snapshot text NOT NULL DEFAULT '',
  sku_snapshot text NOT NULL DEFAULT '',
  image_url_snapshot text,
  name text NOT NULL DEFAULT '',
  image_url text,
  price numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  quantity integer NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own order items read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "own order items insert" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "admins read all order items" ON public.order_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Sync order_items snapshot fields
CREATE OR REPLACE FUNCTION public.sync_order_item_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.product_name_snapshot = COALESCE(NULLIF(NEW.product_name_snapshot, ''), NEW.name);
  NEW.image_url_snapshot = COALESCE(NEW.image_url_snapshot, NEW.image_url);
  NEW.quantity = NEW.qty;
  NEW.subtotal = NEW.price * NEW.qty;
  NEW.product_slug = COALESCE(NULLIF(NEW.product_slug, ''), NEW.product_slug);
  RETURN NEW;
END; $$;
CREATE TRIGGER order_items_sync BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.sync_order_item_fields();

-- ======================== ORDER STATUS HISTORY ================

CREATE TABLE public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  note text NOT NULL DEFAULT '',
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_status_history_order ON public.order_status_history(order_id);
GRANT SELECT ON public.order_status_history TO authenticated;
GRANT INSERT ON public.order_status_history TO authenticated;
GRANT ALL ON public.order_status_history TO service_role;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own order history read" ON public.order_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "admins read all history" ON public.order_status_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins insert history" ON public.order_status_history FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auto-log order status changes
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.order_status_history (order_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status::text, NEW.status::text, auth.uid());
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_log_status AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- Also log initial status on insert
CREATE OR REPLACE FUNCTION public.log_order_initial_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.order_status_history (order_id, old_status, new_status, changed_by)
  VALUES (NEW.id, NULL, NEW.status::text, auth.uid());
  RETURN NEW;
END; $$;
CREATE TRIGGER orders_log_initial AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_initial_status();

-- ======================== PAYMENTS ===========================

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL DEFAULT 'cod',
  payment_id text,
  order_reference text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  status public.payment_status NOT NULL DEFAULT 'pending',
  method text NOT NULL DEFAULT '',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_order ON public.payments(order_id);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payments read" ON public.payments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins read all payments" ON public.payments FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage payments" ON public.payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== COUPONS ============================

CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  discount_type public.discount_type NOT NULL DEFAULT 'percentage',
  discount_value numeric NOT NULL DEFAULT 0,
  minimum_order_value numeric NOT NULL DEFAULT 0,
  maximum_discount numeric NOT NULL DEFAULT 0,
  usage_limit integer NOT NULL DEFAULT 0,
  usage_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons public read active" ON public.coupons FOR SELECT USING (active);
CREATE POLICY "admins manage coupons" ON public.coupons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.coupon_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  order_id uuid REFERENCES public.orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id, order_id)
);
GRANT SELECT, INSERT ON public.coupon_usage TO authenticated;
GRANT ALL ON public.coupon_usage TO service_role;
ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own coupon usage" ON public.coupon_usage FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own coupon usage insert" ON public.coupon_usage FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins read coupon usage" ON public.coupon_usage FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Server-side coupon validation
CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _user_id uuid, _order_total numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
  user_uses integer;
  discount numeric;
BEGIN
  SELECT * INTO c FROM public.coupons WHERE upper(code) = upper(_code) AND active;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'error', 'Invalid coupon code'); END IF;
  IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN RETURN jsonb_build_object('valid', false, 'error', 'Coupon not yet active'); END IF;
  IF c.expires_at IS NOT NULL AND now() > c.expires_at THEN RETURN jsonb_build_object('valid', false, 'error', 'Coupon has expired'); END IF;
  IF c.usage_limit > 0 AND c.usage_count >= c.usage_limit THEN RETURN jsonb_build_object('valid', false, 'error', 'Coupon usage limit reached'); END IF;
  IF _order_total < c.minimum_order_value THEN RETURN jsonb_build_object('valid', false, 'error', 'Minimum order value is ₹' || c.minimum_order_value); END IF;

  SELECT count(*) INTO user_uses FROM public.coupon_usage WHERE coupon_id = c.id AND user_id = _user_id;
  IF c.per_user_limit > 0 AND user_uses >= c.per_user_limit THEN RETURN jsonb_build_object('valid', false, 'error', 'You have already used this coupon'); END IF;

  IF c.discount_type = 'percentage' THEN
    discount := _order_total * c.discount_value / 100;
    IF c.maximum_discount > 0 AND discount > c.maximum_discount THEN discount := c.maximum_discount; END IF;
  ELSE
    discount := c.discount_value;
  END IF;

  RETURN jsonb_build_object('valid', true, 'discount', discount, 'coupon_id', c.id, 'code', c.code);
END; $$;

-- ======================== REVIEWS ============================

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  images text[] NOT NULL DEFAULT '{}',
  verified_purchase boolean NOT NULL DEFAULT false,
  status public.review_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_product ON public.reviews(product_id);
CREATE INDEX idx_reviews_user ON public.reviews(user_id);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approved reviews public read" ON public.reviews FOR SELECT USING (status = 'approved' OR user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own review insert" ON public.reviews FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own review update" ON public.reviews FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins manage reviews" ON public.reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER reviews_touch BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-update product rating on review changes
CREATE OR REPLACE FUNCTION public.update_product_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pid uuid;
  avg_rating numeric;
  cnt integer;
BEGIN
  pid := COALESCE(NEW.product_id, OLD.product_id);
  SELECT COALESCE(AVG(rating), 0), COUNT(*) INTO avg_rating, cnt
  FROM public.reviews WHERE product_id = pid AND status = 'approved';
  UPDATE public.products SET rating = ROUND(avg_rating, 1), reviews = cnt WHERE id = pid;
  RETURN NULL;
END; $$;
CREATE TRIGGER reviews_update_rating AFTER INSERT OR UPDATE OR DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_product_rating();

-- ======================== INVENTORY TRANSACTIONS =============

CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid,
  type public.inventory_tx_type NOT NULL,
  quantity integer NOT NULL,
  reference_type text NOT NULL DEFAULT '',
  reference_id uuid,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_tx_product ON public.inventory_transactions(product_id);
GRANT SELECT, INSERT ON public.inventory_transactions TO authenticated;
GRANT ALL ON public.inventory_transactions TO service_role;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage inventory" ON public.inventory_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Deduct stock on order placement
CREATE OR REPLACE FUNCTION public.deduct_stock_on_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  item record;
  prod record;
BEGIN
  FOR item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
    SELECT id, stock INTO prod FROM public.products WHERE slug = item.product_slug;
    IF prod.id IS NOT NULL THEN
      UPDATE public.products SET stock = GREATEST(0, stock - item.qty) WHERE id = prod.id;
      INSERT INTO public.inventory_transactions (product_id, type, quantity, reference_type, reference_id, note, created_by)
      VALUES (prod.id, 'sale', -item.qty, 'order', NEW.id, 'Auto-deducted on order placement', NEW.user_id);
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;

-- ======================== SITE SETTINGS ======================

CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings public read" ON public.site_settings FOR SELECT USING (true);
CREATE POLICY "admins manage settings" ON public.site_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ======================== ANALYTICS ==========================

CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  event_name text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_event ON public.analytics_events(event_name);
CREATE INDEX idx_analytics_created ON public.analytics_events(created_at DESC);
GRANT INSERT ON public.analytics_events TO authenticated;
GRANT SELECT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analytics insert" ON public.analytics_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "admins read analytics" ON public.analytics_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ======================== ADMIN FUNCTIONS ====================

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.profiles (id, email)
  VALUES (uid, COALESCE((SELECT email FROM auth.users WHERE id = uid), ''))
  ON CONFLICT (id) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.grant_admin_by_email(_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can grant admin access'; END IF;
  INSERT INTO public.admin_allowlist (email, added_by) VALUES (lower(_email), auth.uid()) ON CONFLICT (email) DO NOTHING;
  SELECT id INTO target FROM auth.users WHERE lower(email) = lower(_email);
  IF target IS NULL THEN RETURN 'invited'; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target, 'admin') ON CONFLICT DO NOTHING;
  RETURN 'active';
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_admin_by_email(_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can revoke admin access'; END IF;
  DELETE FROM public.admin_allowlist WHERE lower(email) = lower(_email);
  SELECT id INTO target FROM auth.users WHERE lower(email) = lower(_email);
  IF target IS NOT NULL AND target <> auth.uid() THEN
    DELETE FROM public.user_roles WHERE user_id = target AND role = 'admin';
  END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE (email text, status text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Only admins can list admins'; END IF;
  RETURN QUERY
  SELECT a.email,
         CASE WHEN EXISTS (
           SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'
           WHERE lower(u.email) = lower(a.email)
         ) THEN 'active' ELSE 'invited' END AS status,
         a.created_at
  FROM public.admin_allowlist a
  ORDER BY a.created_at;
END; $$;

CREATE OR REPLACE FUNCTION public.sync_admin_from_allowlist()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT email INTO mail FROM auth.users WHERE id = uid;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    IF mail IS NOT NULL THEN
      INSERT INTO public.admin_allowlist (email, added_by) VALUES (lower(mail), uid) ON CONFLICT (email) DO NOTHING;
    END IF;
    RETURN true;
  END IF;

  IF mail IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_allowlist WHERE lower(email) = lower(mail)) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin') ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;

  RETURN false;
END; $$;

-- Revoke anon access to sensitive functions
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_admin_from_allowlist() FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_admins() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon(text, uuid, numeric) FROM anon;

-- ======================== SEED DATA ==========================

-- Admin allowlist
INSERT INTO public.admin_allowlist (email) VALUES
  ('jackxparrowww@gmail.com'),
  ('hello@zerahkids.com')
ON CONFLICT DO NOTHING;

-- Categories
INSERT INTO public.categories (slug, name, tagline, sort_order, display_order) VALUES
  ('clothing','Clothing','Soft, breathable everyday wear',1,1),
  ('toys','Toys','Safe play that grows with them',2,2),
  ('care','Nursery & Care','Gentle essentials you can trust',3,3),
  ('gear','Travel Gear','Strollers, carriers and on-the-go picks',4,4);

-- Brands
INSERT INTO public.brands (name, slug) VALUES
  ('Zerah Essentials', 'zerah-essentials'),
  ('Little Meadow', 'little-meadow'),
  ('PlayGrove', 'playgrove'),
  ('PureNest', 'purenest'),
  ('RoamTots', 'roamtots');

-- Products
INSERT INTO public.products (slug,name,brand,category,price,mrp,rating,reviews,age_group,description,highlights,is_featured,stock,sku,sort_order) VALUES
  ('h1','Organic Cotton Onesie Set (Pack of 3)','Zerah Essentials','clothing',899,1499,4.8,132,'0-6m','A trio of buttery-soft onesies cut from certified organic cotton, with side snaps for easy changes.',ARRAY['100% organic cotton','Nickel-free snaps','Pre-washed, no shrink'],true,100,'ZR-CL-001',1),
  ('soft-muslin-swaddle','Muslin Swaddle Wraps (Pack of 2)','Zerah Essentials','clothing',749,1199,4.7,86,'0-6m','Airy double-gauze muslin that softens with every wash — perfect for swaddling, shade or burp cover.',ARRAY['Breathable double gauze','Generous 110x110cm','Gets softer each wash'],true,60,'ZR-CL-002',2),
  ('kids-frock-floral','Floral Summer Frock','Little Meadow','clothing',1099,1799,4.6,54,'2-4y','A twirl-ready cotton frock with hand-finished smocking and covered buttons.',ARRAY['Lined bodice','Machine washable','Fade-resistant print'],false,35,'ZR-CL-003',3),
  ('wooden-stacker','Wooden Rainbow Stacker','PlayGrove','toys',649,999,4.9,201,'6-12m','Chunky beech rings finished with water-based, baby-safe paint for early grip and colour play.',ARRAY['Solid beech wood','Non-toxic water-based paint','Smooth rounded edges'],true,48,'ZR-TY-001',4),
  ('soft-activity-book','Crinkle Soft Activity Book','PlayGrove','toys',449,699,4.5,74,'0-6m','A cloth book with crinkle pages, a peek-a-boo mirror and a teether ring on a clip.',ARRAY['Machine washable','Built-in teether','High-contrast pages'],false,72,'ZR-TY-002',5),
  ('shape-sorter-bus','Shape Sorter Bus','PlayGrove','toys',899,1299,4.6,63,'12-24m','A pull-along bus with six chunky shape blocks that sharpens problem solving.',ARRAY['Six sorting shapes','Smooth-rolling wheels','Sturdy ABS body'],false,40,'ZR-TY-003',6),
  ('baby-lotion-gentle','Gentle Daily Baby Lotion 200ml','PureNest','care',399,549,4.7,158,'0-6m','A fragrance-light lotion with oat milk and shea that sinks in without any greasy film.',ARRAY['Dermatologist tested','No parabens or sulphates','Ideal for daily massage'],true,90,'ZR-CR-001',7),
  ('bamboo-diapers','Bamboo Ultra-Dry Diapers (Pack of 40)','PureNest','care',999,1399,4.6,240,'6-12m','Plant-based bamboo top sheet with a 12-hour core and a wetness indicator line.',ARRAY['12-hour absorbency','Bamboo top sheet','Wetness indicator'],false,120,'ZR-CR-002',8),
  ('feeding-bottle-set','Anti-Colic Feeding Bottle Set','PureNest','care',1149,1599,4.5,97,'0-6m','Two wide-neck bottles with a vented base that keeps air out of every feed.',ARRAY['BPA-free','Vented anti-colic base','Sterilizer safe'],false,55,'ZR-CR-003',9),
  ('lightweight-stroller','Featherlite Travel Stroller','RoamTots','gear',7499,10999,4.8,118,'6-12m','A 6.2kg one-hand-fold stroller with a full recline and a cabin-friendly folded footprint.',ARRAY['One-hand fold','Full recline seat','Cabin bag friendly'],true,18,'ZR-GR-001',10),
  ('ergo-baby-carrier','Ergonomic 4-Way Carrier','RoamTots','gear',3299,4999,4.7,142,'0-6m','Four carry positions with lumbar support and a padded, adjustable hip seat.',ARRAY['4 carry positions','Lumbar support belt','Breathable mesh panel'],false,26,'ZR-GR-002',11),
  ('diaper-backpack','Everyday Diaper Backpack','RoamTots','gear',2199,3299,4.6,88,'12-24m','Twelve pockets, an insulated bottle sleeve and a wipe-clean changing mat included.',ARRAY['Insulated bottle pockets','Includes changing mat','Water-resistant shell'],false,44,'ZR-GR-003',12);

-- Site settings
INSERT INTO public.site_settings (key, value) VALUES
  ('brand_name','Zerah Baby And Kids'),
  ('announcement','Free delivery on orders above ₹999 · Easy 7-day returns'),
  ('hero_title','Everything little ones need, in one happy place'),
  ('hero_subtitle','Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.'),
  ('contact_email','hello@zerahkids.com'),
  ('contact_phone','9057074777, 9667571712'),
  ('store_address','80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India'),
  ('store_hours','Open daily · 10:30 AM – 10:00 PM'),
  ('maps_url','https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA'),
  ('instagram_url','https://www.instagram.com/zerah_kids/');

-- ======================== STORAGE ===========================

-- Create public storage bucket for product images
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('product-images', 'product-images', true, 5242880)
ON CONFLICT (id) DO NOTHING;

-- Public read access (anyone can view images)
CREATE POLICY "product_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Authenticated users can upload images
CREATE POLICY "product_images_auth_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images');

-- Authenticated users can update their uploads
CREATE POLICY "product_images_auth_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images');

-- Admins can delete images
CREATE POLICY "product_images_auth_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images');
