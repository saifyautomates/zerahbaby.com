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
import type { LabelPrinterProfile, LabelType, LabelRotation } from "@/lib/label-printer";
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
  showProductName?: boolean;
  separatePriceLine?: boolean;
  customWidthMm?: number;
  customHeightMm?: number;
  widthMm?: number;
  heightMm?: number;
  rotation?: LabelRotation;
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
  showProductName = true,
  separatePriceLine = true,
  layout,
  customWidthMm,
  customHeightMm,
  rotation = 0,
}: {
  product: LabelProduct;
  labelType: LabelType;
  showDiscount: boolean;
  showMrp?: boolean;
  showSellPrice?: boolean;
  showProductName?: boolean;
  separatePriceLine?: boolean;
  layout: LabelLayout;
  customWidthMm?: number;
  customHeightMm?: number;
  rotation?: LabelRotation;
}) {
  const cfg = resolvePrintFormatConfig(layout, customWidthMm, customHeightMm);
  const mrpVal = typeof product.mrp === "number" && product.mrp > 0 ? product.mrp : product.price;

  // Compute screen preview dimensions maintaining the label\'s physical aspect ratio.
  // For 90°/270° the physical page itself is rotated, so the outer preview
  // dimensions must also swap. This keeps the screen preview in sync with print.
  const basePreviewW = cfg.isSheet
    ? 220
    : Math.max(180, Math.min(260, Math.round(cfg.labelWidthMm * 4.4)));
  const basePreviewH = cfg.isSheet
    ? Math.max(
        85,
        Math.round(basePreviewW * (cfg.labelHeightMm / cfg.labelWidthMm)),
      )
    : Math.max(
        85,
        Math.round(basePreviewW * (cfg.labelHeightMm / cfg.labelWidthMm)),
      );

  const isCompact = cfg.labelHeightMm <= 35;
  const isRotated = rotation === 90 || rotation === 270;
  const previewW = !cfg.isSheet && isRotated ? basePreviewH : basePreviewW;
  const previewH = !cfg.isSheet && isRotated ? basePreviewW : basePreviewH;

  const bcHeight = isRotated
    ? Math.min(26, Math.max(20, Math.round(basePreviewW * 0.12)))
    : (isCompact ? 24 : Math.max(28, Math.min(48, Math.round(basePreviewH * 0.18))));

  const hasDiscount = mrpVal > product.price && product.price > 0;
  const discountPct = hasDiscount ? Math.round(((mrpVal - product.price) / mrpVal) * 100) : 0;

  const artNoVal = (product.artNo || product.sku || product.barcode || "—").toString().trim();
  const brandVal = (product.brand || "ZERAH").toString().trim().toUpperCase();
  const sizeVal = (product.size || "--").toString().trim();
  const mrpFormatted = "₹" + Math.round(mrpVal);
  const priceFormatted = "₹" + Math.round(product.price);
  const barcodeValue = barcodeVal(product);

  const innerStyle: React.CSSProperties = isRotated
    ? {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: basePreviewW,
        height: basePreviewH,
        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        transformOrigin: "center center",
        padding: isCompact ? "4px 6px" : "10px 8px",
        justifyContent: "center",
        gap: isCompact ? "3px" : "6px",
      }
    : rotation === 180
    ? {
        width: "100%",
        height: "100%",
        padding: isCompact ? "6px 8px" : "12px 10px 10px",
        justifyContent: "center",
        gap: isCompact ? "4px" : "12px",
        transform: "rotate(180deg)",
        transformOrigin: "center center",
      }
    : {
        width: "100%",
        height: "100%",
        padding: isCompact ? "6px 8px" : "12px 10px 10px",
        justifyContent: "center",
        gap: isCompact ? "4px" : "12px",
      };

  if (labelType === "barcode-only") {
    return (
      <div
        className="relative flex items-center justify-center text-center rounded-2xl border border-border bg-white text-black shadow-md overflow-hidden select-none shrink-0"
        style={{
          width: previewW,
          height: previewH,
        }}
      >
        <div className="flex flex-col items-center text-center" style={innerStyle}>
          <p className="w-full truncate font-bold uppercase text-slate-500 tracking-wider text-center text-[10px]">
            Zérah Baby &amp; Kids
          </p>
          <div className="mt-1 w-full flex flex-col items-center justify-center text-center">
            <Barcode
              value={barcodeValue}
              format="CODE128"
              width={isRotated ? 1.0 : (isCompact ? 1.0 : 1.25)}
              height={bcHeight * 1.3}
              fontSize={isCompact || isRotated ? 9 : 10}
              margin={0}
              displayValue={true}
              background="transparent"
              lineColor="#000000"
            />
            <p className="mt-1 text-[10px] font-bold text-slate-600 text-center w-full">
              SKU: {product.sku || artNoVal}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex items-center justify-center text-center rounded-2xl border border-border bg-white text-black shadow-md overflow-hidden select-none shrink-0"
      style={{
        width: previewW,
        height: previewH,
      }}
    >
      <div className="flex flex-col items-center text-center w-full" style={innerStyle}>
        <div className="flex flex-col items-center w-full">
          <p className="text-[11px] font-black uppercase tracking-wider text-[#1e3a5f]">
            ZÉRAH BABY &amp; KIDS
          </p>

          {showProductName && (
            <p className="font-black text-black text-center line-clamp-1 px-1 text-base mt-0.5">
              {product.name || "Product Name"}
            </p>
          )}

          {(showSellPrice || showMrp || showDiscount) && (
            <div className="flex items-center justify-center gap-2 mt-1">
              {showSellPrice && (
                <span className="font-black text-2xl text-black tracking-tight">{priceFormatted}</span>
              )}
              {showSellPrice && ((showMrp && mrpVal > product.price) || (showDiscount && discountPct > 0)) && (
                <div className="h-5 w-px bg-slate-300 mx-0.5" />
              )}
              {showMrp && mrpVal > 0 && (
                <span className="text-sm font-bold text-slate-500 line-through">
                  {mrpFormatted}
                </span>
              )}
              {showDiscount && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-[#ff5500] text-white shadow-2xs uppercase tracking-wider">
                  {discountPct}% OFF
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-1.5 w-full flex flex-col items-center justify-center text-center">
          <Barcode
            value={barcodeValue}
            format="CODE128"
            width={isRotated ? 1.0 : (isCompact ? 1.1 : 1.35)}
            height={bcHeight}
            fontSize={isCompact || isRotated ? 9 : 11}
            margin={0}
            displayValue={true}
            background="transparent"
            lineColor="#000000"
          />
          <p className="mt-1 text-xs font-black text-[#1e3a5f] text-center w-full tracking-wider">
            SKU: {product.sku || artNoVal}
          </p>
        </div>
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
  showProductName = true,
  separatePriceLine = true,
  customWidthMm,
  customHeightMm,
  widthMm,
  heightMm,
  rotation = 0,
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
        <p className="text-xs font-bold text-muted-foreground">
          {cfg.name} {rotation !== 0 ? `• ${rotation}° Rotated` : ""}
        </p>
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
                showProductName={showProductName}
                separatePriceLine={separatePriceLine}
                layout={layout}
                customWidthMm={activeCustomW}
                customHeightMm={activeCustomH}
                rotation={rotation}
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
                showProductName={showProductName}
                separatePriceLine={separatePriceLine}
                layout={layout}
                customWidthMm={activeCustomW}
                customHeightMm={activeCustomH}
                rotation={rotation}
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
