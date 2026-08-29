/**
 * bulk-import.ts
 *
 * Pure logic layer for the Bulk Product Management System.
 * No React, no side-effects outside of the explicit commitBatch() call.
 *
 * Pipeline:
 *   parseFile()  →  normalizeRows()  →  validateRows()  →  commitBatch()
 */

import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Constants
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

export const VALID_AGE_GROUPS = ["0-6m", "6-12m", "12-24m", "2-4y"] as const;

const CATEGORY_PREFIXES: Record<string, string> = {
  clothing: "CL",
  toys: "TY",
  care: "CR",
  gear: "GR",
  feeding: "FD",
  diapering: "DP",
  bath: "BT",
  footwear: "FW",
};

/** Number of rows processed per Supabase batch. */
const BATCH_SIZE = 10;
/** Delay between batches in ms — prevents Supabase rate-limit (60 req/s). */
const BATCH_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// CSV Template
// ---------------------------------------------------------------------------

export const CSV_HEADERS = [
  "name",
  "slug",
  "brand",
  "category",
  "price",
  "mrp",
  "age_group",
  "stock",
  "sku",
  "barcode",
  "description",
  "highlights",
  "buying_price",
  "low_stock_at",
  "sort_order",
  "is_featured",
  "is_active",
  "image_url",
  "image_url_2",
  "image_url_3",
  "sales_channel",
] as const;

export type CsvHeader = (typeof CSV_HEADERS)[number];

/** Download a pre-filled CSV template with 2 sample rows. */
export function downloadCsvTemplate(): void {
  const sampleRows = [
    [
      "Soft Cotton Bodysuit",
      "soft-cotton-bodysuit",
      "MeeSho",
      "clothing",
      "499",
      "799",
      "0-6m",
      "50",
      "",
      "",
      "Ultra-soft 100% cotton bodysuit with snap buttons",
      "Soft cotton | BPA-free | Machine washable",
      "200",
      "5",
      "10",
      "false",
      "true",
      "https://example.com/image1.jpg",
      "",
      "",
    ],
    [
      "Wooden Stacking Rings",
      "wooden-stacking-rings",
      "Funskool",
      "toys",
      "349",
      "499",
      "6-12m",
      "30",
      "",
      "",
      "Colourful wooden stacking toy for sensory development",
      "Natural wood | Non-toxic paint | Safe for babies",
      "150",
      "5",
      "20",
      "true",
      "true",
      "https://example.com/image2.jpg",
      "",
      "",
    ],
  ];

  const csv = Papa.unparse({ fields: [...CSV_HEADERS], data: sampleRows });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "zerah-bulk-product-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BulkRowStatus = "new" | "update" | "skip" | "error";

export type BulkMode = "new_and_update" | "new_only" | "stock_only";

/** A single parsed + validated row ready for preview. */
export interface BulkRow {
  /** Zero-based index in the original file. */
  index: number;
  /** Raw parsed values (strings). */
  raw: Record<string, string>;
  /** Normalized values ready to write. */
  name: string;
  slug: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  ageGroup: string;
  stock: number;
  sku: string;
  barcode: string;
  description: string;
  highlights: string[];
  buyingPrice: number;
  lowStockAt: number;
  sortOrder: number;
  isFeatured: boolean;
  isActive: boolean;
  imageUrl: string;
  imageUrl2: string;
  imageUrl3: string;
  salesChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  /** Resolved status after validation. */
  status: BulkRowStatus;
  /** Field-level error messages. */
  errors: string[];
  /** Non-blocking warnings. */
  warnings: string[];
  /** Existing product UUID if this is an update, undefined if new. */
  existingId?: string;
  /** Whether admin has selected this row for commit (default true unless error). */
  selected: boolean;
}

export interface CommitProgress {
  current: number;
  total: number;
  message: string;
}

export interface CommitResult {
  succeeded: number;
  failed: BulkRow[];
}

// ---------------------------------------------------------------------------
// Step 1 — File Parsing
// ---------------------------------------------------------------------------

/** Parse a CSV file. Returns raw string records. */
export async function parseCSVFile(file: File): Promise<Array<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      transform: (value: string) => value.trim(),
      complete: (result) => {
        if (result.errors.length > 0) {
          const fatal = result.errors.filter((e) => e.type === "FieldMismatch");
          if (fatal.length > 0) {
            reject(new Error(`CSV parse error: ${fatal[0].message}`));
          } else {
            resolve(result.data);
          }
        } else {
          resolve(result.data);
        }
      },
      error: (err: Error) => reject(new Error(`CSV parse error: ${err.message}`)),
    });
  });
}

/** Parse an Excel file (.xlsx / .xls). Dynamically imported to keep bundle lean. */
export async function parseExcelFile(file: File): Promise<Array<Record<string, string>>> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Excel file has no sheets.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
    raw: false,
  });
  // Coerce all values to strings
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), String(v ?? "").trim()])),
  );
}

