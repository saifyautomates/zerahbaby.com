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

export type LabelPrinterProfile =
  | "50x75"
  | "58x75"
  | "58x100"
  | "50x50"
  | "80x100"
  | "50x25"
  | "58x30"
  | "58x40"
  | "58x50"
  | "80x50"
  | "100x50"
  | "108x50"
  | "108x75"
  | "a4-3x8"
  | "a4-4x10"
  | "custom"
  // Legacy backward-compatibility aliases
  | "thermal-108"
  | "a4"
  | "thermal-58";

export type LabelType = "barcode-only" | "full";

/** Physical millimetre configuration for each label format */
export interface PrintFormatConfig {
  id: LabelPrinterProfile;
  name: string;
  shortLabel: string;
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
  /** For A4 only — grid columns & rows */
  gridColumns?: number;
  gridRows?: number;
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
  isSheet: boolean;
}

export const LABEL_SIZE_OPTIONS: Array<{
  id: LabelPrinterProfile;
  label: string;
  description: string;
  category: "thermal" | "sheet" | "custom";
}> = [
  { id: "50x75", label: "50 × 75 mm", description: "Standard Thermal Portrait (Default)", category: "thermal" },
  { id: "58x75", label: "58 × 75 mm", description: "Thermal Portrait", category: "thermal" },
  { id: "58x100", label: "58 × 100 mm", description: "Tall Thermal Portrait", category: "thermal" },
  { id: "50x50", label: "50 × 50 mm", description: "Square Thermal", category: "thermal" },
  { id: "80x100", label: "80 × 100 mm", description: "Wide Thermal Portrait", category: "thermal" },
  { id: "50x25", label: "50 × 25 mm", description: "Compact Thermal", category: "thermal" },
  { id: "58x30", label: "58 × 30 mm", description: "Thermal Compact", category: "thermal" },
  { id: "58x40", label: "58 × 40 mm", description: "Thermal Compact", category: "thermal" },
  { id: "58x50", label: "58 × 50 mm", description: "Thermal Compact", category: "thermal" },
  { id: "80x50", label: "80 × 50 mm", description: "Wide Thermal Compact", category: "thermal" },
  { id: "100x50", label: "100 × 50 mm", description: "Large Thermal Compact", category: "thermal" },
  { id: "108x50", label: "108 × 50 mm", description: "Extra-Wide Thermal", category: "thermal" },
  { id: "108x75", label: "108 × 75 mm", description: "Jumbo Thermal", category: "thermal" },
  { id: "a4-3x8", label: "A4 — 3 × 8", description: "24 Labels / A4 Sheet", category: "sheet" },
  { id: "a4-4x10", label: "A4 — 4 × 10", description: "40 Labels / A4 Sheet", category: "sheet" },
  { id: "custom", label: "Custom", description: "Custom Millimetre Size", category: "custom" },
];

