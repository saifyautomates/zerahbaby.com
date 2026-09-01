/**
 * print-settings.ts
 *
 * Shared print configuration helpers for Zérah Baby & Kids.
 *
 * Architecture:
 *  - Settings are persisted in `site_settings` Supabase table (keyed strings).
 *  - This module provides typed accessors + defaults.
 *  - Used by ThermalReceipt, A4Invoice, LabelPrintEngine, POSTab, SettingsTab.
 *
 * Print Profiles:
 *  INVOICE_A4           — Customer-facing invoice, A4 paper, normal printer.
 *  THERMAL_BARCODE_LABEL — Product barcode label, HPRT HT300, 50×25mm default.
 */

/* ------------------------------------------------------------------ */
/*  Profile Types                                                       */
/* ------------------------------------------------------------------ */

export type PrintProfile = "INVOICE_A4" | "THERMAL_BARCODE_LABEL";

export interface InvoicePrintSettings {
  /** Human-readable name of the A4 invoice printer (informational only in browser) */
  printerName: string;
  /** Number of copies to print */
  copies: number;
  /** Whether to auto-print invoice immediately after POS sale completion */
  autoPrint: boolean;
}

export interface ThermalLabelSettings {
  /** Human-readable name of the thermal label printer (e.g. "HPRT HT300") */
  printerName: string;
  /** Label width in millimetres */
  widthMm: number;
  /** Label height in millimetres */
  heightMm: number;
  /** Printer DPI — affects barcode bar widths */
  dpi: number;
  /** Number of label copies per product */
  copies: number;
  /** "full" shows name+sku+price+barcode; "barcode-only" shows minimal info */
  labelType: "full" | "barcode-only";
  /** Whether to show crossed-out MRP + discount % */
  showDiscount: boolean;
}

/* ------------------------------------------------------------------ */
/*  Hard Defaults                                                       */
/* ------------------------------------------------------------------ */

export const DEFAULT_INVOICE_SETTINGS: InvoicePrintSettings = {
  printerName: "Default A4 Printer",
  copies: 1,
  autoPrint: true,
};

export const DEFAULT_THERMAL_SETTINGS: ThermalLabelSettings = {
  printerName: "HPRT HT300",
  widthMm: 50,
  heightMm: 25,
  dpi: 203,
  copies: 1,
  labelType: "full",
  showDiscount: false,
};

/* ------------------------------------------------------------------ */
/*  site_settings Key Map                                               */
/* ------------------------------------------------------------------ */
// These keys must match what is upserted into the site_settings table.

export const PRINT_SETTING_KEYS = {
  // Invoice
  invoicePrinterName: "print_invoice_printer_name",
  invoiceCopies: "print_invoice_copies",
  invoiceAutoPrint: "print_invoice_auto_print",
  // Thermal label
  thermalPrinterName: "print_thermal_printer_name",
  labelWidthMm: "print_label_width_mm",
  labelHeightMm: "print_label_height_mm",
  labelDpi: "print_label_dpi",
  labelCopies: "print_label_copies",
  labelType: "print_label_type",
  labelShowDiscount: "print_label_show_discount",
} as const;

/* ------------------------------------------------------------------ */
/*  Parsers: site_settings Record → typed settings objects             */
/* ------------------------------------------------------------------ */

export function parseInvoiceSettings(
  raw: Record<string, string> | null | undefined,
): InvoicePrintSettings {
  if (!raw) return { ...DEFAULT_INVOICE_SETTINGS };
  return {
    printerName: raw[PRINT_SETTING_KEYS.invoicePrinterName] || DEFAULT_INVOICE_SETTINGS.printerName,
    copies: parseInt(raw[PRINT_SETTING_KEYS.invoiceCopies] || "1", 10) || 1,
    autoPrint: raw[PRINT_SETTING_KEYS.invoiceAutoPrint] !== "false",
  };
}

