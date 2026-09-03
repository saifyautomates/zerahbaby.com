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
import {
  validateAndNormalizeInstagram,
  validateAndNormalizeFacebook,
  validateAndNormalizeWhatsApp,
} from "@/lib/marketing-links";

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

export type ProductVariant = {
  id: string;
  name: string;
  color?: string | null;
  size?: string | null;
  sku: string;
  barcode?: string | null;
  stock: number;
  priceOverride?: number;
  mrpOverride?: number;
  imageUrl?: string | null;
  conflictReconciliationNeeded?: boolean;
};

export type ProductImageItem = {
  id?: string;
  public_url: string;
  is_primary: boolean;
  sort_order: number;
  color?: string | null;
  alt_text?: string | null;
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
  product_images?: ProductImageItem[];
  buyingPrice?: number;
  deliveryFee?: number;
  recommendationMode?: "manual" | "auto" | "manual_fallback";
  salesChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  sales_channel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  variants: ProductVariant[];
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
  image_url?: string | null;
  images?: string[] | null;
  product_images?:
    | {
        id?: string;
        public_url: string;
        is_primary: boolean;
        sort_order: number;
        color?: string | null;
        alt_text?: string | null;
      }[]
    | null;
  product_variants?:
    | {
        id: string;
        name: string;
        sku: string;
        stock: number;
        price_override?: number;
        mrp_override?: number;
        color?: string | null;
        size?: string | null;
        barcode?: string | null;
        image_url?: string | null;
        conflict_reconciliation_needed?: boolean;
      }[]
    | null;
  recommendation_mode?: string;
  sales_channel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
};

/** Get unique list of distinct colors for a product */
export function getProductColors(product: Product): string[] {
  const colorSet = new Set<string>();

  // 1. From variants
  if (product.variants && product.variants.length > 0) {
    for (const v of product.variants) {
      if (v.color && v.color.trim()) {
        colorSet.add(v.color.trim());
      }
    }
  }

  // 2. From product_images
  if (product.product_images && product.product_images.length > 0) {
    for (const img of product.product_images) {
      if (img.color && img.color.trim()) {
        colorSet.add(img.color.trim());
      }
    }
  }

  return Array.from(colorSet);
}

