import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
  const cat = (category || "").toLowerCase().trim();
  return fallbackImages[cat] ?? fallbackImages.clothing;
};

import type {
  Product,
  ProductVariant,
  Category,
  ProductImage as ProductImageItem,
} from "@/domain/models";

export type { Product, ProductVariant, Category, ProductImageItem };

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
        variant_id?: string | null;
        variant_sku?: string | null;
        media_type?: string | null;
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
        is_active?: boolean;
        conflict_reconciliation_needed?: boolean;
      }[]
    | null;
  recommendation_mode?: string;
  sales_channel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  buying_price?: number | null;
  buyingPrice?: number | null;
  product_costs?: { buying_price?: number | null } | Array<{ buying_price?: number | null }> | null;
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

/** Get gallery images/videos for a specific color or variant (strictly isolates variant media) */
export function getColorGallery(
  product: Product,
  color?: string | null,
  variant?: ProductVariant | null,
): string[] {
  if (!product) return [];

  const rawImages = product.product_images || [];

  // 1. Variant-level media (SKU or Variant ID in product_images, or variant.images array)
  if (variant) {
    const vSku = variant.sku?.trim().toLowerCase();
    const vId = variant.id;

    // Direct match by variant_sku or variant_id in product_images
    if (rawImages.length > 0) {
      const variantMatched = rawImages
        .filter((img) => {
          if (img.variant_sku && vSku && img.variant_sku.trim().toLowerCase() === vSku) {
            return true;
          }
          if (img.variant_id && vId && img.variant_id === vId) {
            return true;
          }
          return false;
        })
        .sort(
          (a, b) =>
            (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
            (a.sort_order ?? 0) - (b.sort_order ?? 0),
        )
        .map((img) => img.public_url)
        .filter(Boolean);

      if (variantMatched.length > 0) {
        return variantMatched;
      }
    }

    // Match from variant.images if dedicated array of multiple images is set
    if (variant.images && variant.images.length > 1) {
      return variant.images.filter(Boolean);
    }
  }

  // 2. Color-level match (excluding media tagged to a DIFFERENT variant or DIFFERENT color)
  const targetColor = (color || variant?.color)?.trim().toLowerCase();
  if (targetColor && rawImages.length > 0) {
    const vSku = variant?.sku?.trim().toLowerCase();
    const vId = variant?.id;

    const colorImages = rawImages
      .filter((img) => {
        if (!img.color || img.color.trim().toLowerCase() !== targetColor) {
          return false;
        }
        // Strict isolation: if an image belongs to another variant SKU/ID, never show it
        if (img.variant_sku && vSku && img.variant_sku.trim().toLowerCase() !== vSku) {
          return false;
        }
        if (img.variant_id && vId && img.variant_id !== vId) {
          return false;
        }
        return true;
      })
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

  // 3. Product-level general media (where variant_id, variant_sku, and other colors are NOT set)
  if (rawImages.length > 0) {
    const vSku = variant?.sku?.trim().toLowerCase();
    const vId = variant?.id;
    const targetColor = (color || variant?.color)?.trim().toLowerCase();

    const productLevelImages = rawImages
      .filter((img) => {
        // Exclude images tagged to a DIFFERENT variant SKU
        if (img.variant_sku && vSku && img.variant_sku.trim().toLowerCase() !== vSku) {
          return false;
        }
        // Exclude images tagged to a DIFFERENT variant ID
        if (img.variant_id && vId && img.variant_id !== vId) {
          return false;
        }
        // Exclude images tagged to a DIFFERENT color
        if (img.color && img.color.trim()) {
          const imgColor = img.color.trim().toLowerCase();
          if (targetColor && imgColor !== targetColor) {
            return false;
          }
        }
        return true;
      })
      .sort(
        (a, b) =>
          (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
      .map((img) => img.public_url)
      .filter(Boolean);

    if (productLevelImages.length > 0) {
      return productLevelImages;
    }

    // If no isolated product-level images, return all sorted rawImages
    const allSorted = [...rawImages]
      .sort(
        (a, b) =>
          (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
          (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
      .map((img) => img.public_url)
      .filter(Boolean);
    if (allSorted.length > 0) return allSorted;
  }

  // 4. Fallback: variant.imageUrl if available, or full product.images
  if (variant?.imageUrl && (!product.images || product.images.length === 0)) {
    return [variant.imageUrl];
  }

  const fullGallery = (product.images?.length ? product.images : [product.image]).filter(
    Boolean,
  ) as string[];
  if (fullGallery.length > 0) return fullGallery;

  const catFallback = imageFor(product.category || "clothing", null);
  return [catFallback];
}

/** Get representative thumbnail/swatch image for a specific color */
export function getColorSwatchImage(product: Product, color: string): string {
  if (!product) return "";
  if (!color) return product.image || imageFor(product.category || "clothing", null);

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

  return product.image || imageFor(product.category || "clothing", null);
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

  // Normalize variants: exclude inactive, and exclude phantom Default variant if real variants exist
  const rawVariants = (row.product_variants || []).filter(
    (v) => (v as any).is_active !== false,
  );
  const hasRealVariants = rawVariants.some(
    (v) =>
      Boolean(v.color && v.color.trim().length > 0) ||
      Boolean(v.size && v.size.trim().length > 0) ||
      Boolean(v.name && v.name.trim().length > 0 && v.name.trim() !== "Default"),
  );
  const normalizedVariants = hasRealVariants
    ? rawVariants.filter(
        (v) =>
          !(
            (!v.color || !v.color.trim()) &&
            (!v.size || !v.size.trim()) &&
            (!v.name || v.name.trim() === "Default")
          ),
      )
    : rawVariants;

  const totalVariantStock = normalizedVariants.reduce(
    (sum, v) => sum + (Number(v.stock) || 0),
    0,
  );

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
    stock: hasRealVariants ? totalVariantStock : (row.stock ?? 0),
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
      variant_id: (img as any).variant_id ?? null,
      variant_sku: (img as any).variant_sku ?? null,
      media_type:
        (img as any).media_type ??
        (img.public_url?.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ? "video" : "image"),
    })),
    deliveryFee:
      row.delivery_fee !== undefined && row.delivery_fee !== null ? Number(row.delivery_fee) : 65,
    recommendationMode:
      (row.recommendation_mode as "manual_fallback" | "manual" | "auto") ?? "manual_fallback",
    salesChannel:
      (row.sales_channel as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY") ?? "ONLINE_AND_OFFLINE",
    sales_channel:
      (row.sales_channel as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY") ?? "ONLINE_AND_OFFLINE",
    variants: normalizedVariants.map((v) => {
      const vSku = v.sku?.trim().toLowerCase();
      const vImages = (row.product_images || [])
        .filter((img) => {
          if ((img as any).variant_id && (img as any).variant_id === v.id) return true;
          if ((img as any).variant_sku && (img as any).variant_sku.trim().toLowerCase() === vSku)
            return true;
          return false;
        })
        .sort(
          (a, b) =>
            (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) ||
            (a.sort_order ?? 0) - (b.sort_order ?? 0),
        )
        .map((img) => img.public_url);

      const isDefault =
        (!v.color || !v.color.trim()) &&
        (!v.size || !v.size.trim()) &&
        (!v.name || v.name.trim() === "Default");

      // Variant only has a genuine price override if it actually differs from parent product price
      const hasDistinctPrice =
        !isDefault &&
        v.price_override != null &&
        Number(v.price_override) > 0 &&
        Number(v.price_override) !== Number(row.price);

      // Variant only has a genuine MRP override if it has a custom price and a distinct MRP
      const hasDistinctMrp =
        !isDefault &&
        hasDistinctPrice &&
        v.mrp_override != null &&
        Number(v.mrp_override) > 0 &&
        Number(v.mrp_override) !== Number(row.mrp);

      return {
        id: v.id,
        name: v.name,
        color: v.color ?? null,
        size: v.size ?? null,
        sku: v.sku,
        barcode: v.barcode ?? null,
        stock: v.stock,
        priceOverride: hasDistinctPrice ? Number(v.price_override) : undefined,
        mrpOverride: hasDistinctMrp ? Number(v.mrp_override) : undefined,
        imageUrl: v.image_url ?? vImages[0] ?? null,
        images: vImages.length > 0 ? vImages : v.image_url ? [v.image_url] : undefined,
        conflictReconciliationNeeded: v.conflict_reconciliation_needed,
      };
    }),
    buyingPrice: (() => {
      if (row.buyingPrice !== undefined && row.buyingPrice !== null) return Number(row.buyingPrice);
      if (row.buying_price !== undefined && row.buying_price !== null)
        return Number(row.buying_price);
      const costs = row.product_costs;
      if (Array.isArray(costs) && costs.length > 0) return Number(costs[0]?.buying_price || 0);
      if (costs && typeof costs === "object" && "buying_price" in costs)
        return Number(costs.buying_price || 0);
      return 0;
    })(),
    buying_price: (() => {
      if (row.buyingPrice !== undefined && row.buyingPrice !== null) return Number(row.buyingPrice);
      if (row.buying_price !== undefined && row.buying_price !== null)
        return Number(row.buying_price);
      const costs = row.product_costs;
      if (Array.isArray(costs) && costs.length > 0) return Number(costs[0]?.buying_price || 0);
      if (costs && typeof costs === "object" && "buying_price" in costs)
        return Number(costs.buying_price || 0);
      return 0;
    })(),
    product_costs: row.product_costs,
  };
};

// Cache Intl.NumberFormat instances – creating one per call is expensive and
// unnecessary. We only need two formatters: integers and decimals.
const _priceFormatterInt = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const _priceFormatterDec = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const formatPrice = (n: number) => {
  const num = Number(n) || 0;
  return (Number.isInteger(num) ? _priceFormatterInt : _priceFormatterDec).format(num);
};

export const discountPct = (product: { price: number; mrp: number }) =>
  product.mrp > 0 ? Math.round(((product.mrp - product.price) / product.mrp) * 100) : 0;

async function fetchProducts(includeInactive: boolean): Promise<Product[]> {
  try {
    let query = supabase
      .from("products")
      .select(
        "*, product_images(id, public_url, is_primary, sort_order, color, alt_text, variant_id, variant_sku, media_type), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url, is_active, conflict_reconciliation_needed)",
      )
      .order("sort_order", { ascending: true });
    if (!includeInactive) {
      query = query.eq("is_active", true).eq("sales_channel", "ONLINE_AND_OFFLINE");
    }

    const [productsRes, deliveryFees] = await Promise.all([query, getDeliveryFeesMap()]);

    if (productsRes.error) throw productsRes.error;
    if (productsRes.data) {
      const mapped = (productsRes.data as unknown as ProductRow[]).map((r) => {
        const prod = mapProduct(r);
        if (deliveryFees[prod.uuid] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.uuid];
        } else if (deliveryFees[prod.id] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.id];
        } else {
          prod.deliveryFee = 65;
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

export function invalidateDeliveryFeesCache(): void {
  cachedDeliveryFees = null;
  lastDeliveryFeesFetch = 0;
}

export async function getDeliveryFeesMap(forceRefresh = false): Promise<Record<string, number>> {
  const now = Date.now();
  if (!forceRefresh && cachedDeliveryFees && now - lastDeliveryFeesFetch < 1000 * 30) {
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
  return cachedDeliveryFees || {};
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
    "*, product_images(id, public_url, is_primary, sort_order, color, alt_text, variant_id, variant_sku, media_type), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url, is_active, conflict_reconciliation_needed)";

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
      } else {
        prod.deliveryFee = 65;
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
        const match = (cached as unknown as ProductRow[]).find((r: ProductRow) => {
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
  staleTime: 1000 * 30, // 30 seconds caching for fast responsiveness
  refetchOnWindowFocus: true,
});

export const productsQueryOptions = (includeInactive = false) => ({
  queryKey: ["products", includeInactive] as const,
  queryFn: () => fetchProducts(includeInactive),
  staleTime: 1000 * 30, // 30 seconds caching for fast responsiveness
  refetchOnWindowFocus: true,
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
  const s = q.data;

  const parsed = useMemo(() => {
    const data = s ?? {};
    const rawIg = data["instagram_url"] ?? "https://www.instagram.com/zerah_kids/";
    const rawFb = data["facebook_url"] ?? "";
    const rawWa = data["whatsapp_url"] ?? "https://whatsapp.com/channel/0029VbC1igD8fewjKTLYEj0g";
    const rawPhone = data["contact_phone"] ?? "9057074777, 9667571712";

    const igNorm = validateAndNormalizeInstagram(rawIg);
    const fbNorm = validateAndNormalizeFacebook(rawFb);
    const waNorm = validateAndNormalizeWhatsApp(rawWa || "https://whatsapp.com/channel/0029VbC1igD8fewjKTLYEj0g");

    return {
      settings: data,
      brandName: data["brand_name"] ?? "Zérah Baby & Kids",
      announcement: data["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
      announcementEnabled: data["announcement_enabled"] !== "false",
      announcementBg:
        data["announcement_bg"] || "linear-gradient(90deg, #E82A82 0%, #A855F7 50%, #00B4D8 100%)",
      announcementTextColor: data["announcement_text_color"] || "#FFFFFF",
      announcementLink: data["announcement_link"] || "",
      heroTitle: data["hero_title"] ?? "Everything little ones need, in one happy place",
      heroSubtitle:
        data["hero_subtitle"] ??
        "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
      contactEmail: data["contact_email"] ?? "hello@zerahkids.com",
      contactPhone: rawPhone,
      storeAddress:
        data["store_address"] ??
        "Shop No. 4-E-21, 80Ft. Road, Atwal Nagar, Hanumanji Mandir Ke Samne, Kota, Rajasthan 324001, India",
      storeHours: data["store_hours"] ?? "Open daily · 10:30 AM – 10:00 PM",
      mapsUrl: data["maps_url"] ?? "https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA",
      instagramUrl:
        igNorm.isValid && igNorm.normalizedUrl
          ? igNorm.normalizedUrl
          : "https://www.instagram.com/zerah_kids/",
      facebookUrl: fbNorm.isValid && fbNorm.normalizedUrl ? fbNorm.normalizedUrl : "",
      whatsappUrl:
        waNorm.isValid && waNorm.normalizedUrl
          ? waNorm.normalizedUrl
          : "https://whatsapp.com/channel/0029VbC1igD8fewjKTLYEj0g",
    };
  }, [s]);

  return {
    ...q,
    ...parsed,
  };
}

export const ageGroups = [
  "0-6m",
  "6-12m",
  "12-24m",
  "2-4y",
  "4-8y",
  "8-16y",
];

/**
 * Checks whether a given product's age group or any of its variant sizes
 * falls within a target age filter (supporting infancy up to 16 Years).
 */
export function matchesAgeGroup(
  productAgeGroup?: string | null,
  targetAge?: string | null,
  variants?: Array<{ size?: string | null }> | null,
): boolean {
  if (!targetAge || targetAge.toLowerCase() === "all" || targetAge.toLowerCase() === "all ages") {
    return true;
  }

  const target = targetAge.trim().toLowerCase();
  const pAge = (productAgeGroup || "").trim().toLowerCase();

  // If product is flagged for all ages, it matches any age filter
  if (pAge === "all ages" || pAge === "all" || pAge === "free size") {
    return true;
  }

  // Exact or direct substring match on product age group
  if (pAge && (pAge === target || pAge.includes(target) || target.includes(pAge))) {
    return true;
  }

  // Helper to test if a string matches a specific bracket
  const testString = (val: string): boolean => {
    const s = val.toLowerCase().trim();
    if (!s) return false;
    if (s === target || s.includes(target) || target.includes(s)) return true;

    // 0-6m: covers 0-3m, 3-6m, newborn, infant
    if (target === "0-6m" || target === "0-6M") {
      if (/0-3m|3-6m|newborn|infant|^0m|^1m|^2m|^3m|^4m|^5m|^6m/.test(s)) return true;
    }

    // 6-12m: covers 6-9m, 9-12m, 6-12m
    if (target === "6-12m" || target === "6-12M") {
      if (/6-9m|9-12m|6-12m|^6m|^7m|^8m|^9m|^10m|^11m|^12m/.test(s)) return true;
    }

    // 12-24m or 1-2y: covers 12-18m, 18-24m, 1-2y, toddler
    if (target === "12-24m" || target === "12-24M" || target === "1-2y" || target === "1-2Y") {
      if (/12-18m|18-24m|12-24m|1-2y|toddler/.test(s)) return true;
    }

    // 2-4y: covers 2-3y, 3-4y, 2-4y
    if (target === "2-4y" || target === "2-4Y") {
      if (/2-3y|3-4y|2-4y/.test(s)) return true;
    }

    // 4-8y or kids: covers 4-5y, 5-6y, 6-7y, 7-8y, 4-6y, 6-8y, kids
    if (target === "4-8y" || target === "4-8Y" || target.includes("kids")) {
      if (/4-5y|5-6y|6-7y|7-8y|4-6y|6-8y|4-8y|kids/.test(s)) return true;
    }

    // 8-16y or teens: covers 8-9y, 9-10y, 10-11y, 11-12y, 12-13y, 13-14y, 14-15y, 15-16y, teens
    if (target === "8-16y" || target === "8-16Y" || target.includes("teen")) {
      if (
        /8-9y|9-10y|10-11y|11-12y|12-13y|13-14y|14-15y|15-16y|8-10y|10-12y|12-14y|14-16y|8-16y|teen/.test(
          s,
        )
      ) {
        return true;
      }
    }

    return false;
  };

  // Test product-level age group
  if (pAge && testString(pAge)) {
    return true;
  }

  // Test variant sizes
  if (variants && variants.length > 0) {
    for (const v of variants) {
      if (v.size && testString(v.size)) {
        return true;
      }
    }
  }

  return false;
}
