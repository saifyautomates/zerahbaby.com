import { X, Printer } from "lucide-react";
import Barcode from "react-barcode";
import type { Product } from "@/lib/store";
import { formatPrice } from "@/lib/store";

export function PrintLabelsModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm print:block print:bg-white print:p-0"
      role="dialog"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-3xl border border-border bg-white shadow-2xl print:max-h-none print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none">
        <div className="flex items-center justify-between border-b border-border/50 p-6 print:hidden">
          <div>
            <h2 className="font-display text-2xl font-bold">Print Product Labels</h2>
            <p className="text-sm text-muted-foreground">
              Print this sheet on A4 sticker paper to tag your inventory.
            </p>
          </div>
          <div className="flex items-center gap-3">
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
              <Printer className="size-4" /> Print Sheet
            </button>
          </div>
        </div>

        {/* Printable Area - A4 grid of labels */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8 print:overflow-visible print:bg-white print:p-0">
          <div className="mx-auto max-w-[210mm] bg-white p-4 shadow-sm print:max-w-none print:p-0 print:shadow-none">
            <div className="grid grid-cols-4 gap-4 print:grid-cols-4">
              {products
                .filter((p) => p.sku)
                .map((product) => (
                  <div
                    key={product.uuid}
                    className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-4 text-center break-inside-avoid print:border-solid print:border-slate-200"
                  >
                    <p className="w-full truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Zérah Baby
                    </p>
                    <p className="mt-1 line-clamp-2 min-h-[2rem] w-full text-xs font-semibold leading-tight text-slate-900">
                      {product.name}
                    </p>
                    <p className="mt-1 text-sm font-black text-slate-900">
                      {formatPrice(product.price)}
                    </p>
                    <div className="mt-2 w-full flex justify-center scale-90">
                      <Barcode
                        value={product.sku}
                        width={1.2}
                        height={40}
                        fontSize={10}
                        margin={0}
                        displayValue={true}
                        background="transparent"
                      />
                    </div>
                  </div>
                ))}
            </div>

            {products.filter((p) => !p.sku).length > 0 && (
              <p className="mt-8 text-center text-sm text-destructive print:hidden">
                Warning: {products.filter((p) => !p.sku).length} product(s) missing SKU. They are
                excluded from this sheet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
