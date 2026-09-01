/**
 * PrintLabelsModal.tsx — Advanced / Manual Label Configuration Modal.
 *
 * Provides a live visual sticker preview (identical to physical thermal print)
 * with 50×25mm 1-Up Thermal automatic default, fully clickable Barcode-Only
 * and Show Discount % toggles, and quantity controls.
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Tag, CheckCircle2, Sparkles } from "lucide-react";
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
  const [layout, setLayout] = useState<LabelLayout>("thermal-58");
  const [labelType, setLabelType] = useState<LabelType>(() => getSavedLabelType());
  const [showDiscount, setShowDiscount] = useState<boolean>(() => getSavedShowDiscount());
  const [isPrinting, setIsPrinting] = useState(false);

  const handleLabelTypeChange = (newType: LabelType) => {
    setLabelType(newType);
    setSavedLabelType(newType);
    if (newType === "barcode-only") {
      setShowDiscount(false);
      setSavedShowDiscount(false);
    }
  };

  const handleDiscountToggle = (checked: boolean) => {
    setShowDiscount(checked);
    setSavedShowDiscount(checked);
    // When Show Discount % is clicked, ensure full label with text/prices is active
    if (checked && labelType === "barcode-only") {
      setLabelType("full");
      setSavedLabelType("full");
    }
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
        layout,
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
      layout,
      labelType,
      showDiscount,
      onDone: () => setIsPrinting(false),
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-3 sm:p-6 backdrop-blur-sm print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl max-h-[94vh] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/60 p-4 sm:p-5 bg-card print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#8B2020]/10 text-[#8B2020] border border-[#8B2020]/20">
              <Tag className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Print Product Labels
                </h2>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  Thermal 50×25mm
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {totalLabels} label{totalLabels !== 1 ? "s" : ""} • {printableProducts.length} product{printableProducts.length !== 1 ? "s" : ""}
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
              className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2.5 text-sm font-bold text-white shadow-premium-sm hover:bg-[#7a1c1c] active:scale-95 transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-4" />
              <span>{isPrinting ? "Printing…" : "Print Labels"}</span>
            </button>
          </div>
        </div>

        {/* Format & Option Controls Bar */}
        <div className="shrink-0 border-b border-border/60 px-4 py-3 bg-muted/20 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          {/* Format selector */}
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-muted-foreground">Format:</span>
            <div className="flex bg-muted/60 p-0.5 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setLayout("thermal-58")}
                className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  layout === "thermal-58"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                58mm Thermal (50×25mm)
              </button>
              <button
                type="button"
                onClick={() => setLayout("thermal-108")}
                className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  layout === "thermal-108"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                108mm Thermal
              </button>
              <button
                type="button"
                onClick={() => setLayout("a4")}
                className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                  layout === "a4"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                A4 Grid
              </button>
            </div>
          </div>

          {/* Fully Clickable Option Toggles */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground select-none">
              <input
                type="checkbox"
                checked={labelType === "barcode-only"}
                onChange={(e) => handleLabelTypeChange(e.target.checked ? "barcode-only" : "full")}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span>Barcode Only</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground select-none">
              <input
                type="checkbox"
                checked={showDiscount}
                onChange={(e) => handleDiscountToggle(e.target.checked)}
                className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
              />
              <span className="flex items-center gap-1">
                <Sparkles className="size-3 text-amber-500" />
                <span>Show Discount %</span>
              </span>
            </label>
          </div>
        </div>

        {/* Quantities Quick Selector */}
        <div className="shrink-0 px-4 py-2.5 bg-muted/10 border-b border-border/40 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground mr-1">
            Quantities:
          </span>
          {printableProducts.map((p) => {
            const key = p.uuid || p.id;
            const q = quantities[key] ?? 1;
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1 shadow-2xs"
              >
                <span className="text-xs font-bold text-foreground max-w-[110px] truncate" title={p.name}>
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
                    className="w-8 text-center text-xs font-black rounded border border-border py-0.5 bg-background"
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

        {/* Live Sticker Preview Center Area — Full Prominent View */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100 dark:bg-slate-900/60 flex flex-col items-center justify-start min-h-[260px] max-h-[50vh]">
          <div className="w-full flex flex-col items-center">
            <LabelPrintEngine
              entries={entries}
              labelType={labelType}
              layout={layout}
              showDiscount={showDiscount}
            />
          </div>
        </div>

        {/* Footer info & print shortcut */}
        <div className="shrink-0 border-t border-border/60 p-4 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground print:hidden">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            <span>Exact physical preview (Horizontal 50×25mm sticker)</span>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            disabled={isPrinting || printableProducts.length === 0}
            className="flex items-center gap-1.5 font-bold text-[#8B2020] hover:underline cursor-pointer disabled:opacity-50"
          >
            <Printer className="size-3.5" />
            <span>Ready to Print {totalLabels} Label{totalLabels !== 1 ? "s" : ""}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
