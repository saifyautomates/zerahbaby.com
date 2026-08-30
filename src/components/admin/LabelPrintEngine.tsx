/**
 * LabelPrintEngine — Unified direct product label renderer and DirectLabelPrintHost.
 *
 * Supports:
 * - One-Click Direct Printing without intermediate UI modals
 * - Label types: "barcode-only" | "full"
 * - Layouts:     "thermal-108" (HPRT HT300 / 108mm roll) | "thermal-58" (58mm roll) | "a4" (4-column grid)
 * - Automatic Code 128 Barcode generation with quiet zone & human readable text
 * - Dynamic MRP / Discount calculation
 * - Configurable label width/height in mm (read from Admin Print Settings → site_settings)
 * - Print isolation: only the labels print when window.print() is executed
 *
 * PRINT PROFILE: THERMAL_BARCODE_LABEL
 */
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Barcode from "react-barcode";
import { formatPrice } from "@/lib/store";
import {
  type DirectPrintPayload,
  subscribeToDirectPrint,
  type LabelPrinterProfile,
  type LabelType,
} from "@/lib/label-printer";

export type { LabelType };
export type LabelLayout = LabelPrinterProfile;

export type LabelProduct = {
  uuid: string;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  mrp: number;
  stock: number;
};

export type LabelEntry = {
  product: LabelProduct;
  qty: number;
};

type Props = {
  entries: LabelEntry[];
  labelType: LabelType;
  layout: LabelLayout;
  showDiscount: boolean;
  /** Label width in mm — from Admin Print Settings. Defaults: thermal=50mm, a4=A4 */
  widthMm?: number;
  /** Label height in mm — from Admin Print Settings. Defaults: thermal=25mm, a4=A4 */
  heightMm?: number;
};

/** Safe discount % calculation — never shows NaN, Infinity, or negative values */
function safeDiscountPct(mrp: number, price: number): number | null {
  if (!mrp || mrp <= 0 || price <= 0 || mrp <= price) return null;
  const pct = Math.round(((mrp - price) / mrp) * 100);
  if (!isFinite(pct) || pct <= 0 || pct > 100) return null;
  return pct;
}

/** Expand entries by qty into flat list of products to print */
function expand(entries: LabelEntry[]): LabelProduct[] {
  const out: LabelProduct[] = [];
  for (const { product, qty } of entries) {
    const safeQty = Math.max(0, Math.min(500, qty));
    for (let i = 0; i < safeQty; i++) out.push(product);
  }
  return out;
}

/** Barcode value: prefer barcode, fall back to SKU */
const barcodeVal = (p: LabelProduct) => p.barcode || p.sku || "NO-BARCODE";

/* ─────────────────────────────────────────────
   Individual Label Cells
   ───────────────────────────────────────────── */

function BarcodeOnlyLabel({ product, layout }: { product: LabelProduct; layout: LabelLayout }) {
  const is58 = layout === "thermal-58";
  const is108 = layout === "thermal-108";
  const isThermal = is58 || is108;

  const bw = is58 ? 0.9 : is108 ? 1.2 : 1.1;
  const bh = is58 ? 24 : is108 ? 32 : 30;

  return (
    <div
      className={`label-cell flex flex-col items-center justify-center text-center break-inside-avoid ${
        isThermal
          ? "py-2 px-1 border-b border-dashed border-border print:border-solid print:border-border"
          : "rounded border-2 border-dashed border-border p-2 print:border-solid print:border-border"
      }`}
      style={{ pageBreakInside: "avoid", breakInside: "avoid" }}
    >
      <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground truncate w-full">
        Zérah Baby &amp; Kids
      </p>
      <p className="text-[9px] font-semibold text-foreground truncate w-full mt-0.5">
        {product.name}
      </p>
      <div className="mt-1 w-full flex justify-center overflow-hidden">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={8}
          margin={2}
          displayValue={true}
          background="transparent"
        />
      </div>
      <p className="text-[8px] text-muted-foreground mt-0.5 font-mono">SKU: {product.sku || "—"}</p>
    </div>
  );
}

