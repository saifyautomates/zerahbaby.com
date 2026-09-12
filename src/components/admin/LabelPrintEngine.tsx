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
  const SCALE = layout === "thermal-58" ? 4.2 : layout === "a4" ? 3.8 : 3.8;
  const previewW = Math.round(cfg.labelWidthMm * SCALE);
  const previewH = Math.round(cfg.labelHeightMm * SCALE);

  const hasDiscount = typeof product.mrp === "number" && product.mrp > product.price;
  const discountPct = hasDiscount ? Math.round(((mrpVal - product.price) / mrpVal) * 100) : 0;

  const artNoVal = (product.artNo || product.sku || product.barcode || "—").toString().trim();
  const productName = (product.name || "").toString().trim().toUpperCase();
  const brandVal = (product.brand || "ZERAH").toString().trim().toUpperCase();
  const sizeVal = (product.size || "--").toString().trim();

  return (
    <div
      className="relative flex flex-col justify-between items-start text-left rounded-xl border border-gray-300 bg-white text-black shadow-md select-none shrink-0"
      style={{
        width: previewW,
        minHeight: previewH,
        padding: `${Math.round(cfg.paddingTopMm * SCALE)}px ${Math.round(cfg.paddingHorizMm * SCALE)}px ${Math.round(cfg.paddingBottomMm * SCALE)}px`,
      }}
    >
      {labelType === "barcode-only" ? (
        <div className="w-full flex-1 flex flex-col justify-center items-center py-4">
          <Barcode
            value={barcodeVal(product)}
            format="CODE128"
            width={cfg.barcodeBarWidthPx * 0.9}
            height={Math.round(cfg.barcodeHeightMm * 2.8)}
            fontSize={Math.round(cfg.barcodeFontPt * 1.3)}
            margin={2}
            displayValue={true}
            background="transparent"
            lineColor="#000000"
          />
          <p
            className="w-full truncate font-extrabold uppercase text-black tracking-wider text-center shrink-0 mt-3"
            style={{ fontSize: Math.round(cfg.brandFontPt * 1.3) + "px", lineHeight: 1.2 }}
          >
            {brandVal}
          </p>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col justify-between gap-2">
          {/* Top Metadata Section */}
          <div className="w-full space-y-1">
            {/* Row 1: Art No */}
            <div
              className="flex items-baseline w-full leading-tight text-black"
              style={{ fontSize: Math.round(cfg.skuFontPt * 1.2) + "px" }}
            >
              <span className="font-extrabold mr-1 shrink-0">Art No:</span>
              <span className="font-bold break-words">{artNoVal}</span>
            </div>

            {/* Row 2: Product Name */}
            <div
              className="flex items-baseline w-full leading-tight text-black"
              style={{ fontSize: Math.round(cfg.nameFontPt * 1.2) + "px" }}
            >
              <span className="font-extrabold mr-1 shrink-0">Product:</span>
              <span className="font-bold break-words leading-tight">{productName}</span>
            </div>

            {/* Row 3: Brand */}
            <div
              className="flex items-baseline w-full leading-tight text-black"
              style={{ fontSize: Math.round(cfg.brandFontPt * 1.2) + "px" }}
            >
              <span className="font-extrabold mr-1 shrink-0">Brand:</span>
              <span className="font-bold">{brandVal}</span>
            </div>

            {/* Row 4: Size */}
            <div
              className="flex items-baseline w-full leading-tight text-black"
              style={{ fontSize: Math.round(cfg.skuFontPt * 1.2) + "px" }}
            >
              <span className="font-extrabold mr-1 shrink-0">Size:</span>
              <span className="font-bold">{sizeVal}</span>
            </div>

            {/* Row 5: M.R.P. & Taxes */}
            <div className="pt-1">
              <div
                className="flex items-baseline w-full leading-tight text-black"
                style={{ fontSize: Math.round(cfg.priceFontPt * 1.3) + "px" }}
              >
                <span className="font-extrabold mr-1 shrink-0">M.R.P.:</span>
                {showMrp && showSellPrice ? (
                  <>
                    <span
                      className="line-through text-gray-500 mr-1.5"
                      style={{ fontSize: Math.round(cfg.priceFontPt * 1.1) + "px" }}
                    >
                      ₹{Math.round(mrpVal)}
                    </span>
                    <span className="font-black">₹{Math.round(product.price)}</span>
                  </>
                ) : showSellPrice ? (
                  <span className="font-black">₹{Math.round(product.price)}</span>
                ) : (
                  <span className="font-black">₹{Math.round(mrpVal)}</span>
                )}
                {showDiscount && hasDiscount && discountPct > 0 && (
                  <span
                    className="font-extrabold text-emerald-800 ml-1.5"
                    style={{ fontSize: Math.round(cfg.priceFontPt * 1.0) + "px" }}
                  >
                    (-{discountPct}%)
                  </span>
                )}
              </div>
              <p
                className="font-bold text-black text-left mt-0.5"
                style={{ fontSize: Math.round(cfg.priceFontPt * 0.9) + "px" }}
              >
                (Inclusive of All Taxes)
              </p>
            </div>
          </div>

          {/* Divider, Barcode & Footer Brand */}
          <div className="w-full flex flex-col items-center pt-2">
            <div className="w-full border-t border-black mb-2 shrink-0" />
            <div className="w-full flex justify-center items-center overflow-hidden shrink-0">
              <Barcode
                value={barcodeVal(product)}
                format="CODE128"
                width={cfg.barcodeBarWidthPx * 0.85}
                height={Math.round(cfg.barcodeHeightMm * 2.6)}
                fontSize={Math.round(cfg.barcodeFontPt * 1.25)}
                margin={1}
                marginTop={1}
                marginBottom={1}
                displayValue={true}
                background="transparent"
                lineColor="#000000"
              />
            </div>
            <p
              className="w-full truncate font-extrabold uppercase text-black tracking-wider text-center shrink-0 mt-1.5"
              style={{ fontSize: Math.round(cfg.brandFontPt * 1.2) + "px", lineHeight: 1.2 }}
            >
              {brandVal}
            </p>
          </div>
        </div>
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
    if (layout === "thermal-108") return "1-Up 75mm × 100mm Thermal (Portrait)";
    if (layout === "thermal-58") return "1-Up 50mm × 75mm Thermal (Portrait)";
    return "A4 Grid (4-Column Portrait)";
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
