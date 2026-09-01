/**
 * LabelPrintEngine — Interactive Label Screen Preview Engine & Direct Host.
 *
 * Provides:
 * - Pixel-perfect screen preview matching the exact physical label dimensions:
 *   - "thermal-58": 50mm × 25mm standard retail barcode sticker
 *   - "thermal-108": 100mm × 50mm large thermal shipping/product label
 *   - "a4": 4-column A4 sheet grid
 * - Barcode-only vs Full product label modes
 * - Real-time MRP / Discount percentage calculations
 */
import { useMemo } from "react";
import Barcode from "react-barcode";
import { formatPrice } from "@/lib/store";
import type { LabelPrinterProfile, LabelType } from "@/lib/label-printer";

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
  widthMm?: number;
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
const barcodeVal = (p: LabelProduct) => (p.barcode || p.sku || "000000").trim();

/* ─────────────────────────────────────────────
   Individual Label Preview Cards
   ───────────────────────────────────────────── */

function BarcodeOnlyLabelPreview({
  product,
  layout,
}: {
  product: LabelProduct;
  layout: LabelLayout;
}) {
  const is58 = layout === "thermal-58";
  const is108 = layout === "thermal-108";

  const bw = is58 ? 0.95 : is108 ? 1.4 : 1.0;
  const bh = is58 ? 20 : is108 ? 32 : 22;

  return (
    <div
      className={`relative flex flex-col justify-between items-center text-center rounded-xl border border-border bg-white text-black shadow-2xs overflow-hidden transition-all ${
        is58
          ? "w-[200px] h-[100px] p-2"
          : is108
            ? "w-[320px] h-[160px] p-3.5"
            : "w-full min-h-[110px] p-2"
      }`}
    >
      <div className="w-full">
        <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-500 truncate">
          Zérah Baby &amp; Kids
        </p>
        <p className="text-[10px] font-bold text-black truncate mt-0.5">{product.name}</p>
      </div>

      <div className="w-full flex justify-center items-center overflow-hidden my-auto">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={8}
          margin={1}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
      </div>

      <p className="text-[8px] text-gray-600 font-mono">SKU: {product.sku || "—"}</p>
    </div>
  );
}

function FullProductLabelPreview({
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

  const discPct = showDiscount ? safeDiscountPct(product.mrp, product.price) : null;
  const bw = is58 ? 0.9 : is108 ? 1.4 : 0.95;
  const bh = is58 ? 18 : is108 ? 30 : 20;
  const hasMrp = product.mrp > product.price;

  return (
    <div
      className={`relative flex flex-col justify-between items-center text-center rounded-xl border border-border bg-white text-black shadow-2xs overflow-hidden transition-all ${
        is58
          ? "w-[210px] h-[115px] p-2"
          : is108
            ? "w-[340px] h-[175px] p-3.5"
            : "w-full min-h-[120px] p-2"
      }`}
    >
      {/* Header */}
      <div className="w-full">
        <p className="text-[8px] font-extrabold uppercase tracking-widest text-gray-500 truncate">
          Zérah Baby &amp; Kids
        </p>
        <p
          className={`font-bold text-black leading-tight mt-0.5 ${
            is58 ? "text-[9px] line-clamp-1" : is108 ? "text-[12px] line-clamp-2" : "text-[9px] line-clamp-2"
          }`}
        >
          {product.name}
        </p>
      </div>

      {/* Meta Row: SKU + Price + MRP */}
      <div className="flex items-baseline justify-center gap-1.5 flex-wrap my-0.5">
        <span className="text-[8px] text-gray-600 font-mono">SKU: {product.sku || "—"}</span>
        <span className="text-[11px] font-black text-black">{formatPrice(product.price)}</span>
        {hasMrp && (
          <span className="text-[8px] text-gray-400 line-through">{formatPrice(product.mrp)}</span>
        )}
        {discPct !== null && (
          <span className="text-[7.5px] font-extrabold text-black bg-gray-100 px-1 py-0.2 rounded border border-gray-300">
            -{discPct}%
          </span>
        )}
      </div>

      {/* Barcode */}
      <div className="w-full flex justify-center items-center overflow-hidden">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={bw}
          height={bh}
          fontSize={7.5}
          margin={1}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Screen Preview Component
   ───────────────────────────────────────────── */

export function LabelPrintEngine({
  entries,
  labelType,
  layout,
  showDiscount,
}: Props) {
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">No labels to preview.</p>
    );
  }

  const containerClass =
    layout === "a4"
      ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5"
      : "flex flex-wrap items-center justify-center gap-4 py-2";

  return (
    <div className={containerClass}>
      {labels.map((product, idx) =>
        labelType === "barcode-only" ? (
          <BarcodeOnlyLabelPreview
            key={`${product.uuid}-${idx}`}
            product={product}
            layout={layout}
          />
        ) : (
          <FullProductLabelPreview
            key={`${product.uuid}-${idx}`}
            product={product}
            layout={layout}
            showDiscount={showDiscount}
          />
        ),
      )}
    </div>
  );
}

/** Legacy singleton stub for backward-compatibility */
export function DirectLabelPrintHost() {
  return null;
}
