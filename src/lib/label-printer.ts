/**
 * One-Click Direct Product Label Printer Engine & Standalone Print Bridge
 *
 * Specifically engineered for Zérah Baby & Kids Thermal Barcode Label Printers:
 * - 2-Up Sticker Roll (100mm width × 25mm height, 2 stickers per row) [Default for HPRT HT300 / 108mm]
 * - 1-Up Single Sticker Roll (50mm width × 25mm height) [thermal-58]
 * - A4 Grid (4 columns × 10 rows on A4 paper) [a4]
 * - 100% Isolated iframe-based printing: immune to screen styles, background modals, and toasts
 * - Code 128 SVG Barcode rendering with quiet zones and human-readable text
 * - Dynamic MRP / Discount badge calculations
 */
import { useState, useCallback } from "react";
import { toast } from "sonner";
import JsBarcode from "jsbarcode";
import type { Product } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { buildTSPLLabel, sendTSPLViaQZTray } from "@/lib/print-settings";

export type LabelPrinterProfile = "thermal-108" | "a4" | "thermal-58";
export type LabelType = "barcode-only" | "full";

export const DEFAULT_LABEL_PROFILE_KEY = "zerah_default_label_printer_profile";
export const LABEL_DISCOUNT_KEY = "zerah_label_show_discount";
export const LABEL_TYPE_KEY = "zerah_label_type";

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

/* ------------------------------------------------------------------ */
/*  Persistent Printer Profile Helpers                                */
/* ------------------------------------------------------------------ */

let memoryProfile: LabelPrinterProfile = "thermal-108";
let memoryShowDiscount = false;
let memoryLabelType: LabelType = "full";

export function getSavedLabelProfile(): LabelPrinterProfile {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(DEFAULT_LABEL_PROFILE_KEY);
      if (saved === "a4" || saved === "thermal-58" || saved === "thermal-108") {
        return saved;
      }
    } catch {
      // Ignore storage access errors
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
      // Ignore storage access errors
    }
  }
}

export function getSavedShowDiscount(): boolean {
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem(LABEL_DISCOUNT_KEY) === "true";
    } catch {
      // Ignore storage access errors
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
      // Ignore storage access errors
    }
  }
}

export function getSavedLabelType(): LabelType {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LABEL_TYPE_KEY);
      if (saved === "barcode-only" || saved === "full") return saved;
    } catch {
      // Ignore storage access errors
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
      // Ignore storage access errors
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Product & Barcode Validation                                      */
/* ------------------------------------------------------------------ */

export function validatePrintableProduct(product: PrintableProduct): {
  valid: boolean;
  error?: string;
} {
  if (!product) {
    return { valid: false, error: "Invalid product data" };
  }
  if (!product.name || !product.name.trim()) {
    return { valid: false, error: "Product name is required to print label." };
  }
  const barcodeValue = (product.barcode || product.sku || "").trim();
  if (!barcodeValue) {
    return {
      valid: false,
      error: `Product "${product.name}" does not have a barcode or SKU.`,
    };
  }
  if (product.price === undefined || product.price === null || isNaN(Number(product.price))) {
    return {
      valid: false,
      error: `Product "${product.name}" has an invalid selling price.`,
    };
  }
  return { valid: true };
}

/* ------------------------------------------------------------------ */
/*  Barcode SVG Generator (Client-Side)                               */
/* ------------------------------------------------------------------ */

export function generateBarcodeSvgString(
  text: string,
  options?: { width?: number; height?: number; fontSize?: number; displayValue?: boolean },
): string {
  if (typeof document === "undefined") return "";
  const safeText = (text || "").trim() || "000000";
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, safeText, {
      format: "CODE128",
      width: options?.width ?? 0.85,
      height: options?.height ?? 16,
      fontSize: options?.fontSize ?? 7,
      margin: 1,
      displayValue: options?.displayValue ?? true,
      font: "ui-monospace, monospace, sans-serif",
      fontOptions: "bold",
      textMargin: 1,
      background: "transparent",
      lineColor: "#000000",
    });
    return svg.outerHTML;
  } catch (err) {
    console.error("Barcode SVG generation failed:", err);
    return `<div style="font-family:monospace;font-size:8px;font-weight:bold;letter-spacing:1px;text-align:center;">${escapeHtml(safeText)}</div>`;
  }
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ------------------------------------------------------------------ */
/*  HTML Print Document Builder with Physical Millimeter Geometry     */
/* ------------------------------------------------------------------ */

