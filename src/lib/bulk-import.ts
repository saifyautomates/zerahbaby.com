/**
 * bulk-import.ts
 *
 * Full-parity Bulk Product Import Engine for Zérah Baby & Kids.
 * Achieves 100% field, variant, pricing, media, and validation parity
 * with the Add Product form (ProductForm.tsx) and Supabase database schema.
 *
 * Pipeline:
 *   parsePackageFile()  →  groupAndValidateRows()  →  commitBulkImport()
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/lib/uploads";

// ---------------------------------------------------------------------------
// Constants & Allowed Vocabularies
// ---------------------------------------------------------------------------

export const VALID_CATEGORIES = [
  "clothing",
  "toys",
  "care",
  "gear",
  "feeding",
  "diapering",
  "bath",
  "footwear",
] as const;

export const VALID_AGE_GROUPS = [
  "0-6m",
  "6-12m",
  "1-2y",
  "12-24m",
  "2-4y",
  "4-6y",
  "All Ages",
] as const;

export const CATEGORY_PREFIXES: Record<string, string> = {
  clothing: "CL",
  toys: "TY",
  care: "CR",
  gear: "GR",
  feeding: "FD",
  diapering: "DP",
  bath: "BT",
  footwear: "FW",
};

/** Number of products committed per Supabase database transaction chunk */
const DB_CHUNK_SIZE = 20;
/** Concurrency limit for simultaneous media uploads to Supabase Storage */
const MEDIA_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Excel Template Specification (100% Parity with Add Product)
// ---------------------------------------------------------------------------

export interface TemplateColumnSpec {
  header: string;
  key: string;
  required: boolean;
  group: string;
  description: string;
  sampleValue1: string | number;
  sampleValue2: string | number;
  sampleValue3: string | number;
}

