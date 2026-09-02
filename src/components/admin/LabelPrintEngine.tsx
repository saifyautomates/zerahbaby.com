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
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
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

const barcodeVal = (p: LabelProduct) => sanitizeBarcode(p.barcode, p.sku) || "PREVIEW";

/* ─────────────────────────────────────────────
   Single Sticker Preview Card
   Matches physical label proportions on screen.
   ───────────────────────────────────────────── */

function SingleStickerPreview({
  product,
  labelType,
  showDiscount,
  showMrp = true,
  showSellPrice = false,
  separatePriceLine = false,
  layout,
}: {
  product: LabelProduct;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  layout: LabelLayout;
}) {
  const cfg = PRINT_FORMAT_CONFIG[layout];
  const mrpVal = typeof product.mrp === "number" && product.mrp > 0 ? product.mrp : product.price;

  // Screen preview scales ~4.2px per mm for clear representation
  const SCALE = layout === "thermal-58" ? 4.4 : layout === "a4" ? 4.0 : 4.0;
  const previewW = Math.round(cfg.labelWidthMm * SCALE);
  const previewH = Math.round(cfg.labelHeightMm * SCALE);

  const bcHeight =
    labelType === "barcode-only" ? Math.round(previewH * 0.45) : Math.round(previewH * 0.34);

  const hasDiscount = typeof product.mrp === "number" && product.mrp > product.price;
  const discountPct = hasDiscount
    ? Math.round(((mrpVal - product.price) / mrpVal) * 100)
    : 0;

  return (
    <div
      className="relative flex flex-col justify-between items-center text-center rounded-lg border border-gray-300 bg-white text-black shadow-sm overflow-hidden select-none shrink-0"
      style={{ width: previewW, height: previewH, padding: "4px 8px 3px" }}
    >
      {/* Row 1: Brand Header */}
      <p
        className="w-full truncate font-extrabold uppercase text-gray-700 tracking-wider text-center"
        style={{ fontSize: Math.round(cfg.brandFontPt * 1.1) + "px", lineHeight: 1 }}
      >
        ZÉRAH BABY &amp; KIDS
      </p>

      {/* Row 2: Product Name & Prices (Full Toggle Support) */}
      {labelType !== "barcode-only" && (
        separatePriceLine && (showMrp || showSellPrice) ? (
          <>
            {/* Standalone Product Name */}
            <p
              className="font-bold text-black text-center leading-tight line-clamp-1 truncate w-full"
              style={{ fontSize: Math.round(cfg.nameFontPt * 1.05) + "px" }}
              title={product.name}
            >
              {product.name}
            </p>

            {/* Dedicated Separate Price Row */}
            <div className="flex items-center justify-center gap-1.5 w-full leading-none overflow-hidden my-0.5">
              {showMrp && showSellPrice ? (
                <>
                  <span
                    className="text-gray-500 line-through whitespace-nowrap"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 0.9) + "px" }}
                  >
                    MRP: {formatPrice(mrpVal)}
                  </span>
                  <span
                    className="font-black text-black whitespace-nowrap"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 1.15) + "px" }}
                  >
                    Price: {formatPrice(product.price)}
                  </span>
                  {showDiscount && hasDiscount && discountPct > 0 && (
                    <span
                      className="font-extrabold text-emerald-800 whitespace-nowrap"
                      style={{ fontSize: Math.round(cfg.priceFontPt * 0.9) + "px" }}
                    >
                      (-{discountPct}%)
                    </span>
                  )}
                </>
              ) : showSellPrice ? (
                <span
                  className="font-black text-black whitespace-nowrap"
                  style={{ fontSize: Math.round(cfg.priceFontPt * 1.15) + "px" }}
                >
                  Price: {formatPrice(product.price)}
                </span>
              ) : showMrp ? (
                <>
                  <span
                    className="font-black text-black whitespace-nowrap"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 1.15) + "px" }}
                  >
                    MRP: {formatPrice(mrpVal)}
                  </span>
                  {showDiscount && hasDiscount && discountPct > 0 && (
                    <span
                      className="font-extrabold text-emerald-800 whitespace-nowrap"
                      style={{ fontSize: Math.round(cfg.priceFontPt * 0.9) + "px" }}
                    >
                      (-{discountPct}%)
                    </span>
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : (
          /* Inline Beside Product Name */
          <div className="flex items-center justify-between w-full gap-1.5 overflow-hidden">
            <p
              className="font-bold text-black text-left leading-tight line-clamp-2 truncate flex-1 min-w-0"
              style={{ fontSize: Math.round(cfg.nameFontPt * 1.05) + "px" }}
              title={product.name}
            >
              {product.name}
            </p>
            <div className="flex flex-col items-end shrink-0 leading-tight text-right">
              {showMrp && showSellPrice ? (
                <>
                  <span
                    className="text-gray-500 line-through text-[9px] whitespace-nowrap leading-none"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 0.85) + "px" }}
                  >
                    MRP: {formatPrice(mrpVal)}
                  </span>
                  <span
                    className="font-black text-black whitespace-nowrap leading-none mt-0.5"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 1.1) + "px" }}
                  >
                    Price: {formatPrice(product.price)}{" "}
                    {showDiscount && hasDiscount && discountPct > 0 && (
                      <span className="font-extrabold text-emerald-800 text-[9px]">
                        (-{discountPct}%)
                      </span>
                    )}
                  </span>
                </>
              ) : showSellPrice ? (
                <span
                  className="font-black text-black whitespace-nowrap"
                  style={{ fontSize: Math.round(cfg.priceFontPt * 1.15) + "px" }}
                >
                  Price: {formatPrice(product.price)}
                </span>
              ) : showMrp ? (
                <span
                  className="font-black text-black whitespace-nowrap"
                  style={{ fontSize: Math.round(cfg.priceFontPt * 1.15) + "px" }}
                >
                  MRP: {formatPrice(mrpVal)}{" "}
                  {showDiscount && hasDiscount && discountPct > 0 && (
                    <span className="font-extrabold text-emerald-800">
                      (-{discountPct}%)
                    </span>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        )
      )}

      {/* Row 3: Barcode with numbers */}
      <div className="w-full flex justify-center items-center overflow-hidden">
        <Barcode
          value={barcodeVal(product)}
          format="CODE128"
          width={cfg.barcodeBarWidthPx * 0.72}
          height={bcHeight}
          fontSize={Math.round(cfg.barcodeFontPt * 1.15)}
          margin={0}
          marginTop={0}
          marginBottom={0}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
      </div>

      {/* Row 4: SKU */}
      <p
        className="text-gray-700 font-bold w-full truncate text-center tracking-wide"
        style={{ fontSize: Math.round(cfg.skuFontPt * 1.1) + "px", lineHeight: 1 }}
      >
        SKU: {product.sku || product.barcode || "—"}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main Preview Component
   ───────────────────────────────────────────── */

export function LabelPrintEngine({
  entries,
  labelType,
  layout,
  showDiscount,
  showMrp = true,
  showSellPrice = false,
  separatePriceLine = false,
}: Props) {
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No labels to preview.</p>;
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
        <p className="text-[10px] text-muted-foreground/70">
          {labels.length} label{labels.length !== 1 ? "s" : ""} total
        </p>
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
                showMrp={showMrp}
                showSellPrice={showSellPrice}
                separatePriceLine={separatePriceLine}
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
              showMrp={showMrp}
              showSellPrice={showSellPrice}
              separatePriceLine={separatePriceLine}
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