export function buildLabelPrintHtml(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  widthMm?: number;
  heightMm?: number;
}): string {
  const { products, quantities, layout, labelType, showDiscount } = params;

  // Flatten products by quantity
  const expandedProducts: PrintableProduct[] = [];
  for (const p of products) {
    const key = p.uuid || p.id || p.sku || p.name;
    const qty = Math.max(0, Math.min(500, quantities[key] ?? 1));
    for (let i = 0; i < qty; i++) {
      expandedProducts.push(p);
    }
  }

  if (expandedProducts.length === 0) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;text-align:center;">No labels to print.</body></html>`;
  }

  const is58 = layout === "thermal-58";
  const is108 = layout === "thermal-108";
  const isA4 = layout === "a4";

  let pageStyle = "";
  let bodyStyle = "";

  if (is108) {
    // 2-Up thermal stickers: 100mm total width × 25mm height (2 stickers of 48×24mm side-by-side)
    pageStyle = `@page { size: 100mm 25mm; margin: 0; }`;
    bodyStyle = `width: 100mm; margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  } else if (is58) {
    // 1-Up single sticker: 50mm width × 25mm height
    pageStyle = `@page { size: 50mm 25mm; margin: 0; }`;
    bodyStyle = `width: 50mm; margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  } else {
    // A4 grid
    pageStyle = `@page { size: A4 portrait; margin: 8mm 6mm; }`;
    bodyStyle = `margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  }

  const renderSingleSticker = (p: PrintableProduct) => {
    const rawBarcode = p.barcode || p.sku || "NO-BARCODE";
    const hasMrp = p.mrp && p.mrp > p.price;
    const discPct =
      showDiscount && hasMrp ? Math.round(((p.mrp! - p.price) / p.mrp!) * 100) : null;

    if (labelType === "barcode-only") {
      const bcSvg = generateBarcodeSvgString(rawBarcode, {
        width: 0.88,
        height: 18,
        fontSize: 7,
        displayValue: true,
      });

      return `
        <div class="brand">ZÉRAH BABY &amp; KIDS</div>
        <div class="prod-name truncate">${escapeHtml(p.name)}</div>
        <div class="barcode-container">${bcSvg}</div>
        <div class="sku">SKU: ${escapeHtml(p.sku || "—")}</div>
      `;
    }

    // Full label
    const bcSvg = generateBarcodeSvgString(rawBarcode, {
      width: 0.85,
      height: 15,
      fontSize: 6.5,
      displayValue: true,
    });

    return `
      <div class="brand">ZÉRAH BABY &amp; KIDS</div>
      <div class="prod-name truncate">${escapeHtml(p.name)}</div>
      <div class="meta-row">
        <span class="sku">SKU: ${escapeHtml(p.sku || "—")}</span>
        <span class="price">₹${p.price.toLocaleString("en-IN")}</span>
        ${hasMrp ? `<span class="mrp">₹${p.mrp!.toLocaleString("en-IN")}</span>` : ""}
        ${discPct ? `<span class="disc">-${discPct}%</span>` : ""}
      </div>
      <div class="barcode-container">${bcSvg}</div>
    `;
  };

  let labelsHtml = "";

  if (is108) {
    // Group into rows of 2 (2-Up format)
    const rows: Array<[PrintableProduct, PrintableProduct | null]> = [];
    for (let i = 0; i < expandedProducts.length; i += 2) {
      rows.push([expandedProducts[i], expandedProducts[i + 1] || null]);
    }

    labelsHtml = rows
      .map(
        ([left, right]) => `
      <div class="thermal-2up-page">
        <div class="sticker-cell">
          ${renderSingleSticker(left)}
        </div>
        <div class="sticker-cell ${right ? "" : "empty"}">
          ${right ? renderSingleSticker(right) : ""}
        </div>
      </div>
    `,
      )
      .join("");
  } else if (is58) {
    // 1-Up single label
    labelsHtml = expandedProducts
      .map(
        (p) => `
      <div class="thermal-1up-page">
        <div class="sticker-cell">
          ${renderSingleSticker(p)}
        </div>
      </div>
    `,
      )
      .join("");
  } else {
    // A4 grid (4 columns)
    labelsHtml = `
      <div class="a4-grid">
        ${expandedProducts
          .map(
            (p) => `
          <div class="a4-label-cell">
            ${renderSingleSticker(p)}
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Zerah Product Labels</title>
  <style>
    ${pageStyle}

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      ${bodyStyle}
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    /* ─── 2-UP THERMAL (100mm × 25mm row, 2 stickers side-by-side) ─── */
    .thermal-2up-page {
      width: 100mm;
      height: 25mm;
      max-height: 25mm;
      min-height: 25mm;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      overflow: hidden;
      background: #ffffff;
      padding: 0 1mm;
    }

    .thermal-2up-page .sticker-cell {
      width: 48mm;
      height: 24mm;
      max-height: 24mm;
      min-height: 24mm;
      padding: 1.2mm 2mm 0.8mm 2mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      overflow: hidden;
      background: #ffffff;
    }

    .thermal-2up-page .sticker-cell.empty {
      visibility: hidden;
    }

    /* ─── 1-UP THERMAL (50mm × 25mm) ─── */
    .thermal-1up-page {
      width: 50mm;
      height: 25mm;
      max-height: 25mm;
      min-height: 25mm;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      background: #ffffff;
    }

    .thermal-1up-page .sticker-cell {
      width: 48mm;
      height: 24mm;
      max-height: 24mm;
      min-height: 24mm;
      padding: 1.2mm 2mm 0.8mm 2mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      overflow: hidden;
      background: #ffffff;
    }

    /* Shared Typography for Thermal Stickers */
    .brand {
      font-size: 5.5pt;
      font-weight: 800;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      line-height: 1;
      color: #333333;
    }

    .prod-name {
      font-size: 6.8pt;
      font-weight: 700;
      line-height: 1.05;
      color: #000000;
      max-width: 44mm;
      margin-top: 0.2mm;
    }

    .meta-row {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 1.5mm;
      font-size: 6pt;
      line-height: 1;
      margin-top: 0.3mm;
      flex-wrap: nowrap;
    }

    .sku {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 5pt;
      color: #555555;
    }

    .price {
      font-size: 7.5pt;
      font-weight: 900;
      color: #000000;
    }

    .mrp {
      font-size: 5pt;
      text-decoration: line-through;
      color: #777777;
    }

    .disc {
      font-size: 5pt;
      font-weight: 800;
      color: #000000;
    }

    .barcode-container {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      margin-top: 0.2mm;
    }

    .barcode-container svg {
      max-width: 44mm;
      display: block;
    }

    /* ─── A4 GRID (4 COLUMNS) ─── */
    .a4-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-auto-rows: 26.5mm;
      gap: 1.5mm;
      width: 100%;
    }

    .a4-label-cell {
      width: 100%;
      height: 26.5mm;
      max-height: 26.5mm;
      min-height: 26.5mm;
      padding: 1.2mm 1.5mm;
      border: 1px dashed #bbbbbb;
      border-radius: 1.5mm;
      page-break-inside: avoid;
      break-inside: avoid;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      text-align: center;
      overflow: hidden;
      background: #ffffff;
    }
  </style>
</head>
<body>
  ${labelsHtml}
</body>
</html>
  `.trim();
}

/* ------------------------------------------------------------------ */
/*  100% Isolated Hidden Iframe Print Runner                          */
/* ------------------------------------------------------------------ */

export function printLabelsViaIframe(params: {
  products: PrintableProduct[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
  widthMm?: number;
  heightMm?: number;
  onDone?: () => void;
}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  try {
    // Dismiss active toast notifications
    toast.dismiss();

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "0px";
    iframe.style.height = "0px";
    iframe.style.border = "0px";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const html = buildLabelPrintHtml(params);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const triggerPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Iframe print invocation error:", err);
        window.print();
      } finally {
        params.onDone?.();
        setTimeout(() => {
          try {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
            }
          } catch {
            // ignore
          }
        }, 3000);
      }
    };

    // Small timeout for browser layout computation
    setTimeout(triggerPrint, 250);
  } catch (err) {
    console.error("Print via iframe failed, falling back to window.print:", err);
    window.print();
    params.onDone?.();
  }
}