export const TEMPLATE_COLUMNS: TemplateColumnSpec[] = [
  // IDENTIFICATION
  {
    header: "Product SKU",
    key: "sku",
    required: true,
    group: "Identification",
    description: "Unique product identifier (e.g. ZR-CL-4189). Multi-variant rows repeat this SKU.",
    sampleValue1: "ZR-TY-1001",
    sampleValue2: "ZR-CL-2001",
    sampleValue3: "ZR-CL-2001",
  },
  {
    header: "Product Name",
    key: "name",
    required: true,
    group: "Basic Information",
    description: "Title of the product (max 120 chars).",
    sampleValue1: "Wooden Sensory Stacking Rings",
    sampleValue2: "Organic Cotton Baby Romper",
    sampleValue3: "Organic Cotton Baby Romper",
  },
  {
    header: "Brand",
    key: "brand",
    required: false,
    group: "Basic Information",
    description: "Brand name (default: 'Zérah').",
    sampleValue1: "Zérah",
    sampleValue2: "Zérah",
    sampleValue3: "Zérah",
  },
  {
    header: "Category",
    key: "category",
    required: true,
    group: "Basic Information",
    description: "Must be: clothing, toys, care, gear, feeding, diapering, bath, footwear",
    sampleValue1: "toys",
    sampleValue2: "clothing",
    sampleValue3: "clothing",
  },
  {
    header: "Selling Price",
    key: "price",
    required: true,
    group: "Pricing",
    description: "Final selling price in ₹ (e.g. 499). Must be > 0 and <= MRP.",
    sampleValue1: 499,
    sampleValue2: 399,
    sampleValue3: 399,
  },
  {
    header: "MRP",
    key: "mrp",
    required: true,
    group: "Pricing",
    description: "Maximum retail price in ₹ (e.g. 799). Must be >= Selling Price.",
    sampleValue1: 799,
    sampleValue2: 799,
    sampleValue3: 799,
  },
  {
    header: "Buying Price",
    key: "buying_price",
    required: false,
    group: "Pricing",
    description: "Internal cost/purchase price in ₹ for profit reporting (saved to product_costs).",
    sampleValue1: 220,
    sampleValue2: 150,
    sampleValue3: 150,
  },
  {
    header: "Stock",
    key: "stock",
    required: false,
    group: "Inventory",
    description: "Inventory count. For products with variants, this is auto-calculated from variant stocks.",
    sampleValue1: 45,
    sampleValue2: "",
    sampleValue3: "",
  },
  {
    header: "Low Stock Alert",
    key: "low_stock_at",
    required: false,
    group: "Inventory",
    description: "Alert threshold for low inventory warnings (default: 5).",
    sampleValue1: 5,
    sampleValue2: 5,
    sampleValue3: 5,
  },
  {
    header: "Age Group",
    key: "age_group",
    required: false,
    group: "Basic Information",
    description: "e.g. 0-6m, 6-12m, 1-2y, 2-4y, 4-6y, All Ages",
    sampleValue1: "6-12m",
    sampleValue2: "0-6m",
    sampleValue3: "0-6m",
  },
  {
    header: "Barcode",
    key: "barcode",
    required: false,
    group: "Identification",
    description: "Parent 8-14 digit barcode. Auto-generated if left blank.",
    sampleValue1: "359719710001",
    sampleValue2: "359719710002",
    sampleValue3: "359719710002",
  },
  {
    header: "Slug",
    key: "slug",
    required: false,
    group: "Identification",
    description: "URL slug (e.g. wooden-stacking-rings). Auto-generated from name if blank.",
    sampleValue1: "wooden-sensory-stacking-rings",
    sampleValue2: "organic-cotton-baby-romper",
    sampleValue3: "organic-cotton-baby-romper",
  },
  {
    header: "Delivery Fee",
    key: "delivery_fee",
    required: false,
    group: "Logistics",
    description: "Per-product delivery fee in ₹ (e.g. 65, or 0 for Free Delivery).",
    sampleValue1: 65,
    sampleValue2: 65,
    sampleValue3: 65,
  },
  {
    header: "Sales Channel",
    key: "sales_channel",
    required: false,
    group: "Publishing",
    description: "ONLINE_AND_OFFLINE or OFFLINE_ONLY (default: ONLINE_AND_OFFLINE).",
    sampleValue1: "ONLINE_AND_OFFLINE",
    sampleValue2: "ONLINE_AND_OFFLINE",
    sampleValue3: "ONLINE_AND_OFFLINE",
  },
  {
    header: "Description",
    key: "description",
    required: false,
    group: "Basic Information",
    description: "Full product description.",
    sampleValue1: "Natural beechwood stacking toy that teaches hand-eye coordination.",
    sampleValue2: "Softest organic combed cotton with nickel-free snap buttons for easy diaper changes.",
    sampleValue3: "Softest organic combed cotton with nickel-free snap buttons for easy diaper changes.",
  },
  {
    header: "Highlights",
    key: "highlights",
    required: false,
    group: "Basic Information",
    description: "Key product bullet points separated by pipe '|' (e.g. 100% Cotton | BPA Free).",
    sampleValue1: "Natural beechwood | Non-toxic food-grade paint | Smooth edges",
    sampleValue2: "100% Organic Cotton | Hypoallergenic | Snap closure",
    sampleValue3: "100% Organic Cotton | Hypoallergenic | Snap closure",
  },
  {
    header: "Is Featured",
    key: "is_featured",
    required: false,
    group: "Publishing",
    description: "TRUE or FALSE (default: FALSE).",
    sampleValue1: "FALSE",
    sampleValue2: "TRUE",
    sampleValue3: "TRUE",
  },
  {
    header: "Is Active",
    key: "is_active",
    required: false,
    group: "Publishing",
    description: "TRUE or FALSE (default: TRUE).",
    sampleValue1: "TRUE",
    sampleValue2: "TRUE",
    sampleValue3: "TRUE",
  },
  {
    header: "Sort Order",
    key: "sort_order",
    required: false,
    group: "Publishing",
    description: "Sorting priority (integer, 0 is top).",
    sampleValue1: 10,
    sampleValue2: 20,
    sampleValue3: 20,
  },
  {
    header: "Recommendation Mode",
    key: "recommendation_mode",
    required: false,
    group: "Publishing",
    description: "manual, auto, or manual_fallback (default: manual_fallback).",
    sampleValue1: "manual_fallback",
    sampleValue2: "manual_fallback",
    sampleValue3: "manual_fallback",
  },
  {
    header: "Homepage Sections",
    key: "homepage_sections",
    required: false,
    group: "Publishing",
    description: "Comma-separated homepage section slugs/titles (e.g. new-arrivals-trending, bestsellers-parent-favorites).",
    sampleValue1: "bestsellers-parent-favorites",
    sampleValue2: "new-arrivals-trending",
    sampleValue3: "new-arrivals-trending",
  },
  {
    header: "SEO Title",
    key: "seo_title",
    required: false,
    group: "SEO",
    description: "Search engine page title (max 70 chars).",
    sampleValue1: "Wooden Sensory Stacking Toy for Babies | Zérah",
    sampleValue2: "Organic Cotton Baby Romper | Zérah Baby",
    sampleValue3: "Organic Cotton Baby Romper | Zérah Baby",
  },
  {
    header: "SEO Description",
    key: "seo_description",
    required: false,
    group: "SEO",
    description: "Search engine description (max 160 chars).",
    sampleValue1: "Eco-friendly wooden sensory stacking rings for infants aged 6-12 months.",
    sampleValue2: "Breathable organic cotton romper with quick-snap buttons for babies.",
    sampleValue3: "Breathable organic cotton romper with quick-snap buttons for babies.",
  },
  // VARIANT FIELDS
  {
    header: "Variant Name",
    key: "variant_name",
    required: false,
    group: "Variants",
    description: "Descriptive variant name (e.g. 'Ocean Blue / 0-6m'). Auto-derived if omitted.",
    sampleValue1: "",
    sampleValue2: "Ocean Blue / 0-6m",
    sampleValue3: "Blush Pink / 0-6m",
  },
  {
    header: "Color",
    key: "color",
    required: false,
    group: "Variants",
    description: "Variant color (e.g. Blue, Pink, Sage Green).",
    sampleValue1: "",
    sampleValue2: "Ocean Blue",
    sampleValue3: "Blush Pink",
  },
  {
    header: "Size",
    key: "size",
    required: false,
    group: "Variants",
    description: "Variant size (e.g. 0-6m, 6-12m, 1-2y, S, M, L).",
    sampleValue1: "",
    sampleValue2: "0-6m",
    sampleValue3: "0-6m",
  },
  {
    header: "Variant SKU",
    key: "variant_sku",
    required: false,
    group: "Variants",
    description: "Unique variant SKU (e.g. ZR-CL-2001-BL-06). Auto-generated if omitted.",
    sampleValue1: "",
    sampleValue2: "ZR-CL-2001-BL-06",
    sampleValue3: "ZR-CL-2001-PK-06",
  },
  {
    header: "Variant Barcode",
    key: "variant_barcode",
    required: false,
    group: "Variants",
    description: "Variant 8-14 digit barcode. Auto-generated if omitted.",
    sampleValue1: "",
    sampleValue2: "359719710003",
    sampleValue3: "359719710004",
  },
  {
    header: "Variant Stock",
    key: "variant_stock",
    required: false,
    group: "Variants",
    description: "Stock quantity for this specific variant.",
    sampleValue1: "",
    sampleValue2: 25,
    sampleValue3: 30,
  },
  {
    header: "Variant Price Override",
    key: "variant_price",
    required: false,
    group: "Variants",
    description: "Price override in ₹ for this variant. Leave blank to inherit product selling price.",
    sampleValue1: "",
    sampleValue2: "",
    sampleValue3: "",
  },
  {
    header: "Variant MRP Override",
    key: "variant_mrp",
    required: false,
    group: "Variants",
    description: "MRP override in ₹ for this variant. Leave blank to inherit product MRP.",
    sampleValue1: "",
    sampleValue2: "",
    sampleValue3: "",
  },
  {
    header: "Variant Image File",
    key: "variant_image",
    required: false,
    group: "Variants",
    description: "Image filename in the SKU folder for this variant (e.g. blue.jpg).",
    sampleValue1: "",
    sampleValue2: "ocean-blue.jpg",
    sampleValue3: "blush-pink.jpg",
  },
  // DIRECT MEDIA URLS (Optional alternative to ZIP folders)
  {
    header: "Image URL 1",
    key: "image_url",
    required: false,
    group: "Media (Optional URLs)",
    description: "Direct URL for primary image (if not using ZIP SKU folders).",
    sampleValue1: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1",
    sampleValue2: "",
    sampleValue3: "",
  },
  {
    header: "Image URL 2",
    key: "image_url_2",
    required: false,
    group: "Media (Optional URLs)",
    description: "Direct URL for secondary image.",
    sampleValue1: "",
    sampleValue2: "",
    sampleValue3: "",
  },
  {
    header: "Image URL 3",
    key: "image_url_3",
    required: false,
    group: "Media (Optional URLs)",
    description: "Direct URL for additional gallery image.",
    sampleValue1: "",
    sampleValue2: "",
    sampleValue3: "",
  },
];

// ---------------------------------------------------------------------------
// Template Downloaders
// ---------------------------------------------------------------------------

/**
 * Downloads a rich, dual-sheet Excel template (.xlsx) with:
 * 1. "Products Import Template" tab pre-filled with all columns and realistic sample rows.
 * 2. "Instructions & Reference" tab explaining category codes, age groups, and ZIP structure.
 */
