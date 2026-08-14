import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import clothing from "@/assets/cat-clothing.jpg";
import toys from "@/assets/cat-toys.jpg";
import care from "@/assets/cat-care.jpg";
import gear from "@/assets/cat-gear.jpg";

export const fallbackImages: Record<string, string> = { clothing, toys, care, gear };

export const imageFor = (category: string, url?: string | null) =>
  url && url.trim().length > 0 ? url : (fallbackImages[category] ?? clothing);

export type Product = {
  uuid: string;
  id: string; // slug — used in URLs and the cart
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  ageGroup: string;
  image: string;
  imageUrl: string | null;
  description: string;
  highlights: string[];
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  stock: number;
  lowStockAt: number;
  sku: string;
  images: string[];
};

export type Category = {
  uuid: string;
  slug: string;
  name: string;
  tagline: string;
  image: string;
  imageUrl: string | null;
  sortOrder: number;
};

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  age_group: string;
  image_url: string | null;
  description: string;
  highlights: string[];
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  stock?: number;
  low_stock_at?: number;
  sku?: string;
  images?: string[] | null;
};

export const mapProduct = (row: ProductRow): Product => ({
  uuid: row.id,
  id: row.slug,
  name: row.name,
  brand: row.brand,
  category: row.category,
  price: Number(row.price),
  mrp: Number(row.mrp),
  rating: Number(row.rating),
  reviews: row.reviews,
  ageGroup: row.age_group,
  image: imageFor(row.category, row.image_url),
  imageUrl: row.image_url,
  description: row.description,
  highlights: row.highlights ?? [],
  isFeatured: row.is_featured,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  stock: row.stock ?? 0,
  lowStockAt: row.low_stock_at ?? 5,
  sku: row.sku ?? "",
  images: (row.images ?? []).filter(Boolean),
});

export const formatPrice = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const discountPct = (product: { price: number; mrp: number }) =>
  product.mrp > 0 ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

async function fetchProducts(includeInactive: boolean): Promise<Product[]> {
  let query = supabase.from("products").select("*").order("sort_order", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as ProductRow[]).map(mapProduct);
}

async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    uuid: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    image: imageFor(row.slug, row.image_url),
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
  }));
}

async function fetchSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("site_settings").select("key, value");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export const productsQueryOptions = (includeInactive = false) => ({
  queryKey: ["products", includeInactive] as const,
  queryFn: () => fetchProducts(includeInactive),
  staleTime: 30_000,
});

export const categoriesQueryOptions = () => ({
  queryKey: ["categories"] as const,
  queryFn: fetchCategories,
  staleTime: 60_000,
});

export const settingsQueryOptions = () => ({
  queryKey: ["site_settings"] as const,
  queryFn: fetchSettings,
  staleTime: 60_000,
});

export function useProducts(includeInactive = false) {
  return useQuery(productsQueryOptions(includeInactive));
}

export function useCategories() {
  return useQuery(categoriesQueryOptions());
}

export function useSettings() {
  const q = useQuery(settingsQueryOptions());
  const s = q.data ?? {};
  return {
    ...q,
    settings: s,
    brandName: s["brand_name"] ?? "Zerah Baby And Kids",
    announcement: s["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
    heroTitle: s["hero_title"] ?? "Everything little ones need, in one happy place",
    heroSubtitle:
      s["hero_subtitle"] ??
      "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
    contactEmail: s["contact_email"] ?? "hello@zerahbabyandkids.com",
    contactPhone: s["contact_phone"] ?? "+91 90000 00000",
    storeAddress:
      s["store_address"] ??
      "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India",
    storeHours: s["store_hours"] ?? "Open daily · 10:30 AM – 10:00 PM",
    mapsUrl: s["maps_url"] ?? "https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA",
    instagramUrl: s["instagram_url"] ?? "https://www.instagram.com/zerah_kids/",
    facebookUrl: s["facebook_url"] ?? "",
    whatsappUrl: s["whatsapp_url"] ?? "",
  };
}

export const ageGroups = ["0-6m", "6-12m", "12-24m", "2-4y"];
