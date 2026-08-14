-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
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
CREATE POLICY "admins read roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.admin_allowlist (
  email text PRIMARY KEY,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_allowlist TO authenticated;
GRANT ALL ON public.admin_allowlist TO service_role;
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read allowlist" ON public.admin_allowlist FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
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

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  price numeric NOT NULL DEFAULT 0,
  mrp numeric NOT NULL DEFAULT 0,
  rating numeric NOT NULL DEFAULT 0,
  reviews integer NOT NULL DEFAULT 0,
  age_group text NOT NULL DEFAULT '',
  image_url text,
  images text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  highlights text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  stock integer NOT NULL DEFAULT 0,
  low_stock_at integer NOT NULL DEFAULT 5,
  sku text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active products public read" ON public.products FOR SELECT USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage products" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Site settings
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

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  pincode text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admins read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Orders
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
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
  notes text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'cod',
  subtotal numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  invoice_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own orders read" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own orders insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "admins read orders" ON public.orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update orders" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_slug text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  image_url text,
  price numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own order items read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "own order items insert" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "admins read order items" ON public.order_items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Helper functions used by the app
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

  -- Bootstrap: the first signed-in account becomes the store admin.
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

REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_admin_from_allowlist() FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_admin_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_admins() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

-- Seed categories
INSERT INTO public.categories (slug, name, tagline, sort_order) VALUES
  ('clothing','Clothing','Soft, breathable everyday wear',1),
  ('toys','Toys','Safe play that grows with them',2),
  ('care','Nursery & Care','Gentle essentials you can trust',3),
  ('gear','Travel Gear','Strollers, carriers and on-the-go picks',4);

-- Seed products
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

-- Seed default site text
INSERT INTO public.site_settings (key, value) VALUES
  ('brand_name','Zerah Baby And Kids'),
  ('announcement','Free delivery on orders above ₹999 · Easy 7-day returns'),
  ('hero_title','Everything little ones need, in one happy place'),
  ('hero_subtitle','Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.'),
  ('contact_email','hello@zerahbabyandkids.com'),
  ('contact_phone','+91 90000 00000'),
  ('store_address','80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India'),
  ('store_hours','Open daily · 10:30 AM – 10:00 PM'),
  ('maps_url','https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA'),
  ('instagram_url','https://www.instagram.com/zerah_kids/');