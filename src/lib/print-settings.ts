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
/*  Profile Types                                                     */
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
/*  Hard Defaults                                                     */
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
/*  site_settings Key Map                                             */
/* ------------------------------------------------------------------ */

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
/*  Parsers: site_settings Record → typed settings objects            */
/* ------------------------------------------------------------------ */

export function parseInvoiceSettings(
  raw: Record<string, string> | null | undefined,
): InvoicePrintSettings {
  if (!raw) return { ...DEFAULT_INVOICE_SETTINGS };

  return {
    printerName:
      raw[PRINT_SETTING_KEYS.invoicePrinterName] ||
      DEFAULT_INVOICE_SETTINGS.printerName,

    copies:
      parseInt(raw[PRINT_SETTING_KEYS.invoiceCopies] || "1", 10) || 1,

    autoPrint:
      raw[PRINT_SETTING_KEYS.invoiceAutoPrint] !== "false",
  };
}

export function parseThermalSettings(
  raw: Record<string, string> | null | undefined,
): ThermalLabelSettings {
  if (!raw) return { ...DEFAULT_THERMAL_SETTINGS };

  const labelType = raw[PRINT_SETTING_KEYS.labelType];

  return {
    printerName:
      raw[PRINT_SETTING_KEYS.thermalPrinterName] ||
      DEFAULT_THERMAL_SETTINGS.printerName,

    widthMm:
      parseFloat(raw[PRINT_SETTING_KEYS.labelWidthMm] || "50") || 50,

    heightMm:
      parseFloat(raw[PRINT_SETTING_KEYS.labelHeightMm] || "25") || 25,

    dpi:
      parseInt(raw[PRINT_SETTING_KEYS.labelDpi] || "203", 10) || 203,

    copies:
      parseInt(raw[PRINT_SETTING_KEYS.labelCopies] || "1", 10) || 1,

    labelType:
      labelType === "barcode-only" ? "barcode-only" : "full",

    showDiscount:
      raw[PRINT_SETTING_KEYS.labelShowDiscount] === "true",
  };
}

/* ------------------------------------------------------------------ */
/*  Print Profile Defaults for site_settings upsert                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_PRINT_SETTINGS_RECORD: Record<string, string> = {
  [PRINT_SETTING_KEYS.invoicePrinterName]:
    DEFAULT_INVOICE_SETTINGS.printerName,

  [PRINT_SETTING_KEYS.invoiceCopies]:
    String(DEFAULT_INVOICE_SETTINGS.copies),

  [PRINT_SETTING_KEYS.invoiceAutoPrint]:
    String(DEFAULT_INVOICE_SETTINGS.autoPrint),

  [PRINT_SETTING_KEYS.thermalPrinterName]:
    DEFAULT_THERMAL_SETTINGS.printerName,

  [PRINT_SETTING_KEYS.labelWidthMm]:
    String(DEFAULT_THERMAL_SETTINGS.widthMm),

  [PRINT_SETTING_KEYS.labelHeightMm]:
    String(DEFAULT_THERMAL_SETTINGS.heightMm),

  [PRINT_SETTING_KEYS.labelDpi]:
    String(DEFAULT_THERMAL_SETTINGS.dpi),

  [PRINT_SETTING_KEYS.labelCopies]:
    String(DEFAULT_THERMAL_SETTINGS.copies),

  [PRINT_SETTING_KEYS.labelType]:
    DEFAULT_THERMAL_SETTINGS.labelType,

  [PRINT_SETTING_KEYS.labelShowDiscount]:
    String(DEFAULT_THERMAL_SETTINGS.showDiscount),
};

/* ------------------------------------------------------------------ */
/*  QZ Tray Bridge Stub (Native TSPL/ZPL for HPRT HT300)              */
/* ------------------------------------------------------------------ */

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
      const connectPromise = qz.websocket.connect({
        retries: 0,
        delay: 1,
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("QZ Tray timeout")),
          1500,
        ),
      );

      await Promise.race([connectPromise, timeoutPromise]);
    }

    qzConnected = true;
    return true;
  } catch (err) {
    console.warn(
      "QZ Tray connection failed or timed out:",
      err,
    );

    return false;
  }
}

