/**
 * BarcodeQuickView — Product quick-view popup triggered by barcode scan.
 *
 * Shows: photo, name, SKU, barcode, MRP, price, stock, variant info.
 * Actions: Add to POS, View Full Product, Scan Next.
 *
 * Handles: not found, archived, out-of-stock states clearly.
 */
import { createPortal } from "react-dom";
import { X, Package, ShoppingBag, ScanLine, AlertTriangle, CheckCircle } from "lucide-react";
import { formatPrice, imageFor } from "@/lib/store";
import type { BarcodeResult } from "@/lib/pos";

type Props = {
  result: BarcodeResult | null;
  scannedCode: string;
  onClose: () => void;
  onAddToPOS?: (result: BarcodeResult) => void;
  onViewProduct?: (slug: string) => void;
  onScanNext: () => void;
};

export function BarcodeQuickView({
  result,
  scannedCode,
  onClose,
  onAddToPOS,
  onViewProduct,
  onScanNext,
}: Props) {
  if (!result && !scannedCode) return null;

  const content = (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Scanned Product"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-100 bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-[#8B2020]" />
            <span className="text-sm font-bold text-foreground">Scanned Product</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {/* NOT FOUND */}
          {(!result || !result.found) && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-7 w-7 text-red-500" />
              </div>
              <div>
                <p className="font-bold text-foreground text-base">Product Not Found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Scanned:{" "}
                  <code className="bg-muted rounded px-1.5 py-0.5 text-xs font-mono">
                    {scannedCode}
                  </code>
                </p>
              </div>
              <div className="flex gap-2 mt-2 w-full">
                <button
                  onClick={onScanNext}
                  className="flex-1 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* ARCHIVED */}
          {result?.found && result.archived && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                <Package className="h-7 w-7 text-amber-500" />
              </div>
              <div>
                <p className="font-bold text-foreground">{result.name}</p>
                <p className="text-sm text-amber-700 bg-amber-50 rounded-full px-3 py-1 mt-1 inline-block">
                  Archived — not available for sale
                </p>
                {result.sku && (
                  <p className="text-xs text-muted-foreground mt-1">SKU: {result.sku}</p>
                )}
              </div>
              <button
                onClick={onScanNext}
                className="rounded-xl border border-border px-6 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted w-full"
              >
                Scan Next
              </button>
            </div>
          )}

          {/* FOUND + ACTIVE */}
          {result?.found && !result.archived && (
            <div className="flex gap-4">
              {/* Product image */}
              <div className="shrink-0 h-20 w-20 rounded-xl overflow-hidden border border-gray-100 bg-muted">
                <img
                  src={imageFor(result.category ?? "clothing", result.image_url)}
                  alt={result.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-foreground text-sm leading-tight line-clamp-2">
                  {result.name}
                </p>
                {result.brand && (
                  <p className="text-xs text-muted-foreground mt-0.5">{result.brand}</p>
                )}

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-base font-black text-foreground">
                    {formatPrice(result.price ?? 0)}
                  </span>
                  {(result.mrp ?? 0) > (result.price ?? 0) && (
                    <span className="text-xs text-gray-400 line-through">
                      {formatPrice(result.mrp ?? 0)}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                  {result.sku && (
                    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono">
                      SKU: {result.sku}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-semibold ${
                      (result.stock ?? 0) > 0
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {(result.stock ?? 0) > 0 ? `${result.stock} in stock` : "Out of stock"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Actions for found + active products */}
          {result?.found && !result.archived && (
            <div className="mt-4 flex flex-col gap-2">
              {(result.stock ?? 0) > 0 && onAddToPOS && (
                <button
                  onClick={() => {
                    onAddToPOS(result);
                    onClose();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#8B2020] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#7a1c1c] transition-colors"
                >
                  <ShoppingBag className="h-4 w-4" />
                  Add to POS
                </button>
              )}
              {(result.stock ?? 0) <= 0 && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  Out of Stock — Cannot Add
                </div>
              )}
              <div className="flex gap-2">
                {onViewProduct && result.slug && (
                  <button
                    onClick={() => onViewProduct(result.slug!)}
                    className="flex-1 rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                  >
                    View Product
                  </button>
                )}
                <button
                  onClick={() => {
                    onScanNext();
                    onClose();
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                >
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                  Scan Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
