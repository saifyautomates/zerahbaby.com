/**
 * PrintLabelsModal — Enhanced label printing with quantity selector,
 * MRP display, thermal label option, and Code 128 barcodes.
 */
import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus, Settings2 } from "lucide-react";
import type { Product } from "@/lib/store";
import {
  LabelPrintEngine,
  type LabelEntry,
  type LabelType,
  type LabelLayout,
} from "./LabelPrintEngine";

export function PrintLabelsModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.uuid, 1])),
  );
  const [layout, setLayout] = useState<LabelLayout>("a4");
  const [labelType, setLabelType] = useState<LabelType>("full");
  const [showDiscount, setShowDiscount] = useState(false);

  const setQty = (uuid: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [uuid]: Math.max(0, Math.min(500, qty)) }));
  };

  const printableProducts = products.filter((p) => p.sku || p.barcode);
  const totalLabels = printableProducts.reduce((sum, p) => sum + (quantities[p.uuid] ?? 1), 0);

  const entries: LabelEntry[] = useMemo(() => {
    return printableProducts.map((p) => ({
      product: {
        uuid: p.uuid,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        price: p.price,
        mrp: p.mrp,
        stock: p.stock,
      },
      qty: quantities[p.uuid] ?? 1,
    }));
  }, [printableProducts, quantities]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-4 sm:p-6 backdrop-blur-sm print:block print:bg-white print:p-0"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl max-h-full flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — hidden during print */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/50 p-6 print:hidden">
          <div>
            <h2 className="font-display text-2xl font-bold">Print Product Labels</h2>
            <p className="text-sm text-muted-foreground">
              {totalLabels} label{totalLabels !== 1 ? "s" : ""} • {printableProducts.length} product
              {printableProducts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Layout Toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setLayout("a4")}
                className={`px-3 py-2 text-xs font-semibold transition-all ${
                  layout === "a4"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                A4 (Grid)
              </button>
              <button
                onClick={() => setLayout("thermal-80")}
                className={`px-3 py-2 text-xs font-semibold transition-all ${
                  layout === "thermal-80"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                108mm Thermal
              </button>
              <button
                onClick={() => setLayout("thermal-58")}
                className={`px-3 py-2 text-xs font-semibold transition-all ${
                  layout === "thermal-58"
                    ? "bg-[#8B2020] text-white"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                58mm Thermal
              </button>
            </div>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
            >
              <X className="size-4" /> Cancel
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#7a1c1c]"
            >
              <Printer className="size-4" /> Print Labels
            </button>
          </div>
        </div>

        {/* Configuration Bar */}
        <div className="shrink-0 border-b border-border/50 px-6 py-3 bg-gray-50/50 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2 text-sm text-gray-500 font-semibold">
            <Settings2 className="size-4" /> Config
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={labelType === "barcode-only"}
                onChange={(e) => setLabelType(e.target.checked ? "barcode-only" : "full")}
                className="rounded border-gray-300 text-[#8B2020] focus:ring-[#8B2020]"
              />
              Barcode Only
            </label>
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={showDiscount}
                onChange={(e) => setShowDiscount(e.target.checked)}
                disabled={labelType === "barcode-only"}
                className="rounded border-gray-300 text-[#8B2020] focus:ring-[#8B2020] disabled:opacity-50"
              />
              Show Discount %
            </label>
          </div>
        </div>

        {/* Quantity Controls — hidden during print */}
        <div className="shrink-0 border-b border-border/50 p-4 bg-muted/30 print:hidden">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Label Quantities
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {printableProducts.map((p) => (
              <div
                key={p.uuid}
                className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2"
              >
                <span className="flex-1 text-xs font-semibold truncate">{p.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setQty(p.uuid, (quantities[p.uuid] ?? 1) - 1)}
                    className="p-0.5 rounded hover:bg-muted"
                  >
                    <Minus className="size-3" />
                  </button>
                  <input
                    type="number"
                    value={quantities[p.uuid] ?? 1}
                    onChange={(e) => setQty(p.uuid, parseInt(e.target.value) || 0)}
                    className="w-10 text-center text-xs font-bold rounded border border-border bg-background py-0.5"
                    min={0}
                    max={200}
                  />
                  <button
                    onClick={() => setQty(p.uuid, (quantities[p.uuid] ?? 1) + 1)}
                    className="p-0.5 rounded hover:bg-muted"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Printable Area */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-8 print:overflow-visible print:bg-white print:p-0">
          <div
            className={`mx-auto bg-white shadow-sm print:max-w-none print:p-0 print:shadow-none ${
              layout.startsWith("thermal") ? "max-w-[80mm] p-2" : "max-w-[210mm] p-4"
            }`}
          >
            <LabelPrintEngine
              entries={entries}
              labelType={labelType}
              layout={layout}
              showDiscount={showDiscount}
            />
            {products.filter((p) => !p.sku && !p.barcode).length > 0 && (
              <p className="mt-8 text-center text-sm text-red-500 print:hidden">
                Warning: {products.filter((p) => !p.sku && !p.barcode).length} product(s) missing
                SKU and Barcode — excluded from this sheet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
