/**
 * ZÉRAH BABY & KIDS — Core SEO & Structured Data Engine
 *
 * Provides standardized:
 * 1. Authoritative canonical URL construction
 * 2. Meta tags and social card builders with safe fallbacks
 * 3. Schema.org JSON-LD structured data (Product, Offer, BreadcrumbList, LocalBusiness, Organization)
 * 4. Google Shopping / Merchant Center RSS 2.0 XML feed generator
 */

import type { Product, ProductVariant } from "@/domain/models";

export const SITE_URL = "https://zerahkids.com";
export const BRAND_NAME = "Zérah Baby & Kids";
export const DEFAULT_OG_IMAGE = "https://zerahkids.com/logo.png";

export const STORE_INFO = {
  name: BRAND_NAME,
  legalName: "Zérah Baby & Kids Private Limited",
  url: SITE_URL,
  logo: DEFAULT_OG_IMAGE,
  image: DEFAULT_OG_IMAGE,
  telephone: ["+919057074777", "+919667571712"],
  email: "hello@zerahkids.com",
  streetAddress: "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura",
  addressLocality: "Kota",
  addressRegion: "Rajasthan",
  postalCode: "324001",
  addressCountry: "IN",
  openingHours: "Mo-Su 10:30-22:00",
  instagram: "https://www.instagram.com/zerah_kids/",
};

/**
 * Normalizes and builds an absolute canonical URL.
 */
export function buildCanonicalUrl(path: string, params?: Record<string, string | undefined>): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(cleanPath, SITE_URL);
  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val.trim() !== "") {
        url.searchParams.set(key, val);
      }
    });
  }
  return url.toString();
}

/**
 * Standard meta tag generation config
 */
export interface MetaConfig {
  title: string;
  description: string;
  canonicalUrl: string;
  ogType?: "website" | "product" | "article";
  image?: string | null;
  noindex?: boolean;
  nofollow?: boolean;
  additionalMeta?: Array<{ name?: string; property?: string; content: string }>;
}

/**
 * Builds standard TanStack Router head metadata array
 */
export function buildMetaTags(config: MetaConfig) {
  const title = config.title ? config.title.trim() : `${BRAND_NAME} — Premium Baby & Kids Store`;
  const description = config.description
    ? config.description.trim()
    : "Discover premium baby and kids clothing, safe wooden toys, nursery care essentials, and travel gear at Zérah Baby & Kids.";
  const image = config.image && config.image.startsWith("http") ? config.image : DEFAULT_OG_IMAGE;
  const canonicalUrl = config.canonicalUrl || SITE_URL;

  const meta: Array<{ name?: string; property?: string; content?: string; title?: string }> = [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: BRAND_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: config.ogType || "website" },
    { property: "og:url", content: canonicalUrl },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:alt", content: title },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: title },
  ];

  if (config.noindex) {
    const robotsVal = config.nofollow ? "noindex, nofollow" : "noindex, follow";
    meta.push({ name: "robots", content: robotsVal });
  }

  if (config.additionalMeta) {
    meta.push(...config.additionalMeta);
  }

  return {
    meta,
    links: [{ rel: "canonical", href: canonicalUrl }],
  };
}

/**
 * Schema.org Breadcrumb Item
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Builds Schema.org BreadcrumbList JSON-LD object
 */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

/**
 * Builds Schema.org Organization JSON-LD object
 */
export function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: STORE_INFO.name,
    legalName: STORE_INFO.legalName,
    url: STORE_INFO.url,
    logo: STORE_INFO.logo,
    image: STORE_INFO.image,
    description:
      "Zérah Baby & Kids — Premium baby and kids clothing, safe toys, gear, and nursery essentials curated with parent-trusted standards in Kota, Rajasthan.",
    email: STORE_INFO.email,
    telephone: STORE_INFO.telephone[0],
    address: {
      "@type": "PostalAddress",
      streetAddress: STORE_INFO.streetAddress,
      addressLocality: STORE_INFO.addressLocality,
      addressRegion: STORE_INFO.addressRegion,
      postalCode: STORE_INFO.postalCode,
      addressCountry: STORE_INFO.addressCountry,
    },
    sameAs: [STORE_INFO.instagram],
  };
}

/**
 * Builds Schema.org LocalBusiness / Store JSON-LD object
 */
export function buildLocalBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["Store", "ClothingStore"],
    name: STORE_INFO.name,
    url: STORE_INFO.url,
    telephone: STORE_INFO.telephone,
    email: STORE_INFO.email,
    priceRange: "₹₹",
    image: STORE_INFO.image,
    address: {
      "@type": "PostalAddress",
      streetAddress: STORE_INFO.streetAddress,
      addressLocality: STORE_INFO.addressLocality,
      addressRegion: STORE_INFO.addressRegion,
      postalCode: STORE_INFO.postalCode,
      addressCountry: STORE_INFO.addressCountry,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        opens: "10:30",
        closes: "22:00",
      },
    ],
    sameAs: [STORE_INFO.instagram],
  };
}

/**
 * Builds Schema.org Product & Offers JSON-LD object for PDP
 */
