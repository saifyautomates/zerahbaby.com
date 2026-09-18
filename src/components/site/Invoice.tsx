import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Printer, X } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { Order } from "@/lib/orders";
import { useSettings } from "@/lib/store";
import { useSession, useIsAdmin } from "@/lib/auth";

const logo = "/logo.png";

/** Clickable invoice trigger — opens the full printable invoice for customers and admins. */
export function InvoiceBox({
  order,
  requireAdmin = false,
  variant = "chip",
}: {
  order: Order;
  requireAdmin?: boolean;
  variant?: "chip" | "button" | "link";
}) {
  const { user } = useSession();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const [open, setOpen] = useState(false);

  if (requireAdmin && !isAdmin) {
    return null;
  }

  // Non-admin can only access their own invoice
  if (!isAdmin && order.user_id && user?.id && order.user_id !== user.id) {
    return null;
  }

  return (
    <>
      {variant === "button" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 hover:bg-muted px-3 py-1.5 text-xs font-semibold text-foreground transition-all shadow-2xs cursor-pointer hover:border-primary/40 hover:text-primary"
        >
          <Printer className="size-3.5" />
          <span>View Invoice</span>
        </button>
      ) : variant === "link" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
        >
          <FileText className="size-3.5" />
          <span>Invoice ({order.invoice_no ?? "Tax Invoice"})</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs transition hover:border-foreground/30 hover:text-foreground cursor-pointer"
        >
          <FileText className="size-3 text-primary" />
          <span>Invoice</span>
        </button>
      )}

      {open && <InvoiceDialog order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function esc(str?: string | null): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Professional A4 Portrait Order HTML Builder */
export function buildOrderA4HTML(
  order: Order,
  store: {
    brandName?: string;
    storeAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
  _paperSize?: string,
): string {
  const brand = store.brandName || "ZÉRAH BABY & KIDS";
  const address =
    store.storeAddress ||
    "Shop No. 4-E-21, 80Ft. Road, Atwal Nagar, Hanumanji Mandir Ke Samne, Kota, Rajasthan 324001";
  const phone = store.contactPhone || "9057074777";
  const email = store.contactEmail || "hello@zerahkids.com";

  const dateStr = new Date(order.created_at).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const timeStr = new Date(order.created_at).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const addressFormatted = [
    order.address,
    order.address_line2,
    order.landmark ? `Near ${order.landmark}` : "",
    order.city,
    order.state,
    order.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const paymentDisplay =
    order.payment_method?.toLowerCase() === "cod"
      ? "Cash on Delivery"
      : order.payment_method?.toLowerCase() === "razorpay" ||
          order.payment_method?.toLowerCase() === "online"
        ? "Online (Razorpay)"
        : order.payment_method?.toUpperCase() || "COD";

  const itemRows = (order.order_items || [])
    .map((item, i) => {
      const lineTotal = Number(item.price || item.price_at_time || 0) * (item.qty || 1);
      const variantDetails = [item.color ? `Color: ${item.color}` : "", item.size ? `Size: ${item.size}` : ""]
        .filter(Boolean)
        .join(" · ");

      return `
    <tr class="${i % 2 === 0 ? "even" : ""}">
      <td class="center" style="width:36px;">${i + 1}</td>
      <td>
        <div class="item-name">${esc(item.name)}</div>
        ${variantDetails ? `<div class="sku" style="font-size:10px; color:#64748b; margin-top:2px;">${esc(variantDetails)}</div>` : ""}
      </td>
      <td class="center">${item.qty || 1}</td>
      <td class="right bold">₹${Number(item.price || item.price_at_time || 0).toLocaleString("en-IN")}</td>
      <td class="right bold">₹${lineTotal.toLocaleString("en-IN")}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Tax Invoice #${esc(order.invoice_no || order.id.slice(0, 8).toUpperCase())}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: A4 portrait;
    margin: 15mm 12mm 15mm 12mm;
  }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11px;
    color: #1a1a1a;
    background: #fff;
    line-height: 1.5;
    width: 100%;
    max-width: 210mm;
    margin: 0 auto;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #8B2020;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    text-align: center;
  }
  .brand-name {
    font-size: 26px;
    font-weight: 900;
    color: #8B2020;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .brand-contact {
    font-size: 11px;
    color: #555;
    margin-top: 6px;
    line-height: 1.6;
    text-align: center;
  }
  .invoice-meta-container {
    display: flex;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .invoice-title {
    font-size: 16px;
    font-weight: 800;
    color: #8B2020;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .invoice-number {
    font-size: 13px;
    font-weight: 700;
    margin-top: 4px;
    color: #1a1a1a;
  }
  .invoice-date {
    font-size: 10px;
    color: #555;
    margin-top: 3px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .info-card {
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .info-card-title {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8B2020;
    margin-bottom: 5px;
  }
  .info-card-value {
    font-size: 11px;
    font-weight: 600;
    color: #1a1a1a;
  }
  .info-card-sub {
    font-size: 10px;
    color: #555;
    margin-top: 1px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
  }
  thead tr {
    background: #8B2020;
    color: #fff;
  }
  thead th {
    padding: 7px 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  thead th.right { text-align: right; }
  thead th.center { text-align: center; }
  tbody tr.even { background: #faf8f8; }
  tbody td {
    padding: 7px 8px;
    vertical-align: top;
    border-bottom: 1px solid #efefef;
  }
  .item-name { font-weight: 600; }
  .sku { font-size: 9px; color: #888; font-weight: 400; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .totals {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;
  }
  .totals-box {
    width: 240px;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    overflow: hidden;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 10px;
    font-size: 11px;
  }
  .totals-row.alt { background: #faf8f8; }
  .totals-row.discount { color: #15803d; }
  .totals-row.grand-total {
    background: #8B2020;
    color: #fff;
    font-weight: 800;
    font-size: 13px;
    padding: 8px 10px;
  }
  .payment-badge {
    display: inline-block;
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 20px;
    padding: 3px 10px;
    font-size: 10px;
    font-weight: 700;
    color: #15803d;
    text-transform: uppercase;
  }
  .footer {
    border-top: 2px solid #8B2020;
    padding-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 20px;
  }
  .footer-policy {
    font-size: 9px;
    color: #666;
    max-width: 340px;
    line-height: 1.5;
  }
  .footer-thanks {
    text-align: right;
    font-size: 10px;
    color: #8B2020;
    font-weight: 700;
  }
  .footer-web {
    font-size: 9px;
    color: #555;
    margin-top: 2px;
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:6px;">
      <img loading="lazy" decoding="async" src="${typeof window !== "undefined" ? window.location.origin : ""}/logo.png" style="width:54px;height:54px;object-fit:contain;" alt="${esc(brand)}"/>
      <div class="brand-name">${esc(brand)}</div>
    </div>
    <div class="brand-contact">
      ${esc(address)}<br/>
      Ph: ${esc(phone)} · ${esc(email)}
    </div>
  </div>
</div>

<div class="invoice-meta-container">
  <div>
    <div class="invoice-title">TAX INVOICE</div>
    <div class="invoice-number">${esc(order.invoice_no || `INV-${order.id.slice(0, 8).toUpperCase()}`)}</div>
    <div class="invoice-date">${dateStr}<br/>${timeStr}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:11px; font-weight:700; color:#475569;">Order #${esc(order.order_number || order.id.slice(0, 8).toUpperCase())}</div>
    <div style="font-size:10px; color:#16a34a; font-weight:700; margin-top:2px;">Status: ${esc(order.status).toUpperCase()}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-card">
    <div class="info-card-title">Billed To</div>
    <div class="info-card-value">${esc(order.full_name)}</div>
    <div class="info-card-sub">${esc(addressFormatted)}</div>
    <div class="info-card-sub">Ph: ${esc(order.phone)}${order.alt_phone ? ` / ${esc(order.alt_phone)}` : ""}</div>
    ${order.email ? `<div class="info-card-sub">${esc(order.email)}</div>` : ""}
  </div>
  <div class="info-card">
    <div class="info-card-title">Payment Details</div>
    <div class="info-card-value">
      <span class="payment-badge">${esc(paymentDisplay)}</span>
    </div>
    <div class="info-card-sub" style="margin-top:4px;">
      Payment Status: <strong>${esc(order.payment_status || "paid").toUpperCase()}</strong>
    </div>
    ${order.notes ? `<div class="info-card-sub" style="margin-top:4px; font-style:italic;">“${esc(order.notes)}”</div>` : ""}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th class="center" style="width:36px;">#</th>
      <th style="text-align:left;">Item Description</th>
      <th class="center" style="width:50px;">Qty</th>
      <th class="right" style="width:110px;">Price</th>
      <th class="right" style="width:100px;">Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<div class="totals">
  <div class="totals-box">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>₹${Number(order.subtotal).toLocaleString("en-IN")}</span>
    </div>
    ${
      Number(order.discount) > 0
        ? `<div class="totals-row discount">
        <span>Discount</span>
        <span>−₹${Number(order.discount).toLocaleString("en-IN")}</span>
      </div>`
        : ""
    }
    <div class="totals-row">
      <span>Shipping / Delivery</span>
      <span>${Number(order.shipping) === 0 ? "FREE" : `₹${Number(order.shipping).toLocaleString("en-IN")}`}</span>
    </div>
    <div class="totals-row grand-total">
      <span>TOTAL</span>
      <span>₹${Number(order.total).toLocaleString("en-IN")}</span>
    </div>
  </div>
</div>

<div class="footer">
  <div>
    <div class="footer-policy">
      <strong>Return Policy:</strong> Exchange or return within 7 days of delivery with original tags intact.<br/>
      GST: Not Applicable (Composition / Exemption Threshold) · Computer Generated Invoice
    </div>
  </div>
  <div class="footer-thanks">
    Thank You For Shopping With Us!
    <div class="footer-web">zerahkids.com · ${esc(email)}</div>
  </div>
</div>

</body>
</html>`;
}

/** Print online order invoice using standard portrait iframe print */
export function printOrderA4Invoice(
  order: Order,
  store: {
    brandName?: string;
    storeAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
  _paperSize?: string,
) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.print();
      } finally {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            /* already cleaned */
          }
        }, 2000);
      }
    };

    iframe.onload = triggerPrint;

    doc.open();
    doc.write(buildOrderA4HTML(order, store));
    doc.close();

    if (doc.readyState === "complete") {
      setTimeout(triggerPrint, 60);
    }
  } catch {
    window.print();
  }
}