export function downloadBulkImportTemplate(): void {
  const wb = XLSX.utils.book_new();

  // 1. Products Sheet
  const headers = TEMPLATE_COLUMNS.map((c) => c.header);
  const row1 = TEMPLATE_COLUMNS.map((c) => c.sampleValue1);
  const row2 = TEMPLATE_COLUMNS.map((c) => c.sampleValue2);
  const row3 = TEMPLATE_COLUMNS.map((c) => c.sampleValue3);

  const wsProducts = XLSX.utils.aoa_to_sheet([headers, row1, row2, row3]);

  // Adjust column widths automatically
  wsProducts["!cols"] = TEMPLATE_COLUMNS.map((col) => ({
    wch: Math.max(col.header.length + 3, 14),
  }));

  XLSX.utils.book_append_sheet(wb, wsProducts, "Products Import Template");

  // 2. Instructions Sheet
  const instructionsData = [
    ["ZÉRAH BABY & KIDS — BULK PRODUCT IMPORT INSTRUCTIONS"],
    [""],
    ["HOW TO PREPARE YOUR IMPORT:"],
    ["1. ONE PRODUCT, MULTIPLE VARIANTS:"],
    ["   - To add multiple variants for a product, enter the same Product SKU on multiple consecutive rows."],
    ["   - Row 1 specifies the parent product details + Variant 1 (Color, Size, Variant SKU, Stock, etc.)."],
    ["   - Row 2+ repeats the same Product SKU, leaving parent details blank (or identical), and specifies Variant 2, Variant 3, etc."],
    ["   - Total product stock is automatically calculated by summing variant stocks."],
    [""],
    ["2. SINGLE ZIP MEDIA WORKFLOW (RECOMMENDED):"],
    ["   Create a ZIP file named 'products-import.zip' containing:"],
    ["   - products.xlsx (this spreadsheet)"],
    ["   - A folder for each Product SKU containing its images and videos:"],
    ["     Example:"],
    ["       ZR-TY-1001/"],
    ["         1.jpg        (Main primary image)"],
    ["         2.jpg        (Gallery image)"],
    ["         demo.mp4     (Product video)"],
    ["       ZR-CL-2001/"],
    ["         1.jpg"],
    ["         ocean-blue.jpg (Variant image)"],
    ["         blush-pink.jpg (Variant image)"],
    [""],
    ["3. CATEGORY VALUES (must match exactly):"],
    ["   clothing, toys, care, gear, feeding, diapering, bath, footwear"],
    [""],
    ["4. AGE GROUP VALUES:"],
    ["   0-6m, 6-12m, 1-2y, 12-24m, 2-4y, 4-6y, All Ages"],
    [""],
    ["5. PRICING & BUYING PRICE:"],
    ["   - Selling Price must be greater than 0 and less than or equal to MRP."],
    ["   - Buying Price is recorded internally in product_costs for profit analytics and does not alter historical sales."],
    [""],
    ["6. DELIVERY FEE:"],
    ["   - Enter numeric amount in ₹ (e.g. 65), or 0 for Free Delivery."],
    [""],
    ["COLUMN DICTIONARY:"],
    ["Column Name", "Required", "Group", "Description"],
    ...TEMPLATE_COLUMNS.map((c) => [c.header, c.required ? "YES" : "NO", c.group, c.description]),
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
  wsInstructions["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions & Reference");

  // Export buffer
  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbOut], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zerah-bulk-products-template-${Date.now()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Legacy CSV template downloader */
export function downloadCsvTemplate(): void {
  downloadBulkImportTemplate();
}

// ---------------------------------------------------------------------------
// Types & Domain Models
// ---------------------------------------------------------------------------

export type BulkRowStatus = "new" | "update" | "skip" | "error";
export type BulkMode = "new_and_update" | "new_only" | "update_only";

export interface BulkProductMedia {
  file: File | Blob;
  fileName: string;
  previewUrl: string;
  isVideo: boolean;
  color?: string;
  variantSku?: string;
  sortOrder: number;
}

export interface BulkVariant {
  name?: string;
  color?: string;
  size?: string;
  sku: string;
  barcode?: string;
  stock: number;
  priceOverride?: number;
  mrpOverride?: number;
  imageFileName?: string;
  imageUrl?: string;
  buyingPrice?: number;
}

export interface BulkProductGroup {
  rowIndices: number[]; // file row numbers (1-indexed)
  raw: Record<string, string>;
  // Authoritative product attributes
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  buyingPrice: number;
  stock: number;
  lowStockAt: number;
  ageGroup: string;
  barcode: string;
  slug: string;
  deliveryFee: number;
  salesChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  description: string;
  highlights: string[];
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  recommendationMode: "manual" | "auto" | "manual_fallback";
  homepageSections: string[];
  seoTitle: string;
  seoDescription: string;
  // Variants
  variants: BulkVariant[];
  // Direct URLs
  imageUrls: string[];
  // Media from ZIP
  zipMedia: BulkProductMedia[];
  // Status & Validation
  status: BulkRowStatus;
  errors: string[];
  warnings: string[];
  existingId?: string;
  selected: boolean;
}

export interface CommitProgress {
  current: number;
  total: number;
  message: string;
  stage: "media" | "database" | "sync" | "done";
}

export interface CommitResult {
  succeeded: number;
  updated: number;
  failed: BulkProductGroup[];
  totalMediaUploaded: number;
}

export interface ExistingProductRef {
  id: string;
  slug: string;
  sku: string;
  barcode?: string | null;
}

// ---------------------------------------------------------------------------
// File Parsing & ZIP Extraction
// ---------------------------------------------------------------------------

export interface ParsedPackage {
  rawRows: Array<Record<string, string>>;
  mediaBySku: Map<string, BulkProductMedia[]>;
  fileName: string;
}

/** Normalize keys in parsed rows to match TEMPLATE_COLUMNS keys */
function normalizeHeaderKeys(row: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};

  // Build a lookup map of common aliases to canonical keys
  const aliasMap: Record<string, string> = {
    // sku
    sku: "sku",
    "product sku": "sku",
    product_sku: "sku",
    productsku: "sku",
    // name
    name: "name",
    "product name": "name",
    product_name: "name",
    title: "name",
    "product title": "name",
    // brand
    brand: "brand",
    "brand name": "brand",
    // category
    category: "category",
    "product category": "category",
    // price
    price: "price",
    "selling price": "price",
    selling_price: "price",
    "price (₹)": "price",
    "selling price (₹)": "price",
    // mrp
    mrp: "mrp",
    "mrp (₹)": "mrp",
    "original price": "mrp",
    // buying price
    buying_price: "buying_price",
    "buying price": "buying_price",
    buyingprice: "buying_price",
    "cost price": "buying_price",
    cost_price: "buying_price",
    // stock
    stock: "stock",
    quantity: "stock",
    qty: "stock",
    // low stock
    low_stock_at: "low_stock_at",
    "low stock alert": "low_stock_at",
    "low stock threshold": "low_stock_at",
    // age group
    age_group: "age_group",
    "age group": "age_group",
    age: "age_group",
    // barcode
    barcode: "barcode",
    "barcode number": "barcode",
    ean: "barcode",
    upc: "barcode",
    // slug
    slug: "slug",
    "url slug": "slug",
    // delivery fee
    delivery_fee: "delivery_fee",
    "delivery fee": "delivery_fee",
    "shipping fee": "delivery_fee",
    delivery_fees: "delivery_fee",
    // sales channel
    sales_channel: "sales_channel",
    "sales channel": "sales_channel",
    channel: "sales_channel",
    // description
    description: "description",
    desc: "description",
    // highlights
    highlights: "highlights",
    "bullet points": "highlights",
    features: "highlights",
    // is featured
    is_featured: "is_featured",
    "is featured": "is_featured",
    featured: "is_featured",
    // is active
    is_active: "is_active",
    "is active": "is_active",
    active: "is_active",
    status: "is_active",
    // sort order
    sort_order: "sort_order",
    "sort order": "sort_order",
    position: "sort_order",
    // recommendation mode
    recommendation_mode: "recommendation_mode",
    "recommendation mode": "recommendation_mode",
    // homepage sections
    homepage_sections: "homepage_sections",
    "homepage sections": "homepage_sections",
    sections: "homepage_sections",
    // seo
    seo_title: "seo_title",
    "seo title": "seo_title",
    seo_description: "seo_description",
    "seo description": "seo_description",
    // variants
    variant_name: "variant_name",
    "variant name": "variant_name",
    color: "color",
    colour: "color",
    size: "size",
    variant_sku: "variant_sku",
    "variant sku": "variant_sku",
    variant_barcode: "variant_barcode",
    "variant barcode": "variant_barcode",
    variant_stock: "variant_stock",
    "variant stock": "variant_stock",
    variant_price: "variant_price",
    "variant price": "variant_price",
    "variant price override": "variant_price",
    variant_mrp: "variant_mrp",
    "variant mrp": "variant_mrp",
    "variant mrp override": "variant_mrp",
    variant_image: "variant_image",
    "variant image": "variant_image",
    "variant image file": "variant_image",
    variant_buying_price: "variant_buying_price",
    "variant buying price": "variant_buying_price",
    // media URLs
    image_url: "image_url",
    "image url": "image_url",
    "image url 1": "image_url",
    image_url_2: "image_url_2",
    "image url 2": "image_url_2",
    image_url_3: "image_url_3",
    "image url 3": "image_url_3",
  };

  for (const [key, val] of Object.entries(row)) {
    const cleanKey = key.trim().toLowerCase();
    const targetKey = aliasMap[cleanKey] || cleanKey;
    normalized[targetKey] = String(val ?? "").trim();
  }

  return normalized;
}

/** Natural sort comparator for filenames (e.g. 1.jpg, 2.jpg, 10.jpg) */
const naturalSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/**
 * Universal package parser supporting:
 * - Standalone .csv
 * - Standalone .xlsx / .xls
 * - .zip containing products.xlsx / products.csv + SKU media folders
 */
export async function parsePackageFile(file: File): Promise<ParsedPackage> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // 1. Standalone CSV
  if (ext === "csv") {
    const rawRows = await parseCSVString(await file.text());
    return { rawRows, mediaBySku: new Map(), fileName: file.name };
  }

  // 2. Standalone Excel
  if (ext === "xlsx" || ext === "xls") {
    const rawRows = await parseExcelBuffer(await file.arrayBuffer());
    return { rawRows, mediaBySku: new Map(), fileName: file.name };
  }

  // 3. ZIP File
  if (ext === "zip") {
    return parseZipArchive(file);
  }

  throw new Error(`Unsupported file format ".${ext}". Please upload a .zip, .xlsx, or .csv file.`);
}

