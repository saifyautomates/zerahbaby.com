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
import { sanitizeBarcode, PRINT_FORMAT_CONFIG, resolvePrintFormatConfig } from "@/lib/label-printer";

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
  customWidthMm?: number;
  customHeightMm?: number;
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
  showSellPrice = true,
  layout,
  customWidthMm,
  customHeightMm,
}: {
  product: LabelProduct;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  separatePriceLine?: boolean;
  layout: LabelLayout;
  customWidthMm?: number;
  customHeightMm?: number;
}) {
  const cfg = resolvePrintFormatConfig(layout, customWidthMm, customHeightMm);
  const mrpVal = typeof product.mrp === "number" && product.mrp > 0 ? product.mrp : product.price;

  // Compute screen preview dimensions maintaining exact physical aspect ratio
  const previewW = cfg.isSheet
    ? 220
    : Math.max(180, Math.min(260, Math.round(cfg.labelWidthMm * 4.4)));
  const previewH = Math.max(
    140,
    Math.round(previewW * (cfg.labelHeightMm / cfg.labelWidthMm)),
  );

  const bcHeight = Math.max(20, Math.round(previewH * 0.12));

  const hasDiscount = typeof product.mrp === "number" && product.mrp > product.price && product.price > 0;
  const discountPct = hasDiscount ? Math.round(((mrpVal - product.price) / mrpVal) * 100) : 0;

  const artNoVal = (product.artNo || product.sku || product.barcode || "—").toString().trim();
  const brandVal = (product.brand || "ZERAH").toString().trim().toUpperCase();
  const sizeVal = (product.size || "--").toString().trim();
  const mrpFormatted = "₹" + Math.round(mrpVal);
  const priceFormatted = "₹" + Math.round(product.price);
  const barcodeValue = barcodeVal(product);

  if (labelType === "barcode-only") {
    return (
      <div
        className="relative flex flex-col items-center text-center rounded-2xl border border-border bg-white text-black shadow-md overflow-hidden select-none shrink-0"
        style={{
          width: previewW,
          height: previewH,
          padding: "12px 10px 10px",
          justifyContent: "space-between",
        }}
      >
        <p className="w-full truncate font-bold uppercase text-slate-500 tracking-wider text-center text-[10px]">
          Zérah Baby &amp; Kids
        </p>
        <div className="mt-2 scale-90 w-full flex flex-col items-center justify-center">
          <Barcode
            value={barcodeValue}
            format="CODE128"
            width={1.2}
            height={bcHeight * 1.5}
            fontSize={10}
            margin={0}
            displayValue={true}
            background="transparent"
            lineColor="#000000"
          />
          <p className="mt-1 text-[9px] text-muted-foreground">
            SKU: {product.sku || artNoVal}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col items-center text-center rounded-2xl border border-border bg-white text-black shadow-md overflow-hidden select-none shrink-0"
      style={{
        width: previewW,
        height: previewH,
        padding: "12px 10px 10px",
        justifyContent: "space-between",
      }}
    >
      <div className="flex flex-col items-center w-full">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Zérah Baby &amp; Kids
        </p>
        <p className="text-xs font-semibold mt-1 text-center line-clamp-2 px-1">
          {product.name || "Product Name"}
        </p>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-sm font-black">{priceFormatted}</span>
          {mrpVal > product.price && (
            <span className="text-[10px] text-muted-foreground line-through">
              {mrpFormatted}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 scale-90 w-full flex flex-col items-center">
        <Barcode
          value={barcodeValue}
          format="CODE128"
          width={1.2}
          height={bcHeight}
          fontSize={10}
          margin={0}
          displayValue={true}
          background="transparent"
          lineColor="#000000"
        />
        <p className="mt-1 text-[9px] text-muted-foreground">
          SKU: {product.sku || artNoVal}
        </p>
      </div>
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
  showSellPrice = true,
  separatePriceLine = true,
  customWidthMm,
  customHeightMm,
  widthMm,
  heightMm,
}: Props) {
  const activeCustomW = customWidthMm || widthMm;
  const activeCustomH = customHeightMm || heightMm;
  const cfg = resolvePrintFormatConfig(layout, activeCustomW, activeCustomH);
  const labels = useMemo(() => expand(entries), [entries]);

  if (labels.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No labels to preview.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="text-center pb-1 border-b border-border/40">
        <p className="text-xs font-bold text-muted-foreground">{cfg.name}</p>
        <p className="text-[10px] text-muted-foreground/70">
          {labels.length} label{labels.length !== 1 ? "s" : ""} total
        </p>
      </div>

      {!cfg.isSheet ? (
        <div className="flex flex-col items-center gap-3 overflow-x-auto p-1">
          {labels.map((product, idx) => (
            <div
              key={`${product.uuid}-${idx}`}
              className="flex flex-col items-center gap-1 bg-muted/30 border border-dashed border-border rounded-xl p-2.5"
            >
              <span className="text-[10px] font-bold text-muted-foreground">
                {cfg.shortLabel} Sticker #{idx + 1}
              </span>
              <SingleStickerPreview
                product={product}
                labelType={labelType}
                showDiscount={showDiscount}
                showMrp={showMrp}
                showSellPrice={showSellPrice}
                separatePriceLine={separatePriceLine}
                layout={layout}
                customWidthMm={activeCustomW}
                customHeightMm={activeCustomH}
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          className={`grid gap-2 ${
            (cfg.gridColumns || 3) === 3
              ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
              : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
          }`}
        >
          {labels.map((product, idx) => (
            <div
              key={`${product.uuid}-${idx}`}
              className="flex flex-col items-center gap-1 bg-muted/20 border border-dashed border-border rounded-xl p-2"
            >
              <SingleStickerPreview
                product={product}
                labelType={labelType}
                showDiscount={showDiscount}
                showMrp={showMrp}
                showSellPrice={showSellPrice}
                separatePriceLine={separatePriceLine}
                layout={layout}
                customWidthMm={activeCustomW}
                customHeightMm={activeCustomH}
              />
            </div>
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
