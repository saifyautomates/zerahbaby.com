/**
 * PrintLabelsModal — Enhanced label printing with quantity selector,
 * MRP display, thermal label option, and Code 128 barcodes.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Minus, Plus } from "lucide-react";
import Barcode from "react-barcode";
import type { Product } from "@/lib/store";
import { formatPrice } from "@/lib/store";

type LabelProduct = Product & { labelQty?: number };

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
  const [layout, setLayout] = useState<"a4" | "thermal">("a4");

  const setQty = (uuid: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [uuid]: Math.max(0, Math.min(200, qty)) }));
  };

  const printableProducts = products.filter((p) => p.sku || p.barcode);
  const totalLabels = printableProducts.reduce(
    (sum, p) => sum + (quantities[p.uuid] ?? 1),
    0,
  );

  // Expand products by quantity for printing
  const expandedLabels: Product[] = [];
  for (const p of printableProducts) {
    const qty = quantities[p.uuid] ?? 1;
    for (let i = 0; i < qty; i++) {
      expandedLabels.push(p);
    }
  }

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
            <h2 className="font-display text-2xl font-bold">
              Print Product Labels
            </h2>
            <p className="text-sm text-muted-foreground">
              {totalLabels} label{totalLabels !== 1 ? "s" : ""} •{" "}
              {printableProducts.length} product{printableProducts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Layout Toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setLayout("a4")}
                className={`px-3 py-2 text-xs font-semibold transition-all ${
                  layout === "a4"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                A4 Sheet
              </button>
              <button
                onClick={() => setLayout("thermal")}
                className={`px-3 py-2 text-xs font-semibold transition-all ${
                  layout === "thermal"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                Thermal
              </button>
            </div>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
            >
              <X className="size-4" /> Cancel
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Printer className="size-4" /> Print Labels
            </button>
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
                <span className="flex-1 text-xs font-semibold truncate">
                  {p.name}
                </span>
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
              layout === "thermal"
                ? "max-w-[58mm] p-2"
                : "max-w-[210mm] p-4"
            }`}
          >
            <div
              className={
                layout === "thermal"
                  ? "flex flex-col gap-3"
                  : "grid grid-cols-4 gap-4 print:grid-cols-4"
              }
            >
              {expandedLabels.map((product, idx) => (
                <div
                  key={product.uuid + "-" + idx}
                  className={`flex flex-col items-center justify-center text-center break-inside-avoid ${
                    layout === "thermal"
                      ? "py-3 border-b border-dashed border-slate-300"
                      : "rounded-xl border-2 border-dashed border-slate-300 p-4 print:border-solid print:border-slate-200"
                  }`}
                >
                  <p className="w-full truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Zérah Baby & Kids
                  </p>
                  <p
                    className={`mt-1 w-full font-semibold leading-tight text-slate-900 ${
                      layout === "thermal"
                        ? "text-[11px] line-clamp-2"
                        : "text-xs line-clamp-2 min-h-[2rem]"
                    }`}
                  >
                    {product.name}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900">
                      {formatPrice(product.price)}
                    </span>
                    {product.mrp > product.price && (
                      <span className="text-[10px] text-slate-400 line-through">
                        {formatPrice(product.mrp)}
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-2 w-full flex justify-center ${
                      layout === "thermal" ? "scale-75" : "scale-90"
                    }`}
                  >
                    <Barcode
                      value={product.barcode || product.sku}
                      format="CODE128"
                      width={layout === "thermal" ? 1 : 1.2}
                      height={layout === "thermal" ? 30 : 40}
                      fontSize={layout === "thermal" ? 8 : 10}
                      margin={0}
                      displayValue={true}
                      background="transparent"
                    />
                  </div>
                  <p className="mt-1 text-[9px] font-medium text-slate-500">
                    SKU: {product.sku}
                  </p>
                </div>
              ))}
            </div>

            {expandedLabels.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No labels to print. Adjust quantities above.
              </p>
            )}

            {products.filter((p) => !p.sku && !p.barcode).length > 0 && (
              <p className="mt-8 text-center text-sm text-destructive print:hidden">
                Warning:{" "}
                {products.filter((p) => !p.sku && !p.barcode).length}{" "}
                product(s) missing SKU and Barcode — excluded from this sheet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
