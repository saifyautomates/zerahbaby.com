/**
 * label-printer.ts — Production-Hardened Label Print Engine
 * Zérah Baby & Kids
 *
 * ARCHITECTURE:
 * ─────────────────────────────────────────────────────────────────────
 * One centralized PRINT_FORMAT_CONFIG drives every dimension, margin,
 * barcode size, and page rule for all three formats. Nothing is
 * hard-coded in multiple places.
 *
 * PRINT FLOW:
 *   User clicks "Print Labels"
 *   → buildLabelPrintHtml() generates a self-contained HTML document
 *     with exact @page millimetre dimensions and inline SVG barcodes
 *   → printLabelsViaIframe() injects that HTML into a properly-sized
 *     off-screen iframe
 *   → waits for iframe onload + 350ms layout settle + font check
 *   → calls iframe.contentWindow.print()
 *   → cleans up after afterprint event or 10s timeout
 *
 * FORMATS SUPPORTED:
 *   thermal-108 → 1-Up 100mm × 25mm barcode sticker roll
 *                 (single sticker per row — correct for HPRT HT300)
 *   thermal-58  → 1-Up 50mm × 25mm barcode sticker roll
 *   a4          → 210mm × 297mm A4 sheet, 4-column grid
 */
import { useState, useCallback } from "react";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";
import type { Product } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { buildTSPLLabel, sendTSPLViaQZTray } from "@/lib/print-settings";

/* ================================================================== */
/*  CENTRALIZED PRINT FORMAT CONFIGURATION                            */
/*  All physical dimensions live here. Nowhere else.                  */
/* ================================================================== */

export type LabelPrinterProfile = "thermal-108" | "a4" | "thermal-58";
export type LabelType = "barcode-only" | "full";

/** Physical millimetre configuration for each label format */
export interface PrintFormatConfig {
  /** @page size declaration (CSS mm) */
  pageWidthMm: number;
  pageHeightMm: number;
  /** CSS @page margin */
  pageMarginMm: number;
  /** Printable label width inside page */
  labelWidthMm: number;
  /** Printable label height inside page */
  labelHeightMm: number;
  /** Internal label padding */
  paddingTopMm: number;
  paddingHorizMm: number;
  paddingBottomMm: number;
  /** For A4 only — grid columns */
  gridColumns: number;
  /** Barcode options */
  barcodeBarWidthPx: number; // JsBarcode "width" (bar width in pixels at 96dpi render)
  barcodeHeightMm: number; // SVG height in mm
  barcodeFontPt: number;
  /** Typography */
  brandFontPt: number;
  nameFontPt: number;
  priceFontPt: number;
  skuFontPt: number;
  /** Whether this layout uses a continuous roll (no inter-label gap in CSS) */
  isThermalRoll: boolean;
}

export const PRINT_FORMAT_CONFIG: Record<LabelPrinterProfile, PrintFormatConfig> = {
  /** ─── 1-UP 108mm THERMAL ROLL (100mm × 25mm Horizontal Landscape) ─── */
  "thermal-108": {
    pageWidthMm: 100, // roll width: 100mm printable (108mm physical roll)
    pageHeightMm: 25, // single label height: 25mm
    pageMarginMm: 0,
    labelWidthMm: 96, // 2mm bleed on each side
    labelHeightMm: 23.5, // 0.75mm top+bottom bleed
    paddingTopMm: 1.0,
    paddingHorizMm: 2.5,
    paddingBottomMm: 0.6,
    gridColumns: 1,
    barcodeBarWidthPx: 1.4,
    barcodeHeightMm: 8.0,
    barcodeFontPt: 6.5,
    brandFontPt: 6.5,
    nameFontPt: 8.0,
    priceFontPt: 9.0,
    skuFontPt: 6.0,
    isThermalRoll: true,
  },
  /** ─── 1-UP 58mm THERMAL ROLL (50mm × 25mm Horizontal Landscape) ─── */
  "thermal-58": {
    pageWidthMm: 50, // roll width: 50mm printable (58mm physical roll)
    pageHeightMm: 25,
    pageMarginMm: 0,
    labelWidthMm: 48,
    labelHeightMm: 23.5,
    paddingTopMm: 0.8,
    paddingHorizMm: 1.5,
    paddingBottomMm: 0.6,
    gridColumns: 1,
    barcodeBarWidthPx: 1.0,
    barcodeHeightMm: 7.2,
    barcodeFontPt: 6.0,
    brandFontPt: 5.5,
    nameFontPt: 6.5,
    priceFontPt: 7.5,
    skuFontPt: 5.2,
    isThermalRoll: true,
  },
  /** ─── A4 GRID ─── */
  a4: {
    pageWidthMm: 210,
    pageHeightMm: 297,
    pageMarginMm: 8,
    labelWidthMm: 47,
    labelHeightMm: 26,
    paddingTopMm: 1.0,
    paddingHorizMm: 1.5,
    paddingBottomMm: 0.8,
    gridColumns: 4,
    barcodeBarWidthPx: 1.0,
    barcodeHeightMm: 7.5,
    barcodeFontPt: 6.0,
    brandFontPt: 5.5,
    nameFontPt: 6.5,
    priceFontPt: 7.5,
    skuFontPt: 5.2,
    isThermalRoll: false,
  },
} as const;

