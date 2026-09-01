/**
 * One-Click Direct Product Label Printer Engine & Standalone Print Bridge
 *
 * Supports:
 * - Persistent printer format profile (A4_GRID, THERMAL_108MM, THERMAL_58MM)
 * - 100% Isolated iframe-based printing: immune to screen styles, background modals, and toasts
 * - Strict physical millimeter geometry (50×25mm for 58mm, 100×50mm for 108mm, A4 Grid)
 * - Code 128 SVG Barcode rendering with quiet zones and human-readable text
 * - Dynamic MRP / Discount badge calculations
 * - Debounced duplicate-click prevention
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
      width: options?.width ?? 1.1,
      height: options?.height ?? 24,
      fontSize: options?.fontSize ?? 8,
      margin: 1,
      displayValue: options?.displayValue ?? true,
      font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontOptions: "bold",
      textMargin: 1,
      background: "transparent",
      lineColor: "#000000",
    });
    return svg.outerHTML;
  } catch (err) {
    console.error("Barcode SVG generation failed:", err);
    return `<div style="font-family:monospace;font-size:9px;font-weight:bold;letter-spacing:1px;text-align:center;">${escapeHtml(safeText)}</div>`;
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

  // Exact physical dimensions
  const labelWidth = params.widthMm || (is58 ? 50 : is108 ? 100 : 48);
  const labelHeight = params.heightMm || (is58 ? 25 : is108 ? 50 : 26.5);

  let pageStyle = "";
  let bodyStyle = "";

  if (is58) {
    pageStyle = `@page { size: ${labelWidth}mm ${labelHeight}mm; margin: 0; }`;
    bodyStyle = `width: ${labelWidth}mm; margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  } else if (is108) {
    pageStyle = `@page { size: ${labelWidth}mm ${labelHeight}mm; margin: 0; }`;
    bodyStyle = `width: ${labelWidth}mm; margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  } else {
    pageStyle = `@page { size: A4 portrait; margin: 8mm 6mm; }`;
    bodyStyle = `margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;`;
  }

  const renderSingleLabelContent = (p: PrintableProduct) => {
    const rawBarcode = p.barcode || p.sku || "NO-BARCODE";
    const hasMrp = p.mrp && p.mrp > p.price;
    const discPct =
      showDiscount && hasMrp ? Math.round(((p.mrp! - p.price) / p.mrp!) * 100) : null;

    if (labelType === "barcode-only") {
      const bcSvg = generateBarcodeSvgString(rawBarcode, {
        width: is58 ? 0.95 : is108 ? 1.4 : 1.0,
        height: is58 ? 18 : is108 ? 32 : 20,
        fontSize: is58 ? 7.5 : is108 ? 9 : 8,
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
      width: is58 ? 0.9 : is108 ? 1.4 : 0.95,
      height: is58 ? 16 : is108 ? 30 : 18,
      fontSize: is58 ? 7 : is108 ? 9 : 7.5,
      displayValue: true,
    });

    return `
      <div class="brand">ZÉRAH BABY &amp; KIDS</div>
      <div class="prod-name clamp-2">${escapeHtml(p.name)}</div>
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

  if (isA4) {
    labelsHtml = `
      <div class="a4-grid">
        ${expandedProducts
          .map(
            (p) => `
          <div class="a4-label-cell">
            ${renderSingleLabelContent(p)}
          </div>
        `,
          )
          .join("")}
      </div>
    `;
  } else {
    labelsHtml = expandedProducts
      .map(
        (p) => `
        <div class="thermal-label-page">
          ${renderSingleLabelContent(p)}
        </div>
      `,
      )
      .join("");
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

    .clamp-2 {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      width: 100%;
    }

    /* ─── THERMAL 58MM / 50x25MM ─── */
    .thermal-label-page {
      width: ${labelWidth}mm;
      height: ${labelHeight}mm;
      max-height: ${labelHeight}mm;
      min-height: ${labelHeight}mm;
      padding: ${is58 ? "1.2mm 2mm 0.8mm 2mm" : "2.5mm 3.5mm 1.5mm 3.5mm"};
      page-break-after: always;
      break-after: page;
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

    .thermal-label-page .brand {
      font-size: ${is58 ? "6pt" : "8pt"};
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      line-height: 1;
      color: #333333;
    }

    .thermal-label-page .prod-name {
      font-size: ${is58 ? "7pt" : "9.5pt"};
      font-weight: 700;
      line-height: 1.1;
      color: #000000;
      margin-top: 0.3mm;
    }

    .thermal-label-page .meta-row {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: ${is58 ? "1.5mm" : "3mm"};
      font-size: ${is58 ? "6.5pt" : "8.5pt"};
      line-height: 1;
      margin-top: 0.4mm;
      flex-wrap: nowrap;
    }

    .thermal-label-page .sku {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: ${is58 ? "5.5pt" : "7pt"};
      color: #555555;
    }

    .thermal-label-page .price {
      font-size: ${is58 ? "7.5pt" : "10.5pt"};
      font-weight: 900;
      color: #000000;
    }

    .thermal-label-page .mrp {
      font-size: ${is58 ? "5.5pt" : "7pt"};
      text-decoration: line-through;
      color: #777777;
    }

    .thermal-label-page .disc {
      font-size: ${is58 ? "5.5pt" : "7pt"};
      font-weight: 800;
      color: #000000;
    }

    .thermal-label-page .barcode-container {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
      margin-top: 0.2mm;
    }

    .thermal-label-page .barcode-container svg {
      max-width: 100%;
      display: block;
    }

    /* ─── A4 GRID (4 COLUMNS) ─── */
    .a4-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-auto-rows: ${labelHeight}mm;
      gap: 1.5mm;
      width: 100%;
    }

    .a4-label-cell {
      width: 100%;
      height: ${labelHeight}mm;
      max-height: ${labelHeight}mm;
      min-height: ${labelHeight}mm;
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

    .a4-label-cell .brand {
      font-size: 5.5pt;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #444444;
      line-height: 1;
    }

    .a4-label-cell .prod-name {
      font-size: 6.5pt;
      font-weight: 700;
      line-height: 1.1;
      color: #000000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }

    .a4-label-cell .meta-row {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 1mm;
      font-size: 6pt;
      line-height: 1;
    }

    .a4-label-cell .sku {
      font-family: ui-monospace, monospace;
      font-size: 5pt;
      color: #666666;
    }

    .a4-label-cell .price {
      font-size: 7pt;
      font-weight: 900;
      color: #000000;
    }

    .a4-label-cell .mrp {
      font-size: 5pt;
      text-decoration: line-through;
      color: #888888;
    }

    .a4-label-cell .disc {
      font-size: 5pt;
      font-weight: 800;
    }

    .a4-label-cell .barcode-container {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }

    .a4-label-cell .barcode-container svg {
      max-width: 100%;
      display: block;
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
    // Dismiss any active toast notifications so they never get captured in print preview
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
    const heightMm = is58 ? 25 : 50;

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