export async function detectQZTray(): Promise<boolean> {
  return await connectQZTray();
}

/* ------------------------------------------------------------------ */
/*  TSPL Label Builder                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generates a TSPL command string for a barcode label on the HPRT HT300.
 *
 * IMPORTANT:
 * All visible label content is intentionally centered.
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
  showDiscount?: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  rotation?: 0 | 90 | 180 | 270;
}): string {
  const {
    productName,
    sku,
    barcode,
    price,
    mrp,
    widthMm,
    heightMm,
    dpi = 203,
    copies = 1,
    storeName = "ZÉRAH BABY & KIDS",
    showDiscount = true,
    showMrp = true,
    showSellPrice = true,
    separatePriceLine = false,
    rotation = 0,
  } = params;

  /*
   * TSPL uses printer dots.
   *
   * Instead of assuming 8 dots/mm, calculate it from the configured DPI.
   * 203 DPI ≈ 7.99 dots/mm.
   */
  const dotsPerMm = dpi / 25.4;

  const w = Math.max(
    1,
    Math.round(widthMm * dotsPerMm),
  );

  const h = Math.max(
    1,
    Math.round(heightMm * dotsPerMm),
  );

  /*
   * Exact horizontal center of the label.
   */
  const centerX = Math.round(w / 2);

  /* ---------------------------------------------------------------- */
  /*  Safe text values                                                */
  /* ---------------------------------------------------------------- */

  const safeName = productName
    .replace(/"/g, "")
    .replace(/\r?\n/g, " ")
    .trim()
    .substring(0, 24);

  const safeStore = storeName
    .replace(/"/g, "")
    .replace(/\r?\n/g, " ")
    .trim()
    .substring(0, 28);

  const safeSku = sku
    .replace(/"/g, "")
    .replace(/\r?\n/g, " ")
    .trim()
    .substring(0, 22);

  /*
   * Keep the barcode reasonably short so Code 128 can physically
   * fit inside a 50mm label.
   */
  const safeBarcode = (barcode || sku)
    .replace(/"/g, "")
    .replace(/\r?\n/g, "")
    .trim()
    .substring(0, 18);

  const mrpVal =
    typeof mrp === "number" && mrp > 0
      ? mrp
      : price;

  const hasDiscount = mrpVal > price;

  const discPct = hasDiscount
    ? Math.round(
        ((mrpVal - price) / mrpVal) * 100,
      )
    : 0;

  const discStr =
    showDiscount && discPct > 0
      ? ` (-${discPct}%)`
      : "";

  /* ---------------------------------------------------------------- */
  /*  Label layout                                                    */
  /* ---------------------------------------------------------------- */

  /*
   * Rotation is applied to the CONTENT only. The physical media size
   * remains exactly widthMm × heightMm, so format and rotation remain
   * independent.
   *
   * TSPL supports 0/90/180/270° rotation for text and barcodes.
   * We rotate each element around the physical label centre and
   * transform its coordinates, which keeps rotated content inside the
   * same label instead of changing the label dimensions.
   */
  const safeRotation: 0 | 90 | 180 | 270 =
    rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;

  const minPad = Math.max(4, Math.round(dotsPerMm * 0.8));

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(value)));

  /* Keep the existing look on normal labels, but make small custom
   * labels (for example 25 × 20mm) physically fit. */
  const compact = h <= Math.round(dotsPerMm * 25);
  const veryCompact = h <= Math.round(dotsPerMm * 21);
  const storeFont = veryCompact ? "1" : compact ? "1" : "3";
  const nameFont = veryCompact ? "1" : compact ? "1" : "2";
  const priceFont = veryCompact ? "1" : compact ? "1" : "2";
  const skuFont = "1";
  const textScale = veryCompact ? 1 : compact ? 1 : 1;

  const topY = clamp(h * 0.045, minPad, Math.max(minPad, h - 12));
  const nameY = clamp(h * 0.18, topY + 14, Math.max(topY + 14, h - 90));
  const price1Y = clamp(h * 0.31, nameY + 14, Math.max(nameY + 14, h - 68));
  const price2Y = clamp(h * 0.40, price1Y + 14, Math.max(price1Y + 14, h - 52));

  /* Barcode height is proportional to the physical label height. */
  const barcodeHeight = clamp(
    h * (veryCompact ? 0.23 : compact ? 0.27 : 0.30),
    veryCompact ? 28 : 38,
    Math.max(28, h - 70),
  );

  const barcodeY = clamp(
    h * (veryCompact ? 0.50 : compact ? 0.47 : 0.49),
    price2Y + 8,
    Math.max(price2Y + 8, h - barcodeHeight - 22),
  );

  const skuY = clamp(
    h - Math.max(14, Math.round(h * 0.075)),
    barcodeY + barcodeHeight + 8,
    Math.max(barcodeY + barcodeHeight + 8, h - 6),
  );

  const textPoint = (x: number, y: number) => {
    const cx = w / 2;
    const cy = h / 2;
    const dx = x - cx;
    const dy = y - cy;

    switch (safeRotation) {
      case 90:
        return { x: Math.round(cx - dy), y: Math.round(cy + dx) };
      case 180:
        return { x: Math.round(cx - dx), y: Math.round(cy - dy) };
      case 270:
        return { x: Math.round(cx + dy), y: Math.round(cy - dx) };
      default:
        return { x: Math.round(x), y: Math.round(y) };
    }
  };

  const textCmd = (x: number, y: number, font: string, value: string) => {
    const point = textPoint(x, y);
    return `TEXT ${point.x},${point.y},"${font}",${safeRotation},${textScale},${textScale},2,"${value}"`;
  };

  /*
   * Barcode command uses x/y as the barcode's top-left anchor. Rotate
   * its centre and then convert the rotated bounding box back to a
   * top-left coordinate so 90°/270° stay completely inside the label.
   */
  const barcodeCharacters = Math.max(1, safeBarcode.length);
  const barcodeModules = 35 + barcodeCharacters * 11;
  const availableBarcodeWidth = Math.max(40, w - minPad * 2);
  const narrowBarWidth = Math.max(1, Math.min(2, Math.floor(availableBarcodeWidth / barcodeModules)));
  const estimatedBarcodeWidth = barcodeModules * narrowBarWidth;
  const barcodeWidth = Math.min(estimatedBarcodeWidth, availableBarcodeWidth);

  const barcodeCenterX = w / 2;
  const barcodeCenterY = barcodeY + barcodeHeight / 2;

  const barcodeCenter = textPoint(barcodeCenterX, barcodeCenterY);
  const rotatedBarcodeWidth = safeRotation === 90 || safeRotation === 270
    ? barcodeHeight
    : barcodeWidth;
  const rotatedBarcodeHeight = safeRotation === 90 || safeRotation === 270
    ? barcodeWidth
    : barcodeHeight;

  const barcodeX = clamp(
    barcodeCenter.x - rotatedBarcodeWidth / 2,
    minPad,
    Math.max(minPad, w - rotatedBarcodeWidth - minPad),
  );
  const finalBarcodeY = clamp(
    barcodeCenter.y - rotatedBarcodeHeight / 2,
    minPad,
    Math.max(minPad, h - rotatedBarcodeHeight - minPad),
  );

  const lines: string[] = [
    `SIZE ${widthMm} mm, ${heightMm} mm`,
    `GAP 2 mm, 0 mm`,
    `DIRECTION 1`,
    `CLS`,
    textCmd(centerX, topY, storeFont, safeStore),
  ];

  if (separatePriceLine && (showMrp || showSellPrice)) {
    lines.push(textCmd(centerX, nameY, nameFont, safeName));

    let priceLine = "";
    if (showMrp && showSellPrice) {
      priceLine = `MRP: Rs.${mrpVal}  Price: Rs.${price}${discStr}`;
    } else if (showSellPrice) {
      priceLine = `Price: Rs.${price}`;
    } else if (showMrp) {
      priceLine = `MRP: Rs.${mrpVal}${discStr}`;
    }

    lines.push(textCmd(centerX, price1Y, priceFont, priceLine));
  } else {
    lines.push(textCmd(centerX, nameY, nameFont, safeName));

    if (showMrp && showSellPrice) {
      lines.push(textCmd(centerX, price1Y, skuFont, `MRP: Rs.${mrpVal}`));
      lines.push(textCmd(centerX, price2Y, priceFont, `Price: Rs.${price}${discStr}`));
    } else if (showSellPrice) {
      lines.push(textCmd(centerX, price1Y, priceFont, `Price: Rs.${price}`));
    } else if (showMrp) {
      lines.push(textCmd(centerX, price1Y, priceFont, `MRP: Rs.${mrpVal}${discStr}`));
    }
  }

  lines.push(
    `BARCODE ${barcodeX},${finalBarcodeY},"128",${barcodeHeight},1,${safeRotation},${narrowBarWidth},${narrowBarWidth},"${safeBarcode}"`,
  );

  lines.push(
    textCmd(centerX, skuY, skuFont, `SKU: ${safeSku}`),
  );

  lines.push(`PRINT ${copies},1`);
  lines.push(`END`);

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  QZ Tray TSPL Printing                                             */
/* ------------------------------------------------------------------ */

/**
 * Attempts to send a TSPL command string to the HPRT HT300 via QZ Tray.
 *
 * Returns:
 * { success: true }
 *
 * or:
 * { success: false; error: string; fallback: "window.print" }
 */
export async function sendTSPLViaQZTray(
  printerName: string,
  tsplCommands: string,
): Promise<{
  success: boolean;
  error?: string;
  fallback?: "window.print";
}> {
  const isActive = await connectQZTray();

  if (!isActive) {
    return {
      success: false,
      error:
        "QZ Tray not detected. Install QZ Tray on this Windows machine for direct printing.",
      fallback: "window.print",
    };
  }

  try {
    const config =
      qz.configs.create(printerName);

    const data = [
      {
        type: "raw",
        format: "plain",
        data: tsplCommands,
      },
    ];

    await (
      qz.print as (
        c: unknown,
        d: unknown,
      ) => Promise<void>
    )(config, data);

    return {
      success: true,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "QZ Tray print failed",
      fallback: "window.print",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  HTML QZ Tray Printing                                             */
/* ------------------------------------------------------------------ */

/**
 * Attempts to send HTML directly to an A4 printer via QZ Tray.
 */
export async function sendHTMLViaQZTray(
  printerName: string,
  htmlData: string,
  options?: {
    isThermal?: boolean;
    widthMm?: number;
  },
): Promise<{
  success: boolean;
  error?: string;
  fallback?: "window.print";
}> {
  const isActive = await connectQZTray();

  if (!isActive) {
    return {
      success: false,
      error:
        "QZ Tray not detected. Install QZ Tray on this Windows machine for direct printing.",
      fallback: "window.print",
    };
  }

  try {
    const qzConfig: Record<string, unknown> = {
      margins: 0,
    };

    /*
     * Keep the existing A4 behaviour untouched.
     *
     * Thermal label dimensions are controlled by the label HTML/CSS
     * and printer media configuration.
     */
    if (options?.isThermal && options.widthMm) {
      qzConfig.size = {
        width: options.widthMm,
        height: 25,
      };
    }

    const config =
      qz.configs.create(
        printerName,
        qzConfig,
      );

    const data = [
      {
        type: "pixel",
        format: "html",
        flavor: "plain",
        data: htmlData,
      },
    ];

    await (
      qz.print as (
        c: unknown,
        d: unknown,
      ) => Promise<void>
    )(config, data);

    return {
      success: true,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "QZ Tray HTML print failed",
      fallback: "window.print",
    };
  }
}
