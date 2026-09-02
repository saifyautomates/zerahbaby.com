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
let memoryShowDiscount = false;
let memoryLabelType: LabelType = "full";
let memoryShowMrp = true;
let memoryShowSellPrice = false;
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
/*  Preflight Print Validation                                         */
/* ================================================================== */

export function validatePrintPreflight(params: {
  products: (Product | PrintableProduct)[];
  quantities?: Record<string, number>;
}): { valid: boolean; error?: string; totalLabels: number } {
  const rawProducts = Array.isArray(params.products) ? params.products : [params.products];
  if (rawProducts.length === 0) {
    return { valid: false, error: "Please select at least 1 product to print labels.", totalLabels: 0 };
  }

  let totalLabels = 0;
  for (const p of rawProducts) {
    const check = validatePrintableProduct(p);
    if (!check.valid) {
      return { valid: false, error: check.error || `Invalid data for product: ${p.name || "Unknown"}`, totalLabels: 0 };
    }
    const key = getProductKey(p);
    const qty = params.quantities?.[key] !== undefined ? params.quantities[key] : 1;
    if (qty > 0) {
      totalLabels += qty;
    }
  }

  if (totalLabels === 0) {
    return { valid: false, error: "Total label quantity to print must be at least 1.", totalLabels: 0 };
  }

  return { valid: true, totalLabels };
}

/* ================================================================== */
/*  HTML Print Document Builder — Single Canonical Generator           */
/* ================================================================== */

export type BuildLabelPrintOptions = {
  products: (Product | PrintableProduct)[];
  quantities?: Record<string, number>;
  layout?: LabelPrinterProfile;
  labelType?: LabelType;
  showDiscount?: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  isStandaloneTab?: boolean;
};