/** Parse CSV text into records */
async function parseCSVString(csvContent: string): Promise<Array<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(csvContent, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const rows = results.data.map(normalizeHeaderKeys);
        resolve(rows);
      },
      error: (err: Error) => reject(new Error(`CSV parse error: ${err.message}`)),
    });
  });
}

/** Parse Excel buffer into records from the first non-instruction sheet */
async function parseExcelBuffer(buffer: ArrayBuffer): Promise<Array<Record<string, string>>> {
  const wb = XLSX.read(buffer, { type: "array" });
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("The Excel workbook has no sheets.");
  }

  // Prefer "Products Import Template" or "Products", otherwise first sheet
  const targetSheetName =
    wb.SheetNames.find((s) => /product/i.test(s)) || wb.SheetNames[0];
  const ws = wb.Sheets[targetSheetName];
  if (!ws) throw new Error("Could not find product data sheet in workbook.");

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });

  return jsonRows.map(normalizeHeaderKeys);
}

/** Parse ZIP archive: extracts spreadsheet + SKU folders with images/videos */
async function parseZipArchive(zipFile: File): Promise<ParsedPackage> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(zipFile);

  // 1. Locate the spreadsheet file inside the ZIP
  const fileEntries = Object.keys(loadedZip.files);
  const spreadsheetPath = fileEntries.find((p) => {
    const lower = p.toLowerCase();
    return (
      !lower.startsWith("__macosx") &&
      !lower.startsWith(".") &&
      (lower.endsWith(".xlsx") || lower.endsWith(".csv") || lower.endsWith(".xls"))
    );
  });

  if (!spreadsheetPath) {
    throw new Error(
      "The ZIP archive does not contain a spreadsheet (products.xlsx or products.csv). Please include one.",
    );
  }

  const spreadsheetFile = loadedZip.files[spreadsheetPath];
  let rawRows: Array<Record<string, string>> = [];

  if (spreadsheetPath.toLowerCase().endsWith(".csv")) {
    const csvText = await spreadsheetFile.async("string");
    rawRows = await parseCSVString(csvText);
  } else {
    const xlsxBuffer = await spreadsheetFile.async("arraybuffer");
    rawRows = await parseExcelBuffer(xlsxBuffer);
  }

  // 2. Locate and group media files by SKU folder
  const mediaBySku = new Map<string, BulkProductMedia[]>();
  const mediaPathsByFolder = new Map<string, string[]>();

  for (const path of fileEntries) {
    const entry = loadedZip.files[path];
    if (entry.dir) continue;
    if (path.startsWith("__MACOSX") || path.startsWith(".")) continue;

    const lower = path.toLowerCase();
    const isImage = /\.(jpg|jpeg|png|webp|gif|avif)$/.test(lower);
    const isVideo = /\.(mp4|webm|mov)$/.test(lower);

    if (!isImage && !isVideo) continue;

    // Extract folder name (e.g. "ZR-CL-4189/1.jpg" -> folder: "ZR-CL-4189")
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) continue; // Not inside a folder

    // If zip was packaged with a root folder e.g. "products-import/ZR001/1.jpg"
    const skuFolder = parts.length === 2 ? parts[0] : parts[parts.length - 2];
    const normalizedSkuKey = skuFolder.trim().toLowerCase();

    if (!mediaPathsByFolder.has(normalizedSkuKey)) {
      mediaPathsByFolder.set(normalizedSkuKey, []);
    }
    mediaPathsByFolder.get(normalizedSkuKey)!.push(path);
  }

  // Process and sort media for each SKU folder
  for (const [skuKey, paths] of mediaPathsByFolder.entries()) {
    // Sort paths naturally by filename
    paths.sort((a, b) => {
      const nameA = a.split("/").pop() || "";
      const nameB = b.split("/").pop() || "";
      return naturalSort(nameA, nameB);
    });

    const mediaList: BulkProductMedia[] = [];

    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const entry = loadedZip.files[p];
      const fileName = p.split("/").pop() || `media-${i}`;
      const blob = await entry.async("blob");
      const isVideo = /\.(mp4|webm|mov)$/i.test(fileName);
      const previewUrl = URL.createObjectURL(blob);

      // Attempt to extract color association from filename (e.g. "blue.jpg", "navy-blue-front.png")
      const baseNameWithoutExt = fileName.replace(/\.[^/.]+$/, "").toLowerCase();
      const colorMatch = baseNameWithoutExt.match(
        /^(blue|navy|pink|red|green|yellow|white|black|grey|gray|beige|orange|purple|brown|teal)/i,
      );

      mediaList.push({
        file: blob,
        fileName,
        previewUrl,
        isVideo,
        sortOrder: i,
        color: colorMatch ? colorMatch[0] : undefined,
        variantSku: skuKey,
      });
    }

    mediaBySku.set(skuKey, mediaList);
  }

  return { rawRows, mediaBySku, fileName: zipFile.name };
}

