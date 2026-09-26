import { useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Printer, X } from "lucide-react";
import { formatPrice } from "@/lib/store";
import type { Order } from "@/lib/orders";
import { useSettings } from "@/lib/store";

const logo = "/logo.png";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildOrderA4HTML(
  order: Order,
  store: {
    brandName?: string;
    storeAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
  } = {},
): string {
  const brandName = store.brandName || "ZÉRAH BABY & KIDS";
  const storeAddress =
    store.storeAddress ||
    "Shop No. 4-E-21, 80Ft. Road, Atwal Nagar, Hanumanji Mandir Ke Samne, Kota, Rajasthan 324001";
  const contactPhone = store.contactPhone || "9057074777";
  const contactEmail = store.contactEmail || "hello@zerahkids.com";

  const dateFormatted = new Date(order.created_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const paymentDisplay = order.payment_method
    ? order.payment_method.toUpperCase()
    : "COD";

  const isInterState = Boolean(order.state && order.state.trim().toLowerCase() !== "rajasthan");
  let totalTaxable = 0;
  let totalGstAmount = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const rowsHtml = (order.order_items || [])
    .map((item, idx) => {
      const linePrice = Number(item.price || item.price_at_time || 0);
      const lineTotal = linePrice * item.qty;
      const variantInfo = [item.color, item.size].filter(Boolean).join(" / ");
      const hsnDisplay = item.hsn_code ? escapeHtml(item.hsn_code) : "—";
      const hasGst = item.gst_rate != null && item.gst_rate > 0;
      const taxableValue = hasGst
        ? Math.round((lineTotal / (1 + item.gst_rate! / 100)) * 100) / 100
        : lineTotal;
      const gstAmount = hasGst ? Math.round((lineTotal - taxableValue) * 100) / 100 : 0;
      const gstRateStr = item.gst_rate != null ? `${item.gst_rate}%` : "—";

      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      if (hasGst) {
        if (isInterState) {
          igst = gstAmount;
        } else {
          cgst = Math.round((gstAmount / 2) * 100) / 100;
          sgst = Math.round((gstAmount - cgst) * 100) / 100;
        }
      }

      totalTaxable += taxableValue;
      totalGstAmount += gstAmount;
      totalCgst += cgst;
      totalSgst += sgst;
      totalIgst += igst;

      return `<tr>
        <td class="center">${idx + 1}</td>
        <td>
          <div class="bold">${escapeHtml(item.name)}</div>
          ${variantInfo ? `<div style="font-size: 9px; color: #555;">${escapeHtml(variantInfo)}</div>` : ""}
          ${item.sku_snapshot ? `<div style="font-size: 8.5px; color: #777;">SKU: ${escapeHtml(item.sku_snapshot)}</div>` : ""}
        </td>
        <td class="center font-mono">${hsnDisplay}</td>
        <td class="center">${item.qty}</td>
        <td class="right">₹${linePrice.toLocaleString("en-IN")}</td>
        <td class="right">₹${taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="center">${gstRateStr}</td>
        <td class="right">₹${gstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="right bold">₹${lineTotal.toLocaleString("en-IN")}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Invoice ${escapeHtml(order.invoice_no || order.id)}</title>
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
  }
  .invoice-container {
    max-width: 210mm;
    margin: 0 auto;
    padding: 0;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #8B2020;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-logo {
    width: 60px;
    height: 60px;
    object-fit: contain;
  }
  .brand-name {
    font-size: 22px;
    font-weight: 900;
    color: #8B2020;
    text-transform: uppercase;
  }
  .brand-contact {
    font-size: 10.5px;
    color: #555;
    margin-top: 3px;
  }
  .header-right {
    text-align: right;
  }
  .invoice-title {
    font-size: 16px;
    font-weight: 800;
    color: #8B2020;
    text-transform: uppercase;
  }
  .invoice-number {
    font-size: 13px;
    font-weight: 700;
    color: #111;
    margin-top: 2px;
  }
  .invoice-date {
    font-size: 10px;
    color: #666;
    margin-top: 2px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  .info-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    background: #f8fafc;
  }
  .info-title {
    font-size: 9.5px;
    font-weight: 700;
    color: #8B2020;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  th {
    background: #8B2020;
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 7px 8px;
    border: 1px solid #8B2020;
  }
  td {
    padding: 6px 8px;
    border: 1px solid #e2e8f0;
    font-size: 10.5px;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .totals {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;
  }
  .totals-table {
    width: 260px;
    border-collapse: collapse;
  }
  .totals-table td {
    padding: 4px 8px;
    border: none;
    font-size: 10.5px;
  }
  .grand-total {
    font-size: 13px;
    font-weight: 900;
    color: #8B2020;
    border-top: 2px solid #8B2020 !important;
  }
  .footer {
    border-top: 1px solid #e2e8f0;
    padding-top: 12px;
    text-align: center;
    font-size: 9.5px;
    color: #64748b;
  }
</style>
</head>
<body>
<div class="invoice-container">
  <div class="header">
    <div class="header-left">
      <img src="/logo.png" alt="Logo" class="header-logo" />
      <div>
        <div class="brand-name">${escapeHtml(brandName)}</div>
        <div class="brand-contact">${escapeHtml(storeAddress)}<br/>Phone: ${escapeHtml(contactPhone)} · Email: ${escapeHtml(contactEmail)}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="invoice-title">Tax Invoice</div>
      <div class="invoice-number">${escapeHtml(order.invoice_no || order.id)}</div>
      <div class="invoice-date">${escapeHtml(dateFormatted)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-card">
      <div class="info-title">Billed To</div>
      <div class="bold">${escapeHtml(order.full_name || "Customer")}</div>
      <div>${escapeHtml(order.address || "")} ${order.address_line2 ? escapeHtml(order.address_line2) : ""}</div>
      <div>${escapeHtml([order.city, order.state, order.pincode].filter(Boolean).join(", "))}</div>
      <div>Phone: ${escapeHtml(order.phone || "—")}</div>
      ${order.email ? `<div>Email: ${escapeHtml(order.email)}</div>` : ""}
    </div>
    <div class="info-card">
      <div class="info-title">Order Summary</div>
      <div><span class="bold">Order ID:</span> #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
      <div><span class="bold">Status:</span> ${escapeHtml(order.status || "Pending")}</div>
      <div><span class="bold">Payment:</span> ${escapeHtml(paymentDisplay)}</div>
      ${order.notes ? `<div><span class="bold">Notes:</span> ${escapeHtml(order.notes)}</div>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 25px;">#</th>
        <th>Item Description</th>
        <th style="width: 55px;" class="center">HSN</th>
        <th style="width: 40px;" class="center">Qty</th>
        <th style="width: 65px;" class="right">Rate</th>
        <th style="width: 75px;" class="right">Taxable</th>
        <th style="width: 50px;" class="center">GST %</th>
        <th style="width: 65px;" class="right">GST</th>
        <th style="width: 75px;" class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="totals">
    <div style="width: 260px;">
      <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 10.5px;">
        <span>Subtotal</span>
        <span class="right">₹${Number(order.subtotal || 0).toLocaleString("en-IN")}</span>
      </div>
      ${
        totalGstAmount > 0
          ? `<div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 10px; color: #475569;">
          <span>Taxable Value</span>
          <span class="right">₹${totalTaxable.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        ${
          isInterState
            ? `<div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 10px; color: #475569;">
            <span>IGST</span>
            <span class="right">₹${totalIgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>`
            : `<div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 10px; color: #475569;">
            <span>CGST</span>
            <span class="right">₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 10px; color: #475569;">
            <span>SGST</span>
            <span class="right">₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>`
        }
        <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 10px; font-weight: 700; color: #8B2020;">
          <span>Total GST</span>
          <span class="right">₹${totalGstAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>`
          : ""
      }
      ${Number(order.discount || 0) > 0 ? `<div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 10.5px; color: #15803d;">
        <span>Discount ${order.coupon_code ? `(${escapeHtml(order.coupon_code)})` : ""}</span>
        <span class="right">-₹${Number(order.discount).toLocaleString("en-IN")}</span>
      </div>` : ""}
      <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 10.5px;">
        <span>Delivery</span>
        <span class="right">${Number(order.shipping || 0) === 0 ? "FREE" : `₹${Number(order.shipping).toLocaleString("en-IN")}`}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 6px 0 0; font-size: 13px; font-weight: 900; color: #8B2020; border-top: 2px solid #8B2020;">
        <span>Total Paid</span>
        <span class="right">₹${Number(order.total || 0).toLocaleString("en-IN")}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Thank you for shopping with ${escapeHtml(brandName)}!</p>
    <p style="margin-top: 2px;">This is a computer generated invoice and requires no physical signature.</p>
  </div>
</div>
</body>
</html>`;
}

/** Small clickable invoice chip — opens the full printable invoice. */
export function InvoiceBox({
  order,
  variant,
  requireAdmin,
}: {
  order: Order;
  variant?: string;
  requireAdmin?: boolean;
}) {
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
          {(() => {
            const isInterStateModal = Boolean(order.state && order.state.trim().toLowerCase() !== "rajasthan");
            let mTotalTaxable = 0;
            let mTotalGst = 0;
            let mTotalCgst = 0;
            let mTotalSgst = 0;
            let mTotalIgst = 0;

            const renderedRows = order.order_items.map((item) => {
              const linePrice = Number(item.price || item.price_at_time || 0);
              const lineTotal = linePrice * item.qty;
              const hasGst = item.gst_rate != null && item.gst_rate > 0;
              const taxableValue = hasGst
                ? Math.round((lineTotal / (1 + item.gst_rate! / 100)) * 100) / 100
                : lineTotal;
              const gstAmount = hasGst ? Math.round((lineTotal - taxableValue) * 100) / 100 : 0;
              const gstRateStr = item.gst_rate != null ? `${item.gst_rate}%` : "—";

              let cgst = 0;
              let sgst = 0;
              let igst = 0;
              if (hasGst) {
                if (isInterStateModal) {
                  igst = gstAmount;
                } else {
                  cgst = Math.round((gstAmount / 2) * 100) / 100;
                  sgst = Math.round((gstAmount - cgst) * 100) / 100;
                }
              }

              mTotalTaxable += taxableValue;
              mTotalGst += gstAmount;
              mTotalCgst += cgst;
              mTotalSgst += sgst;
              mTotalIgst += igst;

              return (
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
                  <td className="py-4 text-center font-mono text-xs text-slate-700">
                    {item.hsn_code || "—"}
                  </td>
                  <td className="py-4 text-center font-medium text-slate-700">{item.qty}</td>
                  <td className="py-4 text-right font-medium text-slate-700">
                    {formatPrice(linePrice)}
                  </td>
                  <td className="py-4 text-right font-medium text-slate-700">
                    {formatPrice(taxableValue)}
                  </td>
                  <td className="py-4 text-center font-medium text-slate-700">
                    {gstRateStr}
                  </td>
                  <td className="py-4 text-right font-medium text-slate-700">
                    {formatPrice(gstAmount)}
                  </td>
                  <td className="py-4 text-right font-bold text-slate-900">
                    {formatPrice(lineTotal)}
                  </td>
                </tr>
              );
            });

            return (
              <>
                <table className="mt-8 w-full text-left text-sm">
                  <thead className="border-b-2 border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3">Item Description</th>
                      <th className="py-3 text-center">HSN</th>
                      <th className="py-3 text-center">Qty</th>
                      <th className="py-3 text-right">Rate</th>
                      <th className="py-3 text-right">Taxable</th>
                      <th className="py-3 text-center">GST %</th>
                      <th className="py-3 text-right">GST</th>
                      <th className="py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {renderedRows}
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
                    {mTotalGst > 0 && (
                      <>
                        <div className="flex justify-between text-xs text-slate-600">
                          <dt>Taxable Value</dt>
                          <dd className="font-medium">{formatPrice(mTotalTaxable)}</dd>
                        </div>
                        {isInterStateModal ? (
                          <div className="flex justify-between text-xs text-slate-600">
                            <dt>IGST</dt>
                            <dd className="font-medium">{formatPrice(mTotalIgst)}</dd>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between text-xs text-slate-600">
                              <dt>CGST</dt>
                              <dd className="font-medium">{formatPrice(mTotalCgst)}</dd>
                            </div>
                            <div className="flex justify-between text-xs text-slate-600">
                              <dt>SGST</dt>
                              <dd className="font-medium">{formatPrice(mTotalSgst)}</dd>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between text-xs font-bold text-primary">
                          <dt>Total GST</dt>
                          <dd>{formatPrice(mTotalGst)}</dd>
                        </div>
                      </>
                    )}
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
        </>
      );
    })()}

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