/* ------------------------------------------------------------------ */
/*  Direct Print Event Emitter (Singleton for Instant 1-Click Print)  */
/* ------------------------------------------------------------------ */

type PrintEventListener = (payload: DirectPrintPayload | null) => void;
const listeners = new Set<PrintEventListener>();

export function subscribeToDirectPrint(listener: PrintEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let isDirectPrintingLock = false;

/**
 * Trigger an instant 1-click product label print job.
 */
export async function triggerDirectLabelPrint(
  target: Product | PrintableProduct | Array<Product | PrintableProduct>,
  options?: {
    quantity?: number;
    quantities?: Record<string, number>;
    layout?: LabelPrinterProfile;
    labelType?: LabelType;
    showDiscount?: boolean;
  },
): Promise<boolean> {
  if (isDirectPrintingLock) {
    return false;
  }

  const rawProducts = Array.isArray(target) ? target : [target];
  if (rawProducts.length === 0) {
    toast.error("No products selected to print.");
    return false;
  }

  // Validate each product
  for (const p of rawProducts) {
    const check = validatePrintableProduct(p);
    if (!check.valid) {
      toast.error(check.error || "Cannot print label: invalid product");
      return false;
    }
  }

  // Determine quantities
  const quantities: Record<string, number> = options?.quantities ?? {};
  if (options?.quantity && options.quantity > 0) {
    for (const p of rawProducts) {
      const id = p.uuid || p.id || p.sku || p.name;
      if (!quantities[id]) {
        quantities[id] = options.quantity;
      }
    }
  } else {
    for (const p of rawProducts) {
      const id = p.uuid || p.id || p.sku || p.name;
      if (!quantities[id]) {
        quantities[id] = 1;
      }
    }
  }

  const layout = options?.layout || getSavedLabelProfile();
  const labelType = options?.labelType || getSavedLabelType();
  const showDiscount = options?.showDiscount ?? getSavedShowDiscount();

  isDirectPrintingLock = true;

  // If QZ Tray is available and connected, attempt direct TSPL
  if (layout !== "a4") {
    try {
      const qzResult = await printThermalLabelsDirectly({
        products: rawProducts,
        quantities,
        layout,
        labelType,
        showDiscount,
      });
      if (qzResult.success) {
        toast.success("Printed to thermal printer directly!");
        isDirectPrintingLock = false;
        return true;
      }
    } catch {
      // Fall back to clean browser iframe print
    }
  }

  // Pure isolated browser print
  printLabelsViaIframe({
    products: rawProducts,
    quantities,
    layout,
    labelType,
    showDiscount,
    onDone: () => {
      setTimeout(() => {
        isDirectPrintingLock = false;
      }, 1000);
    },
  });

  return true;
}

/**
 * Directly print thermal labels via QZ Tray (TSPL commands for HPRT HT300 / TSC / Zebra).
 */
export async function printThermalLabelsDirectly(params: {
  products: (Product | PrintableProduct)[];
  quantities: Record<string, number>;
  layout: LabelPrinterProfile;
  labelType: LabelType;
  showDiscount: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["print_thermal_printer_name"]);

    const printerName =
      data?.find((d) => d.key === "print_thermal_printer_name")?.value || "HPRT HT300";

    const is58 = params.layout === "thermal-58";
    const widthMm = is58 ? 50 : 100;
    const heightMm = 25;

    let allTspl = "";

    for (const product of params.products) {
      const key = product.uuid || product.id || product.sku || product.name;
      const copies = params.quantities[key] || 1;
      if (copies <= 0) continue;

      const tspl = buildTSPLLabel({
        productName: product.name,
        sku: product.sku || "",
        barcode: product.barcode || product.sku || "NO-BARCODE",
        price: product.price,
        mrp: product.mrp,
        widthMm,
        heightMm,
        copies,
      });

      allTspl += tspl + "\n";
    }

    if (!allTspl) return { success: true };

    const result = await sendTSPLViaQZTray(printerName, allTspl);
    if (!result.success) {
      return { success: false, error: result.error || "QZ Tray failed" };
    }
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}

/**
 * React Hook for components initiating direct label printing
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
      },
    ) => {
      setIsPrinting(true);
      triggerDirectLabelPrint(target, options).finally(() => {
        setTimeout(() => setIsPrinting(false), 1200);
      });
      return true;
    },
    [],
  );

  return { printLabel, isPrinting };
}