// ---------------------------------------------------------------------------
// Normalization & Validation Layer
// ---------------------------------------------------------------------------

function toNum(v: string | undefined, fallback = 0): number {
  if (!v) return fallback;
  const clean = String(v).replace(/[^\d.-]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? fallback : n;
}

function toInt(v: string | undefined, fallback = 0): number {
  if (!v) return fallback;
  const clean = String(v).replace(/[^\d-]/g, "");
  const n = parseInt(clean, 10);
  return isNaN(n) ? fallback : n;
}

function toBool(v: string | undefined, fallback = true): boolean {
  if (!v) return fallback;
  const lower = String(v).toLowerCase().trim();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return fallback;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function generateSKU(category: string, color?: string | null, size?: string | null): string {
  const prefix = CATEGORY_PREFIXES[category] ?? "GN";
  const colorPart = color
    ? `-${color.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "")}`
    : "";
  const sizePart = size
    ? `-${size.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "")}`
    : "";
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ZR-${prefix}${colorPart}${sizePart}-${random}`;
}

function generateBarcode(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

/** Fetch existing products from Supabase for fast in-memory collision detection */
export async function fetchExistingProducts(): Promise<ExistingProductRef[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, sku, barcode");
  if (error) throw error;
  return (data ?? []) as ExistingProductRef[];
}

/**
 * Groups raw rows into multi-variant product groups and executes
 * 100% parity validation against Add Product rules.
 */
export function groupAndValidateRows(
  rawRows: Array<Record<string, string>>,
  mediaBySku: Map<string, BulkProductMedia[]>,
  existing: ExistingProductRef[],
  mode: BulkMode,
): BulkProductGroup[] {
  const existingBySku = new Map<string, ExistingProductRef>();
  const existingBySlug = new Map<string, ExistingProductRef>();
  const existingByBarcode = new Map<string, ExistingProductRef>();

  for (const p of existing) {
    if (p.sku) existingBySku.set(p.sku.trim().toLowerCase(), p);
    if (p.slug) existingBySlug.set(p.slug.trim().toLowerCase(), p);
    if (p.barcode) existingByBarcode.set(p.barcode.trim(), p);
  }

  // 1. Group rows by Product SKU (or Slug if SKU omitted)
  const productGroups: Array<{
    groupKey: string;
    rows: Array<{ raw: Record<string, string>; rowIndex: number }>;
  }> = [];

  const groupIndexMap = new Map<string, number>();

  let lastGroupKey = "";

  rawRows.forEach((raw, idx) => {
    const rawSku = raw.sku?.trim();
    const rawSlug = raw.slug?.trim();
    const rawName = raw.name?.trim();

    // Determine group key
    let key = "";
    if (rawSku) {
      key = `sku:${rawSku.toLowerCase()}`;
    } else if (rawSlug) {
      key = `slug:${rawSlug.toLowerCase()}`;
    } else if (rawName) {
      key = `name:${slugify(rawName)}`;
    } else if (lastGroupKey) {
      // Continuation variant row under preceding parent
      key = lastGroupKey;
    } else {
      key = `anon:${idx}`;
    }

    lastGroupKey = key;

    if (!groupIndexMap.has(key)) {
      groupIndexMap.set(key, productGroups.length);
      productGroups.push({ groupKey: key, rows: [] });
    }

    productGroups[groupIndexMap.get(key)!].rows.push({ raw, rowIndex: idx + 2 }); // 1-indexed (row 2 in excel)
  });

  const seenSkusInFile = new Set<string>();
  const seenBarcodesInFile = new Set<string>();

  // 2. Validate each Product Group
  return productGroups.map(({ rows }): BulkProductGroup => {
    const firstRow = rows[0].raw;
    const rowIndices = rows.map((r) => r.rowIndex);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Find parent fields from first non-empty occurrence
    const name = rows.find((r) => r.raw.name?.trim())?.raw.name?.trim() ?? "";
    const brand = rows.find((r) => r.raw.brand?.trim())?.raw.brand?.trim() ?? "Zérah";
    const categoryRaw =
      rows.find((r) => r.raw.category?.trim())?.raw.category?.trim().toLowerCase() ?? "";
    const category =
      VALID_CATEGORIES.find((c) => c === categoryRaw) ?? categoryRaw;

    const price = toNum(rows.find((r) => r.raw.price?.trim())?.raw.price);
    const mrp = toNum(rows.find((r) => r.raw.mrp?.trim())?.raw.mrp);
    const buyingPrice = toNum(
      rows.find((r) => r.raw.buying_price?.trim())?.raw.buying_price,
      0,
    );
    const lowStockAt = toInt(
      rows.find((r) => r.raw.low_stock_at?.trim())?.raw.low_stock_at,
      5,
    );
    const ageGroup =
      rows.find((r) => r.raw.age_group?.trim())?.raw.age_group?.trim() ?? "";
    const rawSlug = rows.find((r) => r.raw.slug?.trim())?.raw.slug?.trim() ?? "";
    const slug = rawSlug || slugify(name);
    const deliveryFee = toNum(
      rows.find((r) => r.raw.delivery_fee?.trim())?.raw.delivery_fee,
      65,
    );
    const salesChannel =
      rows.find((r) => r.raw.sales_channel?.trim())?.raw.sales_channel?.trim() ===
      "OFFLINE_ONLY"
        ? "OFFLINE_ONLY"
        : "ONLINE_AND_OFFLINE";
    const description =
      rows.find((r) => r.raw.description?.trim())?.raw.description?.trim() ?? "";
    const rawHighlights =
      rows.find((r) => r.raw.highlights?.trim())?.raw.highlights?.trim() ?? "";
    const highlights = rawHighlights
      .split(/[\n|]/)
      .map((h) => h.trim())
      .filter(Boolean);
    const isFeatured = toBool(
      rows.find((r) => r.raw.is_featured?.trim())?.raw.is_featured,
      false,
    );
    const isActive = toBool(
      rows.find((r) => r.raw.is_active?.trim())?.raw.is_active,
      true,
    );
    const sortOrder = toInt(
      rows.find((r) => r.raw.sort_order?.trim())?.raw.sort_order,
      0,
    );
    const recommendationMode = (rows.find((r) => r.raw.recommendation_mode?.trim())
      ?.raw.recommendation_mode?.trim() || "manual_fallback") as
      | "manual"
      | "auto"
      | "manual_fallback";
    const rawSections =
      rows.find((r) => r.raw.homepage_sections?.trim())?.raw.homepage_sections?.trim() ?? "";
    const homepageSections = rawSections
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const seoTitle =
      rows.find((r) => r.raw.seo_title?.trim())?.raw.seo_title?.trim() ?? "";
    const seoDescription =
      rows.find((r) => r.raw.seo_description?.trim())?.raw.seo_description?.trim() ?? "";

    // Direct Image URLs
    const imageUrls = [
      rows.find((r) => r.raw.image_url?.trim())?.raw.image_url?.trim(),
      rows.find((r) => r.raw.image_url_2?.trim())?.raw.image_url_2?.trim(),
      rows.find((r) => r.raw.image_url_3?.trim())?.raw.image_url_3?.trim(),
    ].filter(Boolean) as string[];

    // Product SKU
    let sku = rows.find((r) => r.raw.sku?.trim())?.raw.sku?.trim() ?? "";
    if (!sku && category) {
      sku = generateSKU(category);
      warnings.push(`No SKU provided — auto-generated "${sku}"`);
    }

    // Barcode
    let barcode = rows.find((r) => r.raw.barcode?.trim())?.raw.barcode?.trim() ?? "";
    if (!barcode) {
      barcode = generateBarcode();
    } else if (!/^\d{8,14}$/.test(barcode)) {
      warnings.push(`Barcode "${barcode}" is not standard 8-14 digits.`);
    }

    // Extract Variants
    const variants: BulkVariant[] = [];
    rows.forEach((r, vIdx) => {
      const color = r.raw.color?.trim();
      const size = r.raw.size?.trim();
      const vSku = r.raw.variant_sku?.trim();
      const vBarcode = r.raw.variant_barcode?.trim();
      const vStock = r.raw.variant_stock?.trim();
      const vPrice = r.raw.variant_price?.trim();
      const vMrp = r.raw.variant_mrp?.trim();
      const vImg = r.raw.variant_image?.trim();
      const vName = r.raw.variant_name?.trim();
      const vBuyingPrice = r.raw.variant_buying_price?.trim();

      // Only treat as a variant if color, size, variant_sku, or variant_stock is provided
      if (color || size || vSku || (vStock !== undefined && vStock !== "")) {
        const variantSku =
          vSku ||
          (sku && (color || size)
            ? `${sku}-${(color || "").slice(0, 3).toUpperCase()}-${(size || "").slice(0, 3).toUpperCase()}`.replace(
                /-+$/,
                "",
              )
            : generateSKU(category, color, size));

        variants.push({
          name:
            vName ||
            (color && size ? `${color} / ${size}` : color || size || `Variant ${vIdx + 1}`),
          color: color || undefined,
          size: size || undefined,
          sku: variantSku,
          barcode: vBarcode || generateBarcode(),
          stock: toInt(vStock, 0),
          priceOverride: vPrice ? toNum(vPrice) : undefined,
          mrpOverride: vMrp ? toNum(vMrp) : undefined,
          imageFileName: vImg || undefined,
          buyingPrice: vBuyingPrice ? toNum(vBuyingPrice) : undefined,
        });
      }
    });

    // Calculate Stock
    let stock = 0;
    if (variants.length > 0) {
      stock = variants.reduce((sum, v) => sum + v.stock, 0);
    } else {
      stock = toInt(rows.find((r) => r.raw.stock?.trim())?.raw.stock, 0);
    }

    // Look for media in ZIP corresponding to this SKU or variant SKUs
    const normalizedSkuKey = sku.toLowerCase().trim();
    const directProductMedia = (mediaBySku.get(normalizedSkuKey) ?? []).map((m) => ({
      ...m,
      variantSku: m.variantSku || sku,
    }));

    const variantMediaList: BulkProductMedia[] = [];
    const missingMediaVariants: string[] = [];

    for (const v of variants) {
      const vSkuKey = v.sku.toLowerCase().trim();
      const vMedia = mediaBySku.get(vSkuKey);
      if (vMedia && vMedia.length > 0) {
        vMedia.forEach((m) => {
          variantMediaList.push({
            ...m,
            variantSku: v.sku,
            color: v.color || m.color,
          });
        });
      } else {
        missingMediaVariants.push(v.sku);
      }
    }

    if (missingMediaVariants.length > 0 && variants.length > 0) {
      warnings.push(
        `Variant(s) missing dedicated media folder in ZIP: ${missingMediaVariants.join(", ")}. Using product-level media fallback.`,
      );
    }

    const zipMedia = [...directProductMedia, ...variantMediaList];

    // ── Business Validations (100% Add Product Parity) ──────────────────────
    if (!name) errors.push("Product Name is required.");
    if (name.length > 120) errors.push("Product Name must be ≤ 120 characters.");
    if (!category) errors.push("Category is required.");
    else if (!VALID_CATEGORIES.includes(category as never)) {
      errors.push(
        `Category "${category}" is invalid. Allowed: ${VALID_CATEGORIES.join(", ")}.`,
      );
    }

    if (price <= 0) errors.push("Selling Price must be greater than 0.");
    if (mrp <= 0) errors.push("MRP must be greater than 0.");
    if (price > mrp && mrp > 0) errors.push("Selling Price cannot be greater than MRP.");
    if (buyingPrice < 0) errors.push("Buying Price cannot be negative.");
    if (stock < 0) errors.push("Stock cannot be negative.");

    // Uniqueness checks in current file
    if (sku) {
      const lowerSku = sku.toLowerCase();
      if (seenSkusInFile.has(lowerSku)) {
        errors.push(`Duplicate Product SKU "${sku}" repeated across multiple products.`);
      } else {
        seenSkusInFile.add(lowerSku);
      }
    }

    if (barcode) {
      if (seenBarcodesInFile.has(barcode)) {
        warnings.push(`Barcode "${barcode}" is repeated in this file.`);
      } else {
        seenBarcodesInFile.add(barcode);
      }
    }

    // Variant uniqueness
    const variantSkusInProduct = new Set<string>();
    for (const v of variants) {
      if (v.stock < 0) errors.push(`Variant "${v.name}" stock cannot be negative.`);
      if (v.priceOverride && v.mrpOverride && v.priceOverride > v.mrpOverride) {
        errors.push(`Variant "${v.name}" Price Override cannot exceed its MRP Override.`);
      }
      if (variantSkusInProduct.has(v.sku)) {
        errors.push(`Duplicate variant SKU "${v.sku}" inside product "${name}".`);
      }
      variantSkusInProduct.add(v.sku);
    }

    // ── Collision with Existing Database Records ───────────────────────────
    const existingMatch =
      existingBySku.get(sku.toLowerCase()) ||
      existingBySlug.get(slug.toLowerCase()) ||
      (barcode ? existingByBarcode.get(barcode) : undefined);

    let status: BulkRowStatus = "new";

    if (errors.length > 0) {
      status = "error";
    } else if (existingMatch) {
      if (mode === "new_only") {
        status = "skip";
        warnings.push(`SKU "${sku}" already exists in store — skipped in New Only mode.`);
      } else {
        status = "update";
      }
    } else {
      if (mode === "update_only") {
        status = "skip";
        warnings.push(`Product "${sku}" does not exist — skipped in Update Only mode.`);
      } else {
        status = "new";
      }
    }

    return {
      rowIndices,
      raw: firstRow,
      sku,
      name,
      brand,
      category,
      price,
      mrp,
      buyingPrice,
      stock,
      lowStockAt,
      ageGroup,
      barcode,
      slug,
      deliveryFee,
      salesChannel,
      description,
      highlights,
      isFeatured,
      isActive,
      sortOrder,
      recommendationMode,
      homepageSections,
      seoTitle,
      seoDescription,
      variants,
      imageUrls,
      zipMedia,
      status,
      errors,
      warnings,
      existingId: existingMatch?.id,
      selected: status !== "error" && status !== "skip",
    };
  });
}

// ---------------------------------------------------------------------------
// Execution Engine (High-Performance Bounded Batch Committer)
// ---------------------------------------------------------------------------

/**
 * Commits verified products and their media to Supabase in bounded batches.
 * Safe against realtime storms, rate limits, and network dropouts.
 */
export async function commitBulkImport(
  products: BulkProductGroup[],
  mode: BulkMode,
  signal: AbortSignal,
  onProgress: (p: CommitProgress) => void,
): Promise<CommitResult> {
  const eligible = products.filter(
    (p) => p.selected && p.status !== "error" && p.status !== "skip",
  );
  const total = eligible.length;
  let succeeded = 0;
  let updated = 0;
  let totalMediaUploaded = 0;
  const failed: BulkProductGroup[] = [];

  // Stage 1: Upload Media Files in Parallel with Bounded Concurrency
  const mediaQueue: Array<{
    product: BulkProductGroup;
    media: BulkProductMedia;
    uploadedUrl?: string;
  }> = [];

  for (const p of eligible) {
    for (const m of p.zipMedia) {
      mediaQueue.push({ product: p, media: m });
    }
  }

  if (mediaQueue.length > 0 && !signal.aborted) {
    onProgress({
      current: 0,
      total: mediaQueue.length,
      message: `Uploading ${mediaQueue.length} media files to Supabase Storage…`,
      stage: "media",
    });

    let completedMedia = 0;

    // Run media uploads with bounded concurrency
    const uploadWorker = async (index: number) => {
      while (index < mediaQueue.length && !signal.aborted) {
        const item = mediaQueue[index];
        try {
          // Convert Blob to File if needed
          const rawFile =
            item.media.file instanceof File
              ? item.media.file
              : new File([item.media.file], item.media.fileName, {
                  type: item.media.isVideo
                    ? "video/mp4"
                    : item.media.fileName.endsWith(".png")
                      ? "image/png"
                      : "image/jpeg",
                });

          const publicUrl = await uploadMedia(rawFile, "products");
          item.uploadedUrl = publicUrl;
          totalMediaUploaded++;
        } catch (uploadErr) {
          console.error(`Failed to upload media ${item.media.fileName}:`, uploadErr);
          item.product.warnings.push(
            `Failed to upload media "${item.media.fileName}": ${(uploadErr as Error).message}`,
          );
        }

        completedMedia++;
        onProgress({
          current: completedMedia,
          total: mediaQueue.length,
          message: `Uploaded media ${completedMedia} / ${mediaQueue.length}…`,
          stage: "media",
        });

        index += MEDIA_CONCURRENCY;
      }
    };

    const workers = Array.from({ length: Math.min(MEDIA_CONCURRENCY, mediaQueue.length) }, (_, i) =>
      uploadWorker(i),
    );
    await Promise.all(workers);
  }

  if (signal.aborted) {
    throw new Error("Bulk import was cancelled by the user.");
  }

  // Stage 2: Database Operations in Chunks
  const deliveryFeeUpdates: Record<string, number> = {};

  for (let i = 0; i < eligible.length; i += DB_CHUNK_SIZE) {
    if (signal.aborted) break;

    const chunk = eligible.slice(i, i + DB_CHUNK_SIZE);

    for (const p of chunk) {
      if (signal.aborted) break;

      try {
        const isUpdate = Boolean(p.existingId);

        // Gather all resolved media URLs for this product
        const uploadedUrls = p.zipMedia
          .map((m) => {
            const queueItem = mediaQueue.find(
              (qi) => qi.product === p && qi.media === m && qi.uploadedUrl,
            );
            return queueItem ? queueItem.uploadedUrl : null;
          })
          .filter(Boolean) as string[];

        const allImages = Array.from(new Set([...uploadedUrls, ...p.imageUrls]));
        const primaryImage = allImages[0] || null;

        // 1. Upsert Products table
        const dbProduct: any = {
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          category: p.category,
          price: p.price,
          mrp: p.mrp,
          stock: p.stock,
          low_stock_at: p.lowStockAt,
          age_group: p.ageGroup || undefined,
          barcode: p.barcode || null,
          slug: p.slug,
          sales_channel: p.salesChannel,
          description: p.description,
          highlights: p.highlights,
          is_featured: p.isFeatured,
          is_active: p.isActive,
          sort_order: p.sortOrder,
          recommendation_mode: p.recommendationMode,
          seo_title: p.seoTitle || null,
          seo_description: p.seoDescription || null,
          image_url: primaryImage,
          images: allImages,
        };

        let productId = p.existingId;

        if (isUpdate && productId) {
          const { error: updErr } = await supabase
            .from("products")
            .update(dbProduct)
            .eq("id", productId);
          if (updErr) throw updErr;
          updated++;
        } else {
          const { data: insData, error: insErr } = await supabase
            .from("products")
            .insert({ ...dbProduct, rating: 0, reviews: 0 })
            .select("id")
            .single();
          if (insErr) throw insErr;
          productId = insData.id;
          succeeded++;
        }

        // 2. Upsert Buying Price into product_costs
        if (p.buyingPrice >= 0 && productId) {
          await supabase.from("product_costs").upsert(
            { product_id: productId, buying_price: p.buyingPrice },
            { onConflict: "product_id" },
          );
        }

        // 3. Upsert Product Images
        if (allImages.length > 0 && productId) {
          if (isUpdate) {
            await supabase.from("product_images").delete().eq("product_id", productId);
          }

          const imageRecords = allImages.map((url, idx) => {
            const correspondingZipMedia = p.zipMedia.find(
              (m) =>
                mediaQueue.find(
                  (qi) => qi.product === p && qi.media === m && qi.uploadedUrl === url,
                ) !== undefined,
            );

            const isVideo =
              !!url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ||
              !!correspondingZipMedia?.isVideo;

            return {
              product_id: productId,
              public_url: url,
              storage_path: url.includes("product-images/")
                ? url.split("product-images/")[1]
                : "",
              alt_text: p.name,
              is_primary: idx === 0,
              sort_order: idx,
              color: correspondingZipMedia?.color || null,
              variant_sku: correspondingZipMedia?.variantSku || null,
              media_type: isVideo ? "video" : "image",
            };
          });

          await (supabase.from("product_images" as any) as any).insert(imageRecords);
        }

        // 4. Handle Variants
        if (productId) {
          if (p.variants.length > 0) {
            // Deactivate any phantom Default variant
            await supabase
              .from("product_variants")
              .update({ is_active: false, stock: 0 })
              .eq("product_id", productId)
              .eq("name", "Default")
              .is("color", null)
              .is("size", null);

            // Fetch existing variants to reconcile
            const { data: existingVariants } = await supabase
              .from("product_variants")
              .select("id, sku")
              .eq("product_id", productId);

            const existingSkuMap = new Map<string, string>();
            (existingVariants ?? []).forEach((v) => {
              if (v.sku) {
                existingSkuMap.set(v.sku.toLowerCase().trim(), v.id);
              }
            });

            const savedIds: string[] = [];

            for (const v of p.variants) {
              // Match variant image
              let variantImageUrl = v.imageUrl || null;
              if (!variantImageUrl && v.imageFileName) {
                const matchedMedia = mediaQueue.find(
                  (qi) =>
                    qi.product === p &&
                    qi.media.fileName.toLowerCase() === v.imageFileName?.toLowerCase() &&
                    qi.uploadedUrl,
                );
                if (matchedMedia?.uploadedUrl) {
                  variantImageUrl = matchedMedia.uploadedUrl;
                }
              }

              const variantDbRow: any = {
                product_id: productId,
                name: v.name || `${v.color || ""} / ${v.size || ""}`.trim() || "Default",
                color: v.color || null,
                size: v.size || null,
                sku: v.sku,
                barcode: v.barcode || null,
                stock: v.stock,
                price_override: v.priceOverride ?? null,
                mrp_override: v.mrpOverride ?? null,
                image_url: variantImageUrl,
                is_active: true,
              };

              const existingVId = existingSkuMap.get(v.sku.toLowerCase().trim());

              if (existingVId) {
                await (supabase.from("product_variants" as any) as any)
                  .update(variantDbRow)
                  .eq("id", existingVId);
                savedIds.push(existingVId);
              } else {
                const newId = crypto.randomUUID();
                await (supabase.from("product_variants" as any) as any).insert({
                  ...variantDbRow,
                  id: newId,
                });
                savedIds.push(newId);
              }
            }

            // Clean up old active variants not present in this import
            if (savedIds.length > 0 && isUpdate) {
              await (supabase.from("product_variants" as any) as any)
                .update({ is_active: false, stock: 0 })
                .eq("product_id", productId)
                .eq("is_active", true)
                .not("id", "in", `(${savedIds.map((id) => `'${id}'`).join(",")})`);
            }

            // Re-link product_images variant_id by variant_sku
            const { data: updatedDbVariants } = await supabase
              .from("product_variants")
              .select("id, sku, image_url")
              .eq("product_id", productId);

            if (updatedDbVariants && updatedDbVariants.length > 0) {
              for (const dv of updatedDbVariants) {
                if (dv.sku) {
                  await (supabase.from("product_images" as any) as any)
                    .update({ variant_id: dv.id })
                    .eq("product_id", productId)
                    .ilike("variant_sku", dv.sku.trim());

                  // If variant has no image_url, populate it from its first product_image
                  if (!dv.image_url) {
                    const { data: firstImg } = await supabase
                      .from("product_images")
                      .select("public_url")
                      .eq("product_id", productId)
                      .ilike("variant_sku", dv.sku.trim())
                      .order("is_primary", { ascending: false })
                      .order("sort_order", { ascending: true })
                      .limit(1)
                      .maybeSingle();

                    if (firstImg?.public_url) {
                      await supabase
                        .from("product_variants")
                        .update({ image_url: firstImg.public_url })
                        .eq("id", dv.id);
                    }
                  }
                }
              }
            }
          }
        }

        // 5. Collect Delivery Fee
        if (p.deliveryFee !== undefined && productId) {
          deliveryFeeUpdates[productId] = p.deliveryFee;
          deliveryFeeUpdates[p.slug] = p.deliveryFee;
        }

        // 6. Homepage Section Associations
        if (p.homepageSections.length > 0 && productId) {
          for (const sectionNameOrSlug of p.homepageSections) {
            const { data: section } = await supabase
              .from("homepage_sections")
              .select("id")
              .or(`slug.eq.${sectionNameOrSlug},title.ilike.%${sectionNameOrSlug}%`)
              .maybeSingle();

            if (section) {
              await (supabase.from("homepage_section_products" as any) as any).upsert(
                { section_id: section.id, product_id: productId, position: 0 },
                { onConflict: "section_id,product_id" },
              );
            }
          }
        }
      } catch (rowErr) {
        console.error(`Error saving product ${p.sku}:`, rowErr);
        p.errors = [(rowErr as Error).message];
        failed.push(p);
      }

      onProgress({
        current: Math.min(succeeded + updated + failed.length, total),
        total,
        message: `Saving products… (${succeeded + updated} done, ${failed.length} failed)`,
        stage: "database",
      });
    }
  }

  // Stage 3: Batch Update Site Settings (Delivery Fees)
  if (Object.keys(deliveryFeeUpdates).length > 0 && !signal.aborted) {
    onProgress({
      current: total,
      total,
      message: "Synchronizing delivery fees & store settings…",
      stage: "sync",
    });

    try {
      const { data: currentSettings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle();

      let feeMap: Record<string, number> = {};
      if (currentSettings?.value) {
        try {
          feeMap = JSON.parse(currentSettings.value);
        } catch {
          feeMap = {};
        }
      }

      Object.assign(feeMap, deliveryFeeUpdates);

      const { error: upsertErr } = await supabase.from("site_settings").upsert(
        { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
        { onConflict: "key" },
      );

      if (upsertErr) {
        await (supabase.rpc as any)("admin_update_site_setting", {
          _key: "product_delivery_fees",
          _value: JSON.stringify(feeMap),
        });
      }
    } catch (feeErr) {
      console.error("Failed to sync delivery fee map:", feeErr);
    }
  }

  onProgress({
    current: total,
    total,
    message: "Completed!",
    stage: "done",
  });

  return {
    succeeded,
    updated,
    failed,
    totalMediaUploaded,
  };
}

// ---------------------------------------------------------------------------
// Error & Audit Reporting
// ---------------------------------------------------------------------------

/** Download an actionable error report in CSV format */
export function downloadFailureReport(failedGroups: BulkProductGroup[]): void {
  const failureRows: Array<Record<string, unknown>> = [];

  for (const g of failedGroups) {
    const errorText = g.errors.join("; ");
    const warningText = g.warnings.join("; ");

    failureRows.push({
      "Row(s)": g.rowIndices.join(", "),
      "Product SKU": g.sku,
      "Product Name": g.name,
      Category: g.category,
      "Selling Price": g.price,
      MRP: g.mrp,
      Errors: errorText,
      Warnings: warningText,
    });
  }

  const csv = Papa.unparse(failureRows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zerah-bulk-import-failures-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Backwards Compatibility Aliases
// ---------------------------------------------------------------------------
export type BulkRow = BulkProductGroup;
export const parseFile = parsePackageFile;
export const validateRows = groupAndValidateRows;
export const commitBatch = commitBulkImport;

