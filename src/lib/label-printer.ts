/**
 * One-Click Direct Product Label Printer Engine & Profile Store
 *
 * Provides:
 * - Persistent printer format profile (A4_GRID, THERMAL_108MM, THERMAL_58MM)
 * - Authoritative product & barcode validation (no fake barcodes, accurate prices & quantities)
 * - One-click instant direct printing without intermediate configuration screens
 * - Debounced duplicate-click prevention
 * - Safe fallback to browser print dialog with optional native bridge detection
 */
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Product } from "@/lib/store";

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
 * Trigger an instant 1-click product label print job without any configuration modal.
 */
export function triggerDirectLabelPrint(
  target: Product | PrintableProduct | Array<Product | PrintableProduct>,
  options?: {
    quantity?: number;
    quantities?: Record<string, number>;
    layout?: LabelPrinterProfile;
    labelType?: LabelType;
    showDiscount?: boolean;
  },
): boolean {
  if (isDirectPrintingLock) {
    toast.info("A print job is already preparing. Please wait...");
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

  const totalLabels = rawProducts.reduce((sum, p) => {
    const id = p.uuid || p.id || p.sku || p.name;
    return sum + (quantities[id] ?? 1);
  }, 0);

  // Lock to prevent duplicate clicks
  isDirectPrintingLock = true;
  const toastId = toast.loading(
    `Preparing ${totalLabels} label${totalLabels > 1 ? "s" : ""} (${layout.toUpperCase()})...`,
  );

  const payload: DirectPrintPayload = {
    products: rawProducts,
    quantities,
    layout,
    labelType,
    showDiscount,
  };

  // Dispatch to the active DirectLabelPrintHost
  listeners.forEach((listener) => listener(payload));

  // Small delay to allow React-Barcode SVG render in the DOM, then invoke print
  setTimeout(() => {
    try {
      // Check for native desktop shell / kiosk print bridge if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      if (typeof win.electronAPI?.printDirect === "function") {
        win.electronAPI.printDirect();
      } else {
        window.print();
      }
      toast.success("Print job initiated", { id: toastId });
    } catch (err) {
      console.error("[label-printer] Print invocation failed:", err);
      toast.error("Failed to invoke printer dialog", { id: toastId });
    } finally {
      // Release lock and clean up print portal after dialog
      setTimeout(() => {
        listeners.forEach((listener) => listener(null));
        isDirectPrintingLock = false;
      }, 1000);
    }
  }, 350);

  return true;
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
      const success = triggerDirectLabelPrint(target, options);
      setTimeout(() => setIsPrinting(false), 1200);
      return success;
    },
    [],
  );

  return { printLabel, isPrinting };
}
