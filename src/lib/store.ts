import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import clothing from "@/assets/cat-clothing.jpg";
import toys from "@/assets/cat-toys.jpg";
import care from "@/assets/cat-care.jpg";
import gear from "@/assets/cat-gear.jpg";

export const fallbackImages: Record<string, string> = {
  clothing,
  toys,
  care,
  gear,
  feeding: care,
  diapering: care,
  bath: care,
  footwear: clothing,
};

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
  barcode: string;
  images: string[];
  buyingPrice?: number;
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
  description: string;
  highlights: string[];
  is_featured: boolean;
  is_active: boolean;
  sort_order: number;
  stock?: number;
  low_stock_at?: number;
  sku?: string;
  barcode?: string | null;
  product_images?: { public_url: string; is_primary: boolean; sort_order: number }[] | null;
};

export const mapProduct = (row: ProductRow): Product => {
  const dbImages = row.product_images
    ? [...row.product_images].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const primaryImage = dbImages.find((img) => img.is_primary) || dbImages[0];
  const imageUrl = primaryImage ? primaryImage.public_url : null;
  const imageList = dbImages.map((img) => img.public_url);

  return {
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
    image: imageFor(row.category, imageUrl),
    imageUrl,
    description: row.description,
    highlights: row.highlights ?? [],
    isFeatured: row.is_featured,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    stock: row.stock ?? 0,
    lowStockAt: row.low_stock_at ?? 5,
    sku: row.sku ?? "",
    barcode: row.barcode ?? "",
    images: imageList,
  };
};

export const formatPrice = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

export const discountPct = (product: { price: number; mrp: number }) =>
  product.mrp > 0 ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

async function fetchProducts(includeInactive: boolean): Promise<Product[]> {
  try {
    let query = supabase
      .from("products")
      .select("*, product_images(public_url, is_primary, sort_order)")
      .order("sort_order", { ascending: true });
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    if (data && data.length > 0) {
      return (data as unknown as ProductRow[]).map(mapProduct);
    }
  } catch (err) {
    console.warn("[fetchProducts] Falling back to FirstCry catalog seed:", err);
  }

  // Resilient fallback dataset with all 100 products (10 stock each)
  const { FIRSTCRY_100_PRODUCTS } = await import("@/lib/firstcry-catalog");
  return FIRSTCRY_100_PRODUCTS.filter((p) => includeInactive || p.isActive).map((p) => ({
    uuid: p.slug,
    id: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    mrp: p.mrp,
    rating: p.rating,
    reviews: p.reviews,
    ageGroup: p.ageGroup,
    image: imageFor(p.category, p.imageUrl),
    imageUrl: p.imageUrl,
    description: p.description,
    highlights: p.highlights ?? [],
    isFeatured: p.isFeatured,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    stock: p.stock,
    lowStockAt: p.lowStockAt,
    sku: p.sku,
    barcode: p.barcode,
    images: p.images && p.images.length > 0 ? p.images : [p.imageUrl],
    buyingPrice: p.buyingPrice,
  }));
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
  staleTime: 1000 * 60 * 5, // 5 minutes caching for ultra-fast navigation
});

export const fallbackCategories: Category[] = [
  {
    uuid: "cat-1",
    slug: "clothing",
    name: "Clothing & Fashion",
    tagline: "Soft, breathable everyday wear & festive outfits",
    image: clothing,
    imageUrl: null,
    sortOrder: 1,
  },
  {
    uuid: "cat-2",
    slug: "toys",
    name: "Toys & Games",
    tagline: "Safe sensory play, puzzles & learning toys",
    image: toys,
    imageUrl: null,
    sortOrder: 2,
  },
  {
    uuid: "cat-3",
    slug: "care",
    name: "Nursery & Care",
    tagline: "Gentle skincare, bath & pediatric hygiene essentials",
    image: care,
    imageUrl: null,
    sortOrder: 3,
  },
  {
    uuid: "cat-4",
    slug: "gear",
    name: "Travel Gear & Strollers",
    tagline: "Strollers, car seats, carriers & travel gear",
    image: gear,
    imageUrl: null,
    sortOrder: 4,
  },
  {
    uuid: "cat-5",
    slug: "feeding",
    name: "Feeding & Nursing",
    tagline: "Anti-colic bottles, sterilizers, tableware & pumps",
    image: care,
    imageUrl: null,
    sortOrder: 5,
  },
  {
    uuid: "cat-6",
    slug: "diapering",
    name: "Diapering & Potty",
    tagline: "Ultra-absorbent diapers, wipes & training gear",
    image: care,
    imageUrl: null,
    sortOrder: 6,
  },
  {
    uuid: "cat-7",
    slug: "bath",
    name: "Bath & Healthcare",
    tagline: "Collapsible tubs, organic towels & grooming kits",
    image: care,
    imageUrl: null,
    sortOrder: 7,
  },
  {
    uuid: "cat-8",
    slug: "footwear",
    name: "Footwear & Accessories",
    tagline: "Pre-walkers, sandals, clogs, sneakers & hats",
    image: clothing,
    imageUrl: null,
    sortOrder: 8,
  },
];

export const categoriesQueryOptions = () => ({
  queryKey: ["categories"] as const,
  queryFn: fetchCategories,
  staleTime: 1000 * 60 * 60, // 1 hour caching for categories
  initialData: fallbackCategories,
  initialDataUpdatedAt: 0,
});

export const settingsQueryOptions = () => ({
  queryKey: ["site_settings"] as const,
  queryFn: fetchSettings,
  staleTime: 1000 * 60, // 1 minute caching for site settings so updates sync faster
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
    brandName: s["brand_name"] ?? "Zerah Baby And Kid's",
    announcement: s["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
    heroTitle: s["hero_title"] ?? "Everything little ones need, in one happy place",
    heroSubtitle:
      s["hero_subtitle"] ??
      "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
    contactEmail: s["contact_email"] ?? "hello@zerahkids.com",
    contactPhone: s["contact_phone"] ?? "9057074777, 9667571712",
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
