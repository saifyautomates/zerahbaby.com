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
  let totalOriginalMrp = 0;
  let totalProductDiscount = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  const originalSubtotal = (order.order_items || []).reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || item.price_at_time || 0);
    const mrp = Number(item.mrp || 0) > 0 ? Number(item.mrp) : price;
    return sum + mrp * qty;
  }, 0);

  const sellingSubtotal = (order.order_items || []).reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const price = Number(item.price || item.price_at_time || 0);
    return sum + price * qty;
  }, 0);

  const orderLevelDiscount = Math.max(0, Number(order.discount || 0));
  const saleDiscountRatio =
    sellingSubtotal > 0
      ? Math.min(orderLevelDiscount / sellingSubtotal, 1)
      : 0;

  const rowsHtml = (order.order_items || [])
    .map((item, idx) => {
      const qty = Number(item.qty || 0);
      const sellingPrice = Number(item.price || item.price_at_time || 0);
      const originalPrice = Number(item.mrp || 0) > 0 ? Number(item.mrp) : sellingPrice;
      const originalLineAmount = originalPrice * qty;
      const sellingLineAmount = sellingPrice * qty;
      const productDiscount = Math.max(0, originalLineAmount - sellingLineAmount);
      const additionalSaleDiscount = sellingLineAmount * saleDiscountRatio;
      const totalLineDiscount = productDiscount + additionalSaleDiscount;
      const discountedLineAmount = Math.max(0, sellingLineAmount - additionalSaleDiscount);
      const discountPercent =
        originalLineAmount > 0
          ? Math.round((totalLineDiscount / originalLineAmount) * 100)
          : 0;

      const hasGst = item.gst_rate != null && Number(item.gst_rate) > 0;
      const gstRate = hasGst ? Number(item.gst_rate) : 0;
      const taxableValue = hasGst
        ? Math.round((discountedLineAmount / (1 + gstRate / 100)) * 100) / 100
        : discountedLineAmount;
      const gstAmount = hasGst
        ? Math.round((discountedLineAmount - taxableValue) * 100) / 100
        : 0;

      const cgst =
        hasGst && !isInterState
          ? Math.round((gstAmount / 2) * 100) / 100
          : 0;
      const sgst =
        hasGst && !isInterState
          ? Math.round((gstAmount - cgst) * 100) / 100
          : 0;

      totalOriginalMrp += originalLineAmount;
      totalProductDiscount += totalLineDiscount;
      totalCgst += cgst;
      totalSgst += sgst;

      const variantInfo = [item.color, item.size].filter(Boolean).join(" / ");
      const hsnDisplay = item.hsn_code ? escapeHtml(item.hsn_code) : "—";

      const discountHtml =
        totalLineDiscount > 0
          ? `<div style="font-weight: 700; color: #15803d;">${discountPercent}%</div>
             <div style="font-size: 9px; color: #15803d;">− ₹${totalLineDiscount.toLocaleString(
               "en-IN",
               { minimumFractionDigits: 2, maximumFractionDigits: 2 },
             )}</div>`
          : `<div style="font-weight: 700; color: #15803d;">0%</div>
             <div style="font-size: 9px; color: #15803d;">− ₹0.00</div>`;

      return `<tr>
        <td class="center">${idx + 1}</td>
        <td>
          <div class="bold">${escapeHtml(item.name)}</div>
          ${variantInfo ? `<div style="font-size: 9px; color: #555;">${escapeHtml(variantInfo)}</div>` : ""}
          ${item.sku_snapshot ? `<div style="font-size: 8.5px; color: #777;">SKU: ${escapeHtml(item.sku_snapshot)}</div>` : ""}
        </td>
        <td class="center font-mono">${hsnDisplay}</td>
        <td class="center">${qty}</td>
        <td class="right">₹${originalPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="right">${isInterState ? "—" : `₹${cgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td class="right">${isInterState ? "—" : `₹${sgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td class="right">${discountHtml}</td>
        <td class="right bold">₹${discountedLineAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    })
    .join("");

  const finalDiscountPercent =
    totalOriginalMrp > 0
      ? Math.round((totalProductDiscount / totalOriginalMrp) * 100)
      : 0;

  const finalDiscountHtml =
    totalProductDiscount > 0
      ? `<div style="font-weight: 700; color: #15803d;">${finalDiscountPercent}%</div>
         <div style="font-size: 9px; color: #15803d;">− ₹${totalProductDiscount.toLocaleString(
           "en-IN",
           { minimumFractionDigits: 2, maximumFractionDigits: 2 },
         )}</div>`
      : `<div style="font-weight: 700; color: #15803d;">0%</div>
         <div style="font-size: 9px; color: #15803d;">− ₹0.00</div>`;

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
    table-layout: fixed;
    margin-bottom: 12px;
  }
  th {
    background: #f4dfe0;
    color: #611616;
    font-size: 8px;
    line-height: 1.15;
    font-weight: 800;
    text-transform: uppercase;
    padding: 7px 5px;
    border: 1px solid #d8b8ba;
  }
  td {
    padding: 7px 5px;
    border: 1px solid #e2e8f0;
    font-size: 9px;
    vertical-align: middle;
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .discount-cell { vertical-align: middle; }
  .discount-percent {
    font-weight: 800;
    color: #15803d;
    line-height: 1.1;
  }
  .discount-amount {
    font-size: 8px;
    color: #15803d;
    margin-top: 2px;
    line-height: 1.1;
  }
  .grand-total-row td {
    background: #f8f1f1;
    border-top: 2px solid #8B2020;
    border-bottom: 2px solid #8B2020;
    font-weight: 900;
  }
  .grand-total-label {
    text-align: right;
    font-size: 11px;
    font-weight: 900;
    color: #8B2020;
    text-transform: uppercase;
  }
  .grand-total-final {
    font-size: 12px;
    font-weight: 900;
    color: #8B2020;
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
        <th>PRODUCT</th>
        <th style="width: 55px;" class="center">HSN</th>
        <th style="width: 40px;" class="center">QTY</th>
        <th style="width: 75px;" class="right">M.R.P<br/>(ORIGINAL)</th>
        <th style="width: 70px;" class="right">CGST<br/>2.5%</th>
        <th style="width: 70px;" class="right">SGST<br/>2.5%</th>
        <th style="width: 85px;" class="right">DISCOUNT</th>
        <th style="width: 75px;" class="right">TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="grand-total-row">
        <td colspan="4" class="grand-total-label">G.TOTAL</td>
        <td class="right">₹${totalOriginalMrp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="right">${isInterState ? "—" : `₹${totalCgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td class="right">${isInterState ? "—" : `₹${totalSgst.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</td>
        <td class="right">${finalDiscountHtml}</td>
        <td class="right grand-total-final">₹${Number(order.total || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
  </table>

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
            const modalIsInterState = Boolean(
              order.state &&
                order.state.trim().toLowerCase() !== "rajasthan",
            );

            let modalOriginalMrp = 0;
            let modalProductDiscount = 0;
            let modalCgst = 0;
            let modalSgst = 0;

            const modalSellingSubtotal = order.order_items.reduce(
              (sum, item) =>
                sum + Number(item.price || item.price_at_time || 0) * Number(item.qty || 0),
              0,
            );

            const modalOrderDiscount = Math.max(0, Number(order.discount || 0));
            const modalDiscountRatio =
              modalSellingSubtotal > 0
                ? Math.min(modalOrderDiscount / modalSellingSubtotal, 1)
                : 0;

            const renderedRows = order.order_items.map((item, index) => {
              const qty = Number(item.qty || 0);
              const sellingPrice = Number(item.price || item.price_at_time || 0);
              const originalPrice =
                Number(item.mrp || 0) > 0
                  ? Number(item.mrp)
                  : sellingPrice;

              const originalLineAmount = originalPrice * qty;
              const sellingLineAmount = sellingPrice * qty;
              const productDiscount = Math.max(0, originalLineAmount - sellingLineAmount);
              const additionalDiscount = sellingLineAmount * modalDiscountRatio;
              const lineDiscount = productDiscount + additionalDiscount;
              const discountedLineAmount = Math.max(0, sellingLineAmount - additionalDiscount);

              const discountPercent =
                originalLineAmount > 0
                  ? Math.round((lineDiscount / originalLineAmount) * 100)
                  : 0;

              const hasGst = item.gst_rate != null && Number(item.gst_rate) > 0;
              const gstRate = hasGst ? Number(item.gst_rate) : 0;
              const taxableValue = hasGst
                ? Math.round((discountedLineAmount / (1 + gstRate / 100)) * 100) / 100
                : discountedLineAmount;
              const gstAmount = hasGst
                ? Math.round((discountedLineAmount - taxableValue) * 100) / 100
                : 0;

              const cgst =
                hasGst && !modalIsInterState
                  ? Math.round((gstAmount / 2) * 100) / 100
                  : 0;
              const sgst =
                hasGst && !modalIsInterState
                  ? Math.round((gstAmount - cgst) * 100) / 100
                  : 0;

              modalOriginalMrp += originalLineAmount;
              modalProductDiscount += lineDiscount;
              modalCgst += cgst;
              modalSgst += sgst;

              const variantInfo = [item.color, item.size]
                .filter(Boolean)
                .join(" / ");

              return (
                <tr key={item.id} className="border-b border-slate-200">
                  <td className="px-2 py-4 text-center text-xs font-bold text-slate-900">
                    {index + 1}
                  </td>

                  <td className="px-3 py-4">
                    <span className="block text-sm font-bold text-slate-900">
                      {item.name}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {variantInfo && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                          {variantInfo}
                        </span>
                      )}
                      {item.sku_snapshot && (
                        <span className="font-mono text-[11px] text-slate-500">
                          SKU: {item.sku_snapshot}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-4 text-center font-mono text-xs text-slate-700">
                    {item.hsn_code || "—"}
                  </td>

                  <td className="px-2 py-4 text-center font-medium text-slate-700">
                    {qty}
                  </td>

                  <td className="px-2 py-4 text-right font-medium text-slate-700">
                    {formatPrice(originalPrice)}
                  </td>

                  <td className="px-2 py-4 text-right font-medium text-slate-700">
                    {modalIsInterState ? "—" : formatPrice(cgst)}
                  </td>

                  <td className="px-2 py-4 text-right font-medium text-slate-700">
                    {modalIsInterState ? "—" : formatPrice(sgst)}
                  </td>

                  <td className="px-2 py-4 text-right">
                    <div className="text-xs font-black text-emerald-600">
                      {discountPercent}%
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-emerald-600">
                      − {formatPrice(lineDiscount)}
                    </div>
                  </td>

                  <td className="px-2 py-4 text-right font-bold text-slate-900">
                    {formatPrice(discountedLineAmount)}
                  </td>
                </tr>
              );
            });

            const modalDiscountPercent =
              modalOriginalMrp > 0
                ? Math.round((modalProductDiscount / modalOriginalMrp) * 100)
                : 0;

            return (
              <table className="mt-8 w-full text-left text-sm">
                <thead className="border-b-2 border-slate-200 bg-[#f4dfe0] text-xs font-bold uppercase tracking-wider text-[#611616]">
                  <tr>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-center">#</th>
                    <th className="border border-[#d8b8ba] px-3 py-3">PRODUCT</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-center">HSN</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-center">QTY</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-right">M.R.P<br/>(ORIGINAL)</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-right">CGST<br/>2.5%</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-right">SGST<br/>2.5%</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-right">DISCOUNT</th>
                    <th className="border border-[#d8b8ba] px-2 py-3 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {renderedRows}
                  <tr className="bg-[#f8f1f1]">
                    <td colSpan={4} className="border-b-2 border-t-2 border-primary px-3 py-4 text-right text-sm font-black uppercase tracking-wider text-primary">
                      G.TOTAL
                    </td>
                    <td className="border-b-2 border-t-2 border-primary px-2 py-4 text-right font-bold">
                      {formatPrice(modalOriginalMrp)}
                    </td>
                    <td className="border-b-2 border-t-2 border-primary px-2 py-4 text-right font-bold">
                      {modalIsInterState ? "—" : formatPrice(modalCgst)}
                    </td>
                    <td className="border-b-2 border-t-2 border-primary px-2 py-4 text-right font-bold">
                      {modalIsInterState ? "—" : formatPrice(modalSgst)}
                    </td>
                    <td className="border-b-2 border-t-2 border-primary px-2 py-4 text-right">
                      <div className="text-xs font-black text-emerald-600">
                        {modalDiscountPercent}%
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-emerald-600">
                        − {formatPrice(modalProductDiscount)}
                      </div>
                    </td>
                    <td className="border-b-2 border-t-2 border-primary px-2 py-4 text-right text-base font-black text-primary">
                      {formatPrice(Number(order.total))}
                    </td>
                  </tr>
                </tbody>
              </table>
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