export function buildLabelPrintParts(params: BuildLabelPrintOptions): {
  pagesHtml: string;
  css: string;
  fullHtml: string;
  labelCount: number;
} {
  const {
    products,
    quantities = {},
    layout = "thermal-58",
    labelType = "full",
    showDiscount = false,
    showMrp = true,
    showSellPrice = false,
    separatePriceLine = false,
    isStandaloneTab = false,
  } = params;

  const cfg = PRINT_FORMAT_CONFIG[layout] || PRINT_FORMAT_CONFIG["thermal-58"];
  const rawProducts = Array.isArray(products) ? products : [products];

  // Map layout profile to isolated print mode class
  const modeClass =
    layout === "thermal-108"
      ? "print-mode-108mm"
      : layout === "a4"
        ? "print-mode-a4"
        : "print-mode-50x25";

  // ── 1. Flatten products × quantities into ordered label list ──────
  const labels: PrintableProduct[] = [];
  for (const p of rawProducts) {
    const key = getProductKey(p);
    const qty = Math.max(0, Math.min(500, quantities[key] ?? 1));
    for (let i = 0; i < qty; i++) {
      labels.push(p);
    }
  }

  if (labels.length === 0) {
    const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>No Labels</title>
</head>
<body style="font-family:sans-serif;padding:40px;text-align:center;color:#64748b;">
  <h2>No labels to print</h2>
  <p>Please select at least one product with quantity greater than zero.</p>
</body>
</html>`;
    return { pagesHtml: "<p>No labels to print.</p>", css: "", fullHtml: emptyHtml, labelCount: 0 };
  }

  // ── 2. Render individual label inner content ──────────────────────
  const renderLabelContent = (p: PrintableProduct): string => {
    const barcodeValue = sanitizeBarcode(p.barcode, p.sku) || "SKU-" + (p.sku || "NONE");
    const effectiveMrp = typeof p.mrp === "number" && p.mrp > 0 ? p.mrp : p.price;
    const mrpFormatted = formatINR(effectiveMrp);
    const priceFormatted = formatINR(p.price);

    const barcodeSvg = generateBarcodeSvgString(barcodeValue, {
      barWidthPx: cfg.barcodeBarWidthPx,
      heightMm: labelType === "barcode-only" ? cfg.barcodeHeightMm * 1.3 : cfg.barcodeHeightMm,
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

    const hasDiscount = typeof p.mrp === "number" && p.mrp > p.price && p.price > 0;
    const discountPct = hasDiscount
      ? Math.round(((effectiveMrp - p.price) / effectiveMrp) * 100)
      : 0;
    const discBadge =
      showDiscount && hasDiscount && discountPct > 0
        ? `<span class="lbl-disc-pct">(-${discountPct}%)</span>`
        : "";

    // Price rendering according to retail specification
    let priceSnippet = "";
    if (showMrp && showSellPrice) {
      // Both enabled: show MRP struck through and bold selling price
      priceSnippet = `<span class="lbl-mrp-strike">MRP: ${mrpFormatted}</span> <span class="lbl-sell-bold">Price: ${priceFormatted}</span>${discBadge}`;
    } else if (showSellPrice) {
      // Selling price only
      priceSnippet = `<span class="lbl-sell-bold">Price: ${priceFormatted}</span>`;
    } else if (showMrp) {
      // MRP only (Standard Retail Specification Default - Bold, NOT struck through)
      priceSnippet = `<span class="lbl-mrp-bold">MRP: ${mrpFormatted}</span>${discBadge}`;
    }

    if (separatePriceLine && priceSnippet) {
      return [
        `<div class="lbl-brand">ZÉRAH BABY &amp; KIDS</div>`,
        `<div class="lbl-name-standalone">${escapeHtml(p.name)}</div>`,
        `<div class="lbl-price-row">${priceSnippet}</div>`,
        `<div class="lbl-bc">${barcodeSvg}</div>`,
        `<div class="lbl-sku">SKU: ${escapeHtml(p.sku || p.barcode || "—")}</div>`,
      ].join("");
    }

    // Default compact horizontal middle row: Name (left) + Price (right)
    return [
      `<div class="lbl-brand">ZÉRAH BABY &amp; KIDS</div>`,
      `<div class="lbl-row-middle">`,
      `  <div class="lbl-name">${escapeHtml(p.name)}</div>`,
      priceSnippet ? `  <div class="lbl-price-cell">${priceSnippet}</div>` : "",
      `</div>`,
      `<div class="lbl-bc">${barcodeSvg}</div>`,
      `<div class="lbl-sku">SKU: ${escapeHtml(p.sku || p.barcode || "—")}</div>`,
    ].join("");
  };

  // ── 3. Build HTML Structure ───────────────────────────────────────
  let pagesHtml = "";

  if (cfg.isThermalRoll) {
    if (isStandaloneTab) {
      pagesHtml = labels
        .map(
          (p, idx) => `
        <div class="sticker-preview-wrapper" data-label-index="${idx + 1}">
          <div class="sticker-dim-badge no-print">${cfg.pageWidthMm}mm × ${cfg.pageHeightMm}mm Label #${idx + 1}</div>
          <div class="label-page sticker-card">
            <div class="label-inner">${renderLabelContent(p)}</div>
          </div>
        </div>`,
        )
        .join("\n");
    } else {
      pagesHtml = labels
        .map(
          (p, idx) => `
        <div class="label-page" data-label-index="${idx + 1}">
          <div class="label-inner">${renderLabelContent(p)}</div>
        </div>`,
        )
        .join("\n");
    }
  } else {
    // A4 grid layout
    const cells = labels
      .map(
        (p, idx) => `
      <div class="label-cell" data-label-index="${idx + 1}">
        <div class="label-inner">${renderLabelContent(p)}</div>
      </div>`,
      )
      .join("\n");

    pagesHtml = `<div class="label-grid">${cells}</div>`;
  }

  // ── 4. Build Exact Physical CSS ───────────────────────────────────
  const pageSizeDecl = `${cfg.pageWidthMm}mm ${cfg.pageHeightMm}mm`;
  const pageMarginDecl = cfg.isThermalRoll ? "0" : `${cfg.pageMarginMm}mm`;

  const css = `
    /* ── Reset ── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Exact Physical Page Dimensions (Strictly isolated per format) ── */
    @page {
      size: ${pageSizeDecl};
      margin: ${pageMarginDecl};
    }

    /* ── Label Typography & Layout Tokens ── */
    .label-inner {
      width: 100%;
      height: 100%;
      max-height: 100%;
      padding: ${cfg.paddingTopMm}mm ${cfg.paddingHorizMm}mm ${cfg.paddingBottomMm}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      background: #ffffff;
      box-sizing: border-box;
    }

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

    .lbl-row-middle {
      display: flex;
      flex-direction: row;
      align-items: baseline;
      justify-content: space-between;
      width: 100%;
      gap: 1.2mm;
      overflow: hidden;
      flex-shrink: 0;
      margin: 0.2mm 0;
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
      margin: 0.2mm 0;
    }

    .lbl-price-cell {
      display: flex;
      align-items: baseline;
      gap: 1mm;
      flex-shrink: 0;
      text-align: right;
      line-height: 1;
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

    .lbl-mrp-strike {
      font-size: ${Math.round(cfg.priceFontPt * 0.85)}pt;
      font-weight: 600;
      color: #666666;
      text-decoration: line-through;
      white-space: nowrap;
    }

    .lbl-sell-bold,
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

    /* ── Mode-Specific Dimensions (Screen & Print Baseline) ── */
    .print-mode-50x25 .label-page {
      width: 50mm;
      height: 25mm;
      max-width: 50mm;
      max-height: 25mm;
      box-sizing: border-box;
      background: #ffffff;
      overflow: hidden;
    }

    .print-mode-108mm .label-page {
      width: 100mm;
      height: 25mm;
      max-width: 100mm;
      max-height: 25mm;
      box-sizing: border-box;
      background: #ffffff;
      overflow: hidden;
    }

    .print-mode-a4 .label-grid {
      display: grid;
      grid-template-columns: repeat(${cfg.gridColumns}, 1fr);
      gap: 1.5mm;
      width: 194mm;
      box-sizing: border-box;
    }

    .print-mode-a4 .label-cell {
      height: ${cfg.labelHeightMm}mm;
      max-height: ${cfg.labelHeightMm}mm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      border: 0.3mm dashed #cccccc;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      background: #ffffff;
    }

    /* ── Screen Presentation Styling (@media screen) ── */
    @media screen {
      html, body {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 0;
        background-color: #0f172a;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .standalone-toolbar {
        position: sticky;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
        z-index: 1000;
        background: #1e293b;
        border-bottom: 1px solid #334155;
        color: #ffffff;
        padding: 12px 24px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }

      .toolbar-info {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .toolbar-title {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.02em;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .toolbar-badge {
        background: #8B2020;
        color: #ffffff;
        font-size: 11px;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 6px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .toolbar-hint {
        font-size: 11px;
        color: #94a3b8;
      }

      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .btn-print-primary {
        background: #8B2020;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 8px 18px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease-in-out;
        box-shadow: 0 2px 8px rgba(139, 32, 32, 0.4);
      }
      .btn-print-primary:hover {
        background: #a32828;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 32, 32, 0.5);
      }
      .btn-print-primary:active {
        transform: translateY(0);
      }

      .btn-secondary {
        background: #334155;
        color: #e2e8f0;
        border: none;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .btn-secondary:hover {
        background: #475569;
      }

      .screen-canvas {
        flex: 1;
        width: 100%;
        padding: 32px 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
      }

      .sticker-preview-wrapper {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }

      .sticker-dim-badge {
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }

      .sticker-card {
        border-radius: 3px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
        position: relative;
      }
    }

    /* ── Strict Physical Print Styling (@media print) ── */
    @media print {
      .no-print,
      .standalone-toolbar,
      .sticker-dim-badge {
        display: none !important;
      }

      html, body {
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        color: #000000 !important;
        display: block !important;
        font-family: Arial, Helvetica, sans-serif !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .screen-canvas {
        padding: 0 !important;
        margin: 0 !important;
        display: block !important;
        background: transparent !important;
        width: auto !important;
      }

      .sticker-preview-wrapper {
        display: contents !important;
      }

      .sticker-card {
        box-shadow: none !important;
        border-radius: 0 !important;
      }

      /* ── Thermal Roll Page Breaks & Physical Sizing ── */
      .print-mode-50x25 .label-page,
      .print-mode-108mm .label-page {
        page-break-after: always !important;
        break-after: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Suppress trailing page break on final label to prevent extra blank stickers */
      .print-mode-50x25 .label-page:last-child,
      .print-mode-108mm .label-page:last-child,
      .sticker-preview-wrapper:last-child .label-page {
        page-break-after: auto !important;
        break-after: auto !important;
      }

      .print-mode-a4 .label-cell {
        border: none !important;
      }
    }
  `.trim();

  // ── 5. Full HTML Document Composition ─────────────────────────────
  let bodyContent = "";
  if (isStandaloneTab) {
    bodyContent = `
  <header class="standalone-toolbar no-print">
    <div class="toolbar-info">
      <div class="toolbar-title">
        <span>ZÉRAH BABY &amp; KIDS</span>
        <span class="toolbar-badge">${cfg.labelWidthMm}×${cfg.labelHeightMm}mm ${cfg.isThermalRoll ? "Thermal Sticker" : "A4 Sheet"}</span>
      </div>
      <div class="toolbar-hint">
        ${labels.length} label${labels.length !== 1 ? "s" : ""} ready • In print dialog: Set Paper Size to ${cfg.labelWidthMm}×${cfg.labelHeightMm}mm (or 2"×1"), Margins: None
      </div>
    </div>
    <div class="toolbar-actions">
      <button class="btn-print-primary" onclick="window.print()">
        🖨️ Print Labels (${labels.length})
      </button>
      <button class="btn-secondary" onclick="window.close()">
        Close Preview
      </button>
    </div>
  </header>
  <main class="screen-canvas">
    ${pagesHtml}
  </main>
  <script>
    (function() {
      function triggerAutoPrint() {
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() {
            requestAnimationFrame(function() {
              setTimeout(function() {
                try { window.print(); } catch(e) { console.error(e); }
              }, 50);
            });
          });
        } else {
          setTimeout(function() {
            try { window.print(); } catch(e) { console.error(e); }
          }, 150);
        }
      }
      if (document.readyState === 'complete') {
        triggerAutoPrint();
      } else {
        window.addEventListener('load', triggerAutoPrint);
      }
    })();
  </script>`;
  } else {
    bodyContent = `
  <div class="screen-canvas">
    ${pagesHtml}
  </div>`;
  }

  const fullHtml = `<!DOCTYPE html>
<html lang="en" class="${modeClass}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Zerah Labels – ${cfg.labelWidthMm}×${cfg.labelHeightMm}mm (${labels.length})</title>
  <style>${css}</style>
</head>
<body class="${modeClass}">
  ${bodyContent}
</body>
</html>`;

  return { pagesHtml, css, fullHtml, labelCount: labels.length };
}

export function buildLabelPrintHtml(params: BuildLabelPrintOptions): string {
  return buildLabelPrintParts(params).fullHtml;
}

/* ================================================================== */
/*  Canonical Print Execution Pipeline                                 */
/* ================================================================== */

/**
 * Opens a dedicated standalone browser tab with the responsive sticker preview
 * and automatic print dialog trigger.
 */
export function openLabelPrintInNewTab(params: {
  products: (Product | PrintableProduct)[];
  quantities?: Record<string, number>;
  layout?: LabelPrinterProfile;
  labelType?: LabelType;
  showDiscount?: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const rawProducts = Array.isArray(params.products) ? params.products : [params.products];
    const preflight = validatePrintPreflight({ products: rawProducts, quantities: params.quantities });
    if (!preflight.valid) {
      toast.error(preflight.error || "Cannot print labels: invalid data");
      return false;
    }

    const quantities: Record<string, number> = { ...(params.quantities ?? {}) };
    for (const p of rawProducts) {
      const key = getProductKey(p);
      if (quantities[key] === undefined || quantities[key] <= 0) {
        quantities[key] = 1;
      }
    }

    const html = buildLabelPrintHtml({
      products: rawProducts,
      quantities,
      layout: params.layout || "thermal-58",
      labelType: params.labelType || "full",
      showDiscount: params.showDiscount ?? false,
      showMrp: params.showMrp ?? true,
      showSellPrice: params.showSellPrice ?? false,
      separatePriceLine: params.separatePriceLine ?? false,
      isStandaloneTab: true,
    });

    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      return true;
    } else {
      toast.error("Popup window was blocked by browser. Please allow popups for printing.");
      return false;
    }
  } catch (err) {
    console.error("[ZerahPrint] openLabelPrintInNewTab error:", err);
    toast.error("Failed to open print tab.");
    return false;
  }
}

/**
 * Direct Canonical Print Pipeline for Zérah Baby & Kids.
 * Uses an isolated hidden iframe with preflight checks and font-settling.
 * Falls back seamlessly to standalone new-tab if iframe is restricted.
 */
export function printProductLabels(params: {
  products: (Product | PrintableProduct)[];
  quantities?: Record<string, number>;
  layout?: LabelPrinterProfile;
  labelType?: LabelType;
  showDiscount?: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  onDone?: () => void;
}): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    params.onDone?.();
    return false;
  }

  // Dismiss active toasts to ensure clean print state
  toast.dismiss();

  const rawProducts = Array.isArray(params.products) ? params.products : [params.products];
  const preflight = validatePrintPreflight({ products: rawProducts, quantities: params.quantities });
  if (!preflight.valid) {
    toast.error(preflight.error || "Cannot print labels: invalid data");
    params.onDone?.();
    return false;
  }

  const quantities: Record<string, number> = { ...(params.quantities ?? {}) };
  for (const p of rawProducts) {
    const key = getProductKey(p);
    if (quantities[key] === undefined || quantities[key] <= 0) {
      quantities[key] = 1;
    }
  }

  const html = buildLabelPrintHtml({
    products: rawProducts,
    quantities,
    layout: params.layout || "thermal-58",
    labelType: params.labelType || "full",
    showDiscount: params.showDiscount ?? false,
    showMrp: params.showMrp ?? true,
    showSellPrice: params.showSellPrice ?? false,
    separatePriceLine: params.separatePriceLine ?? false,
    isStandaloneTab: false,
  });

  const iframeId = "zerah-canonical-label-print-frame";
  let iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
  if (iframe) {
    try {
      iframe.remove();
    } catch {}
  }

  iframe = document.createElement("iframe");
  iframe.id = iframeId;
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.top = "-9999px";
  iframe.style.left = "-9999px";
  iframe.style.width = "400px";
  iframe.style.height = "300px";
  iframe.style.border = "none";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  const cleanup = () => {
    try {
      const existing = document.getElementById(iframeId);
      if (existing) existing.remove();
    } catch {}
    params.onDone?.();
  };

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      return openLabelPrintInNewTab(params);
    }

    doc.open();
    doc.write(html);
    doc.close();

    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return openLabelPrintInNewTab(params);
    }

    const triggerPrint = () => {
      try {
        const labelsInDoc = doc.querySelectorAll(".label-page, .label-cell");
        if (!labelsInDoc || labelsInDoc.length === 0) {
          console.warn("[ZerahPrint] No label elements detected in print iframe, falling back to new tab");
          cleanup();
          return openLabelPrintInNewTab(params);
        }

        win.focus();
        win.addEventListener("afterprint", cleanup, { once: true });
        // Generous safety timeout so iframe isn't destroyed while print dialog is open
        setTimeout(cleanup, 60000);
        win.print();
        return true;
      } catch (err) {
        console.error("[ZerahPrint] iframe print failed:", err);
        cleanup();
        return openLabelPrintInNewTab(params);
      }
    };

    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => {
        requestAnimationFrame(() => requestAnimationFrame(triggerPrint));
      });
    } else {
      setTimeout(triggerPrint, 150);
    }
    return true;
  } catch (err) {
    console.error("[ZerahPrint] printProductLabels iframe error:", err);
    cleanup();
    return openLabelPrintInNewTab(params);
  }
}

/** Legacy alias pointing directly to canonical engine */
export const printLabelsViaIframe = printProductLabels;

/* ================================================================== */
/*  Direct Print Event Bus & Hook                                      */
/* ================================================================== */

type PrintEventListener = (payload: DirectPrintPayload | null) => void;
const _listeners = new Set<PrintEventListener>();

export function subscribeToDirectPrint(listener: PrintEventListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Direct entry-point for 1-click printing without asynchronous delays
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
  const rawProducts = Array.isArray(target) ? target : [target];
  const quantities: Record<string, number> = { ...(options?.quantities ?? {}) };
  for (const p of rawProducts) {
    const key = getProductKey(p);
    if (quantities[key] === undefined) {
      quantities[key] = options?.quantity && options.quantity > 0 ? options.quantity : 1;
    }
  }

  return printProductLabels({
    products: rawProducts,
    quantities,
    layout: options?.layout,
    labelType: options?.labelType,
    showDiscount: options?.showDiscount,
    showMrp: options?.showMrp,
    showSellPrice: options?.showSellPrice,
    separatePriceLine: options?.separatePriceLine,
  });
}

/**
 * Standard React Hook for 1-click printing across all components.
 * 100% synchronous invocation guarantees preservation of browser user gesture.
 */
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
        showMrp?: boolean;
        showSellPrice?: boolean;
        separatePriceLine?: boolean;
      },
    ) => {
      const rawProducts = Array.isArray(target) ? target : [target];
      if (rawProducts.length === 0) {
        toast.error("Please select at least 1 product to print labels.");
        return false;
      }

      setIsPrinting(true);

      const quantities: Record<string, number> = { ...(options?.quantities ?? {}) };
      for (const p of rawProducts) {
        const key = getProductKey(p);
        if (quantities[key] === undefined) {
          quantities[key] = options?.quantity && options.quantity > 0 ? options.quantity : 1;
        }
      }

      return printProductLabels({
        products: rawProducts,
        quantities,
        layout: options?.layout,
        labelType: options?.labelType,
        showDiscount: options?.showDiscount,
        showMrp: options?.showMrp,
        showSellPrice: options?.showSellPrice,
        separatePriceLine: options?.separatePriceLine,
        onDone: () => setIsPrinting(false),
      });
    },
    [],
  );

  return { printLabel, isPrinting };
}