/** Get gallery images for a specific color (or all images if no color selected or no color images exist) */
export function getColorGallery(product: Product, color?: string | null): string[] {
  if (!product) return [];

  const rawImages = product.product_images || [];
  if (color && color.trim() && rawImages.length > 0) {
    const trimmedColor = color.trim().toLowerCase();
    const colorImages = rawImages
      .filter((img) => img.color && img.color.trim().toLowerCase() === trimmedColor)
      .sort(
        (a, b) =>
          (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
      .map((img) => img.public_url)
      .filter(Boolean);

    if (colorImages.length > 0) {
      return colorImages;
    }
  }

  // Fallback: full product gallery
  const fullGallery = (product.images?.length ? product.images : [product.image]).filter(
    Boolean,
  ) as string[];
  return fullGallery.length > 0 ? fullGallery : [product.image];
}

/** Get representative thumbnail/swatch image for a specific color */
export function getColorSwatchImage(product: Product, color: string): string {
  if (!product || !color) return product?.image || "";

  const trimmedColor = color.trim().toLowerCase();

  // 1. Look in product_images for primary or first of this color
  if (product.product_images && product.product_images.length > 0) {
    const matching = product.product_images
      .filter((img) => img.color && img.color.trim().toLowerCase() === trimmedColor)
      .sort(
        (a, b) =>
          (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );

    if (matching.length > 0 && matching[0].public_url) {
      return matching[0].public_url;
    }
  }

  // 2. Look in variants for image_url
  if (product.variants && product.variants.length > 0) {
    const variantMatch = product.variants.find(
      (v) => v.color && v.color.trim().toLowerCase() === trimmedColor && v.imageUrl,
    );
    if (variantMatch?.imageUrl) {
      return variantMatch.imageUrl;
    }
  }

  return product.image;
}

export const mapProduct = (row: ProductRow): Product => {
  const media = resolveProductMedia({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sku: row.sku,
    category: row.category,
    imageUrl: row.image_url ?? null,
    images: row.images ?? [],
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
    product_images: (row.product_images || []).map((img) => ({
      id: img.id,
      public_url: img.public_url,
      is_primary: img.is_primary,
      sort_order: img.sort_order,
      color: img.color ?? null,
      alt_text: img.alt_text ?? null,
    })),
    deliveryFee:
      row.delivery_fee !== undefined && row.delivery_fee !== null ? Number(row.delivery_fee) : 79,
    recommendationMode:
      (row.recommendation_mode as "manual_fallback" | "manual" | "auto") ?? "manual_fallback",
    salesChannel:
      (row.sales_channel as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY") ?? "ONLINE_AND_OFFLINE",
    sales_channel:
      (row.sales_channel as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY") ?? "ONLINE_AND_OFFLINE",
    variants: (row.product_variants || []).map((v) => ({
      id: v.id,
      name: v.name,
      color: v.color ?? null,
      size: v.size ?? null,
      sku: v.sku,
      barcode: v.barcode ?? null,
      stock: v.stock,
      priceOverride: v.price_override,
      mrpOverride: v.mrp_override,
      imageUrl: v.image_url ?? null,
      conflictReconciliationNeeded: v.conflict_reconciliation_needed,
    })),
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
      .select(
        "*, product_images(id, public_url, is_primary, sort_order, color, alt_text), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url, conflict_reconciliation_needed)",
      )
      .order("sort_order", { ascending: true });
    if (!includeInactive) {
      query = query.eq("is_active", true).eq("sales_channel", "ONLINE_AND_OFFLINE");
    }

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
          m.cacheFullCatalog(mapped as unknown as Array<Record<string, unknown>>).catch(
            console.error,
          );
        })
        .catch(console.error);

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
    } catch (offlineErr) {
      console.warn("[fetchProducts] Failed to read from offline cache fallback", offlineErr);
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

/**
 * Canonical product URL generator.
 * Standardizes product URL generation across the entire application.
 * Safely accepts a Product, ProductRow, ProductDraft, string identifier, or partial object.
 */
export function getProductUrl(
  product: { id?: string; slug?: string; uuid?: string; sku?: string } | string | null | undefined,
): string {
  if (!product) return "/shop";
  if (typeof product === "string") {
    const clean = product.trim();
    return clean ? `/product/${encodeURIComponent(clean)}` : "/shop";
  }
  const identifier =
    product.id?.trim() || product.slug?.trim() || product.uuid?.trim() || product.sku?.trim() || "";
  return identifier ? `/product/${encodeURIComponent(identifier)}` : "/shop";
}

export type SingleProductResult = {
  product: Product | null;
  error: Error | null;
  isNotFound: boolean;
  isError: boolean;
};

let cachedDeliveryFees: Record<string, number> | null = null;
let lastDeliveryFeesFetch = 0;

async function getDeliveryFeesMap(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cachedDeliveryFees && now - lastDeliveryFeesFetch < 1000 * 60 * 5) {
    return cachedDeliveryFees;
  }
  try {
    const { data: settingsData } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "product_delivery_fees")
      .maybeSingle();
    if (settingsData?.value) {
      cachedDeliveryFees = JSON.parse(settingsData.value);
      lastDeliveryFeesFetch = now;
      return cachedDeliveryFees || {};
    }
  } catch {
    // ignore
  }
  return {};
}

export async function fetchSingleProduct(
  rawIdentifier: string,
  includeInactive = false,
): Promise<SingleProductResult> {
  if (!rawIdentifier || !rawIdentifier.trim()) {
    return { product: null, error: null, isNotFound: true, isError: false };
  }

  let decoded = rawIdentifier.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // preserve raw identifier
  }

  const isUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(decoded);

  const selectFields =
    "*, product_images(id, public_url, is_primary, sort_order, color, alt_text), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url, conflict_reconciliation_needed)";

  try {
    let row: ProductRow | null = null;

    if (isUuid) {
      const query = supabase.from("products").select(selectFields).eq("id", decoded);
      if (!includeInactive) {
        const { data, error } = await query.eq("is_active", true).maybeSingle();
        if (error) throw error;
        if (data) {
          row = data as unknown as ProductRow;
        } else {
          // Check if it exists without the active filter (for admin preview)
          const { data: anyData, error: anyError } = await supabase
            .from("products")
            .select(selectFields)
            .eq("id", decoded)
            .maybeSingle();
          if (anyError) throw anyError;
          if (anyData) row = anyData as unknown as ProductRow;
        }
      } else {
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (data) row = data as unknown as ProductRow;
      }
    } else {
      // 1. Try slug (case-insensitive)
      let slugQuery = supabase.from("products").select(selectFields).ilike("slug", decoded);
      if (!includeInactive) {
        slugQuery = slugQuery.eq("is_active", true);
      }
      const { data: slugData, error: slugError } = await slugQuery.maybeSingle();
      if (slugError) throw slugError;
      if (slugData) {
        row = slugData as unknown as ProductRow;
      } else {
        // Try slug without active filter
        const { data: rawSlugData } = await supabase
          .from("products")
          .select(selectFields)
          .ilike("slug", decoded)
          .maybeSingle();
        if (rawSlugData) {
          row = rawSlugData as unknown as ProductRow;
        } else {
          // 2. Try SKU
          const { data: skuData } = await supabase
            .from("products")
            .select(selectFields)
            .ilike("sku", decoded)
            .maybeSingle();
          if (skuData) {
            row = skuData as unknown as ProductRow;
          } else {
            // 3. Try Barcode
            const { data: barcodeData } = await supabase
              .from("products")
              .select(selectFields)
              .eq("barcode", decoded)
              .maybeSingle();
            if (barcodeData) {
              row = barcodeData as unknown as ProductRow;
            }
          }
        }
      }
    }

    if (row) {
      if (!includeInactive && (row.sales_channel === "OFFLINE_ONLY" || !row.is_active)) {
        return { product: null, error: null, isNotFound: true, isError: false };
      }

      let deliveryFee: number | undefined;
      try {
        const feeMap = await getDeliveryFeesMap();
        deliveryFee = feeMap[row.id] ?? feeMap[row.slug];
      } catch {
        // ignore
      }

      const prod = mapProduct(row);
      if (deliveryFee !== undefined) {
        prod.deliveryFee = deliveryFee;
      }
      return { product: prod, error: null, isNotFound: false, isError: false };
    }

    return { product: null, error: null, isNotFound: true, isError: false };
  } catch (err: unknown) {
    console.error("[fetchSingleProduct] Supabase fetch error:", err);

    // Offline / network failure fallback to IndexedDB catalog cache
    try {
      const { getCachedCatalog } = await import("@/lib/offline-sync-engine");
      const cached = await getCachedCatalog();
      if (cached && cached.length > 0) {
        const match = cached.find((r: any) => {
          const s = (r.slug || "").toLowerCase();
          const u = (r.id || "").toLowerCase();
          const k = (r.sku || "").toLowerCase();
          const b = r.barcode || "";
          const target = decoded.toLowerCase();
          return s === target || u === target || k === target || b === decoded;
        });
        if (match) {
          return {
            product: mapProduct(match as unknown as ProductRow),
            error: null,
            isNotFound: false,
            isError: false,
          };
        }
      }
    } catch {
      // ignore
    }

    return {
      product: null,
      error: err instanceof Error ? err : new Error(String(err)),
      isNotFound: false,
      isError: true,
    };
  }
}

export const singleProductQueryOptions = (identifier: string, includeInactive = false) => ({
  queryKey: ["product", identifier, includeInactive] as const,
  queryFn: () => fetchSingleProduct(identifier, includeInactive),
  staleTime: 1000 * 60 * 5, // 5 minutes caching
});

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

export function useProduct(identifier: string, includeInactive = false) {
  return useQuery(singleProductQueryOptions(identifier, includeInactive));
}

export function useCategories() {
  return useQuery(categoriesQueryOptions());
}

export function useSettings() {
  const q = useQuery(settingsQueryOptions());
  const s = q.data ?? {};

  const rawIg = s["instagram_url"] ?? "https://www.instagram.com/zerah_kids/";
  const rawFb = s["facebook_url"] ?? "";
  const rawWa = s["whatsapp_url"] ?? "";
  const rawPhone = s["contact_phone"] ?? "9057074777, 9667571712";

  const igNorm = validateAndNormalizeInstagram(rawIg);
  const fbNorm = validateAndNormalizeFacebook(rawFb);
  const waNorm = validateAndNormalizeWhatsApp(rawWa || rawPhone);

  return {
    ...q,
    settings: s,
    brandName: s["brand_name"] ?? "Zérah Baby & Kids",
    announcement: s["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
    announcementEnabled: s["announcement_enabled"] !== "false",
    announcementBg: s["announcement_bg"] || "#8B2020",
    announcementTextColor: s["announcement_text_color"] || "#FFFFFF",
    announcementLink: s["announcement_link"] || "",
    heroTitle: s["hero_title"] ?? "Everything little ones need, in one happy place",
    heroSubtitle:
      s["hero_subtitle"] ??
      "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
    contactEmail: s["contact_email"] ?? "hello@zerahkids.com",
    contactPhone: rawPhone,
    storeAddress:
      s["store_address"] ??
      "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India",
    storeHours: s["store_hours"] ?? "Open daily · 10:30 AM – 10:00 PM",
    mapsUrl: s["maps_url"] ?? "https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA",
    instagramUrl:
      igNorm.isValid && igNorm.normalizedUrl
        ? igNorm.normalizedUrl
        : "https://www.instagram.com/zerah_kids/",
    facebookUrl: fbNorm.isValid && fbNorm.normalizedUrl ? fbNorm.normalizedUrl : "",
    whatsappUrl: waNorm.isValid && waNorm.normalizedUrl ? waNorm.normalizedUrl : "",
  };
}

export const ageGroups = ["0-6m", "6-12m", "12-24m", "2-4y"];