/* ================================================================== */
/*  Persistent Printer Profile Helpers                                 */
/* ================================================================== */

export const DEFAULT_LABEL_PROFILE_KEY = "zerah_default_label_printer_profile";
export const LABEL_DISCOUNT_KEY = "zerah_label_show_discount";
export const LABEL_TYPE_KEY = "zerah_label_type";
export const LABEL_SHOW_MRP_KEY = "zerah_label_show_mrp";
export const LABEL_SHOW_SELL_PRICE_KEY = "zerah_label_show_sell_price";
export const LABEL_SEPARATE_PRICE_KEY = "zerah_label_separate_price";

let memoryProfile: LabelPrinterProfile = "thermal-58";
let memoryShowDiscount = true;
let memoryLabelType: LabelType = "full";
let memoryShowMrp = true;
let memoryShowSellPrice = true;
let memorySeparatePrice = false;

export function getSavedLabelProfile(): LabelPrinterProfile {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(DEFAULT_LABEL_PROFILE_KEY);
      if (saved === "thermal-58" || saved === "thermal-108" || saved === "a4") return saved;
    } catch {
      /* ignore */
    }
  }
  return memoryProfile;
}
export function setSavedLabelProfile(profile: LabelPrinterProfile): void {
  memoryProfile = profile;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DEFAULT_LABEL_PROFILE_KEY, profile);
    } catch {
      /* ignore */
    }
  }
}
export function getSavedShowDiscount(): boolean {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_DISCOUNT_KEY);
      if (saved !== null) return saved === "true";
    } catch {
      /* ignore */
    }
  }
  return memoryShowDiscount;
}
export function setSavedShowDiscount(show: boolean): void {
  memoryShowDiscount = show;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LABEL_DISCOUNT_KEY, show ? "true" : "false");
    } catch {
      /* ignore */
    }
  }
}
export function getSavedShowMrp(): boolean {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_SHOW_MRP_KEY);
      if (saved !== null) return saved === "true";
    } catch {
      /* ignore */
    }
  }
  return memoryShowMrp;
}
export function setSavedShowMrp(show: boolean): void {
  memoryShowMrp = show;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LABEL_SHOW_MRP_KEY, show ? "true" : "false");
    } catch {
      /* ignore */
    }
  }
}
export function getSavedShowSellPrice(): boolean {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_SHOW_SELL_PRICE_KEY);
      if (saved !== null) return saved === "true";
    } catch {
      /* ignore */
    }
  }
  return memoryShowSellPrice;
}
export function setSavedShowSellPrice(show: boolean): void {
  memoryShowSellPrice = show;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LABEL_SHOW_SELL_PRICE_KEY, show ? "true" : "false");
    } catch {
      /* ignore */
    }
  }
}
export function getSavedSeparatePrice(): boolean {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_SEPARATE_PRICE_KEY);
      if (saved !== null) return saved === "true";
    } catch {
      /* ignore */
    }
  }
  return memorySeparatePrice;
}
export function setSavedSeparatePrice(sep: boolean): void {
  memorySeparatePrice = sep;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LABEL_SEPARATE_PRICE_KEY, sep ? "true" : "false");
    } catch {
      /* ignore */
    }
  }
}
export function getSavedLabelType(): LabelType {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_TYPE_KEY);
      if (saved === "barcode-only" || saved === "full") return saved;
    } catch {
      /* ignore */
    }
  }
  return memoryLabelType;
}
export function setSavedLabelType(type: LabelType): void {
  memoryLabelType = type;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LABEL_TYPE_KEY, type);
    } catch {
      /* ignore */
    }
  }
}