export function parseThermalSettings(
  raw: Record<string, string> | null | undefined,
): ThermalLabelSettings {
  if (!raw) return { ...DEFAULT_THERMAL_SETTINGS };
  const labelType = raw[PRINT_SETTING_KEYS.labelType];
  return {
    printerName: raw[PRINT_SETTING_KEYS.thermalPrinterName] || DEFAULT_THERMAL_SETTINGS.printerName,
    widthMm: parseFloat(raw[PRINT_SETTING_KEYS.labelWidthMm] || "50") || 50,
    heightMm: parseFloat(raw[PRINT_SETTING_KEYS.labelHeightMm] || "25") || 25,
    dpi: parseInt(raw[PRINT_SETTING_KEYS.labelDpi] || "203", 10) || 203,
    copies: parseInt(raw[PRINT_SETTING_KEYS.labelCopies] || "1", 10) || 1,
    labelType: labelType === "barcode-only" ? "barcode-only" : "full",
    showDiscount: raw[PRINT_SETTING_KEYS.labelShowDiscount] === "true",
  };
}

/* ------------------------------------------------------------------ */
/*  Print Profile Defaults for site_settings upsert                    */
/* ------------------------------------------------------------------ */

export const DEFAULT_PRINT_SETTINGS_RECORD: Record<string, string> = {
  [PRINT_SETTING_KEYS.invoicePrinterName]: DEFAULT_INVOICE_SETTINGS.printerName,
  [PRINT_SETTING_KEYS.invoiceCopies]: String(DEFAULT_INVOICE_SETTINGS.copies),
  [PRINT_SETTING_KEYS.invoiceAutoPrint]: String(DEFAULT_INVOICE_SETTINGS.autoPrint),
  [PRINT_SETTING_KEYS.thermalPrinterName]: DEFAULT_THERMAL_SETTINGS.printerName,
  [PRINT_SETTING_KEYS.labelWidthMm]: String(DEFAULT_THERMAL_SETTINGS.widthMm),
  [PRINT_SETTING_KEYS.labelHeightMm]: String(DEFAULT_THERMAL_SETTINGS.heightMm),
  [PRINT_SETTING_KEYS.labelDpi]: String(DEFAULT_THERMAL_SETTINGS.dpi),
  [PRINT_SETTING_KEYS.labelCopies]: String(DEFAULT_THERMAL_SETTINGS.copies),
  [PRINT_SETTING_KEYS.labelType]: DEFAULT_THERMAL_SETTINGS.labelType,
  [PRINT_SETTING_KEYS.labelShowDiscount]: String(DEFAULT_THERMAL_SETTINGS.showDiscount),
};

/* ------------------------------------------------------------------ */
/*  QZ Tray Bridge Stub (Native TSPL/ZPL for HPRT HT300)              */
/* ------------------------------------------------------------------ */

/**
 * Detects whether QZ Tray WebSocket bridge is available in the current browser context.
 *
 * QZ Tray is a free Windows service that allows web apps to send raw printer
 * commands (TSPL, ZPL, ESC/POS) directly to USB/network printers without the
 * browser print dialog.
 *
 * Installation: https://qz.io/download/
 * Must be installed and running on the Windows machine running the POS.
 */
import qz from "qz-tray";

let qzConnected = false;

/**
 * Ensures QZ Tray is connected before attempting to use it.
 */
export async function connectQZTray(): Promise<boolean> {
  if (qzConnected && qz.websocket.isActive()) {
    return true;
  }
  try {
    if (!qz.websocket.isActive()) {
      const connectPromise = qz.websocket.connect({ retries: 0, delay: 1 });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("QZ Tray timeout")), 1500),
      );
      await Promise.race([connectPromise, timeoutPromise]);
    }
    qzConnected = true;
    return true;
  } catch (err) {
    console.warn("QZ Tray connection failed or timed out:", err);
    return false;
  }
}

export async function detectQZTray(): Promise<boolean> {
  return await connectQZTray();
}

/**
 * Generates a TSPL command string for a barcode label on the HPRT HT300.
 *
 * This is a stub — it generates valid TSPL that can be sent via QZ Tray
 * once the user installs QZ Tray on their Windows POS machine.
 */
