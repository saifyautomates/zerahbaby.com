import { FIRSTCRY_IMAGE_MAP } from "@/lib/firstcry-catalog";

import clothing from "@/assets/cat-clothing.jpg";
import toys from "@/assets/cat-toys.jpg";
import care from "@/assets/cat-care.jpg";
import gear from "@/assets/cat-gear.jpg";

export const CATEGORY_FALLBACK_IMAGES: Record<string, string> = {
  clothing,
  toys,
  care,
  gear,
  feeding:
    "https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&auto=format&fit=crop&q=80",
  diapering:
    "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80",
  bath: "https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&auto=format&fit=crop&q=80",
  footwear:
    "https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=800&auto=format&fit=crop&q=80",
};

/**
 * Generate a deterministic, high-contrast, beautiful inline SVG placeholder
 * specifically customized with this exact product's name, initials, and category color.
 * Guarantees that Product A NEVER displays Product B's image or a shared generic photo.
 */
export function generateProductFallbackSvg(product?: {
  name?: string;
  category?: string;
  slug?: string;
  sku?: string;
}): string {
  const name = product?.name?.trim() || product?.slug?.trim() || "Product";
  const category = (product?.category?.trim() || "Baby").toUpperCase();
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase() || "ZB";

  // Category specific color palettes
  const palettes: Record<string, { bg1: string; bg2: string; text: string; accent: string }> = {
    clothing: { bg1: "#FFF1F2", bg2: "#FFE4E6", text: "#9F1239", accent: "#F43F5E" },
    toys: { bg1: "#FEF3C7", bg2: "#FDE68A", text: "#92400E", accent: "#F59E0B" },
    care: { bg1: "#F0FDF4", bg2: "#DCFCE7", text: "#166534", accent: "#10B981" },
    gear: { bg1: "#EFF6FF", bg2: "#DBEAFE", text: "#1E40AF", accent: "#3B82F6" },
    feeding: { bg1: "#FAF5FF", bg2: "#F3E8FF", text: "#6B21A8", accent: "#A855F7" },
    diapering: { bg1: "#ECFEFF", bg2: "#CFFAFE", text: "#155E75", accent: "#06B6D4" },
    bath: { bg1: "#F0FDFA", bg2: "#CCFBF1", text: "#115E59", accent: "#14B8A6" },
    footwear: { bg1: "#FFFBEB", bg2: "#FEF3C7", text: "#78350F", accent: "#D97706" },
  };

  const palette = palettes[category.toLowerCase()] || {
    bg1: "#F8FAFC",
    bg2: "#E2E8F0",
    text: "#334155",
    accent: "#64748B",
  };

  // Truncate long names for SVG text display
  const cleanTitle = name.length > 24 ? name.substring(0, 22) + "…" : name;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="100%" height="100%">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)" rx="32"/>
  <circle cx="300" cy="240" r="90" fill="#FFFFFF" opacity="0.9" />
  <text x="300" y="270" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="72" font-weight="bold" fill="${palette.accent}" text-anchor="middle">${initials}</text>
  <rect x="180" y="360" width="240" height="32" rx="16" fill="${palette.accent}" opacity="0.15" />
  <text x="300" y="382" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="bold" fill="${palette.text}" text-anchor="middle" letter-spacing="1.5">${category}</text>
  <text x="300" y="440" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="600" fill="${palette.text}" text-anchor="middle">${cleanTitle}</text>
  <text x="300" y="475" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" fill="${palette.accent}" text-anchor="middle">Zérah Baby &amp; Kids</text>
</svg>`.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type ProductMediaRow = {
  id?: string;
  slug?: string;
  name?: string;
  sku?: string;
  category?: string;
  imageUrl?: string | null;
  image?: string | null;
  images?: string[] | null;
  product_images?: { public_url: string; is_primary?: boolean; sort_order?: number }[] | null;
};

export interface ResolvedProductMedia {
  primaryImage: string;
  imageUrl: string | null;
  gallery: string[];
  hasCustomUpload: boolean;
}

/**
 * CANONICAL GLOBAL PRODUCT MEDIA RESOLVER
 * Deterministically resolves 1-to-1 media for any product entity throughout the application.
 */
export function resolveProductMedia(product?: ProductMediaRow | null): ResolvedProductMedia {
  if (!product) {
    const fallback = generateProductFallbackSvg();
    return {
      primaryImage: fallback,
      imageUrl: null,
      gallery: [fallback],
      hasCustomUpload: false,
    };
  }

  // 1. Check DB product_images relation
  const dbImages = Array.isArray(product.product_images)
    ? [...product.product_images].filter(
        (img) => img && typeof img.public_url === "string" && img.public_url.trim().length > 0,
      )
    : [];

  if (dbImages.length > 0) {
    dbImages.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const explicitPrimary = dbImages.find((img) => img.is_primary);
    const primaryUrl = explicitPrimary ? explicitPrimary.public_url : dbImages[0].public_url;
    const galleryUrls = dbImages.map((img) => img.public_url);

    return {
      primaryImage: primaryUrl,
      imageUrl: primaryUrl,
      gallery: galleryUrls,
      hasCustomUpload: true,
    };
  }

  // 2. Check direct imageUrl / images on the product object
  if (product.imageUrl && product.imageUrl.trim().length > 0) {
    const gallery =
      Array.isArray(product.images) && product.images.length > 0
        ? product.images.filter((u) => typeof u === "string" && u.trim().length > 0)
        : [product.imageUrl];

    return {
      primaryImage: product.imageUrl,
      imageUrl: product.imageUrl,
      gallery: gallery.length > 0 ? gallery : [product.imageUrl],
      hasCustomUpload: true,
    };
  }

  if (Array.isArray(product.images) && product.images.length > 0) {
    const validImages = product.images.filter((u) => typeof u === "string" && u.trim().length > 0);
    if (validImages.length > 0) {
      return {
        primaryImage: validImages[0],
        imageUrl: validImages[0],
        gallery: validImages,
        hasCustomUpload: true,
      };
    }
  }

  // 3. Match against FirstCry curated catalog by slug, SKU, or normalized name
  const seedMatch =
    (product.slug && FIRSTCRY_IMAGE_MAP[product.slug]) ||
    (product.sku && FIRSTCRY_IMAGE_MAP[product.sku]) ||
    (product.name && FIRSTCRY_IMAGE_MAP[product.name.toLowerCase().trim()]);

  if (seedMatch && seedMatch.imageUrl && seedMatch.imageUrl.trim().length > 0) {
    return {
      primaryImage: seedMatch.imageUrl,
      imageUrl: seedMatch.imageUrl,
      gallery: seedMatch.images?.length > 0 ? seedMatch.images : [seedMatch.imageUrl],
      hasCustomUpload: false,
    };
  }

  // 4. Safe product-specific deterministic fallback (guarantees NO cross-product contamination)
  const productSpecificFallback = generateProductFallbackSvg({
    name: product.name,
    category: product.category,
    slug: product.slug,
    sku: product.sku,
  });

  return {
    primaryImage: productSpecificFallback,
    imageUrl: null,
    gallery: [productSpecificFallback],
    hasCustomUpload: false,
  };
}