/* ================================================================== */
/*  Product Types & Validation                                         */
/* ================================================================== */

export type PrintableProduct = {
  uuid?: string;
  id?: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  price: number;
  mrp?: number;
  stock?: number;
  brand?: string;
};

export type DirectPrintPayload = {
  products: PrintableProduct[];
  quantities?: Record<string, number>;
  layout?: LabelPrinterProfile;
  labelType?: LabelType;
  showDiscount?: boolean;
  widthMm?: number;
  heightMm?: number;
};

/**
 * Sanitize barcode string for CODE128 encoding.
 * Removes non-printable / non-ASCII characters that would cause JsBarcode to throw.
 */
export function sanitizeBarcode(barcode?: string | null, fallbackSku?: string | null): string {
  const raw = (barcode || fallbackSku || "").toString().trim();
  // CODE128 encodes printable ASCII 0x20–0x7E only
  const clean = raw.replace(/[^\x20-\x7E]/g, "").trim();
  return clean || "";
}

export function validatePrintableProduct(product: PrintableProduct): {
  valid: boolean;
  error?: string;
} {
  if (!product) return { valid: false, error: "Invalid product data" };
  if (!product.name?.trim())
    return { valid: false, error: "Product name is required to print label." };
  // Price 0 is valid (free products / POS samples)
  if (product.price === undefined || product.price === null || isNaN(Number(product.price))) {
    return { valid: false, error: `Product "${product.name}" has an invalid selling price.` };
  }
  const code = sanitizeBarcode(product.barcode, product.sku);
  if (!code) {
    return {
      valid: false,
      error: `Product "${product.name}" does not have a barcode or SKU.`,
    };
  }
  return { valid: true };
}

function getProductKey(p: PrintableProduct): string {
  return p.uuid || p.id || p.sku || p.name;
}

/* ================================================================== */
/*  Barcode SVG Generator (Deterministic Physical Dimensions)         */
/* ================================================================== */

/**
 * Generates a CODE128 barcode as an inline SVG string.
 * Returns an empty string if called during SSR (document not available).
 *
 * IMPORTANT: The returned SVG has an explicit width and height in mm so that
 * the browser print engine renders it at the correct physical size regardless
 * of DPI or zoom level.
 */
