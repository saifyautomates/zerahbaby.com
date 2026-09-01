import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Printer, X } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { Order } from "@/lib/orders";
import { useSettings } from "@/lib/store";
import logo from "@/assets/zerah-logo-official.png";

/** Small clickable invoice chip — opens the full printable invoice. */
export function InvoiceBox({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-fit items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-left shadow-sm transition-all duration-300 hover:border-primary hover:bg-primary hover:text-primary-foreground"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-background text-primary shadow-sm transition-colors group-hover:text-primary">
          <Printer className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-bold uppercase tracking-wider">Print Invoice</span>
          <span className="block text-[11px] opacity-80">
            {order.invoice_no ?? "—"} • {formatPrice(Number(order.total))}
          </span>
        </span>
      </button>
      {open && <InvoiceModal order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function InvoiceModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const { brandName, storeAddress, contactPhone, contactEmail } = useSettings();

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-4 sm:p-6 backdrop-blur-sm print:block print:bg-card print:p-0"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-full rounded-3xl border border-border bg-card shadow-2xl overflow-hidden print:max-h-none print:overflow-visible print:w-full print:rounded-none print:border-0 print:p-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-8 print:p-0 print:overflow-visible">
          {/* Header section */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-6 print:border-slate-300">
            <div className="flex gap-4 items-center">
              <img
                loading="lazy"
                decoding="async"
                src={logo}
                alt={brandName}
                className="size-20 object-contain"
              />
              <div>
                <p className="font-display text-3xl font-black tracking-tight">{brandName}</p>
                <p className="mt-2 max-w-xs text-sm text-slate-600">{storeAddress}</p>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  {contactPhone} · {contactEmail}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
                Tax Invoice
              </p>
              <p className="mt-1 font-display text-2xl font-bold">{order.invoice_no ?? "—"}</p>
              <p className="mt-2 text-sm text-slate-600">
                {new Date(order.created_at).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="mt-1 text-sm font-semibold capitalize text-slate-500">
                Order #{order.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>

          {/* Billing details */}
          <div className="mt-6 grid gap-6 rounded-2xl bg-slate-50 p-6 text-sm sm:grid-cols-2 print:bg-transparent print:p-0">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Billed To</p>
              <p className="mt-2 text-base font-bold text-slate-900">{order.full_name}</p>
              <p className="mt-1 text-slate-600">
                {order.address}
                {order.address_line2 ? `, ${order.address_line2}` : ""}
                {order.landmark ? `, near ${order.landmark}` : ""}
              </p>
              <p className="text-slate-600">
                {[order.city, order.state, order.pincode].filter(Boolean).join(", ")}
              </p>
              <p className="mt-2 font-medium text-slate-800">
                {order.phone}
                {order.alt_phone ? ` / ${order.alt_phone}` : ""}
              </p>
              <p className="text-slate-600">{order.email}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Payment Method
              </p>
              <p className="mt-2 text-base font-bold uppercase text-slate-900">
                {order.payment_method || "cod"}
              </p>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                Order Status
              </p>
              <p className="mt-1 text-base font-bold capitalize text-slate-900">{order.status}</p>
              {order.notes && (
                <div className="mt-4 inline-block max-w-xs rounded-xl bg-amber-100 p-3 text-left sm:text-right">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-800">
                    Order Note
                  </p>
                  <p className="mt-1 text-sm text-amber-900">“{order.notes}”</p>
                </div>
              )}
            </div>
          </div>

          {/* Line items table */}
          <table className="mt-8 w-full text-left text-sm">
            <thead className="border-b-2 border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-3">Item Description</th>
                <th className="py-3 text-center">Qty</th>
                <th className="py-3 text-right">Rate</th>
                <th className="py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.order_items.map((item) => (
                <tr key={item.id}>
                  <td className="py-4">
                    <span className="block font-bold text-slate-900">{item.name}</span>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
                      {item.color && (
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                          Color: {item.color}
                        </span>
                      )}
                      {item.size && (
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                          Size: {item.size}
                        </span>
                      )}
                      {item.sku_snapshot && (
                        <span className="font-mono text-[11px] text-slate-500">
                          SKU: {item.sku_snapshot}
                        </span>
                      )}
                      {!item.sku_snapshot && <span>Ref: {item.product_slug}</span>}
                    </div>
                  </td>
                  <td className="py-4 text-center font-medium text-slate-700">{item.qty}</td>
                  <td className="py-4 text-right font-medium text-slate-700">
                    {formatPrice(Number(item.price || item.price_at_time || 0))}
                  </td>
                  <td className="py-4 text-right font-bold text-slate-900">
                    {formatPrice(Number(item.price || item.price_at_time || 0) * item.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-sm space-y-3 rounded-2xl bg-slate-50 p-6 text-sm print:bg-transparent print:p-0">
              <div className="flex justify-between">
                <dt className="font-medium text-slate-600">Subtotal</dt>
                <dd className="font-semibold text-slate-900">
                  {formatPrice(Number(order.subtotal))}
                </dd>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <dt className="font-medium">Discount</dt>
                  <dd className="font-semibold">−{formatPrice(Number(order.discount))}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="font-medium text-slate-600">Delivery</dt>
                <dd className="font-semibold text-slate-900">
                  {Number(order.shipping) === 0 ? "Free" : formatPrice(Number(order.shipping))}
                </dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-4 text-lg font-black text-slate-900">
                <dt>Total</dt>
                <dd>{formatPrice(Number(order.total))}</dd>
              </div>
            </dl>
          </div>

          {/* Footer */}
          <div className="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
            <p>Thank you for shopping with {brandName}.</p>
            <p className="mt-1">This is a computer generated invoice.</p>
          </div>

          {/* Action buttons (hidden when printing) */}
          <div className="mt-8 flex justify-end gap-3 print:hidden">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-card px-6 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="size-4" /> Close
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Printer className="size-4" /> Print Invoice
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