export function buildProductJsonLd(product: Product, canonicalUrl: string) {
  const description = product.description
    ? product.description.substring(0, 500)
    : `Buy ${product.name} at Zérah Baby & Kids. Premium quality for babies and children.`;

  const primaryImage = product.image && product.image.startsWith("http")
    ? product.image
    : `${SITE_URL}${product.image || "/logo.png"}`;

  const allImages = (product.images || [])
    .filter((img) => img && typeof img === "string" && img.startsWith("http"))
    .slice(0, 10);
  if (!allImages.includes(primaryImage)) {
    allImages.unshift(primaryImage);
  }

  const hasVariants = Boolean(product.variants && product.variants.length > 0);

  const offers = hasVariants
    ? product.variants.map((v: ProductVariant) => ({
        "@type": "Offer",
        url: canonicalUrl,
        itemCondition: "https://schema.org/NewCondition",
        priceCurrency: "INR",
        price: v.priceOverride ?? product.price,
        availability:
          v.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        sku: v.sku || v.id,
        seller: {
          "@type": "Organization",
          name: BRAND_NAME,
        },
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "IN",
          returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          merchantReturnDays: 7,
          returnMethod: "https://schema.org/ReturnByMail",
          returnFees: "https://schema.org/FreeReturn",
        },
      }))
    : [
        {
          "@type": "Offer",
          url: canonicalUrl,
          itemCondition: "https://schema.org/NewCondition",
          priceCurrency: "INR",
          price: product.price,
          availability:
            product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          sku: product.sku || product.id,
          seller: {
            "@type": "Organization",
            name: BRAND_NAME,
          },
          hasMerchantReturnPolicy: {
            "@type": "MerchantReturnPolicy",
            applicableCountry: "IN",
            returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
            merchantReturnDays: 7,
            returnMethod: "https://schema.org/ReturnByMail",
            returnFees: "https://schema.org/FreeReturn",
          },
        },
      ];

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: allImages.length > 0 ? allImages : [primaryImage],
    brand: {
      "@type": "Brand",
      name: product.brand || BRAND_NAME,
    },
    sku: product.sku || product.id,
    category: product.category,
    offers: offers.length === 1 ? offers[0] : offers,
  };

  if (product.reviews > 0 && product.rating > 0) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(product.rating.toFixed(1)),
      reviewCount: product.reviews,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return schema;
}

/**
 * Builds Google Merchant Center RSS 2.0 Product Feed XML
 */
export function buildGoogleShoppingXml(products: Product[]): string {
  const escapeXml = (unsafe: string) =>
    unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const itemsXml: string[] = [];

  for (const product of products) {
    if (!product.isActive || product.salesChannel === "OFFLINE_ONLY") continue;

    const prodUrl = `${SITE_URL}/product/${encodeURIComponent(product.id)}`;
    const imageLink = product.image && product.image.startsWith("http")
      ? product.image
      : `${SITE_URL}${product.image || "/logo.png"}`;

    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        const variantPrice = variant.priceOverride ?? product.price;
        const variantAvailability = variant.stock > 0 ? "in_stock" : "out_of_stock";
        const variantId = `${product.id}_${variant.sku || variant.id}`;

        itemsXml.push(`    <item>
      <g:id>${escapeXml(variantId)}</g:id>
      <g:title>${escapeXml(product.name + (variant.name ? ` - ${variant.name}` : ""))}</g:title>
      <g:description>${escapeXml(product.description || product.name)}</g:description>
      <g:link>${escapeXml(prodUrl)}</g:link>
      <g:image_link>${escapeXml(variant.imageUrl || imageLink)}</g:image_link>
      <g:availability>${variantAvailability}</g:availability>
      <g:price>${variantPrice.toFixed(2)} INR</g:price>
      <g:brand>${escapeXml(product.brand || BRAND_NAME)}</g:brand>
      <g:condition>new</g:condition>
      <g:item_group_id>${escapeXml(product.id)}</g:item_group_id>
      <g:identifier_exists>${variant.barcode ? "yes" : "no"}</g:identifier_exists>
      ${variant.barcode ? `<g:gtin>${escapeXml(variant.barcode)}</g:gtin>` : `<g:mpn>${escapeXml(variant.sku || variant.id)}</g:mpn>`}
      ${variant.size ? `<g:size>${escapeXml(variant.size)}</g:size>` : ""}
      ${variant.color ? `<g:color>${escapeXml(variant.color)}</g:color>` : ""}
    </item>`);
      }
    } else {
      const availability = product.stock > 0 ? "in_stock" : "out_of_stock";
      itemsXml.push(`    <item>
      <g:id>${escapeXml(product.id)}</g:id>
      <g:title>${escapeXml(product.name)}</g:title>
      <g:description>${escapeXml(product.description || product.name)}</g:description>
      <g:link>${escapeXml(prodUrl)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${product.price.toFixed(2)} INR</g:price>
      <g:brand>${escapeXml(product.brand || BRAND_NAME)}</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>${product.barcode ? "yes" : "no"}</g:identifier_exists>
      ${product.barcode ? `<g:gtin>${escapeXml(product.barcode)}</g:gtin>` : `<g:mpn>${escapeXml(product.sku || product.id)}</g:mpn>`}
    </item>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(BRAND_NAME)} Products Feed</title>
    <link>${SITE_URL}</link>
    <description>Authoritative live Google Merchant Center shopping feed for ${escapeXml(BRAND_NAME)}</description>
${itemsXml.join("\n")}
  </channel>
</rss>`;
}
