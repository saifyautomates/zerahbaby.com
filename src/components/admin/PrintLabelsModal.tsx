/**
 * PrintLabelsModal — Advanced / Manual Label Configuration Modal.
 *
 * Provides a live visual sticker preview (identical to ThermalReceipt modal aesthetic)
 * with 50×25mm 1-Up Thermal automatic default, barcode-only & discount % toggles,
 * and quantity controls.
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Tag, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/store";
import {
  LabelPrintEngine,
  type LabelEntry,
  type LabelType,
  type LabelLayout,
} from "./LabelPrintEngine";
import {
  getSavedLabelType,
  setSavedLabelType,
  getSavedShowDiscount,
  setSavedShowDiscount,
  printThermalLabelsDirectly,
  printLabelsViaIframe,
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
  const layout: LabelLayout = "thermal-58";
  const [labelType, setLabelType] = useState<LabelType>(() => getSavedLabelType());
  const [showDiscount, setShowDiscount] = useState<boolean>(() => getSavedShowDiscount());
  const [isPrinting, setIsPrinting] = useState(false);

  const handleLabelTypeChange = (newType: LabelType) => {
    setLabelType(newType);
    setSavedLabelType(newType);
  };

  const handleDiscountChange = (show: boolean) => {
    setShowDiscount(show);
    setSavedShowDiscount(show);
  };

  const setQty = (uuid: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [uuid]: Math.max(1, Math.min(500, qty)) }));
  };

  const printableProducts = products.filter((p) => p.sku || p.barcode || p.name);
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
        mrp: p.mrp || p.price,
        stock: p.stock ?? 1,
      },
      qty: quantities[p.uuid || p.id] ?? 1,
    }));
  }, [printableProducts, quantities]);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      // Try hardware direct TSPL via QZ Tray first
      const res = await printThermalLabelsDirectly({
        products: printableProducts,
        quantities,
        layout: "thermal-58",
        labelType,
        showDiscount,
      });
      if (res.success) {
        toast.success("Printed to thermal printer directly!");
        setIsPrinting(false);
        return;
      }
    } catch {
      // Fallback to iframe browser print
    }

    printLabelsViaIframe({
      products: printableProducts,
      quantities,
      layout: "thermal-58",
      labelType,
      showDiscount,
      onDone: () => setIsPrinting(false),
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-sm print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg max-h-[92vh] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — matching Thermal Receipt modal aesthetic */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/60 p-5 bg-card print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8B2020]/10 text-[#8B2020] border border-[#8B2020]/20">
              <Tag className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">
                Thermal Barcode Label
              </h2>
              <p className="text-xs text-muted-foreground">
                50×25mm Thermal Roll • {totalLabels} sticker{totalLabels !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting || printableProducts.length === 0}
              className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-4 py-2 text-sm font-bold text-white shadow-premium-sm hover:bg-[#7a1c1c] active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-4" />
              <span>{isPrinting ? "Printing…" : "Print"}</span>
            </button>
          </div>
        </div>

        {/* Status Badge */}
        <div className="px-5 pt-3 pb-1 bg-card print:hidden">
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2 flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            <span>Sticker preview ready (50mm × 25mm 1-Up Thermal Roll)</span>
          </div>
        </div>

        {/* Live Sticker Preview Center Area */}
        <div className="flex-1 overflow-y-auto p-5 bg-muted/20 flex flex-col items-center justify-center min-h-[190px] max-h-[380px]">
          <LabelPrintEngine
            entries={entries}
            labelType={labelType}
            layout={layout}
            showDiscount={showDiscount}
          />
        </div>

        {/* Controls & Options Bar */}
        <div className="shrink-0 border-t border-border/60 p-4 bg-muted/30 space-y-3 print:hidden">
          {/* Quantity Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Quantity / Copies
            </span>
            <div className="flex flex-wrap gap-2">
              {printableProducts.map((p) => {
                const key = p.uuid || p.id;
                const q = quantities[key] ?? 1;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 shadow-2xs"
                  >
                    <span className="text-xs font-semibold text-foreground max-w-[120px] truncate">
                      {p.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(key, q - 1)}
                        className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer active:scale-95 transition"
                      >
                        <Minus className="size-3" />
                      </button>
                      <input
                        type="number"
                        value={q}
                        onChange={(e) => setQty(key, parseInt(e.target.value) || 1)}
                        className="w-9 text-center text-xs font-bold rounded border border-border py-0.5 bg-background"
                        min={1}
                        max={500}
                      />
                      <button
                        type="button"
                        onClick={() => setQty(key, q + 1)}
                        className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/50 hover:bg-muted text-muted-foreground cursor-pointer active:scale-95 transition"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Options Toggles */}
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-border/40 text-xs font-semibold">
            <label className="flex items-center gap-2 cursor-pointer hover:text-foreground text-muted-foreground transition">
              <input
                type="checkbox"
                checked={labelType === "barcode-only"}
                onChange={(e) => handleLabelTypeChange(e.target.checked ? "barcode-only" : "full")}
                className="rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Barcode Only</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer hover:text-foreground text-muted-foreground transition">
              <input
                type="checkbox"
                checked={showDiscount}
                onChange={(e) => handleDiscountChange(e.target.checked)}
                disabled={labelType === "barcode-only"}
                className="rounded border-border text-[#8B2020] focus:ring-[#8B2020] disabled:opacity-50 cursor-pointer"
              />
              <span>Show Discount %</span>
            </label>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
