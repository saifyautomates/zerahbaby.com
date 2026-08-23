/**
 * LabelPrintEngine — Unified product label renderer.
 *
 * Supports:
 * - Label type: "barcode-only" | "full"
 * - Layout:     "a4" (4-up grid) | "thermal-58" | "thermal-80"
 * - Per-product quantity
 * - Discount % display (optional, validated)
 * - @page + @media print CSS for HGR HT-300X 108mm (80mm printable)
 */
import { useMemo } from "react";
import Barcode from "react-barcode";
import { formatPrice } from "@/lib/store";

export type LabelType = "barcode-only" | "full";
export type LabelLayout = "a4" | "thermal-58" | "thermal-80";

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

function BarcodeOnlyLabel({ product, thermal }: { product: LabelProduct; thermal: boolean }) {
  const bw = thermal ? 1.0 : 1.2;
  const bh = thermal ? 28 : 36;
  return (
    <div
      className={`label-cell flex flex-col items-center justify-center text-center break-inside-avoid ${
        thermal
          ? "py-2 border-b border-dashed border-gray-300"
          : "rounded border-2 border-dashed border-gray-300 p-2 print:border-solid print:border-gray-200"
      }`}
    >
      <p className="text-[8px] font-bold uppercase tracking-wider text-gray-500 truncate w-full">
        Zérah Baby &amp; Kids
      </p>
      <p className="text-[9px] font-semibold text-gray-700 truncate w-full mt-0.5">
        {product.name}
      </p>
      <div className="mt-1 w-full flex justify-center">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={7}
          margin={2}
          displayValue={true}
          background="transparent"
        />
      </div>
      <p className="text-[8px] text-gray-500 mt-0.5">SKU: {product.sku || "—"}</p>
    </div>
  );
}

function FullProductLabel({
  product,
  thermal,
  showDiscount,
}: {
  product: LabelProduct;
  thermal: boolean;
  showDiscount: boolean;
}) {
  const discPct = showDiscount ? safeDiscountPct(product.mrp, product.price) : null;
  const bw = thermal ? 1.0 : 1.2;
  const bh = thermal ? 28 : 36;
  const hasMrp = product.mrp > product.price;

  return (
    <div
      className={`label-cell flex flex-col items-center justify-center text-center break-inside-avoid ${
        thermal
          ? "py-2 border-b border-dashed border-gray-300"
          : "rounded border-2 border-dashed border-gray-300 p-2 print:border-solid print:border-gray-200"
      }`}
    >
      {/* Store name */}
      <p className="text-[8px] font-bold uppercase tracking-wider text-gray-500 truncate w-full">
        Zérah Baby &amp; Kids
      </p>

      {/* Product name */}
      <p
        className={`font-semibold leading-tight text-gray-900 w-full mt-0.5 ${
          thermal ? "text-[10px] line-clamp-2" : "text-[9px] line-clamp-2"
        }`}
      >
        {product.name}
      </p>

      {/* SKU */}
      <p className="text-[8px] text-gray-500 mt-0.5">SKU: {product.sku || "—"}</p>

      {/* Prices */}
      <div className="mt-1 flex items-center gap-1.5 justify-center flex-wrap">
        <span className="text-[12px] font-black text-gray-900">{formatPrice(product.price)}</span>
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
      <div className="mt-1.5 w-full flex justify-center">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={7}
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

export function LabelPrintEngine({ entries, labelType, layout, showDiscount }: Props) {
  const labels = useMemo(() => expand(entries), [entries]);
  const isThermal = layout !== "a4";

  if (labels.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-gray-400 print:hidden">
        No labels to print. Add products and set quantities above.
      </p>
    );
  }

  /* Grid config */
  const gridClass =
    layout === "a4" ? "grid grid-cols-4 gap-3 print:grid-cols-4" : "flex flex-col gap-0";

  return (
    <>
      {/* ── Print CSS injected via style tag ── */}
      <style>{`
        @media print {
          html, body { margin: 0; padding: 0; }

          /* A4 layout */
          ${
            layout === "a4"
              ? `@page { size: A4 portrait; margin: 8mm; }
                 .label-cell { page-break-inside: avoid; }`
              : ""
          }

          /* Thermal 58mm */
          ${
            layout === "thermal-58"
              ? `@page { size: 58mm auto; margin: 2mm; }
                 .label-cell { page-break-inside: avoid; width: 54mm; }`
              : ""
          }

          /* Thermal 80mm (HGR HT-300X) */
          ${
            layout === "thermal-80"
              ? `@page { size: 80mm auto; margin: 3mm; }
                 .label-cell { page-break-inside: avoid; width: 74mm; }`
              : ""
          }
        }
      `}</style>

      <div className={gridClass}>
        {labels.map((product, idx) =>
          labelType === "barcode-only" ? (
            <BarcodeOnlyLabel
              key={`${product.uuid}-${idx}`}
              product={product}
              thermal={isThermal}
            />
          ) : (
            <FullProductLabel
              key={`${product.uuid}-${idx}`}
              product={product}
              thermal={isThermal}
              showDiscount={showDiscount}
            />
          ),
        )}
      </div>
    </>
  );
}
