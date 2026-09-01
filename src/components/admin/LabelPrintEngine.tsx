/**
 * LabelPrintEngine — Screen Preview Component
 *
 * Renders a visual approximation of what will be printed.
 * Uses the same PRINT_FORMAT_CONFIG as the print engine so
 * preview and output stay in sync.
 *
 * Formats:
 *   thermal-108 → 1-Up 100mm × 25mm single sticker per row
 *   thermal-58  → 1-Up 50mm × 25mm single sticker
 *   a4          → 4-column grid on A4
 */
import { useMemo } from "react";
import Barcode from "react-barcode";
import { formatPrice } from "@/lib/store";
import type { LabelPrinterProfile, LabelType } from "@/lib/label-printer";
import { sanitizeBarcode, PRINT_FORMAT_CONFIG } from "@/lib/label-printer";

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

function safeDiscountPct(mrp: number, price: number): number | null {
  if (!mrp || mrp <= 0 || price <= 0 || mrp <= price) return null;
  const pct = Math.round(((mrp - price) / mrp) * 100);
  return isFinite(pct) && pct > 0 && pct <= 100 ? pct : null;
}

function expand(entries: LabelEntry[]): LabelProduct[] {
  const out: LabelProduct[] = [];
  for (const { product, qty } of entries) {
    const safeQty = Math.max(0, Math.min(500, qty));
    for (let i = 0; i < safeQty; i++) out.push(product);
  }
  return out;
}

const barcodeVal = (p: LabelProduct) =>
  sanitizeBarcode(p.barcode, p.sku) || "PREVIEW";

/* ─────────────────────────────────────────────
   Single Sticker Preview Card
   Matches physical label proportions on screen.
   ───────────────────────────────────────────── */

function SingleStickerPreview({
  product,
  labelType,
  showDiscount,
  layout,
}: {
  product: LabelProduct;
  labelType: LabelType;
  showDiscount: boolean;
  layout: LabelLayout;
}) {
  const discPct = showDiscount ? safeDiscountPct(product.mrp, product.price) : null;
  const hasMrp = product.mrp > product.price;
  const cfg = PRINT_FORMAT_CONFIG[layout];

  // Screen preview scales ~4px per mm for readability
  // thermal-108: 100mm → 400px wide, 25mm → 100px tall
  // thermal-58:  50mm → 200px wide, 25mm → 100px tall
  // a4 cell:     47mm → 188px wide, 26mm → 104px tall
  const SCALE = layout === "thermal-58" ? 3.6 : layout === "a4" ? 3.8 : 3.8;
  const previewW = Math.round(cfg.labelWidthMm * SCALE);
  const previewH = Math.round(cfg.labelHeightMm * SCALE);

  const bcHeight = labelType === "barcode-only" ? previewH * 0.5 : previewH * 0.38;

  return (
    <div
      className="relative flex flex-col justify-between items-center text-center rounded-lg border border-gray-300 bg-white text-black shadow-sm overflow-hidden select-none shrink-0"
      style={{ width: previewW, height: previewH, padding: "3px 5px 2px" }}
    >
      {/* Brand */}
      <p
        className="w-full truncate font-black uppercase text-gray-500"
        style={{ fontSize: Math.round(cfg.brandFontPt * 1.05) + "px", lineHeight: 1.1 }}
      >
        Zérah Baby &amp; Kids
      </p>

      {/* Name */}
      <p
        className="w-full font-bold text-black leading-tight line-clamp-2"
        style={{ fontSize: Math.round(cfg.nameFontPt * 1.05) + "px" }}
      >
        {product.name}
      </p>

      {labelType === "full" && (
        <div className="flex items-baseline justify-center gap-1 flex-wrap w-full overflow-hidden">
          <span
            className="font-black text-black whitespace-nowrap"
            style={{ fontSize: Math.round(cfg.priceFontPt * 1.05) + "px" }}
          >
            {formatPrice(product.price)}
          </span>
          {hasMrp && (
            <span
              className="text-gray-400 line-through whitespace-nowrap"
              style={{ fontSize: Math.round(cfg.skuFontPt * 1.05) + "px" }}
            >
              {formatPrice(product.mrp)}
            </span>
          )}
          {discPct !== null && (
            <span
              className="font-black text-black bg-gray-100 border border-gray-300 rounded px-1"
              style={{ fontSize: Math.round(cfg.skuFontPt * 1.05) + "px" }}
            >
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
          width={cfg.barcodeBarWidthPx * 0.65}
          height={bcHeight}
          fontSize={Math.round(cfg.barcodeFontPt * 1.1)}
          margin={1}
          marginTop={0}
          marginBottom={0}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
      </div>

      {labelType === "barcode-only" && (
        <p
          className="text-gray-500 font-mono w-full truncate"
          style={{ fontSize: Math.round(cfg.skuFontPt * 1.05) + "px" }}
        >
          SKU: {product.sku || "—"}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Preview Component
   ───────────────────────────────────────────── */

export function LabelPrintEngine({ entries, labelType, layout, showDiscount }: Props) {
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">No labels to preview.</p>
    );
  }

  const formatLabel = (() => {
    if (layout === "thermal-108") return "1-Up 100mm × 25mm Thermal";
    if (layout === "thermal-58") return "1-Up 50mm × 25mm Thermal";
    return "A4 Grid (4 columns)";
  })();

  return (
    <div className="space-y-3">
      <div className="text-center pb-1 border-b border-border/40">
        <p className="text-xs font-bold text-muted-foreground">{formatLabel}</p>
        <p className="text-[10px] text-muted-foreground/70">{labels.length} label{labels.length !== 1 ? "s" : ""} total</p>
      </div>

      {layout === "thermal-108" || layout === "thermal-58" ? (
        <div className="flex flex-col items-center gap-2 overflow-x-auto">
          {labels.map((product, idx) => (
            <div
              key={`${product.uuid}-${idx}`}
              className="flex items-center gap-0 bg-muted/30 border border-dashed border-border rounded-xl p-2"
            >
              <SingleStickerPreview
                product={product}
                labelType={labelType}
                showDiscount={showDiscount}
                layout={layout}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {labels.map((product, idx) => (
            <SingleStickerPreview
              key={`${product.uuid}-${idx}`}
              product={product}
              labelType={labelType}
              showDiscount={showDiscount}
              layout={layout}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Legacy singleton stub for backward-compatibility */
export function DirectLabelPrintHost() {
  return null;
}