export function generateBarcodeSvgString(
  text: string,
  cfg: {
    barWidthPx: number;
    heightMm: number;
    fontPt: number;
    displayValue?: boolean;
    maxWidthMm: number;
  },
): string {
  if (typeof document === "undefined") return "";

  const safeText = sanitizeBarcode(text) || "000000";
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, safeText, {
      format: "CODE128",
      width: cfg.barWidthPx,
      height: Math.round(cfg.heightMm * 3.7795), // mm → px at 96dpi
      fontSize: Math.round(cfg.fontPt * 1.333), // pt → px
      margin: 2,
      marginTop: 0,
      marginBottom: 1,
      displayValue: cfg.displayValue ?? true,
      font: "Arial, Helvetica, sans-serif",
      fontOptions: "bold",
      textMargin: 1,
      background: "#ffffff",
      lineColor: "#000000",
    });
    // Force deterministic physical size on the SVG element itself.
    // Avoid "max-width: 100%" which causes browsers to rescale in print.
    // Use explicit mm-unit width + height so the barcode always prints at
    // its configured physical size regardless of printer driver scaling.
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("width", `${cfg.maxWidthMm}mm`);
    svg.setAttribute("height", `${cfg.heightMm + cfg.fontPt * 0.35 + 1}mm`);
    svg.setAttribute(
      "style",
      "display:block;margin:0 auto;shape-rendering:crispEdges;overflow:visible;",
    );
    return svg.outerHTML;
  } catch (err) {
    console.error("[ZerahPrint] Barcode SVG generation failed for:", safeText, err);
    // Fallback: text-only representation
    return (
      `<div style="font-family:monospace;font-size:${cfg.fontPt}pt;font-weight:bold;` +
      `text-align:center;letter-spacing:1px;padding:1mm 0;word-break:break-all;">${escapeHtml(safeText)}</div>`
    );
  }
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatINR(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

/* ================================================================== */
/*  HTML Print Document Builder                                        */
/*  Single source of truth — preview and print use same config.       */
/* ================================================================== */

export function buildLabelPrintParts(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): { pagesHtml: string; css: string; fullHtml: string } {
  const {
    products,
    quantities,
    layout,
    labelType,
    showDiscount,
    showMrp = true,
    showSellPrice = true,
    separatePriceLine = false,
  } = params;
  const cfg = PRINT_FORMAT_CONFIG[layout];

  // ── 1. Flatten products × quantities into ordered label list ──────
  const labels: PrintableProduct[] = [];
  for (const p of products) {
    const key = getProductKey(p);
    const qty = Math.max(0, Math.min(500, quantities[key] ?? 1));
    for (let i = 0; i < qty; i++) labels.push(p);
  }

  if (labels.length === 0) {
    const emptyHtml =
      `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>` +
      `<body style="font-family:sans-serif;padding:20px;text-align:center;">` +
      `<p>No labels to print.</p></body></html>`;
    return { pagesHtml: "<p>No labels to print.</p>", css: "", fullHtml: emptyHtml };
  }

  // ── 2. Render a single label cell's inner HTML content ────────────
  const renderLabelContent = (p: PrintableProduct): string => {
    const barcodeValue = sanitizeBarcode(p.barcode, p.sku) || "SKU-" + (p.sku || "NONE");
    const effectiveMrp = typeof p.mrp === "number" && p.mrp > 0 ? p.mrp : p.price;
    const mrpFormatted = formatINR(effectiveMrp);
    const priceFormatted = formatINR(p.price);

    const barcodeSvg = generateBarcodeSvgString(barcodeValue, {
      barWidthPx: cfg.barcodeBarWidthPx,
      heightMm: cfg.barcodeHeightMm,
      fontPt: cfg.barcodeFontPt,
      displayValue: true,
      maxWidthMm: cfg.labelWidthMm - cfg.paddingHorizMm * 2,
    });

    if (labelType === "barcode-only") {
      return [
        `<div class="lbl-brand">ZÉRAH BABY &amp; KIDS</div>`,
        `<div class="lbl-bc">${barcodeSvg}</div>`,
        `<div class="lbl-sku">SKU: ${escapeHtml(p.sku || p.barcode || "—")}</div>`,
      ].join("");
    }

    const hasDiscount = typeof p.mrp === "number" && p.mrp > p.price;
    const discountPct = hasDiscount
      ? Math.round(((effectiveMrp - p.price) / effectiveMrp) * 100)
      : 0;
    const discBadge =
      showDiscount && hasDiscount && discountPct > 0
        ? `<span class="lbl-disc-pct">(-${discountPct}%)</span>`
        : "";

    // When Separate Price Line is enabled (Dedicated Price Row)
    if (separatePriceLine && (showMrp || showSellPrice)) {
      const priceItems: string[] = [];
      if (showMrp) {
        priceItems.push(`<span class="lbl-mrp-strike">MRP: ${mrpFormatted}</span>`);
      }
      if (showSellPrice) {
        priceItems.push(`<span class="lbl-sell-bold">Price: ${priceFormatted}</span>`);
      }
      if (discBadge) {
        priceItems.push(discBadge);
      }

      return [
        `<div class="lbl-brand">ZÉRAH BABY &amp; KIDS</div>`,
        `<div class="lbl-name-standalone">${escapeHtml(p.name)}</div>`,
        `<div class="lbl-price-row">${priceItems.join("&nbsp; ")}</div>`,
        `<div class="lbl-bc">${barcodeSvg}</div>`,
        `<div class="lbl-sku">SKU: ${escapeHtml(p.sku || p.barcode || "—")}</div>`,
      ].join("");
    }

    // Default inline / stacked prices beside product name
    let priceSection = "";
    if (showMrp && showSellPrice) {
      priceSection = [
        `<div class="lbl-prices-stacked">`,
        `  <div class="lbl-mrp-strike">MRP: ${mrpFormatted}</div>`,
        `  <div class="lbl-sell-bold">Price: ${priceFormatted} ${discBadge}</div>`,
        `</div>`,
      ].join("");
    } else if (showSellPrice) {
      priceSection = `<div class="lbl-sell-bold">Price: ${priceFormatted}</div>`;
    } else if (showMrp) {
      priceSection = `<div class="lbl-mrp-bold">MRP: ${mrpFormatted} ${discBadge}</div>`;
    }

    return [
      `<div class="lbl-brand">ZÉRAH BABY &amp; KIDS</div>`,
      `<div class="lbl-row-middle">`,
      `  <div class="lbl-name">${escapeHtml(p.name)}</div>`,
      priceSection ? `  ${priceSection}` : "",
      `</div>`,
      `<div class="lbl-bc">${barcodeSvg}</div>`,
      `<div class="lbl-sku">SKU: ${escapeHtml(p.sku || p.barcode || "—")}</div>`,
    ].join("");
  };

  // ── 3. Build page HTML ────────────────────────────────────────────
  let pagesHtml = "";

  if (cfg.isThermalRoll) {
    // Each label = one @page on the thermal roll
    pagesHtml = labels
      .map(
        (p) =>
          `<div class="label-page"><div class="label-inner">${renderLabelContent(p)}</div></div>`,
      )
      .join("\n");
  } else {
    // A4 grid — all cells flow inside one page
    const cells = labels
      .map(
        (p) =>
          `<div class="label-cell"><div class="label-inner">${renderLabelContent(p)}</div></div>`,
      )
      .join("\n");
    pagesHtml = `<div class="label-grid">${cells}</div>`;
  }

  // ── 4. Build CSS ──────────────────────────────────────────────────
  const pageSizeDecl = `${cfg.pageWidthMm}mm ${cfg.pageHeightMm}mm`;
  const pageMarginDecl = cfg.isThermalRoll ? "0mm" : `${cfg.pageMarginMm}mm`;

  const css = `
    /* ── Reset ── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Exact Physical Page Dimensions ── */
    @page {
      size: ${pageSizeDecl};
      margin: ${pageMarginDecl};
    }

    html, body {
      width: ${cfg.pageWidthMm}mm;
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* ── Thermal roll: one label per @page ── */
    .label-page {
      width: ${cfg.pageWidthMm}mm;
      height: ${cfg.pageHeightMm}mm;
      max-height: ${cfg.pageHeightMm}mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
    }

    /* ── A4 grid ── */
    .label-grid {
      display: grid;
      grid-template-columns: repeat(${cfg.gridColumns}, 1fr);
      gap: 1.5mm;
      width: 100%;
    }

    .label-cell {
      height: ${cfg.labelHeightMm}mm;
      max-height: ${cfg.labelHeightMm}mm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      border: 0.3mm dashed #cccccc;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Inner horizontal label container ── */
    .label-inner {
      width: ${cfg.labelWidthMm}mm;
      height: ${cfg.labelHeightMm}mm;
      max-height: ${cfg.labelHeightMm}mm;
      padding: ${cfg.paddingTopMm}mm ${cfg.paddingHorizMm}mm ${cfg.paddingBottomMm}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      background: #ffffff;
      box-sizing: border-box;
    }

    /* ── Row 1: Brand Header ── */
    .lbl-brand {
      font-size: ${cfg.brandFontPt}pt;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #333333;
      line-height: 1;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      flex-shrink: 0;
    }

    /* ── Row 2: Product Name (Left) + Prices (Right) ── */
    .lbl-row-middle {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      justify-content: space-between;
      width: 100%;
      gap: 1.5mm;
      overflow: hidden;
      flex-shrink: 0;
      margin-top: 0.2mm;
      margin-bottom: 0.2mm;
    }

    .lbl-name {
      font-size: ${cfg.nameFontPt}pt;
      font-weight: 700;
      color: #000000;
      line-height: 1.15;
      text-align: left;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      text-overflow: ellipsis;
    }

    .lbl-name-standalone {
      font-size: ${cfg.nameFontPt}pt;
      font-weight: 700;
      color: #000000;
      line-height: 1.15;
      width: 100%;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }

    .lbl-price-row {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      width: 100%;
      gap: 1.5mm;
      line-height: 1;
      flex-shrink: 0;
      margin: 0.2mm 0;
    }

    .lbl-prices-stacked {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      text-align: right;
      line-height: 1.1;
      flex-shrink: 0;
    }

    .lbl-mrp-strike {
      font-size: ${Math.round(cfg.priceFontPt * 0.85)}pt;
      font-weight: 600;
      color: #555555;
      text-decoration: line-through;
      white-space: nowrap;
    }

    .lbl-sell-bold {
      font-size: ${cfg.priceFontPt}pt;
      font-weight: 900;
      color: #000000;
      white-space: nowrap;
      letter-spacing: -0.01em;
    }

    .lbl-mrp-bold {
      font-size: ${cfg.priceFontPt}pt;
      font-weight: 900;
      color: #000000;
      white-space: nowrap;
      letter-spacing: -0.01em;
    }

    .lbl-disc-pct {
      font-size: ${Math.round(cfg.priceFontPt * 0.85)}pt;
      font-weight: 800;
      color: #059669;
      margin-left: 0.5mm;
    }

    /* ── Row 3: Barcode & Barcode Number ── */
    .lbl-bc {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      flex-shrink: 0;
    }

    .lbl-bc svg {
      display: block;
      margin: 0 auto;
    }

    /* ── Row 4: SKU ── */
    .lbl-sku {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${cfg.skuFontPt}pt;
      font-weight: 700;
      color: #444444;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      line-height: 1;
      flex-shrink: 0;
      letter-spacing: 0.02em;
    }
  `.trim();

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Zerah Labels – ${layout}</title>
  <style>${css}</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;

  return { pagesHtml, css, fullHtml };
}

export function buildLabelPrintHtml(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): string {
  return buildLabelPrintParts(params).fullHtml;
}

/* ================================================================== */
/*  Reliable Print Engine — Production-Hardened                       */
/*                                                                     */
/*  Permanent Architecture:                                            */
/*  1. Direct in-page print via @media print and window.print()        */
/*     (100% immune to Chromium iframe isolation & popup blockers).   */
/*  2. Standalone New-Tab preview & print via standard window.open()   */
/*     with auto-trigger print dialog.                                 */
/* ================================================================== */

export function openLabelPrintInNewTab(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const html = buildLabelPrintHtml(params);
    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      try {
        win.print();
      } catch {
        /* print fallback handled inside tab */
      }
      return true;
    } else {
      toast.error("Popup window was blocked by browser. Please allow popups.");
      return false;
    }
  } catch (err) {
    console.error("[ZerahPrint] openLabelPrintInNewTab error:", err);
    toast.error("Failed to open print tab.");
    return false;
  }
}