export function buildTSPLLabel(params: {
  productName: string;
  sku: string;
  barcode: string;
  price: number;
  mrp?: number;
  widthMm: number;
  heightMm: number;
  dpi?: number;
  copies?: number;
  storeName?: string;
}): string {
  const {
    productName,
    sku,
    barcode,
    price,
    mrp,
    widthMm,
    heightMm,
    copies = 1,
    storeName = "Zerah Baby & Kids",
  } = params;

  // TSPL unit = dots. 203 DPI → 1mm ≈ 8 dots
  const dotsPerMm = 8;
  const w = Math.round(widthMm * dotsPerMm);
  const h = Math.round(heightMm * dotsPerMm);

  // Sanitize strings for TSPL (no quotes in values)
  const safeName = productName.replace(/"/g, "").substring(0, 30);
  const safeStore = storeName.replace(/"/g, "").substring(0, 25);
  const safeSku = sku.replace(/"/g, "").substring(0, 20);
  const safeBarcode = barcode.replace(/"/g, "").substring(0, 40);
  const mrpVal = typeof mrp === "number" && mrp > 0 ? mrp : price;
  const mrpStr = `MRP: Rs.${mrpVal}`;

  return [
    `SIZE ${widthMm} mm, ${heightMm} mm`,
    `GAP 2 mm, 0 mm`,
    `DIRECTION 1`,
    `CLS`,
    // Store name — top centered
    `TEXT ${Math.round(w / 2)} ,5,"3",0,1,1,1,"${safeStore}"`,
    // Product name
    `TEXT 5,25,"2",0,1,1,"${safeName}"`,
    // SKU
    `TEXT 5,45,"1",0,1,1,"SKU: ${safeSku}"`,
    // Authoritative MRP on physical sticker
    `TEXT 5,60,"2",0,1,1,"${mrpStr}"`,
    // Barcode — Code 128, height 40 dots, narrow bar 2 dots
    `BARCODE ${Math.round(w / 2)},80,"128",40,1,0,2,2,"${safeBarcode}"`,
    `PRINT ${copies},1`,
    `END`,
  ].join("\n");
}

/**
 * Attempts to send a TSPL command string to the HPRT HT300 via QZ Tray.
 *
 * Returns: { success: true } | { success: false; error: string; fallback: "window.print" }
 */
export async function sendTSPLViaQZTray(
  printerName: string,
  tsplCommands: string,
): Promise<{ success: boolean; error?: string; fallback?: "window.print" }> {
  const isActive = await connectQZTray();
  if (!isActive) {
    return {
      success: false,
      error: "QZ Tray not detected. Install QZ Tray on this Windows machine for direct printing.",
      fallback: "window.print",
    };
  }

  try {
    const config = qz.configs.create(printerName);
    const data = [{ type: "raw", format: "plain", data: tsplCommands }];
    await (qz.print as (c: unknown, d: unknown) => Promise<void>)(config, data);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "QZ Tray print failed",
      fallback: "window.print",
    };
  }
}

/**
 * Attempts to send HTML directly to an A4 printer via QZ Tray.
 */
export async function sendHTMLViaQZTray(
  printerName: string,
  htmlData: string,
  options?: { isThermal?: boolean; widthMm?: number },
): Promise<{ success: boolean; error?: string; fallback?: "window.print" }> {
  const isActive = await connectQZTray();
  if (!isActive) {
    return {
      success: false,
      error: "QZ Tray not detected. Install QZ Tray on this Windows machine for direct printing.",
      fallback: "window.print",
    };
  }

  try {
    const qzConfig: Record<string, unknown> = {
      margins: options?.isThermal ? 0 : 0, // Let CSS handle margins
    };
    // If it's thermal, we might specify width, otherwise rely on printer defaults (A4).
    const config = qz.configs.create(printerName, qzConfig);
    const data = [
      {
        type: "pixel",
        format: "html",
        flavor: "plain",
        data: htmlData,
      },
    ];
    await (qz.print as (c: unknown, d: unknown) => Promise<void>)(config, data);
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "QZ Tray HTML print failed",
      fallback: "window.print",
    };
  }
}