function FullProductLabel({
  product,
  layout,
  showDiscount,
}: {
  product: LabelProduct;
  layout: LabelLayout;
  showDiscount: boolean;
}) {
  const is58 = layout === "thermal-58";
  const is108 = layout === "thermal-108";
  const isThermal = is58 || is108;

  const discPct = showDiscount ? safeDiscountPct(product.mrp, product.price) : null;
  const bw = is58 ? 0.9 : is108 ? 1.2 : 1.1;
  const bh = is58 ? 26 : is108 ? 34 : 32;
  const hasMrp = product.mrp > product.price;

  return (
    <div
      className={`label-cell flex flex-col items-center justify-center text-center break-inside-avoid ${
        isThermal
          ? "py-2.5 px-1 border-b border-dashed border-border print:border-solid print:border-border"
          : "rounded border-2 border-dashed border-border p-2 print:border-solid print:border-border"
      }`}
      style={{ pageBreakInside: "avoid", breakInside: "avoid" }}
    >
      {/* Store name */}
      <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground truncate w-full">
        Zérah Baby &amp; Kids
      </p>

      {/* Product name */}
      <p
        className={`font-bold leading-tight text-foreground w-full mt-0.5 ${
          is58
            ? "text-[9px] line-clamp-1"
            : is108
              ? "text-[11px] line-clamp-2"
              : "text-[9px] line-clamp-2"
        }`}
      >
        {product.name}
      </p>

      {/* SKU */}
      <p className="text-[8px] text-muted-foreground mt-0.5 font-mono">SKU: {product.sku || "—"}</p>

      {/* Prices */}
      <div className="mt-1 flex items-center gap-1.5 justify-center flex-wrap">
        <span className="text-[12px] font-black text-foreground">{formatPrice(product.price)}</span>
        {hasMrp && (
          <span className="text-[9px] text-gray-400 line-through">{formatPrice(product.mrp)}</span>
        )}
        {discPct !== null && (
          <span className="text-[8px] font-bold text-green-700 bg-green-50 px-1 rounded">
            -{discPct}%
          </span>
        )}
      </div>

      {/* Barcode */}
      <div className="mt-1.5 w-full flex justify-center overflow-hidden">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={8}
          margin={2}
          displayValue={true}
          background="transparent"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Engine
   ───────────────────────────────────────────── */

export function LabelPrintEngine({
  entries,
  labelType,
  layout,
  showDiscount,
  widthMm,
  heightMm,
}: Props) {
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-gray-400 print:hidden">No labels to print.</p>
    );
  }

  // Resolve configurable label dimensions with sensible defaults
  const resolvedWidthMm =
    widthMm ?? (layout === "thermal-58" ? 54 : layout === "thermal-108" ? 100 : undefined);
  const resolvedHeightMm = heightMm;

  /* Grid config */
  const gridClass =
    layout === "a4"
      ? "grid grid-cols-4 gap-3 print:grid-cols-4 print:gap-2"
      : layout === "thermal-58"
        ? "flex flex-col gap-0 w-[54mm] max-w-[54mm] mx-auto"
        : "flex flex-col gap-0 w-[100mm] max-w-[100mm] mx-auto";

  return (
    <>
      {/* ── Print CSS injected via style tag ── */}
      <style>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
          }

          /* A4 layout */
          ${
            layout === "a4"
              ? `@page { size: A4 portrait; margin: 8mm; }
                 .label-cell { page-break-inside: avoid; break-inside: avoid; min-height: 25mm; }`
              : ""
          }

          /* Thermal 58mm — uses admin-configured width/height if provided */
          ${
            layout === "thermal-58"
              ? `@page { size: ${resolvedWidthMm ? resolvedWidthMm + "mm" : "58mm"} ${resolvedHeightMm ? resolvedHeightMm + "mm" : "auto"}; margin: 2mm; }
                 .label-cell { page-break-inside: avoid; break-inside: avoid; width: ${resolvedWidthMm ? resolvedWidthMm - 4 + "mm" : "54mm"} !important; max-width: ${resolvedWidthMm ? resolvedWidthMm - 4 + "mm" : "54mm"} !important; }`
              : ""
          }

          /* Thermal 108mm (HPRT HT300) — uses admin-configured width/height if provided */
          ${
            layout === "thermal-108"
              ? `@page { size: ${resolvedWidthMm ? resolvedWidthMm + "mm" : "108mm"} ${resolvedHeightMm ? resolvedHeightMm + "mm" : "auto"}; margin: 3mm; }
                 .label-cell { page-break-inside: avoid; break-inside: avoid; width: ${resolvedWidthMm ? resolvedWidthMm - 8 + "mm" : "100mm"} !important; max-width: ${resolvedWidthMm ? resolvedWidthMm - 8 + "mm" : "100mm"} !important; }`
              : ""
          }
        }
      `}</style>

      <div className={gridClass}>
        {labels.map((product, idx) =>
          labelType === "barcode-only" ? (
            <BarcodeOnlyLabel key={`${product.uuid}-${idx}`} product={product} layout={layout} />
          ) : (
            <FullProductLabel
              key={`${product.uuid}-${idx}`}
              product={product}
              layout={layout}
              showDiscount={showDiscount}
            />
          ),
        )}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────
   Direct Label Print Host Portal Singleton
   ───────────────────────────────────────────── */

export function DirectLabelPrintHost() {
  const [payload, setPayload] = useState<DirectPrintPayload | null>(null);

  useEffect(() => {
    return subscribeToDirectPrint((newPayload) => {
      setPayload(newPayload);
    });
  }, []);

  if (!payload || payload.products.length === 0) return null;

  const entries: LabelEntry[] = payload.products.map((p) => {
    const id = p.uuid || p.id || p.sku || p.name;
    const qty = payload.quantities?.[id] ?? 1;
    return {
      product: {
        uuid: p.uuid || id,
        name: p.name,
        sku: p.sku || "",
        barcode: p.barcode || p.sku || "",
        price: Number(p.price || 0),
        mrp: Number(p.mrp || p.price || 0),
        stock: Number(p.stock || 0),
      },
      qty,
    };
  });

  return createPortal(
    <div
      id="direct-label-print-portal"
      className="hidden print:block fixed inset-0 z-[9999] bg-card p-0 text-foreground"
    >
      <style>{`
        @media print {
          /* Hide all application elements and keep only direct print portal */
          body > *:not(#direct-label-print-portal) {
            display: none !important;
          }
          #direct-label-print-portal {
            display: block !important;
            position: static !important;
            inset: auto !important;
          }
        }
      `}</style>
      <LabelPrintEngine
        entries={entries}
        layout={payload.layout || "thermal-108"}
        labelType={payload.labelType || "full"}
        showDiscount={payload.showDiscount ?? false}
      />
    </div>,
    document.body,
  );
}