export function printLabelsViaIframe(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  onDone?: () => void;
}): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    params.onDone?.();
    return;
  }

  // Dismiss active toasts
  toast.dismiss();

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    const container = document.getElementById("zerah-print-container");
    const style = document.getElementById("zerah-print-style");
    if (container) container.innerHTML = "";
    if (style) style.textContent = "";
    params.onDone?.();
  };

  try {
    const { pagesHtml, css } = buildLabelPrintParts(params);

    // 1. Inject or update the dedicated in-page print container
    let container = document.getElementById("zerah-print-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "zerah-print-container";
      document.body.appendChild(container);
    }
    container.innerHTML = pagesHtml;

    // 2. Inject or update the dedicated print style
    let style = document.getElementById("zerah-print-style") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "zerah-print-style";
      document.head.appendChild(style);
    }

    style.textContent = `
      @media screen {
        #zerah-print-container {
          display: none !important;
        }
      }
      @media print {
        body > *:not(#zerah-print-container) {
          display: none !important;
        }
        #zerah-print-container {
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          z-index: 999999 !important;
        }
        ${css}
      }
    `;

    window.addEventListener("afterprint", cleanup, { once: true });

    // 3. Directly call window.print() synchronously inside the user click stack
    try {
      window.print();
    } catch (printErr) {
      console.warn("[ZerahPrint] window.print() failed, attempting open in tab:", printErr);
      openLabelPrintInNewTab(params);
    } finally {
      // Safety release cleanup after print dialog dismiss
      setTimeout(cleanup, 500);
    }
  } catch (err) {
    console.error("[ZerahPrint] printLabels failed:", err);
    toast.error("Failed to prepare label print sheet.");
    cleanup();
  }
}