export const PRINT_FORMAT_CONFIG: Record<string, PrintFormatConfig> = {
  /** 1. 50 × 75 mm — Portrait (Standard Thermal Retail Tag Default) */
  "50x75": {
    id: "50x75",
    name: "50 × 75 mm",
    shortLabel: "50×75mm",
    pageWidthMm: 50,
    pageHeightMm: 75,
    pageMarginMm: 0,
    labelWidthMm: 50,
    labelHeightMm: 75,
    paddingTopMm: 1.5,
    paddingHorizMm: 1.5,
    paddingBottomMm: 1.5,
    barcodeBarWidthPx: 1.15,
    barcodeHeightMm: 13.0,
    barcodeFontPt: 6.5,
    brandFontPt: 7.5,
    nameFontPt: 8.0,
    priceFontPt: 12.0,
    skuFontPt: 7.0,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 2. 58 × 75 mm — Portrait */
  "58x75": {
    id: "58x75",
    name: "58 × 75 mm",
    shortLabel: "58×75mm",
    pageWidthMm: 58,
    pageHeightMm: 75,
    pageMarginMm: 0,
    labelWidthMm: 58,
    labelHeightMm: 75,
    paddingTopMm: 1.5,
    paddingHorizMm: 2.0,
    paddingBottomMm: 1.5,
    barcodeBarWidthPx: 1.25,
    barcodeHeightMm: 14.5,
    barcodeFontPt: 7.0,
    brandFontPt: 8.0,
    nameFontPt: 8.5,
    priceFontPt: 13.0,
    skuFontPt: 7.5,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 3. 58 × 100 mm — Tall Portrait */
  "58x100": {
    id: "58x100",
    name: "58 × 100 mm",
    shortLabel: "58×100mm",
    pageWidthMm: 58,
    pageHeightMm: 100,
    pageMarginMm: 0,
    labelWidthMm: 58,
    labelHeightMm: 100,
    paddingTopMm: 2.0,
    paddingHorizMm: 2.0,
    paddingBottomMm: 2.0,
    barcodeBarWidthPx: 1.25,
    barcodeHeightMm: 18.0,
    barcodeFontPt: 7.5,
    brandFontPt: 8.5,
    nameFontPt: 9.5,
    priceFontPt: 14.0,
    skuFontPt: 8.0,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 4. 50 × 50 mm — Square */
  "50x50": {
    id: "50x50",
    name: "50 × 50 mm",
    shortLabel: "50×50mm",
    pageWidthMm: 50,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 50,
    labelHeightMm: 50,
    paddingTopMm: 1.0,
    paddingHorizMm: 1.5,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.1,
    barcodeHeightMm: 10.0,
    barcodeFontPt: 6.0,
    brandFontPt: 7.0,
    nameFontPt: 7.5,
    priceFontPt: 10.0,
    skuFontPt: 6.5,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 5. 80 × 100 mm — Portrait */
  "80x100": {
    id: "80x100",
    name: "80 × 100 mm",
    shortLabel: "80×100mm",
    pageWidthMm: 80,
    pageHeightMm: 100,
    pageMarginMm: 0,
    labelWidthMm: 80,
    labelHeightMm: 100,
    paddingTopMm: 2.5,
    paddingHorizMm: 3.0,
    paddingBottomMm: 2.5,
    barcodeBarWidthPx: 1.5,
    barcodeHeightMm: 22.0,
    barcodeFontPt: 8.5,
    brandFontPt: 10.0,
    nameFontPt: 11.0,
    priceFontPt: 16.0,
    skuFontPt: 9.0,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 6. 50 × 25 mm — Compact */
  "50x25": {
    id: "50x25",
    name: "50 × 25 mm",
    shortLabel: "50×25mm",
    pageWidthMm: 50,
    pageHeightMm: 25,
    pageMarginMm: 0,
    labelWidthMm: 50,
    labelHeightMm: 25,
    paddingTopMm: 0.6,
    paddingHorizMm: 1.2,
    paddingBottomMm: 0.5,
    barcodeBarWidthPx: 1.1,
    barcodeHeightMm: 7.8,
    barcodeFontPt: 5.8,
    brandFontPt: 6.2,
    nameFontPt: 6.8,
    priceFontPt: 7.5,
    skuFontPt: 5.6,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 2. 58 × 30 mm — Landscape */
  "58x30": {
    id: "58x30",
    name: "58 × 30 mm",
    shortLabel: "58×30mm",
    pageWidthMm: 58,
    pageHeightMm: 30,
    pageMarginMm: 0,
    labelWidthMm: 58,
    labelHeightMm: 30,
    paddingTopMm: 0.8,
    paddingHorizMm: 1.5,
    paddingBottomMm: 0.6,
    barcodeBarWidthPx: 1.2,
    barcodeHeightMm: 9.5,
    barcodeFontPt: 6.2,
    brandFontPt: 7.0,
    nameFontPt: 7.5,
    priceFontPt: 8.2,
    skuFontPt: 6.0,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 3. 58 × 40 mm — Landscape */
  "58x40": {
    id: "58x40",
    name: "58 × 40 mm",
    shortLabel: "58×40mm",
    pageWidthMm: 58,
    pageHeightMm: 40,
    pageMarginMm: 0,
    labelWidthMm: 58,
    labelHeightMm: 40,
    paddingTopMm: 1.0,
    paddingHorizMm: 1.5,
    paddingBottomMm: 0.8,
    barcodeBarWidthPx: 1.2,
    barcodeHeightMm: 13.0,
    barcodeFontPt: 6.8,
    brandFontPt: 7.8,
    nameFontPt: 8.5,
    priceFontPt: 9.5,
    skuFontPt: 6.8,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 4. 58 × 50 mm — Landscape */
  "58x50": {
    id: "58x50",
    name: "58 × 50 mm",
    shortLabel: "58×50mm",
    pageWidthMm: 58,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 58,
    labelHeightMm: 50,
    paddingTopMm: 1.2,
    paddingHorizMm: 1.8,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.2,
    barcodeHeightMm: 16.0,
    barcodeFontPt: 7.2,
    brandFontPt: 8.2,
    nameFontPt: 9.0,
    priceFontPt: 10.0,
    skuFontPt: 7.2,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 5. 80 × 50 mm — Landscape */
  "80x50": {
    id: "80x50",
    name: "80 × 50 mm",
    shortLabel: "80×50mm",
    pageWidthMm: 80,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 80,
    labelHeightMm: 50,
    paddingTopMm: 1.2,
    paddingHorizMm: 2.0,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.4,
    barcodeHeightMm: 16.5,
    barcodeFontPt: 7.8,
    brandFontPt: 9.0,
    nameFontPt: 10.0,
    priceFontPt: 11.0,
    skuFontPt: 7.8,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 6. 100 × 50 mm — Landscape */
  "100x50": {
    id: "100x50",
    name: "100 × 50 mm",
    shortLabel: "100×50mm",
    pageWidthMm: 100,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 100,
    labelHeightMm: 50,
    paddingTopMm: 1.2,
    paddingHorizMm: 2.2,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.5,
    barcodeHeightMm: 17.0,
    barcodeFontPt: 8.2,
    brandFontPt: 9.5,
    nameFontPt: 10.5,
    priceFontPt: 11.5,
    skuFontPt: 8.2,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 7. 108 × 50 mm — Landscape */
  "108x50": {
    id: "108x50",
    name: "108 × 50 mm",
    shortLabel: "108×50mm",
    pageWidthMm: 108,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 108,
    labelHeightMm: 50,
    paddingTopMm: 1.2,
    paddingHorizMm: 2.5,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.5,
    barcodeHeightMm: 17.5,
    barcodeFontPt: 8.5,
    brandFontPt: 10.0,
    nameFontPt: 11.0,
    priceFontPt: 12.0,
    skuFontPt: 8.5,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 8. 108 × 75 mm — Landscape */
  "108x75": {
    id: "108x75",
    name: "108 × 75 mm",
    shortLabel: "108×75mm",
    pageWidthMm: 108,
    pageHeightMm: 75,
    pageMarginMm: 0,
    labelWidthMm: 108,
    labelHeightMm: 75,
    paddingTopMm: 1.5,
    paddingHorizMm: 3.0,
    paddingBottomMm: 1.2,
    barcodeBarWidthPx: 1.6,
    barcodeHeightMm: 26.0,
    barcodeFontPt: 9.5,
    brandFontPt: 11.5,
    nameFontPt: 13.0,
    priceFontPt: 14.0,
    skuFontPt: 9.5,
    isThermalRoll: true,
    isSheet: false,
  },
  /** 9. A4 — 3 × 8 Grid (24 labels per sheet) */
  "a4-3x8": {
    id: "a4-3x8",
    name: "A4 — 3 × 8",
    shortLabel: "A4 3×8",
    pageWidthMm: 210,
    pageHeightMm: 297,
    pageMarginMm: 8,
    labelWidthMm: 64.0,
    labelHeightMm: 33.5,
    paddingTopMm: 0.8,
    paddingHorizMm: 1.5,
    paddingBottomMm: 0.6,
    gridColumns: 3,
    gridRows: 8,
    barcodeBarWidthPx: 1.1,
    barcodeHeightMm: 10.5,
    barcodeFontPt: 6.2,
    brandFontPt: 7.0,
    nameFontPt: 7.5,
    priceFontPt: 8.2,
    skuFontPt: 6.0,
    isThermalRoll: false,
    isSheet: true,
  },
  /** 10. A4 — 4 × 10 Grid (40 labels per sheet) */
  "a4-4x10": {
    id: "a4-4x10",
    name: "A4 — 4 × 10",
    shortLabel: "A4 4×10",
    pageWidthMm: 210,
    pageHeightMm: 297,
    pageMarginMm: 8,
    labelWidthMm: 48.5,
    labelHeightMm: 26.5,
    paddingTopMm: 0.6,
    paddingHorizMm: 1.2,
    paddingBottomMm: 0.5,
    gridColumns: 4,
    gridRows: 10,
    barcodeBarWidthPx: 1.0,
    barcodeHeightMm: 8.0,
    barcodeFontPt: 5.6,
    brandFontPt: 6.0,
    nameFontPt: 6.5,
    priceFontPt: 7.2,
    skuFontPt: 5.5,
    isThermalRoll: false,
    isSheet: true,
  },
  // Legacy aliases
  "thermal-58": {
    id: "50x25",
    name: "50 × 25 mm",
    shortLabel: "50×25mm",
    pageWidthMm: 50,
    pageHeightMm: 25,
    pageMarginMm: 0,
    labelWidthMm: 50,
    labelHeightMm: 25,
    paddingTopMm: 0.6,
    paddingHorizMm: 1.2,
    paddingBottomMm: 0.5,
    barcodeBarWidthPx: 1.1,
    barcodeHeightMm: 7.8,
    barcodeFontPt: 5.8,
    brandFontPt: 6.2,
    nameFontPt: 6.8,
    priceFontPt: 7.5,
    skuFontPt: 5.6,
    isThermalRoll: true,
    isSheet: false,
  },
  "thermal-108": {
    id: "108x50",
    name: "108 × 50 mm",
    shortLabel: "108×50mm",
    pageWidthMm: 108,
    pageHeightMm: 50,
    pageMarginMm: 0,
    labelWidthMm: 108,
    labelHeightMm: 50,
    paddingTopMm: 1.2,
    paddingHorizMm: 2.5,
    paddingBottomMm: 1.0,
    barcodeBarWidthPx: 1.5,
    barcodeHeightMm: 17.5,
    barcodeFontPt: 8.5,
    brandFontPt: 10.0,
    nameFontPt: 11.0,
    priceFontPt: 12.0,
    skuFontPt: 8.5,
    isThermalRoll: true,
    isSheet: false,
  },
  a4: {
    id: "a4-4x10",
    name: "A4 — 4 × 10",
    shortLabel: "A4 4×10",
    pageWidthMm: 210,
    pageHeightMm: 297,
    pageMarginMm: 8,
    labelWidthMm: 48.5,
    labelHeightMm: 26.5,
    paddingTopMm: 0.6,
    paddingHorizMm: 1.2,
    paddingBottomMm: 0.5,
    gridColumns: 4,
    gridRows: 10,
    barcodeBarWidthPx: 1.0,
    barcodeHeightMm: 8.0,
    barcodeFontPt: 5.6,
    brandFontPt: 6.0,
    nameFontPt: 6.5,
    priceFontPt: 7.2,
    skuFontPt: 5.5,
    isThermalRoll: false,
    isSheet: true,
  },
};

/**
 * Resolves a complete, deterministic PrintFormatConfig for any layout profile,
 * dynamically generating exact physical dimensions and scaled typography for custom sizes.
 */
export function resolvePrintFormatConfig(
  layout?: LabelPrinterProfile,
  customWidthMm?: number,
  customHeightMm?: number,
): PrintFormatConfig {
  const profileKey = layout || "50x25";

  if (profileKey === "custom") {
    const w = Math.max(20, Math.min(200, Math.round(customWidthMm || 60)));
    const h = Math.max(15, Math.min(200, Math.round(customHeightMm || 30)));

    return {
      id: "custom",
      name: `Custom (${w} × ${h} mm)`,
      shortLabel: `${w}×${h}mm`,
      pageWidthMm: w,
      pageHeightMm: h,
      pageMarginMm: 0,
      labelWidthMm: w,
      labelHeightMm: h,
      paddingTopMm: Math.max(0.5, Math.min(2.0, Number((h * 0.025).toFixed(1)))),
      paddingHorizMm: Math.max(1.0, Math.min(3.5, Number((w * 0.025).toFixed(1)))),
      paddingBottomMm: Math.max(0.4, Math.min(1.8, Number((h * 0.02).toFixed(1)))),
      barcodeBarWidthPx: Math.max(0.9, Math.min(1.8, Number((w * 0.018).toFixed(1)))),
      barcodeHeightMm: Math.max(6.0, Math.min(32.0, Number((h * 0.32).toFixed(1)))),
      barcodeFontPt: Math.max(5.0, Math.min(11.0, Number((h * 0.16).toFixed(1)))),
      brandFontPt: Math.max(5.5, Math.min(13.0, Number((h * 0.18).toFixed(1)))),
      nameFontPt: Math.max(6.0, Math.min(15.0, Number((h * 0.2).toFixed(1)))),
      priceFontPt: Math.max(6.5, Math.min(16.0, Number((h * 0.22).toFixed(1)))),
      skuFontPt: Math.max(5.0, Math.min(11.0, Number((h * 0.15).toFixed(1)))),
      isThermalRoll: true,
      isSheet: false,
    };
  }

  const existing = PRINT_FORMAT_CONFIG[profileKey];
  if (existing) return existing;

  // Fallback to standard 50x75 Portrait Default
  return PRINT_FORMAT_CONFIG["50x75"] || PRINT_FORMAT_CONFIG["50x25"];
}

/* ================================================================== */
/*  Persistent Printer Profile Helpers                                 */
/* ================================================================== */

export const DEFAULT_LABEL_PROFILE_KEY = "zerah_default_label_printer_profile";
export const LABEL_DISCOUNT_KEY = "zerah_label_show_discount";
export const LABEL_TYPE_KEY = "zerah_label_type";
export const LABEL_SHOW_MRP_KEY = "zerah_label_show_mrp";
export const LABEL_SHOW_SELL_PRICE_KEY = "zerah_label_show_sell_price";
export const LABEL_SEPARATE_PRICE_KEY = "zerah_label_separate_price";

let memoryProfile: LabelPrinterProfile = "50x75";
let memoryShowDiscount = false;
let memoryLabelType: LabelType = "full";
let memoryShowMrp = true;
let memoryShowSellPrice = true;
let memorySeparatePrice = true;
let memoryCustomWidthMm = 50;
let memoryCustomHeightMm = 75;

export const CUSTOM_LABEL_WIDTH_KEY = "zerah_custom_label_width_mm";
export const CUSTOM_LABEL_HEIGHT_KEY = "zerah_custom_label_height_mm";

export function getSavedCustomDimensions(): { widthMm: number; heightMm: number } {
  if (typeof window !== "undefined") {
    try {
      const w = parseFloat(localStorage.getItem(CUSTOM_LABEL_WIDTH_KEY) || "");
      const h = parseFloat(localStorage.getItem(CUSTOM_LABEL_HEIGHT_KEY) || "");
      return {
        widthMm: !isNaN(w) && w >= 20 && w <= 200 ? w : memoryCustomWidthMm,
        heightMm: !isNaN(h) && h >= 15 && h <= 200 ? h : memoryCustomHeightMm,
      };
    } catch {
      /* ignore */
    }
  }
  return { widthMm: memoryCustomWidthMm, heightMm: memoryCustomHeightMm };
}

export function setSavedCustomDimensions(widthMm: number, heightMm: number): void {
  const safeW = Math.max(20, Math.min(200, Math.round(widthMm)));
  const safeH = Math.max(15, Math.min(200, Math.round(heightMm)));
  memoryCustomWidthMm = safeW;
  memoryCustomHeightMm = safeH;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CUSTOM_LABEL_WIDTH_KEY, String(safeW));
      localStorage.setItem(CUSTOM_LABEL_HEIGHT_KEY, String(safeH));
    } catch {
      /* ignore */
    }
  }
}

export function getSavedLabelProfile(): LabelPrinterProfile {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(DEFAULT_LABEL_PROFILE_KEY) as LabelPrinterProfile | null;
      if (saved) {
        if (saved === "thermal-58" || saved === "50x25") return "50x75"; // migrate default to portrait
        if (saved === "thermal-108") return "108x75";
        if (saved === "a4") return "a4-4x10";
        if (LABEL_SIZE_OPTIONS.some((o) => o.id === saved)) return saved;
      }
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
  return true;
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
  return true;
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
  artNo?: string;
  barcode?: string | null;
  price: number;
  mrp?: number;
  stock?: number;
  brand?: string;
  size?: string | null;
  ageGroup?: string | null;
  variants?: Array<{
    id?: string;
    name?: string;
    sku?: string;
    barcode?: string | null;
    size?: string | null;
    priceOverride?: number;
    mrpOverride?: number;
    stock?: number;
  }>;
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
      margin: 1,
      marginTop: 0,
      marginBottom: 0,
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
    svg.setAttribute("height", `${cfg.heightMm + cfg.fontPt * 0.35 + 0.5}mm`);
    svg.setAttribute(
      "style",
      "display:block;margin:0 auto;shape-rendering:crispEdges;overflow:visible;max-width:100%;",
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
    return {
      valid: false,
      error: "Please select at least 1 product to print labels.",
      totalLabels: 0,
    };
  }

  let totalLabels = 0;
  for (const p of rawProducts) {
    const check = validatePrintableProduct(p);
    if (!check.valid) {
      return {
        valid: false,
        error: check.error || `Invalid data for product: ${p.name || "Unknown"}`,
        totalLabels: 0,
      };
    }
    const key = getProductKey(p);
    const qty = params.quantities?.[key] !== undefined ? params.quantities[key] : 1;
    if (qty > 0) {
      totalLabels += qty;
    }
  }

  if (totalLabels === 0) {
    return {
      valid: false,
      error: "Total label quantity to print must be at least 1.",
      totalLabels: 0,
    };
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
  customWidthMm?: number;
  customHeightMm?: number;
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
    layout = "50x25",
    customWidthMm,
    customHeightMm,
    labelType = "full",
    showDiscount = false,
    showMrp = true,
    showSellPrice = true,
    separatePriceLine = true,
    isStandaloneTab = false,
  } = params;

  const cfg = resolvePrintFormatConfig(layout, customWidthMm, customHeightMm);
  const rawProducts = Array.isArray(products) ? products : [products];

  // Isolated print mode class
  const modeClass = cfg.isSheet ? "print-mode-sheet" : "print-mode-thermal";

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
    const mrpFormatted = "₹" + Math.round(effectiveMrp);
    const priceFormatted = "₹" + Math.round(p.price);
    const skuValue = (p.sku || p.artNo || p.barcode || "—").toString().trim();
    const productName = (p.name || "").toString().trim();

    const barcodeSvg = generateBarcodeSvgString(barcodeValue, {
      barWidthPx: cfg.barcodeBarWidthPx,
      heightMm: labelType === "barcode-only" ? Math.max(16, cfg.barcodeHeightMm * 1.5) : cfg.barcodeHeightMm,
      fontPt: cfg.barcodeFontPt,
      displayValue: true,
      maxWidthMm: cfg.labelWidthMm - cfg.paddingHorizMm * 2,
    });

    if (labelType === "barcode-only") {
      return [
        `<div class="lbl-v-stack lbl-barcode-only">`,
        `  <div class="lbl-brand-header">ZÉRAH BABY &amp; KIDS</div>`,
        `  <div class="lbl-bc-section">`,
        `    <div class="lbl-bc-box">${barcodeSvg}</div>`,
        `  </div>`,
        `  <div class="lbl-sku-line">SKU: ${escapeHtml(skuValue)}</div>`,
        `</div>`,
      ].join("");
    }

    const hasMrpDiff = effectiveMrp > p.price && p.price > 0;

    return [
      `<div class="lbl-v-stack">`,
      `  <div class="lbl-brand-header">ZÉRAH BABY &amp; KIDS</div>`,
      `  <div class="lbl-product-name">${escapeHtml(productName)}</div>`,
      `  <div class="lbl-price-row">`,
      `    <span class="lbl-selling-price">${priceFormatted}</span>`,
      hasMrpDiff ? `    <span class="lbl-mrp-price">${mrpFormatted}</span>` : "",
      `  </div>`,
      `  <div class="lbl-bc-section">`,
      `    <div class="lbl-bc-box">${barcodeSvg}</div>`,
      `  </div>`,
      `  <div class="lbl-sku-line">SKU: ${escapeHtml(skuValue)}</div>`,
      `</div>`,
    ].join("");
  };

  // ── 3. Build HTML Structure ───────────────────────────────────────
  let pagesHtml = "";

  if (cfg.isSheet) {
    // A4 grid sheet layout with multi-sheet pagination
    const cols = cfg.gridColumns || 3;
    const rows = cfg.gridRows || 8;
    const labelsPerSheet = cols * rows;
    const sheets: PrintableProduct[][] = [];
    for (let i = 0; i < labels.length; i += labelsPerSheet) {
      sheets.push(labels.slice(i, i + labelsPerSheet));
    }

    if (isStandaloneTab) {
      pagesHtml = sheets
        .map(
          (sheetLabels, sIdx) => `
        <div class="a4-sheet-wrapper" data-sheet-index="${sIdx + 1}">
          <div class="sticker-dim-badge no-print">A4 Sheet #${sIdx + 1} (${cols} × ${rows} Grid • ${sheetLabels.length} Label${sheetLabels.length !== 1 ? "s" : ""})</div>
          <div class="a4-sheet sheet-card">
            ${sheetLabels
              .map(
                (p, idx) => `
              <div class="label-cell" data-label-index="${sIdx * labelsPerSheet + idx + 1}">
                <div class="label-inner">${renderLabelContent(p)}</div>
              </div>`,
              )
              .join("\n")}
          </div>
        </div>`,
        )
        .join("\n");
    } else {
      pagesHtml = sheets
        .map(
          (sheetLabels, sIdx) => `
        <div class="a4-sheet" data-sheet-index="${sIdx + 1}">
          ${sheetLabels
            .map(
              (p, idx) => `
            <div class="label-cell" data-label-index="${sIdx * labelsPerSheet + idx + 1}">
              <div class="label-inner">${renderLabelContent(p)}</div>
            </div>`,
            )
            .join("\n")}
        </div>`,
        )
        .join("\n");
    }
  } else {
    // Thermal Roll: 1 label = exactly 1 physical sticker
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
  }

  // ── 4. Build Exact Physical CSS ───────────────────────────────────
  const pageSizeDecl = cfg.isSheet
    ? "A4 portrait"
    : `${cfg.pageWidthMm}mm ${cfg.pageHeightMm}mm`;
  const pageMarginDecl = cfg.isSheet ? `${cfg.pageMarginMm}mm 6mm` : "0";

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

    /* ── Label Container & Typography ── */
    .label-page {
      width: ${cfg.pageWidthMm}mm;
      height: ${cfg.pageHeightMm}mm;
      max-height: ${cfg.pageHeightMm}mm;
      box-sizing: border-box;
      background: #ffffff;
      overflow: hidden;
      margin: 0 auto;
      page-break-after: always;
      break-after: page;
    }

    .label-page:last-child {
      page-break-after: avoid;
      break-after: avoid;
    }

    .label-inner {
      width: 100%;
      height: ${cfg.pageHeightMm}mm;
      max-height: ${cfg.pageHeightMm}mm;
      box-sizing: border-box;
      padding: ${cfg.paddingTopMm}mm ${cfg.paddingHorizMm}mm ${cfg.paddingBottomMm}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      text-align: center;
      font-family: Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }

    .lbl-v-stack {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      overflow: hidden;
    }

    .lbl-brand-header {
      font-size: ${cfg.brandFontPt}pt;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 0.6mm;
      text-align: center;
      line-height: 1.1;
    }

    .lbl-product-name {
      font-size: ${cfg.nameFontPt}pt;
      font-weight: 700;
      color: #000000;
      line-height: 1.2;
      text-align: center;
      word-break: break-word;
      overflow-wrap: break-word;
      margin-bottom: 0.6mm;
      padding: 0 0.5mm;
    }

    .lbl-price-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2mm;
      margin-bottom: 0.6mm;
      line-height: 1.1;
    }

    .lbl-selling-price {
      font-size: ${cfg.priceFontPt}pt;
      font-weight: 900;
      color: #000000;
    }

    .lbl-mrp-price {
      font-size: ${Math.max(6, cfg.priceFontPt * 0.72)}pt;
      color: #64748b;
      text-decoration: line-through;
      font-weight: 600;
    }

    .lbl-bc-section {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-top: 0.4mm;
    }

    .lbl-bc-box {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: visible;
    }

    .lbl-bc-box svg {
      display: block;
      margin: 0 auto;
      max-width: 95%;
      height: auto;
      max-height: ${cfg.barcodeHeightMm + 4}mm;
      shape-rendering: crispEdges;
    }

    .lbl-sku-line {
      font-size: ${cfg.skuFontPt}pt;
      font-weight: 600;
      color: #64748b;
      margin-top: 0.6mm;
      text-align: center;
      line-height: 1.1;
    }

    .a4-sheet {
      width: 198mm;
      height: 281mm;
      max-height: 281mm;
      display: grid;
      grid-template-columns: repeat(${cfg.gridColumns || 3}, 1fr);
      grid-template-rows: repeat(${cfg.gridRows || 8}, 1fr);
      gap: 1.5mm;
      box-sizing: border-box;
      background: #ffffff;
      overflow: hidden;
      margin: 0 auto;
    }

    .label-cell {
      height: 100%;
      max-height: 100%;
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

      .sticker-preview-wrapper,
      .a4-sheet-wrapper {
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

      .sticker-card,
      .sheet-card {
        border-radius: 3px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
        position: relative;
      }
    }

    /* ── Strict Physical Print Styling (@media print) ── */
    @media print {
      @page {
        size: portrait;
        size: ${pageSizeDecl};
        margin: ${pageMarginDecl};
      }

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
        margin: 0 auto !important;
        display: block !important;
        background: transparent !important;
        width: auto !important;
      }

      .sticker-preview-wrapper,
      .a4-sheet-wrapper {
        display: contents !important;
      }

      .sticker-card,
      .sheet-card {
        box-shadow: none !important;
        border-radius: 0 !important;
      }

      /* ── Thermal Roll Page Breaks & Physical Sizing ── */
      .label-page {
        width: ${cfg.pageWidthMm}mm !important;
        min-height: ${cfg.pageHeightMm}mm !important;
        page-break-after: always !important;
        break-after: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        overflow: hidden !important;
        margin: 0 auto !important;
        padding: 0 !important;
      }

      /* Suppress trailing page break on final label to prevent extra blank stickers */
      .label-page:last-child,
      .sticker-preview-wrapper:last-child .label-page {
        page-break-after: auto !important;
        break-after: auto !important;
      }

      /* ── A4 Sheet Page Breaks ── */
      .a4-sheet {
        page-break-after: always !important;
        break-after: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        overflow: hidden !important;
        margin: 0 auto !important;
        box-shadow: none !important;
      }

      .a4-sheet:last-child,
      .a4-sheet-wrapper:last-child .a4-sheet {
        page-break-after: auto !important;
        break-after: auto !important;
      }

      .label-cell {
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
        <span class="toolbar-badge">${cfg.name}</span>
      </div>
      <div class="toolbar-hint">
        ${labels.length} label${labels.length !== 1 ? "s" : ""} ready • Paper Size: ${cfg.name}, Margins: None
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
  <title>Zerah Labels – ${cfg.name} (${labels.length})</title>
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
  customWidthMm?: number;
  customHeightMm?: number;
  labelType?: LabelType;
  showDiscount?: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
}): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const rawProducts = Array.isArray(params.products) ? params.products : [params.products];
    const preflight = validatePrintPreflight({
      products: rawProducts,
      quantities: params.quantities,
    });
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
      layout: params.layout || getSavedLabelProfile(),
      customWidthMm: params.customWidthMm,
      customHeightMm: params.customHeightMm,
      labelType: params.labelType || "full",
      showDiscount: params.showDiscount ?? false,
      showMrp: params.showMrp ?? true,
      showSellPrice: params.showSellPrice ?? getSavedShowSellPrice(),
      separatePriceLine: params.separatePriceLine ?? getSavedSeparatePrice(),
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
  customWidthMm?: number;
  customHeightMm?: number;
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
  const preflight = validatePrintPreflight({
    products: rawProducts,
    quantities: params.quantities,
  });
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
    layout: params.layout || getSavedLabelProfile(),
    customWidthMm: params.customWidthMm,
    customHeightMm: params.customHeightMm,
    labelType: params.labelType || "full",
    showDiscount: params.showDiscount ?? false,
    showMrp: params.showMrp ?? true,
    showSellPrice: params.showSellPrice ?? getSavedShowSellPrice(),
    separatePriceLine: params.separatePriceLine ?? getSavedSeparatePrice(),
    isStandaloneTab: false,
  });

  const iframeId = "zerah-canonical-label-print-frame";
  let iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
  if (iframe) {
    try {
      iframe.remove();
    } catch (e) {
      console.error(e);
    }
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
    } catch (e) {
      console.error(e);
    }
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
          console.warn(
            "[ZerahPrint] No label elements detected in print iframe, falling back to new tab",
          );
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
    customWidthMm?: number;
    customHeightMm?: number;
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
    customWidthMm: options?.customWidthMm,
    customHeightMm: options?.customHeightMm,
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
        customWidthMm?: number;
        customHeightMm?: number;
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
        customWidthMm: options?.customWidthMm,
        customHeightMm: options?.customHeightMm,
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
