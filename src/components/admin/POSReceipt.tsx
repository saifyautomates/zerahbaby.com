/**
 * POSReceipt — Printable receipt/invoice for completed POS sales.
 * Supports both A4 invoice layout and print-friendly rendering.
 */
import { createPortal } from "react-dom";
import { X, Printer, Download } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { POSCartItem, SaleResult } from "@/lib/pos";

type ReceiptProps = {
  sale: SaleResult;
  items: POSCartItem[];
  onClose: () => void;
  staffEmail?: string;
};

export function POSReceipt({ sale, items, onClose, staffEmail }: ReceiptProps) {
  const saleDate = new Date();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-4 sm:p-6 backdrop-blur-sm print:block print:bg-card print:p-0"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl max-h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — hidden during print */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/50 p-6 print:hidden">
          <div>
            <h2 className="font-display text-2xl font-bold">Sale Receipt</h2>
            <p className="text-sm text-muted-foreground">
              {sale.sale_number} • {saleDate.toLocaleDateString("en-IN")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
            >
              <X className="size-4" /> Close
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Printer className="size-4" /> Print Receipt
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-8 print:overflow-visible print:bg-card print:p-0">
          <div className="mx-auto max-w-[210mm] bg-card p-8 shadow-sm print:max-w-none print:shadow-none">
            {/* Branding Header */}
            <div className="text-center border-b-2 border-slate-900 pb-4 mb-6">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Zérah <span className="font-serif italic text-[#8B2020]">Baby & Kids</span>
              </h1>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mt-1">
                Premium Children's Clothing & Accessories
              </p>
              <p className="text-xs text-slate-500 mt-1">
                80 Feet Link Rd, Gordhanpura, Kota, Rajasthan 324001
              </p>
              <p className="text-xs text-slate-500">Phone: 9057074777 • zerah_kids</p>
            </div>

            {/* Invoice Details */}
            <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Invoice Details
                </p>
                <p className="font-bold text-slate-900">{sale.sale_number}</p>
                <p className="text-slate-600">
                  {saleDate.toLocaleDateString("en-IN", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <p className="text-slate-600">
                  {saleDate.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                {staffEmail && <p className="text-xs text-slate-500 mt-1">Staff: {staffEmail}</p>}
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Customer
                </p>
                <p className="font-bold text-slate-900">{sale.customer_name}</p>
                {items[0] && !items[0].isCustom && (
                  <p className="text-slate-600">Payment: {sale.payment_method.toUpperCase()}</p>
                )}
              </div>
            </div>

            {/* Items Table */}
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    #
                  </th>
                  <th className="py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Item
                  </th>
                  <th className="py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    SKU
                  </th>
                  <th className="py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Price
                  </th>
                  <th className="py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Qty
                  </th>
                  <th className="py-2 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.product_id + "-" + idx} className="border-b border-slate-100">
                    <td className="py-2 text-slate-500">{idx + 1}</td>
                    <td className="py-2">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      {item.brand && <p className="text-[10px] text-slate-500">{item.brand}</p>}
                    </td>
                    <td className="py-2 text-slate-600 font-mono text-xs">{item.sku}</td>
                    <td className="py-2 text-right text-slate-900">{formatPrice(item.price)}</td>
                    <td className="py-2 text-right text-slate-900 font-semibold">{item.qty}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">
                      {formatPrice(item.price * item.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-semibold text-slate-900">{formatPrice(sale.subtotal)}</span>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>
                      Discount
                      {sale.discount_type === "percentage"
                        ? ` (${sale.discount_value}%)`
                        : sale.discount_type === "fixed"
                          ? ` (₹${sale.discount_value})`
                          : ""}
                    </span>
                    <span className="font-semibold">−{formatPrice(sale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-lg">
                  <span className="font-bold text-slate-900">Total</span>
                  <span className="font-black text-slate-900">{formatPrice(sale.total)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500 pt-1">
                  <span>Payment Method</span>
                  <span className="font-bold uppercase">{sale.payment_method}</span>
                </div>
              </div>
            </div>

            {/* Token Number */}
            {sale.pos_token_number != null && (
              <div className="mt-8 border-2 border-slate-900 rounded-lg p-4 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 mb-2">
                  Walk-in Customer Token
                </p>
                <p className="text-6xl font-black text-slate-900 leading-none">
                  {sale.pos_token_number}
                </p>
                <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-900 mt-2">
                  TOKEN NO: {sale.pos_token_number}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-10 pt-4 border-t border-slate-200 text-center text-xs text-slate-500">
              <p className="font-semibold">Thank you for shopping with Zérah Baby & Kids!</p>
              <p className="mt-1">
                This is a computer-generated receipt and does not require a signature.
              </p>
              <p className="mt-1">Exchange/Return within 7 days with original receipt.</p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