/** Unified file parser — dispatches based on extension. */
export async function parseFile(file: File): Promise<Array<Record<string, string>>> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return parseCSVFile(file);
  if (ext === "xlsx" || ext === "xls") return parseExcelFile(file);
  throw new Error(`Unsupported file type ".${ext}". Use .csv, .xlsx, or .xls.`);
}

// ---------------------------------------------------------------------------
// Step 2 — Normalization helpers
// ---------------------------------------------------------------------------

function toNum(v: string, fallback = 0): number {
  const n = parseFloat(v.replace(/[^\d.-]/g, ""));
  return isNaN(n) ? fallback : n;
}

function toInt(v: string, fallback = 0): number {
  const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? fallback : n;
}

function toBool(v: string, fallback = true): boolean {
  const lower = v.toLowerCase().trim();
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

function generateSKU(category: string): string {
  const prefix = CATEGORY_PREFIXES[category] ?? "GN";
  return `ZR-${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
}

function generateBarcode(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

// ---------------------------------------------------------------------------
// Step 2 — Normalization (raw strings → typed values)
// ---------------------------------------------------------------------------

function normalizeRow(
  raw: Record<string, string>,
  index: number,
): Omit<BulkRow, "status" | "errors" | "warnings" | "existingId" | "selected"> {
  const category =
    VALID_CATEGORIES.find((c) => c === raw.category?.toLowerCase().trim()) ??
    raw.category?.toLowerCase().trim() ??
    "";

  const name = raw.name?.trim() ?? "";
  const rawSlug = raw.slug?.trim() ?? "";
  const slug = rawSlug.length > 0 ? rawSlug : slugify(name);
  const sku = raw.sku?.trim().length > 0 ? raw.sku.trim() : generateSKU(category);
  const barcode = raw.barcode?.trim().length > 0 ? raw.barcode.trim() : generateBarcode();

  return {
    index,
    raw,
    name,
    slug,
    brand: raw.brand?.trim() ?? "",
    category,
    price: toNum(raw.price ?? ""),
    mrp: toNum(raw.mrp ?? ""),
    ageGroup:
      VALID_AGE_GROUPS.find((a) => a === raw.age_group?.trim()) ?? raw.age_group?.trim() ?? "",
    stock: toInt(raw.stock ?? ""),
    sku,
    barcode,
    description: raw.description?.trim() ?? "",
    highlights: (raw.highlights ?? "")
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean),
    buyingPrice: toNum(raw.buying_price ?? ""),
    lowStockAt: raw.low_stock_at?.trim() ? toInt(raw.low_stock_at) : 5,
    sortOrder: raw.sort_order?.trim() ? toInt(raw.sort_order) : 999,
    isFeatured: toBool(raw.is_featured ?? "false", false),
    isActive: toBool(raw.is_active ?? "true", true),
    imageUrl: raw.image_url?.trim() ?? "",
    imageUrl2: raw.image_url_2?.trim() ?? "",
    imageUrl3: raw.image_url_3?.trim() ?? "",
    salesChannel: raw.sales_channel === "OFFLINE_ONLY" ? "OFFLINE_ONLY" : "ONLINE_AND_OFFLINE",
  };
}

// ---------------------------------------------------------------------------
// Step 3 — Validation
// ---------------------------------------------------------------------------

interface ExistingProduct {
  id: string;
  slug: string;
  sku: string;
}

/** Fetch existing slugs + SKUs from DB for collision detection. */
export async function fetchExistingProducts(): Promise<ExistingProduct[]> {
  const { data, error } = await supabase.from("products").select("id, slug, sku");
  if (error) throw error;
  return (data ?? []) as ExistingProduct[];
}

/**
 * Validate parsed rows. Returns BulkRow[] with status + errors filled in.
 * @param rawRows     Output of parseFile()
 * @param existing    Output of fetchExistingProducts()
 * @param mode        Import mode from the UI
 */
export function validateRows(
  rawRows: Array<Record<string, string>>,
  existing: ExistingProduct[],
  mode: BulkMode,
): BulkRow[] {
  const slugMap = new Map(existing.map((p) => [p.slug, p.id]));
  const seenSlugsInFile = new Map<string, number>(); // slug → first row index

  return rawRows.map((raw, index): BulkRow => {
    const normalized = normalizeRow(raw, index);
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Required field checks ───────────────────────────────────────────────
    if (!normalized.name) errors.push("name is required");
    if (normalized.name.length > 120) errors.push("name must be ≤ 120 characters");
    if (!normalized.brand) errors.push("brand is required");
    if (!normalized.category) errors.push("category is required");
    else if (!VALID_CATEGORIES.includes(normalized.category as never))
      errors.push(
        `category "${normalized.category}" is invalid — must be one of: ${VALID_CATEGORIES.join(", ")}`,
      );
    if (!normalized.ageGroup) errors.push("age_group is required");
    else if (!VALID_AGE_GROUPS.includes(normalized.ageGroup as never))
      errors.push(
        `age_group "${normalized.ageGroup}" is invalid — must be one of: ${VALID_AGE_GROUPS.join(", ")}`,
      );
    if (normalized.price <= 0) errors.push("price must be a positive number");
    if (normalized.mrp <= 0) errors.push("mrp must be a positive number");
    if (normalized.mrp > 0 && normalized.price > normalized.mrp)
      errors.push("price cannot be greater than mrp");
    if (normalized.stock < 0) errors.push("stock must be 0 or greater");

    // ── Barcode format ──────────────────────────────────────────────────────
    if (normalized.barcode && !/^\d{8,14}$/.test(normalized.barcode))
      warnings.push("barcode should be 8-14 digits — auto-generated one will be used");

    // ── Slug uniqueness in file ─────────────────────────────────────────────
    if (normalized.slug) {
      if (seenSlugsInFile.has(normalized.slug)) {
        errors.push(
          `duplicate slug "${normalized.slug}" (also on row ${(seenSlugsInFile.get(normalized.slug) ?? 0) + 2})`,
        );
      } else {
        seenSlugsInFile.set(normalized.slug, index);
      }
    }

    // ── Determine status ────────────────────────────────────────────────────
    const existingId = slugMap.get(normalized.slug);
    let status: BulkRowStatus;

    if (errors.length > 0) {
      status = "error";
    } else if (existingId) {
      if (mode === "new_only") {
        status = "skip";
        warnings.push("slug already exists — skipped in new-only mode");
      } else {
        status = "update";
      }
    } else {
      if (mode === "stock_only") {
        status = "skip";
        warnings.push("new product — skipped in stock-only mode");
      } else {
        status = "new";
      }
    }

    return {
      ...normalized,
      status,
      errors,
      warnings,
      existingId,
      selected: status !== "error" && status !== "skip",
    };
  });
}

// ---------------------------------------------------------------------------
// Step 4 — Commit
// ---------------------------------------------------------------------------

/**
 * Commit selected rows to Supabase in safe batches.
 * Uses the exact same upsert pattern as the existing ProductsTab save mutation.
 */
export async function commitBatch(
  rows: BulkRow[],
  signal: AbortSignal,
  onProgress: (p: CommitProgress) => void,
): Promise<CommitResult> {
  const toProcess = rows.filter((r) => r.selected && r.status !== "error" && r.status !== "skip");
  const total = toProcess.length;
  const failed: BulkRow[] = [];
  let succeeded = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    if (signal.aborted) break;

    const chunk = toProcess.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      chunk.map(async (row) => {
        if (signal.aborted) return;
        try {
          await upsertRow(row, signal);
          succeeded++;
        } catch (err) {
          row.errors = [(err as Error).message];
          failed.push(row);
        }
      }),
    );

    onProgress({
      current: Math.min(i + BATCH_SIZE, total),
      total,
      message: `Processing batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} of ${Math.ceil(total / BATCH_SIZE)}…`,
    });

    // Throttle between batches
    if (i + BATCH_SIZE < toProcess.length && !signal.aborted) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return { succeeded, failed };
}

/** Upsert a single row: product + product_costs + product_images. */
async function upsertRow(row: BulkRow, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("Import cancelled");

  const dbRow = {
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price: row.price,
    mrp: row.mrp,
    age_group: row.ageGroup,
    stock: row.stock,
    low_stock_at: row.lowStockAt,
    sku: row.sku,
    barcode: row.barcode,
    description: row.description,
    highlights: row.highlights,
    is_featured: row.isFeatured,
    is_active: row.isActive,
    sort_order: row.sortOrder,
    sales_channel: row.salesChannel,
  };

  let productId: string;

  if (row.existingId) {
    // UPDATE
    const { error } = await supabase.from("products").update(dbRow).eq("id", row.existingId);
    if (error) throw new Error(error.message);
    productId = row.existingId;
  } else {
    // INSERT
    const { data, error } = await supabase
      .from("products")
      .insert({ ...dbRow, rating: 0, reviews: 0 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    productId = data.id;
  }

  if (signal.aborted) throw new Error("Import cancelled");

  // Save buying price
  if (row.buyingPrice >= 0) {
    const { error } = await supabase
      .from("product_costs")
      .upsert({ product_id: productId, buying_price: row.buyingPrice });
    if (error) throw new Error(error.message);
  }

  // Save images
  const imageUrls = [row.imageUrl, row.imageUrl2, row.imageUrl3].filter(Boolean);
  if (imageUrls.length > 0) {
    // Delete old images for updates to avoid orphans
    if (row.existingId) {
      await supabase.from("product_images").delete().eq("product_id", productId);
    }

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      let storagePath = "";
      if (url.includes("product-images/")) {
        storagePath = url.split("product-images/")[1];
      }
      await supabase.from("product_images").insert({
        product_id: productId,
        public_url: url,
        storage_path: storagePath,
        alt_text: row.name,
        is_primary: i === 0,
        sort_order: i,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Export failed rows back to a downloadable CSV. */
export function downloadFailureReport(rows: BulkRow[]): void {
  const data = rows.map((r) => ({
    ...r.raw,
    _errors: r.errors.join("; "),
  }));
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zerah-bulk-import-failures-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
