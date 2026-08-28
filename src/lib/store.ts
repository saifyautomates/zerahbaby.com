import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import clothing from "@/assets/cat-clothing.jpg";
import toys from "@/assets/cat-toys.jpg";
import care from "@/assets/cat-care.jpg";
import gear from "@/assets/cat-gear.jpg";

import {
  resolveProductMedia,
  generateProductFallbackSvg,
  CATEGORY_FALLBACK_IMAGES as fallbackImages,
} from "@/lib/product-media";

export { fallbackImages };

export const imageFor = (
  category: string,
  url?: string | null,
  product?: { name?: string; slug?: string; sku?: string },
) => {
  if (url && url.trim().length > 0) return url;
  if (product) return generateProductFallbackSvg({ ...product, category });
  return fallbackImages[category] ?? fallbackImages.clothing;
};

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
  deliveryFee?: number;
  recommendationMode?: "manual" | "auto" | "manual_fallback";
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
  delivery_fee?: number | null;
  product_images?: { public_url: string; is_primary: boolean; sort_order: number }[] | null;
  recommendation_mode?: string;
};

export const mapProduct = (row: ProductRow): Product => {
  const media = resolveProductMedia({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    category: row.category,
    product_images: row.product_images,
  });

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
    image: media.primaryImage,
    imageUrl: media.imageUrl,
    description: row.description,
    highlights: row.highlights ?? [],
    isFeatured: row.is_featured,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    stock: row.stock ?? 0,
    lowStockAt: row.low_stock_at ?? 5,
    sku: row.sku ?? "",
    barcode: row.barcode ?? "",
    images: media.gallery,
    deliveryFee:
      row.delivery_fee !== undefined && row.delivery_fee !== null ? Number(row.delivery_fee) : 79,
    recommendationMode:
      (row.recommendation_mode as "manual_fallback" | "manual" | "auto") ?? "manual_fallback",
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

    const [productsRes, settingsRes] = await Promise.all([
      query,
      supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle(),
    ]);

    if (productsRes.error) throw productsRes.error;
    if (productsRes.data) {
      let deliveryFees: Record<string, number> = {};
      if (settingsRes.data?.value) {
        try {
          deliveryFees = JSON.parse(settingsRes.data.value);
        } catch {
          deliveryFees = {};
        }
      }

      const mapped = (productsRes.data as unknown as ProductRow[]).map((r) => {
        const prod = mapProduct(r);
        if (deliveryFees[prod.uuid] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.uuid];
        } else if (deliveryFees[prod.id] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.id];
        }
        return prod;
      });

      // Synchronize offline IndexedDB catalog with current active products
      import("@/lib/offline-sync-engine")
        .then((m) => {
          m.cacheFullCatalog(mapped as unknown as Array<Record<string, unknown>>).catch(() => null);
        })
        .catch(() => null);

      return mapped;
    }
  } catch (err) {
    console.error("[fetchProducts] Supabase catalog fetch error:", err);
    // Offline resilience: if network failed, try reading previously cached products from IndexedDB
    try {
      const { getCachedCatalog } = await import("@/lib/offline-sync-engine");
      const cached = await getCachedCatalog();
      if (cached && cached.length > 0) {
        return (cached as unknown as ProductRow[]).map(mapProduct);
      }
    } catch {
      // ignore
    }
  }

  // Authoritative empty state when no products exist
  return [];
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
    image: fallbackImages.clothing,
    imageUrl: fallbackImages.clothing,
    sortOrder: 1,
  },
  {
    uuid: "cat-2",
    slug: "toys",
    name: "Toys & Games",
    tagline: "Safe sensory play, puzzles & learning toys",
    image: fallbackImages.toys,
    imageUrl: fallbackImages.toys,
    sortOrder: 2,
  },
  {
    uuid: "cat-3",
    slug: "care",
    name: "Nursery & Care",
    tagline: "Gentle skincare, bath & pediatric hygiene essentials",
    image: fallbackImages.care,
    imageUrl: fallbackImages.care,
    sortOrder: 3,
  },
  {
    uuid: "cat-4",
    slug: "gear",
    name: "Travel Gear & Strollers",
    tagline: "Strollers, car seats, carriers & travel gear",
    image: fallbackImages.gear,
    imageUrl: fallbackImages.gear,
    sortOrder: 4,
  },
  {
    uuid: "cat-5",
    slug: "feeding",
    name: "Feeding & Nursing",
    tagline: "Anti-colic bottles, sterilizers, tableware & pumps",
    image: fallbackImages.feeding,
    imageUrl: fallbackImages.feeding,
    sortOrder: 5,
  },
  {
    uuid: "cat-6",
    slug: "diapering",
    name: "Diapering & Potty",
    tagline: "Ultra-absorbent diapers, wipes & training gear",
    image: fallbackImages.diapering,
    imageUrl: fallbackImages.diapering,
    sortOrder: 6,
  },
  {
    uuid: "cat-7",
    slug: "bath",
    name: "Bath & Healthcare",
    tagline: "Collapsible tubs, organic towels & grooming kits",
    image: fallbackImages.bath,
    imageUrl: fallbackImages.bath,
    sortOrder: 7,
  },
  {
    uuid: "cat-8",
    slug: "footwear",
    name: "Footwear & Accessories",
    tagline: "Pre-walkers, sandals, clogs, sneakers & hats",
    image: fallbackImages.footwear,
    imageUrl: fallbackImages.footwear,
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
