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

  const lines: string[] = [
    `SIZE ${widthMm} mm, ${heightMm} mm`,
    `GAP 2 mm, 0 mm`,
    `DIRECTION 1`,
    `CLS`,

    /*
     * Store name — CENTER
     */
    `TEXT ${centerX},8,"3",0,1,1,2,"${safeStore}"`,
  ];

  /*
   * Product + pricing.
   *
   * Both variants are now centered.
   */
  if (separatePriceLine && (showMrp || showSellPrice)) {
    /*
     * Product name — CENTER
     */
    lines.push(
      `TEXT ${centerX},28,"2",0,1,1,2,"${safeName}"`,
    );

    let priceLine = "";

    if (showMrp && showSellPrice) {
      priceLine =
        `MRP: Rs.${mrpVal}  Price: Rs.${price}${discStr}`;
    } else if (showSellPrice) {
      priceLine =
        `Price: Rs.${price}`;
    } else if (showMrp) {
      priceLine =
        `MRP: Rs.${mrpVal}${discStr}`;
    }

    /*
     * Price — CENTER
     */
    lines.push(
      `TEXT ${centerX},48,"2",0,1,1,2,"${priceLine}"`,
    );
  } else {
    /*
     * Previously the product name was left aligned and price was
     * right aligned. That is intentionally removed.
     *
     * Everything is CENTER aligned now.
     */

    lines.push(
      `TEXT ${centerX},38,"2",0,1,1,2,"${safeName}"`,
    );

    if (showMrp && showSellPrice) {
      lines.push(
        `TEXT ${centerX},58,"1",0,1,1,2,"MRP: Rs.${mrpVal}"`,
      );

      lines.push(
        `TEXT ${centerX},74,"2",0,1,1,2,"Price: Rs.${price}${discStr}"`,
      );
    } else if (showSellPrice) {
      lines.push(
        `TEXT ${centerX},58,"2",0,1,1,2,"Price: Rs.${price}"`,
      );
    } else if (showMrp) {
      lines.push(
        `TEXT ${centerX},58,"2",0,1,1,2,"MRP: Rs.${mrpVal}${discStr}"`,
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Barcode                                                         */
  /* ---------------------------------------------------------------- */

  /*
   * BARCODE x-coordinate is the LEFT edge of the barcode.
   *
   * The old code used:
   *     BARCODE centerX,...
   *
   * That means the barcode STARTED at the center and extended to the
   * right — it was NOT actually centered.
   *
   * Calculate an approximate Code 128 width and place its LEFT edge
   * so the complete barcode is centered.
   */

  const barcodeCharacters = Math.max(
    1,
    safeBarcode.length,
  );

  /*
   * Approximate Code 128 module count:
   *  - start + checksum + stop + character patterns
   *  - 11 modules per encoded character
   */
  const barcodeModules =
    35 + barcodeCharacters * 11;

  /*
   * "2" is the narrow bar width used below.
   */
  const narrowBarWidth = 2;

  const estimatedBarcodeWidth =
    barcodeModules * narrowBarWidth;

  const barcodeX = Math.max(
    4,
    Math.round(
      (w - estimatedBarcodeWidth) / 2,
    ),
  );

  /*
   * Prevent barcode from exceeding the label width.
   */
  const finalBarcodeX = Math.min(
    barcodeX,
    Math.max(
      4,
      w - estimatedBarcodeWidth - 4,
    ),
  );

  lines.push(
    `BARCODE ${finalBarcodeX},92,"128",48,1,0,${narrowBarWidth},${narrowBarWidth},"${safeBarcode}"`,
  );

  /* ---------------------------------------------------------------- */
  /*  SKU                                                              */
  /* ---------------------------------------------------------------- */

  /*
   * SKU — CENTER
   */
  lines.push(
    `TEXT ${centerX},158,"1",0,1,1,2,"SKU: ${safeSku}"`,
  );

  /* ---------------------------------------------------------------- */
  /*  Print                                                            */
  /* ---------------------------------------------------------------- */

  lines.push(
    `PRINT ${copies},1`,
  );

  lines.push(
    `END`,
  );

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
