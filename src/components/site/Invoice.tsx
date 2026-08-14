import { useState } from "react";
import { FileText, Printer, X } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { Order } from "@/lib/orders";
import { useSettings } from "@/lib/store";

/** Small clickable invoice chip — opens the full printable invoice. */
export function InvoiceBox({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-fit items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-left transition hover:border-primary hover:bg-background"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-bold">Invoice {order.invoice_no ?? "—"}</span>
          <span className="block text-[11px] text-muted-foreground">
            {order.order_items.length} item{order.order_items.length === 1 ? "" : "s"} ·{" "}
            {formatPrice(Number(order.total))}
          </span>
        </span>
      </button>
      {open && <InvoiceModal order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function InvoiceModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const { brandName, storeAddress, contactPhone, contactEmail } = useSettings();

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-foreground/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border bg-card p-6 print:border-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl font-bold">{brandName}</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{storeAddress}</p>
            <p className="text-xs text-muted-foreground">
              {contactPhone} · {contactEmail}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoice</p>
            <p className="font-display text-lg font-bold">{order.invoice_no ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("en-IN")}</p>
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              Order #{order.id.slice(0, 8).toUpperCase()} · {order.status}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 rounded-2xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billed to</p>
            <p className="mt-1 font-semibold">{order.full_name}</p>
            <p className="text-muted-foreground">
              {order.address}
              {order.address_line2 ? `, ${order.address_line2}` : ""}
              {order.landmark ? `, near ${order.landmark}` : ""}
            </p>
            <p className="text-muted-foreground">
              {[order.city, order.state, order.pincode].filter(Boolean).join(", ")}
            </p>
            <p className="text-muted-foreground">
              {order.phone}
              {order.alt_phone ? ` / ${order.alt_phone}` : ""}
            </p>
            <p className="text-muted-foreground">{order.email}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</p>
            <p className="mt-1 font-semibold uppercase">{order.payment_method || "cod"}</p>
            {order.notes && <p className="mt-2 text-xs italic text-muted-foreground">“{order.notes}”</p>}
          </div>
        </div>

        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2">Item</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.order_items.map((item) => (
              <tr key={item.id} className="border-b border-border">
                <td className="py-2">
                  <span className="font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">{item.product_slug}</span>
                </td>
                <td className="py-2 text-center">{item.qty}</td>
                <td className="py-2 text-right">{formatPrice(Number(item.price))}</td>
                <td className="py-2 text-right font-semibold">{formatPrice(Number(item.price) * item.qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatPrice(Number(order.subtotal))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Delivery</dt>
            <dd>{Number(order.shipping) === 0 ? "Free" : formatPrice(Number(order.shipping))}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatPrice(Number(order.total))}</dd>
          </div>
        </dl>

        <div className="mt-6 flex justify-end gap-3 print:hidden">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-muted"
          >
            <X className="size-4" /> Close
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
          >
            <Printer className="size-4" /> Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}