/** Professional Portrait Tax Invoice Modal for Online Store Orders */
export function InvoiceDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const storeSettings = useSettings();
  const brandName = storeSettings.brandName || "ZÉRAH BABY & KIDS";
  const storeAddress =
    storeSettings.storeAddress ||
    "Shop No. 4-E-21, 80Ft. Road, Atwal Nagar, Hanumanji Mandir Ke Samne, Kota, Rajasthan 324001";
  const contactPhone = storeSettings.contactPhone || "9057074777";
  const contactEmail = storeSettings.contactEmail || "hello@zerahkids.com";

  const handlePrint = () => {
    printOrderA4Invoice(order, storeSettings);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/40 p-3 sm:p-6 backdrop-blur-sm print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-2xl max-h-[95vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden print:max-h-none print:overflow-visible print:w-full print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-muted/20 print:hidden">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Tax Invoice</h2>
            <span className="font-mono text-xs text-muted-foreground">
              {order.invoice_no ?? `INV-${order.id.slice(0, 8).toUpperCase()}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-xl bg-[#8B2020] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#7a1c1c] cursor-pointer"
            >
              <Printer className="size-3.5" />
              <span>Print A4 Invoice</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Invoice Body — Clean Portrait Layout */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 bg-white text-slate-900">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b-2 border-[#8B2020] pb-4 mb-5">
            <div className="flex gap-3 items-center">
              <img
                loading="lazy"
                decoding="async"
                src={logo}
                alt={brandName}
                className="size-14 object-contain shrink-0"
              />
              <div>
                <p className="font-display text-xl font-black tracking-tight text-[#8B2020] uppercase">
                  {brandName}
                </p>
                <p className="text-xs text-slate-600 mt-1 max-w-xs">{storeAddress}</p>
                <p className="text-xs font-medium text-slate-600 mt-0.5">
                  Ph: {contactPhone} · {contactEmail}
                </p>
              </div>
            </div>
            <div className="sm:text-right">
              <span className="inline-block bg-[#8B2020] text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded tracking-wider">
                Tax Invoice
              </span>
              <p className="mt-1 font-mono text-base font-bold text-slate-900">
                {order.invoice_no ?? `INV-${order.id.slice(0, 8).toUpperCase()}`}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(order.created_at).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                Order #{order.order_number || order.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          </div>

          {/* Customer & Payment details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-xs border border-slate-200 mb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#8B2020]">
                Billed To
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900">{order.full_name}</p>
              <p className="mt-1 text-slate-600 leading-relaxed">
                {[
                  order.address,
                  order.address_line2,
                  order.landmark ? `Near ${order.landmark}` : "",
                  order.city,
                  order.state,
                  order.pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="mt-1.5 font-medium text-slate-800">
                Ph: {order.phone}
                {order.alt_phone ? ` / ${order.alt_phone}` : ""}
              </p>
              {order.email && <p className="text-slate-600">{order.email}</p>}
            </div>
            <div className="sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#8B2020]">
                Payment Information
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {order.payment_method?.toLowerCase() === "cod"
                  ? "Cash on Delivery"
                  : order.payment_method?.toLowerCase() === "razorpay" ||
                      order.payment_method?.toLowerCase() === "online"
                    ? "Online (Razorpay)"
                    : order.payment_method?.toUpperCase() || "COD"}
              </p>
              <p className="mt-2 text-xs font-bold text-emerald-700">
                STATUS: {(order.payment_status || "paid").toUpperCase()}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Order Status: <span className="font-semibold capitalize">{order.status}</span>
              </p>
              {order.notes && (
                <div className="mt-2 inline-block rounded-lg bg-amber-50 border border-amber-200 p-2 text-left sm:text-right">
                  <p className="text-[10px] text-amber-800">“{order.notes}”</p>
                </div>
              )}
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-left text-xs mb-5 border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                <th className="py-2.5">Item Description</th>
                <th className="py-2.5 text-center w-12">Qty</th>
                <th className="py-2.5 text-right w-24">Price</th>
                <th className="py-2.5 text-right w-24">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(order.order_items || []).map((item) => (
                <tr key={item.id}>
                  <td className="py-3">
                    <span className="font-bold text-slate-900 block">{item.name}</span>
                    {(item.color || item.size) && (
                      <span className="text-[10px] text-slate-500 mt-0.5 block">
                        {[item.color ? `Color: ${item.color}` : "", item.size ? `Size: ${item.size}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-center font-semibold text-slate-700">{item.qty || 1}</td>
                  <td className="py-3 text-right font-medium text-slate-700">
                    {formatPrice(Number(item.price || item.price_at_time || 0))}
                  </td>
                  <td className="py-3 text-right font-bold text-slate-900">
                    {formatPrice(Number(item.price || item.price_at_time || 0) * (item.qty || 1))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end border-t border-slate-200 pt-4">
            <div className="w-full max-w-xs space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-semibold text-slate-900">
                  {formatPrice(Number(order.subtotal))}
                </span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount:</span>
                  <span className="font-semibold">−{formatPrice(Number(order.discount))}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">Shipping:</span>
                <span className="font-semibold text-slate-900">
                  {Number(order.shipping) === 0 ? "Free Delivery" : formatPrice(Number(order.shipping))}
                </span>
              </div>
              <div className="flex justify-between border-t-2 border-[#8B2020] pt-2 text-sm font-black text-[#8B2020]">
                <span>Total Paid:</span>
                <span>{formatPrice(Number(order.total))}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 border-t border-slate-200 pt-4 text-center text-[10px] text-slate-500">
            <p>Thank you for shopping with {brandName}.</p>
            <p className="mt-0.5">This is a computer-generated tax invoice.</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
