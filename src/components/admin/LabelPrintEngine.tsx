/**
 * LabelPrintEngine — Interactive Label Screen Preview Engine & Direct Host.
 *
 * Supports:
 * - "thermal-108": 2-Up Desktop Barcode Sticker Roll (100mm × 25mm row, 2 stickers per row)
 * - "thermal-58": 1-Up POS Thermal Barcode Sticker (50mm × 25mm)
 * - "a4": 4-column A4 grid sheet
 */
import { useMemo } from "react";
import Barcode from "react-barcode";
import { formatPrice } from "@/lib/store";
import type { LabelPrinterProfile, LabelType } from "@/lib/label-printer";
import { sanitizeBarcode } from "@/lib/label-printer";

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

/** Safe discount % calculation */
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

/** Barcode value with sanitization */
const barcodeVal = (p: LabelProduct) => sanitizeBarcode(p.barcode, p.sku);

/* ─────────────────────────────────────────────
   Single Sticker Preview Card (48×24mm)
   ───────────────────────────────────────────── */

function SingleStickerPreview({
  product,
  labelType,
  showDiscount,
}: {
  product: LabelProduct;
  labelType: LabelType;
  showDiscount: boolean;
}) {
  const discPct = showDiscount ? safeDiscountPct(product.mrp, product.price) : null;
  const hasMrp = product.mrp > product.price;

  return (
    <div className="relative flex flex-col justify-between items-center text-center rounded-xl border border-gray-300 bg-white text-black shadow-xs overflow-hidden w-[190px] h-[100px] p-2 select-none">
      {/* Header */}
      <div className="w-full">
        <p className="text-[7.5px] font-black uppercase tracking-widest text-gray-500 truncate">
          Zérah Baby &amp; Kids
        </p>
        <p className="text-[9px] font-bold text-black truncate leading-tight mt-0.5">
          {product.name}
        </p>
      </div>

      {labelType === "full" && (
        <div className="flex items-baseline justify-center gap-1.5 flex-wrap my-0.5">
          <span className="text-[7.5px] text-gray-600 font-mono">SKU: {product.sku || "—"}</span>
          <span className="text-[10.5px] font-black text-black">{formatPrice(product.price)}</span>
          {hasMrp && (
            <span className="text-[7.5px] text-gray-400 line-through">
              {formatPrice(product.mrp)}
            </span>
          )}
          {discPct !== null && (
            <span className="text-[7px] font-black text-black bg-gray-100 px-1 rounded border border-gray-300">
              -{discPct}%
            </span>
          )}
        </div>
      )}

      {/* Barcode */}
      <div className="w-full flex justify-center items-center overflow-hidden">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={0.82}
          height={labelType === "barcode-only" ? 22 : 15}
          fontSize={7}
          margin={1}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
      </div>

      {labelType === "barcode-only" && (
        <p className="text-[7.5px] text-gray-600 font-mono">SKU: {product.sku || "—"}</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Screen Preview Component
   ───────────────────────────────────────────── */

export function LabelPrintEngine({ entries, labelType, layout, showDiscount }: Props) {
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">No labels to preview.</p>
    );
  }

  if (layout === "thermal-108") {
    // 2-Up thermal sticker rows
    const rows: Array<[LabelProduct, LabelProduct | null]> = [];
    for (let i = 0; i < labels.length; i += 2) {
      rows.push([labels[i], labels[i + 1] || null]);
    }

    return (
      <div className="space-y-3">
        <div className="text-center pb-1 border-b border-border/40">
          <p className="text-xs font-bold text-muted-foreground">
            2-Up Thermal Preview (100mm × 25mm • 2 Stickers / Row)
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          {rows.map(([left, right], idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 p-2 rounded-2xl bg-muted/40 border border-dashed border-border"
            >
              <SingleStickerPreview
                product={left}
                labelType={labelType}
                showDiscount={showDiscount}
              />
              {right ? (
                <SingleStickerPreview
                  product={right}
                  labelType={labelType}
                  showDiscount={showDiscount}
                />
              ) : (
                <div className="w-[190px] h-[100px] rounded-xl border border-dashed border-border/50 bg-card/40 flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                  (Empty sticker slot)
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (layout === "thermal-58") {
    return (
      <div className="space-y-3">
        <div className="text-center pb-1 border-b border-border/40">
          <p className="text-xs font-bold text-muted-foreground">
            1-Up Single Thermal Preview (50mm × 25mm)
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {labels.map((product, idx) => (
            <SingleStickerPreview
              key={`${product.uuid}-${idx}`}
              product={product}
              labelType={labelType}
              showDiscount={showDiscount}
            />
          ))}
        </div>
      </div>
    );
  }

  // A4 grid
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
      {labels.map((product, idx) => (
        <SingleStickerPreview
          key={`${product.uuid}-${idx}`}
          product={product}
          labelType={labelType}
          showDiscount={showDiscount}
        />
      ))}
    </div>
  );
}

/** Legacy singleton stub for backward-compatibility */
export function DirectLabelPrintHost() {
  return null;
}
