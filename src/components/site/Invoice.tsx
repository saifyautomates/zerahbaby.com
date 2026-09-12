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
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
        >
          <FileText className="size-3.5" />
          <span>Invoice</span>
        </button>
      ) : (
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
      )}
      {open && <InvoiceModal order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Escape helper for safe HTML generation */
function esc(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build professional, responsive A4 Landscape HTML for an online order invoice */
export function buildOrderA4HTML(
  order: Order,
  store: {
    brandName?: string;
    storeAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
): string {
  const brand = store.brandName || "ZÉRAH BABY & KIDS";
  const address = store.storeAddress || "In Front of Hanumanji Temple, Atwal Nagar, Kota, Rajasthan 324001";
  const phone = store.contactPhone || "9057074777";
  const email = store.contactEmail || "support@zerahkids.com";

  const dateObj = new Date(order.created_at);
  const dateStr = dateObj.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = dateObj.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const addressParts = [
    order.address,
    order.address_line2,
    order.landmark ? `near ${order.landmark}` : "",
    [order.city, order.state, order.pincode].filter(Boolean).join(", "),
  ].filter(Boolean);

  const paymentDisplay =
    order.payment_method?.toLowerCase() === "cod"
      ? "Cash on Delivery"
      : order.payment_method?.toLowerCase() === "razorpay" ||
          order.payment_method?.toLowerCase() === "online"
        ? "Online (Razorpay)"
        : order.payment_method?.toUpperCase() || "COD";

  const isPaid = order.payment_status?.toLowerCase() === "paid";

  const itemRows = (order.order_items || [])
    .map((item, idx) => {
      const unitRate = Number(item.price || item.price_at_time || 0);
      const amount = unitRate * item.qty;
      const isAlt = idx % 2 === 1;
      const attributes = [
        item.color ? `Color: ${esc(item.color)}` : "",
        item.size ? `Size: ${esc(item.size)}` : "",
        item.sku_snapshot
          ? `SKU: ${esc(item.sku_snapshot)}`
          : item.product_slug
            ? `Ref: ${esc(item.product_slug)}`
            : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <tr class="${isAlt ? "alt-row" : ""}">
          <td class="col-idx center">${idx + 1}</td>
          <td class="col-desc">
            <div class="item-name">${esc(item.name)}</div>
            ${attributes ? `<div class="item-meta">${attributes}</div>` : ""}
          </td>
          <td class="col-qty center bold">${item.qty}</td>
          <td class="col-rate right">₹${unitRate.toLocaleString("en-IN")}</td>
          <td class="col-amount right bold">₹${amount.toLocaleString("en-IN")}</td>
        </tr>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Invoice ${esc(order.invoice_no || order.id.slice(0, 8))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  html, body {
    width: 100%;
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 10px;
    line-height: 1.35;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .invoice-container {
    width: 100%;
    max-width: 277mm;
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* ── 3-Column Landscape Header (277mm width) ── */
  .header {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr;
    align-items: center;
    border-bottom: 2.5px solid #8B2020;
    padding-bottom: 8px;
    margin-bottom: 8px;
    gap: 16px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-logo {
    width: 44px;
    height: 44px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .brand-title {
    font-size: 17px;
    font-weight: 900;
    color: #8B2020;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    line-height: 1.1;
  }
  .brand-tagline {
    font-size: 9px;
    color: #64748b;
    font-weight: 600;
    letter-spacing: 0.2px;
    margin-top: 1px;
  }
  .header-center {
    text-align: center;
    font-size: 9px;
    color: #475569;
    line-height: 1.35;
    padding: 0 12px;
    border-left: 1px solid #e2e8f0;
    border-right: 1px solid #e2e8f0;
  }
  .header-right {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .invoice-badge {
    background: #8B2020;
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    padding: 3px 12px;
    border-radius: 4px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    display: inline-block;
  }
  .invoice-number {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    font-family: monospace;
    margin-top: 2px;
  }
  .invoice-date {
    font-size: 9px;
    color: #64748b;
  }

  /* ── 3-Column Info Bar ── */
  .info-bar {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr;
    gap: 10px;
    margin-bottom: 8px;
  }
  .info-card {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 6px 10px;
    background: #f8fafc;
  }
  .info-card-title {
    font-size: 8.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #8B2020;
    margin-bottom: 2px;
  }
  .info-card-value {
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
  }
  .info-card-sub {
    font-size: 9px;
    color: #64748b;
    margin-top: 1px;
  }
  .badge {
    display: inline-block;
    border-radius: 12px;
    padding: 1px 8px;
    font-size: 8.5px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-paid {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    color: #047857;
  }
  .badge-pending {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #b45309;
  }

  /* ── Line Items Table ── */
  table.items-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    page-break-inside: auto;
  }
  table.items-table thead {
    display: table-header-group;
  }
  table.items-table thead tr {
    background: #8B2020;
    color: #ffffff;
  }
  table.items-table th {
    padding: 6px 8px;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border: none;
  }
  table.items-table th.col-idx { width: 30px; text-align: center; }
  table.items-table th.col-desc { text-align: left; }
  table.items-table th.col-qty { width: 60px; text-align: center; }
  table.items-table th.col-rate { width: 100px; text-align: right; }
  table.items-table th.col-amount { width: 110px; text-align: right; }

  table.items-table tbody tr {
    page-break-inside: avoid;
    page-break-after: auto;
  }
  table.items-table tbody tr.alt-row {
    background: #f8fafc;
  }
  table.items-table td {
    padding: 5px 8px;
    font-size: 9.5px;
    vertical-align: middle;
    border-bottom: 1px solid #e2e8f0;
  }
  .item-name { font-weight: 700; color: #0f172a; }
  .item-meta { font-size: 8.5px; color: #64748b; margin-top: 1px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }

  /* ── 2-Column Bottom Summary ── */
  .bottom-summary {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 16px;
    align-items: start;
    margin-top: 2px;
    margin-bottom: 6px;
    page-break-inside: avoid;
  }
  .summary-left {
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    padding: 8px 12px;
    background: #f8fafc;
    font-size: 8.5px;
    color: #475569;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .summary-title {
    font-size: 8.5px;
    font-weight: 800;
    color: #0f172a;
    text-transform: uppercase;
  }
  .totals-box {
    border: 1.5px solid #8B2020;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 3.5px 10px;
    font-size: 10px;
    border-bottom: 1px solid #f1f5f9;
  }
  .totals-row.discount { color: #15803d; font-weight: 600; }
  .totals-row.grand-total {
    background: #8B2020;
    color: #ffffff;
    font-weight: 900;
    font-size: 12px;
    padding: 6px 10px;
    border-bottom: none;
  }

  /* ── Footer ── */
  .footer {
    border-top: 1.5px solid #8B2020;
    padding-top: 5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8.5px;
    color: #64748b;
    margin-top: auto;
    page-break-inside: avoid;
  }
  .footer-left { font-weight: 700; color: #8B2020; }
  .footer-right { font-weight: 600; color: #475569; }
</style>
</head>
<body>

<div class="invoice-container">
  <!-- ── 3-COLUMN HEADER ── -->
  <div class="header">
    <div class="header-left">
      <img loading="lazy" decoding="async" src="${typeof window !== "undefined" ? window.location.origin : ""}/logo.png" class="brand-logo" alt="Zerah Logo"/>
      <div>
        <div class="brand-title">${esc(brand)}</div>
        <div class="brand-tagline">Premium Children's Clothing · Newborn to Pre-Teen</div>
      </div>
    </div>
    <div class="header-center">
      <div>${esc(address)}</div>
      <div>Ph: ${esc(phone)} · ${esc(email)}</div>
    </div>
    <div class="header-right">
      <div class="invoice-badge">TAX INVOICE</div>
      <div class="invoice-number">${esc(order.invoice_no || "INV-" + order.id.slice(0, 8).toUpperCase())}</div>
      <div class="invoice-date">${dateStr} · ${timeStr}</div>
      <div style="font-size: 8.5px; color: #64748b; font-weight: 600;">Order #${order.id.slice(0, 8).toUpperCase()}</div>
    </div>
  </div>

  <!-- ── 3-COLUMN INFO BAR ── -->
  <div class="info-bar">
    <div class="info-card">
      <div class="info-card-title">Billed &amp; Delivered To</div>
      <div class="info-card-value">${esc(order.full_name)}</div>
      <div class="info-card-sub">${esc(addressParts.join(", "))}</div>
      <div class="info-card-sub" style="font-weight: 600; margin-top: 2px;">
        Ph: ${esc(order.phone)}${order.alt_phone ? ` / ${esc(order.alt_phone)}` : ""}
        ${order.email ? ` · ${esc(order.email)}` : ""}
      </div>
    </div>
    <div class="info-card">
      <div class="info-card-title">Payment Information</div>
      <div style="margin-top:2px;">
        <span style="font-weight:700; font-size:10.5px; color:#0f172a;">${esc(paymentDisplay)}</span>
        <span class="badge ${isPaid ? "badge-paid" : "badge-pending"}" style="margin-left:6px;">
          ${isPaid ? "PAID" : "UNPAID / PENDING"}
        </span>
      </div>
      <div class="info-card-sub" style="margin-top:4px;">Order Status: <strong style="text-transform:capitalize; color:#0f172a;">${esc(order.status)}</strong></div>
    </div>
    <div class="info-card">
      <div class="info-card-title">Order Overview</div>
      <div class="info-card-value">${order.order_items.reduce((s, i) => s + i.qty, 0)} Items (${order.order_items.length} Product${order.order_items.length !== 1 ? "s" : ""})</div>
      <div class="info-card-sub">Platform: ZÉRAH Online Storefront</div>
      <div class="info-card-sub">Waybill / AWB: ${esc(order.awb_code || "Direct Delivery")}</div>
    </div>
  </div>

  <!-- ── LINE ITEMS TABLE ── -->
  <table class="items-table">
    <thead>
      <tr>
        <th class="col-idx">#</th>
        <th class="col-desc">Item Description</th>
        <th class="col-qty">Qty</th>
        <th class="col-rate">Rate</th>
        <th class="col-amount">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- ── 2-COLUMN BOTTOM SUMMARY ── -->
  <div class="bottom-summary">
    <div class="summary-left">
      <div>
        <div class="summary-title">Return &amp; Exchange Policy:</div>
        <div>Exchange or return within 7 days of delivery with original tags intact.</div>
      </div>
      <div style="font-size: 8.5px; color: #64748b;">
        GST: Not Applicable (Composition / Exemption Threshold) · Computer Generated Tax Invoice
      </div>
      ${
        order.notes
          ? `<div style="font-size: 8.5px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 3px; margin-top: 2px;">
              <strong>Order Notes:</strong> ${esc(order.notes)}
             </div>`
          : ""
      }
    </div>

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
        <span>Delivery / Shipping</span>
        <span>${Number(order.shipping) === 0 ? "FREE" : `₹${Number(order.shipping).toLocaleString("en-IN")}`}</span>
      </div>
      <div class="totals-row grand-total">
        <span>TOTAL</span>
        <span>₹${Number(order.total).toLocaleString("en-IN")}</span>
      </div>
    </div>
  </div>

  <!-- ── FOOTER ── -->
  <div class="footer">
    <div class="footer-left">Thank You For Shopping At ${esc(brand)}!</div>
    <div class="footer-right">zerahkids.com · support@zerahkids.com</div>
  </div>
</div>

</body>
</html>`;
}

/** Print online order invoice using isolated A4 landscape iframe */
export function printOrderA4Invoice(
  order: Order,
  store: {
    brandName?: string;
    storeAddress?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:297mm;height:210mm;border:none;visibility:hidden;";
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
            /* already removed */
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

function InvoiceModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const { brandName, storeAddress, contactPhone, contactEmail } = useSettings();
  const storeSettings = { brandName, storeAddress, contactPhone, contactEmail };

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
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
      <div
        className="flex flex-col w-full max-w-5xl max-h-[95vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden print:max-h-none print:overflow-visible print:w-full print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-muted/20 print:hidden">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Tax Invoice Preview</h2>
            <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[#8B2020]/10 text-[#8B2020]">
              A4 Landscape
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

        {/* Invoice Body — A4 Landscape Proportioned */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 sm:p-8 print:p-0 print:overflow-visible bg-white text-slate-900">
          <div className="w-full max-w-[277mm] mx-auto">
            {/* Header section */}
            <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-4 border-b-2 border-[#8B2020] pb-4 mb-4">
              <div className="flex gap-3 items-center">
                <img
                  loading="lazy"
                  decoding="async"
                  src={logo}
                  alt={brandName}
                  className="size-14 object-contain shrink-0"
                />
                <div>
                  <p className="font-display text-xl font-black tracking-tight text-[#8B2020] uppercase">{brandName}</p>
                  <p className="text-[11px] text-slate-500 font-medium">Premium Children's Clothing</p>
                </div>
              </div>
              <div className="text-left md:text-center text-xs text-slate-600 md:border-x md:border-slate-200 md:px-4">
                <p>{storeAddress}</p>
                <p className="mt-0.5 font-medium">{contactPhone} · {contactEmail}</p>
              </div>
              <div className="text-left md:text-right">
                <span className="inline-block bg-[#8B2020] text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded tracking-wider">
                  Tax Invoice
                </span>
                <p className="mt-1 font-mono text-base font-bold text-slate-900">{order.invoice_no ?? `INV-${order.id.slice(0, 8).toUpperCase()}`}</p>
                <p className="text-xs text-slate-500">
                  {new Date(order.created_at).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <p className="text-[11px] font-semibold text-slate-500">
                  Order #{order.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
            </div>

            {/* Billing / Info details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4 text-xs border border-slate-200 mb-4 print:bg-transparent">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#8B2020]">Billed &amp; Delivered To</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{order.full_name}</p>
                <p className="mt-0.5 text-slate-600">
                  {[order.address, order.address_line2, order.landmark ? `near ${order.landmark}` : "", [order.city, order.state, order.pincode].filter(Boolean).join(", ")].filter(Boolean).join(", ")}
                </p>
                <p className="mt-1 font-medium text-slate-800">
                  Ph: {order.phone}{order.alt_phone ? ` / ${order.alt_phone}` : ""}
                  {order.email ? ` · ${order.email}` : ""}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#8B2020]">Payment Information</p>
                <p className="mt-1 font-bold text-slate-900">
                  {order.payment_method?.toLowerCase() === "cod"
                    ? "Cash on Delivery"
                    : order.payment_method?.toLowerCase() === "razorpay" ||
                        order.payment_method?.toLowerCase() === "online"
                      ? "Online (Razorpay)"
                      : order.payment_method?.toUpperCase() || "COD"}
                </p>
                <div className="mt-1">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      order.payment_status?.toLowerCase() === "paid"
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                        : "bg-amber-100 text-amber-800 border border-amber-300"
                    }`}
                  >
                    {order.payment_status?.toLowerCase() === "paid" ? "PAID" : "UNPAID / PENDING"}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-600">
                  Order Status: <strong className="capitalize text-slate-900">{order.status}</strong>
                </p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#8B2020]">Order Overview</p>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {order.order_items.reduce((s, i) => s + i.qty, 0)} Items ({order.order_items.length} Products)
                </p>
                <p className="mt-0.5 text-slate-600">Platform: ZÉRAH Online Storefront</p>
                <p className="mt-0.5 text-slate-600">Waybill: {order.awb_code || "Direct Delivery"}</p>
              </div>
            </div>

            {/* Line items table */}
            <table className="w-full text-left text-xs border-collapse mb-4">
              <thead>
                <tr className="bg-[#8B2020] text-white text-[10px] font-bold uppercase tracking-wider">
                  <th className="py-2 px-2 text-center w-8">#</th>
                  <th className="py-2 px-3">Item Description</th>
                  <th className="py-2 px-3 text-center w-16">Qty</th>
                  <th className="py-2 px-3 text-right w-28">Rate</th>
                  <th className="py-2 px-3 text-right w-28">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {order.order_items.map((item, idx) => (
                  <tr key={item.id} className={idx % 2 === 1 ? "bg-slate-50/70" : ""}>
                    <td className="py-2.5 px-2 text-center text-slate-500 font-medium">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <span className="block font-bold text-slate-900">{item.name}</span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                        {item.color && (
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                            Color: {item.color}
                          </span>
                        )}
                        {item.size && (
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                            Size: {item.size}
                          </span>
                        )}
                        {item.sku_snapshot && (
                          <span className="font-mono text-[10px] text-slate-500">
                            SKU: {item.sku_snapshot}
                          </span>
                        )}
                        {!item.sku_snapshot && <span>Ref: {item.product_slug}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-slate-800">{item.qty}</td>
                    <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                      {formatPrice(Number(item.price || item.price_at_time || 0))}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {formatPrice(Number(item.price || item.price_at_time || 0) * item.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bottom Summary (Policy Left, Totals Right) */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4 items-start mb-4">
              <div className="rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50 text-[11px] text-slate-600 space-y-1">
                <p className="font-bold uppercase text-slate-900 text-[10px]">Return &amp; Exchange Policy</p>
                <p>Exchange or return within 7 days of delivery with original tags intact.</p>
                <p className="text-[10px] text-slate-500 pt-1">GST: Not Applicable (Composition / Exemption Threshold) · Computer Generated Tax Invoice</p>
                {order.notes && (
                  <div className="mt-2 pt-2 border-t border-dashed border-slate-300 text-amber-900">
                    <strong>Order Note:</strong> “{order.notes}”
                  </div>
                )}
              </div>

              <div className="rounded-xl border-2 border-[#8B2020] overflow-hidden text-xs bg-white">
                <div className="flex justify-between px-3 py-1.5 border-b border-slate-100">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-semibold text-slate-900">{formatPrice(Number(order.subtotal))}</span>
                </div>
                {Number(order.discount) > 0 && (
                  <div className="flex justify-between px-3 py-1.5 border-b border-slate-100 text-emerald-700">
                    <span>Discount</span>
                    <span className="font-semibold">−{formatPrice(Number(order.discount))}</span>
                  </div>
                )}
                <div className="flex justify-between px-3 py-1.5 border-b border-slate-100">
                  <span className="text-slate-600">Delivery</span>
                  <span className="font-semibold text-slate-900">
                    {Number(order.shipping) === 0 ? "Free" : formatPrice(Number(order.shipping))}
                  </span>
                </div>
                <div className="flex justify-between px-3 py-2 bg-[#8B2020] text-white font-black text-sm">
                  <span>TOTAL</span>
                  <span>{formatPrice(Number(order.total))}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-[#8B2020] pt-2 flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-500">
              <p className="font-bold text-[#8B2020]">Thank you for shopping with {brandName}!</p>
              <p>zerahkids.com · support@zerahkids.com</p>
            </div>
          </div>

          {/* Action buttons (hidden when printing) */}
          <div className="mt-6 flex justify-end gap-3 print:hidden">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 cursor-pointer"
            >
              <X className="size-4" /> Close
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-xl bg-[#8B2020] px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#7a1c1c] cursor-pointer"
            >
              <Printer className="size-4" /> Print A4 Invoice (Landscape)
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