/* ================================================================== */
/*  Direct Print Event Bus (for 1-Click row-level printing)           */
/* ================================================================== */

type PrintEventListener = (payload: DirectPrintPayload | null) => void;
const _listeners = new Set<PrintEventListener>();

export function subscribeToDirectPrint(listener: PrintEventListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

let _printingLock = false;

/**
 * Main entry-point for all 1-click direct label print requests.
 * Tries QZ Tray → falls back to iframe browser print.
 */
export async function triggerDirectLabelPrint(
  target: Product | PrintableProduct | Array<Product | PrintableProduct>,
  options?: {
    quantity?: number;
    quantities?: Record<string, number>;
    layout?: LabelPrinterProfile;
    labelType?: LabelType;
    showDiscount?: boolean;
    showMrp?: boolean;
    showSellPrice?: boolean;
    separatePriceLine?: boolean;
  },
): Promise<boolean> {
  if (_printingLock) {
    toast.info("Print job already in progress…");
    return false;
  }

  const rawProducts = Array.isArray(target) ? target : [target];
  if (rawProducts.length === 0) {
    toast.error("No products selected to print.");
    return false;
  }

  // Validate — do not silently skip invalid products
  for (const p of rawProducts) {
    const check = validatePrintableProduct(p);
    if (!check.valid) {
      toast.error(check.error || "Cannot print label: invalid product data");
      return false;
    }
  }

  // Build quantities map
  const quantities: Record<string, number> = { ...(options?.quantities ?? {}) };
  for (const p of rawProducts) {
    const key = getProductKey(p);
    if (quantities[key] === undefined) {
      quantities[key] = options?.quantity && options.quantity > 0 ? options.quantity : 1;
    }
  }

  const layout = options?.layout || getSavedLabelProfile();
  const labelType = options?.labelType || getSavedLabelType();
  const showDiscount = options?.showDiscount ?? getSavedShowDiscount();
  const showMrp = options?.showMrp ?? getSavedShowMrp();
  const showSellPrice = options?.showSellPrice ?? getSavedShowSellPrice();
  const separatePriceLine = options?.separatePriceLine ?? getSavedSeparatePrice();

  _printingLock = true;
  setTimeout(() => {
    _printingLock = false;
  }, 3000);

  // Try QZ Tray for thermal formats
  if (layout !== "a4") {
    try {
      const qzResult = await printThermalLabelsDirectly({
        products: rawProducts,
        quantities,
        layout,
        labelType,
        showDiscount,
        showMrp,
        showSellPrice,
        separatePriceLine,
      });
      if (qzResult.success) {
        toast.success("Printed directly to thermal printer!");
        _printingLock = false;
        return true;
      }
    } catch {
      // QZ Tray not available — fall through to iframe
    }
  }

  // Browser iframe print
  printLabelsViaIframe({
    products: rawProducts,
    quantities,
    layout,
    labelType,
    showDiscount,
    showMrp,
    showSellPrice,
    separatePriceLine,
    onDone: () => {
      setTimeout(() => {
        _printingLock = false;
      }, 1500);
    },
  });

  return true;
}

/**
 * Directly print thermal labels via QZ Tray raw TSPL commands.
 */
export async function printThermalLabelsDirectly(params: {
  products: (Product | PrintableProduct)[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["print_thermal_printer_name"]);

    const printerName =
      data?.find((d) => d.key === "print_thermal_printer_name")?.value || "HPRT HT300";

    const cfg = PRINT_FORMAT_CONFIG[params.layout];
    let allTspl = "";

    for (const product of params.products) {
      const key = getProductKey(product);
      const copies = params.quantities[key] || 1;
      if (copies <= 0) continue;

      const tspl = buildTSPLLabel({
        productName: product.name,
        sku: product.sku || "",
        barcode: sanitizeBarcode(product.barcode, product.sku) || "NO-BARCODE",
        price: product.price,
        mrp: product.mrp,
        widthMm: cfg.pageWidthMm,
        heightMm: cfg.pageHeightMm,
        copies,
        showDiscount: params.showDiscount,
        showMrp: params.showMrp,
        showSellPrice: params.showSellPrice,
        separatePriceLine: params.separatePriceLine,
      });
      allTspl += tspl + "\n";
    }

    if (!allTspl) return { success: true };

    const result = await sendTSPLViaQZTray(printerName, allTspl);
    return result.success ? { success: true } : { success: false, error: result.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ================================================================== */
/*  React Hook                                                         */
/* ================================================================== */

export function useDirectLabelPrint() {
  const [isPrinting, setIsPrinting] = useState(false);

  const printLabel = useCallback(
    (
      target: Product | PrintableProduct | Array<Product | PrintableProduct>,
      options?: {
        quantity?: number;
        quantities?: Record<string, number>;
        layout?: LabelPrinterProfile;
        labelType?: LabelType;
        showDiscount?: boolean;
      },
    ) => {
      setIsPrinting(true);
      triggerDirectLabelPrint(target, options).finally(() => {
        setTimeout(() => setIsPrinting(false), 1500);
      });
      return true;
    },
    [],
  );

  return { printLabel, isPrinting };
}
