/**
 * PrintLabelsModal — Advanced / Manual Label Configuration Modal.
 *
 * Keeps full customizability:
 * - Multi-format layout toggle (A4, 108mm Thermal, 58mm Thermal)
 * - Persists chosen default format for future One-Click Direct prints
 * - Custom per-product quantity inputs
 * - Barcode-only vs Full product labels
 * - Discount display toggle
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Settings2, CheckCircle2 } from "lucide-react";
import type { Product } from "@/lib/store";
import {
  LabelPrintEngine,
  type LabelEntry,
  type LabelType,
  type LabelLayout,
} from "./LabelPrintEngine";
import {
  getSavedLabelProfile,
  setSavedLabelProfile,
  getSavedLabelType,
  setSavedLabelType,
  getSavedShowDiscount,
  setSavedShowDiscount,
} from "@/lib/label-printer";

export function PrintLabelsModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.uuid || p.id, 1])),
  );
  const [layout, setLayout] = useState<LabelLayout>(() => getSavedLabelProfile());
  const [labelType, setLabelType] = useState<LabelType>(() => getSavedLabelType());
  const [showDiscount, setShowDiscount] = useState<boolean>(() => getSavedShowDiscount());

  const handleLayoutChange = (newLayout: LabelLayout) => {
    setLayout(newLayout);
    setSavedLabelProfile(newLayout);
  };

  const handleLabelTypeChange = (newType: LabelType) => {
    setLabelType(newType);
    setSavedLabelType(newType);
  };

  const handleDiscountChange = (show: boolean) => {
    setShowDiscount(show);
    setSavedShowDiscount(show);
  };

  const setQty = (uuid: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [uuid]: Math.max(0, Math.min(500, qty)) }));
  };

  const printableProducts = products.filter((p) => p.sku || p.barcode);
  const totalLabels = printableProducts.reduce(
    (sum, p) => sum + (quantities[p.uuid || p.id] ?? 1),
    0,
  );

  const entries: LabelEntry[] = useMemo(() => {
    return printableProducts.map((p) => ({
      product: {
        uuid: p.uuid || p.id,
        name: p.name,
        sku: p.sku || "",
        barcode: p.barcode || p.sku || "",
        price: p.price,
        mrp: p.mrp,
        stock: p.stock,
      },
      qty: quantities[p.uuid || p.id] ?? 1,
    }));
  }, [printableProducts, quantities]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-4 sm:p-6 backdrop-blur-sm print:block print:bg-card print:p-0"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl max-h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:bg-card print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — hidden during print */}
        <div className="shrink-0 flex flex-wrap items-center justify-between border-b border-border/50 p-6 gap-4 print:hidden">
          <div>
            <h2 className="font-display text-2xl font-bold flex items-center gap-2">
              <span>Print Product Labels</span>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                Advanced Setup
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalLabels} label{totalLabels !== 1 ? "s" : ""} • {printableProducts.length} product
              {printableProducts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Layout Toggle with persistent default saving */}
            <div className="flex rounded-xl border border-border overflow-hidden bg-background">
              <button
                type="button"
                onClick={() => handleLayoutChange("a4")}
                className={`px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  layout === "a4"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                A4 (Grid)
              </button>
              <button
                type="button"
                onClick={() => handleLayoutChange("thermal-108")}
                className={`px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  layout === "thermal-108"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                108mm Thermal
              </button>
              <button
                type="button"
                onClick={() => handleLayoutChange("thermal-58")}
                className={`px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  layout === "thermal-58"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                58mm Thermal
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold shadow-xs hover:bg-muted cursor-pointer"
            >
              <X className="size-4" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2 text-sm font-bold text-white shadow-xs hover:bg-[#7a1c1c] cursor-pointer"
            >
              <Printer className="size-4" /> Print Labels
            </button>
          </div>
        </div>

        {/* Configuration Bar */}
        <div className="shrink-0 border-b border-border/50 px-6 py-3 bg-muted/50 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-semibold">
            <Settings2 className="size-3.5" />
            <span>Format: {layout.toUpperCase()}</span>
            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Auto-saved as 1-Click Default
            </span>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={labelType === "barcode-only"}
                onChange={(e) => handleLabelTypeChange(e.target.checked ? "barcode-only" : "full")}
                className="rounded border-border text-[#8B2020] focus:ring-[#8B2020]"
              />
              Barcode Only
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={showDiscount}
                onChange={(e) => handleDiscountChange(e.target.checked)}
                disabled={labelType === "barcode-only"}
                className="rounded border-border text-[#8B2020] focus:ring-[#8B2020] disabled:opacity-50"
              />
              Show Discount %
            </label>
          </div>
        </div>

        {/* Quantity Controls — hidden during print */}
        <div className="shrink-0 border-b border-border/50 p-4 bg-muted/30 print:hidden max-h-48 overflow-y-auto">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Label Quantities
          </h3>
          <div className="flex flex-wrap gap-3">
            {printableProducts.map((p) => {
              const key = p.uuid || p.id;
              const q = quantities[key] ?? 1;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-1.5 shadow-2xs"
                >
                  <span className="text-xs font-semibold text-foreground max-w-[140px] truncate">
                    {p.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQty(key, q - 1)}
                      className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer"
                    >
                      <Minus className="size-3" />
                    </button>
                    <input
                      type="number"
                      value={q}
                      onChange={(e) => setQty(key, parseInt(e.target.value) || 0)}
                      className="w-8 text-center text-xs font-bold rounded border border-border py-0.5"
                      min={0}
                      max={500}
                    />
                    <button
                      type="button"
                      onClick={() => setQty(key, q + 1)}
                      className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Preview Engine Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-muted/10 print:p-0 print:overflow-visible">
          <div className="max-w-xl mx-auto rounded-2xl bg-card border border-border/60 p-6 shadow-xs print:border-0 print:shadow-none print:p-0 print:max-w-none">
            <LabelPrintEngine
              entries={entries}
              labelType={labelType}
              layout={layout}
              showDiscount={showDiscount}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
