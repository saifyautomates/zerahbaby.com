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
  artNo?: string;
  barcode: string;
  price: number;
  mrp: number;
  stock: number;
  brand?: string;
  size?: string | null;
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
    labelType === "barcode-only" ? Math.round(previewH * 0.45) : Math.round(previewH * 0.26);

  const hasDiscount = typeof product.mrp === "number" && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((mrpVal - product.price) / mrpVal) * 100) : 0;

  const artNoVal = (product.artNo || product.sku || product.barcode || "—").toString().trim();
  const productName = (product.name || "").toString().trim().toUpperCase();
  const brandVal = (product.brand || "ZERAH").toString().trim().toUpperCase();
  const sizeVal = (product.size || "--").toString().trim();

  return (
    <div
      className="relative flex flex-col justify-between items-center text-left rounded-lg border border-gray-300 bg-white text-black shadow-sm overflow-hidden select-none shrink-0"
      style={{ width: previewW, height: previewH, padding: "5px 7px 4px" }}
    >
      {labelType === "barcode-only" ? (
        <>
          <div className="w-full flex-1 flex justify-center items-center overflow-hidden">
            <Barcode
              value={barcodeVal(product)}
              format="CODE128"
              width={cfg.barcodeBarWidthPx * 0.72}
              height={bcHeight}
              fontSize={Math.round(cfg.barcodeFontPt * 1.15)}
              margin={0}
              displayValue={true}
              background="transparent"
              lineColor="#000000"
            />
          </div>
          <p
            className="w-full truncate font-extrabold uppercase text-black tracking-wider text-center shrink-0"
            style={{ fontSize: Math.round(cfg.brandFontPt * 1.05) + "px", lineHeight: 1 }}
          >
            {brandVal}
          </p>
        </>
      ) : (
        <>
          {/* Row 1: ArtNo */}
          <div
            className="flex items-baseline w-full overflow-hidden leading-tight text-black"
            style={{ fontSize: Math.round(cfg.skuFontPt * 1.05) + "px" }}
          >
            <span className="font-extrabold mr-1">ArtNo:</span>
            <span className="font-bold truncate">{artNoVal}</span>
          </div>

          {/* Row 2: Product Name */}
          <div
            className="flex items-baseline w-full overflow-hidden leading-tight text-black"
            style={{ fontSize: Math.round(cfg.nameFontPt * 1.05) + "px" }}
          >
            <span className="font-extrabold mr-1">Product:</span>
            <span className="font-bold truncate">{productName}</span>
          </div>

          {/* Row 3: Brand & Size */}
          <div
            className="flex items-baseline justify-between w-full overflow-hidden leading-tight text-black"
            style={{ fontSize: Math.round(cfg.brandFontPt * 1.0) + "px" }}
          >
            <div className="flex items-baseline overflow-hidden mr-2">
              <span className="font-extrabold mr-1">Brand:</span>
              <span className="font-bold truncate">{brandVal}</span>
            </div>
            <div className="flex items-baseline shrink-0">
              <span className="font-extrabold mr-1">Size:</span>
              <span className="font-bold">{sizeVal}</span>
            </div>
          </div>

          {/* Row 4: M.R.P. & Taxes */}
          <div
            className="flex items-baseline justify-between w-full overflow-hidden leading-tight text-black"
            style={{ fontSize: Math.round(cfg.priceFontPt * 1.05) + "px" }}
          >
            <div className="flex items-baseline overflow-hidden">
              <span className="font-extrabold mr-1">M.R.P.:</span>
              {showMrp && showSellPrice ? (
                <>
                  <span
                    className="line-through text-gray-500 mr-1.5"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 0.9) + "px" }}
                  >
                    ₹ {Math.round(mrpVal)}
                  </span>
                  <span className="font-black">₹ {Math.round(product.price)}</span>
                </>
              ) : showSellPrice ? (
                <span className="font-black">₹ {Math.round(product.price)}</span>
              ) : (
                <span className="font-black">₹ {Math.round(mrpVal)}</span>
              )}
              {showDiscount && hasDiscount && discountPct > 0 && (
                <span
                  className="font-extrabold text-emerald-800 ml-1"
                  style={{ fontSize: Math.round(cfg.priceFontPt * 0.85) + "px" }}
                >
                  (-{discountPct}%)
                </span>
              )}
            </div>
            <span className="text-[9px] font-semibold text-black shrink-0 whitespace-nowrap ml-1">
              (Inclusive of All taxes)
            </span>
          </div>

          {/* Row 5: Horizontal Divider */}
          <div className="w-full border-t border-black my-0.5 shrink-0" />

          {/* Row 6: Barcode */}
          <div className="w-full flex justify-center items-center overflow-hidden shrink-0">
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

          {/* Row 7: Centered Footer Brand */}
          <p
            className="w-full truncate font-extrabold uppercase text-black tracking-wider text-center shrink-0"
            style={{ fontSize: Math.round(cfg.brandFontPt * 1.05) + "px", lineHeight: 1 }}
          >
            {brandVal}
          </p>
        </>
      )}
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
