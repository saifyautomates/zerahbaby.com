/**
 * A4Invoice — Professional A4 customer invoice for Zérah Baby & Kids.
 *
 * PRINT PROFILE: INVOICE_A4
 *
 * Distinct from ThermalReceipt which is the narrow 80–108mm POS receipt.
 * This component renders a full A4 branded invoice suitable for:
 * - Customer copy (handed across the counter)
 * - Emailed PDF
 * - Printed on any A4/Letter printer
 *
 * Architecture:
 *  - Renders via hidden iframe (print isolation — does NOT interfere with the main app)
 *  - Supports autoPrint, printStatus, onPrintSuccess/onPrintFail for retry flow
 *  - Snapshot-based: invoice data is frozen at sale time, unaffected by later product changes
 *  - TOKEN MUST NOT appear on this invoice (only on the thermal POS receipt for walk-in queue)
 *
 * Usage: Mount after successful sale with autoPrint={settings.autoPrint}
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer, MonitorOff, CheckCircle } from "lucide-react";
import { formatPrice } from "@/lib/store";
import { sendHTMLViaQZTray } from "@/lib/print-settings";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/lib/store";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type A4InvoiceSale = {
  sale_number: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  store_credit_used?: number;
  credit_token_used?: string | null;
  coupon_code?: string | null;
  coupon_discount?: number;
  payment_method: string;
  notes?: string;
  sale_date?: Date;
  status?: "completed" | "pending_sync" | "failed";
  is_offline_queued?: boolean;
};

export type A4InvoiceItem = {
  name: string;
  sku?: string;
  barcode?: string;
  color?: string | null;
  size?: string | null;
  price: number;
  mrp?: number;
  qty: number;
};

export type PrintStatus = "idle" | "printing" | "success" | "failed";

type Props = {
  sale: A4InvoiceSale;
  items: A4InvoiceItem[];
  /** If true, trigger print automatically on mount (after sale commit) */
  autoPrint?: boolean;
  /** Called when print dialog opens successfully */
  onPrintSuccess?: () => void;
  /** Called when print fails (printer offline, iframe error, etc.) */
  onPrintFail?: (error: string) => void;
  onClose: () => void;
};

/* ------------------------------------------------------------------ */
/*  Store Info (matches site_settings defaults)                        */
/* ------------------------------------------------------------------ */
const STORE = {
  name: "ZÉRAH BABY & KIDS",
  tagline: "Premium Children's Clothing",
  address:
    "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar,\nGordhanpura, Kota, Rajasthan 324001",
  phone: "9057074777 / 9667571712",
  email: "hello@zerahkids.com",
  website: "zerahkids.com",
  instagram: "@zerah_kids",
  gstin: "",
  bank_name: "",
  account_no: "",
  ifsc: "",
  branch: "",
  upi_id: "",
};

/* ------------------------------------------------------------------ */
/*  A4 HTML Builder (self-contained, no Tailwind)                      */
/* ------------------------------------------------------------------ */

export function buildA4HTML(
  sale: A4InvoiceSale,
  items: A4InvoiceItem[],
  store: ReturnType<typeof useSettings>,
): string {
  const date = sale.sale_date ?? new Date();

  const dateStr = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalItemsCount = items.reduce((s, it) => s + (it.qty || 1), 0);

  const itemRows = items
    .map((item, i) => {
      const lineTotal = item.price * item.qty;
      const hasMRP = typeof item.mrp === "number" && item.mrp > item.price;
      const totalSavings = hasMRP ? (item.mrp! - item.price) * item.qty : 0;
      const variantDetails = [
        item.color ? `Color: ${escapeHtml(item.color)}` : "",
        item.size ? `Size: ${escapeHtml(item.size)}` : "",
        item.sku ? `SKU: ${escapeHtml(item.sku)}` : "",
        item.barcode ? `Barcode: ${escapeHtml(item.barcode)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
    <tr class="${i % 2 === 1 ? "alt-row" : ""}">
      <td class="center cell-idx">${i + 1}</td>
      <td class="cell-desc">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${variantDetails ? `<div class="item-meta">${variantDetails}</div>` : ""}
      </td>
      <td class="center bold cell-qty">${item.qty}</td>
      <td class="right cell-mrp">${hasMRP ? `<span class="mrp-strike">₹${item.mrp!.toLocaleString("en-IN")}</span>` : "—"}</td>
      <td class="right bold cell-rate">₹${item.price.toLocaleString("en-IN")}</td>
      <td class="right cell-save">${totalSavings > 0 ? `<span class="save-tag">₹${totalSavings.toLocaleString("en-IN")}</span>` : "—"}</td>
      <td class="right bold cell-total">₹${lineTotal.toLocaleString("en-IN")}</td>
    </tr>`;
    })
    .join("");

  const discountLabel =
    sale.discount > 0
      ? `Discount${sale.discount_type === "percentage" || sale.discount_type === "percent" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}`
      : "";

  const paymentDisplay = sale.payment_method
    ? sale.payment_method.charAt(0).toUpperCase() + sale.payment_method.slice(1)
    : "Cash";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Invoice ${escapeHtml(sale.sale_number)}</title>
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
  .payment-badge {
    display: inline-block;
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 12px;
    padding: 1px 8px;
    font-size: 9px;
    font-weight: 700;
    color: #15803d;
    text-transform: uppercase;
    margin-right: 4px;
  }
  .status-badge {
    display: inline-block;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 12px;
    padding: 1px 8px;
    font-size: 8.5px;
    font-weight: 800;
    color: #047857;
    text-transform: uppercase;
  }

  /* ── Wide Line Items Table ── */
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
  table.items-table th.col-qty { width: 55px; text-align: center; }
  table.items-table th.col-mrp { width: 85px; text-align: right; }
  table.items-table th.col-rate { width: 85px; text-align: right; }
  table.items-table th.col-save { width: 85px; text-align: right; }
  table.items-table th.col-total { width: 95px; text-align: right; }

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
  .item-meta { font-size: 8.5px; color: #64748b; font-family: monospace; margin-top: 1px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .mrp-strike { color: #94a3b8; text-decoration: line-through; }
  .save-tag { color: #15803d; font-weight: 700; }

  /* ── 2-Column Bottom Summary Section ── */
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
  .no-print { display: none !important; }
</style>
</head>
<body>

<div class="invoice-container">
  <!-- ── 3-COLUMN HEADER ── -->
  <div class="header">
    <div class="header-left">
      <img loading="lazy" decoding="async" src="${typeof window !== "undefined" ? window.location.origin : ""}/logo.png" class="brand-logo" alt="Zerah Logo"/>
      <div>
        <div class="brand-title">ZÉRAH BABY &amp; KIDS STORE</div>
        <div class="brand-tagline">Premium Children's Clothing · Newborn to Pre-Teen</div>
      </div>
    </div>
    <div class="header-center">
      <div>In Front of Hanumanji Temple, Atwal Nagar</div>
      <div>Kota, Rajasthan 324001</div>
      <div>Ph: ${escapeHtml(store.contactPhone)}</div>
      <div>${escapeHtml(store.contactEmail)}</div>
    </div>
    <div class="header-right">
      <div class="invoice-badge">${sale.status === "pending_sync" || sale.is_offline_queued ? "OFFLINE VOUCHER" : "TAX INVOICE"}</div>
      <div class="invoice-number">${escapeHtml(sale.sale_number)}</div>
      <div class="invoice-date">${dateStr} · ${timeStr}</div>
    </div>
  </div>

  ${
    sale.status === "pending_sync" || sale.is_offline_queued
      ? `<div style="margin: 4px 0 8px; padding: 5px 10px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 6px; text-align: center; color: #b45309; font-weight: 700; font-size: 10px;">
          ⚡ PENDING CLOUD SYNCHRONIZATION — This sale was recorded offline and will be synchronized automatically.
         </div>`
      : ""
  }

  <!-- ── 3-COLUMN INFO BAR ── -->
  <div class="info-bar">
    <div class="info-card">
      <div class="info-card-title">Billed To</div>
      <div class="info-card-value">${escapeHtml(sale.customer_name || "Walk-in Customer")}</div>
      ${sale.customer_phone ? `<div class="info-card-sub">Ph: ${escapeHtml(sale.customer_phone)}</div>` : ""}
      ${sale.customer_email ? `<div class="info-card-sub">${escapeHtml(sale.customer_email)}</div>` : ""}
    </div>
    <div class="info-card">
      <div class="info-card-title">Payment Mode &amp; Status</div>
      <div style="margin-top:2px;">
        <span class="payment-badge">${escapeHtml(paymentDisplay)}</span>
        <span class="status-badge">PAID</span>
      </div>
      ${
        sale.store_credit_used && sale.store_credit_used > 0
          ? `<div class="info-card-sub" style="margin-top:3px; font-weight:700; color:#047857;">
              Store Credit Tender: ₹${sale.store_credit_used.toLocaleString("en-IN")} ${sale.credit_token_used ? `[${escapeHtml(sale.credit_token_used)}]` : ""}
             </div>`
          : ""
      }
    </div>
    <div class="info-card">
      <div class="info-card-title">Sale Details</div>
      <div class="info-card-value">${totalItemsCount} Total Item${totalItemsCount !== 1 ? "s" : ""} (${items.length} Product${items.length !== 1 ? "s" : ""})</div>
      <div class="info-card-sub">Terminal: ZÉRAH POS · Cashier Counter</div>
    </div>
  </div>

  <!-- ── WIDE ITEMS TABLE ── -->
  <table class="items-table">
    <thead>
      <tr>
        <th class="col-idx">#</th>
        <th class="col-desc">Item Description</th>
        <th class="col-qty">Qty</th>
        <th class="col-mrp">MRP</th>
        <th class="col-rate">Unit Price</th>
        <th class="col-save">Savings</th>
        <th class="col-total">Net Total</th>
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
        <div>Exchange or return within 7 days of purchase with original receipt and price tags intact.</div>
      </div>
      <div style="font-size: 8.5px; color: #64748b;">
        GST: Not Applicable (Composition / Exemption Threshold) · Computer Generated Invoice
      </div>
      ${
        sale.notes
          ? `<div style="font-size: 8.5px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 3px; margin-top: 2px;">
              <strong>Notes:</strong> ${escapeHtml(sale.notes)}
             </div>`
          : ""
      }
    </div>

    <div class="totals-box">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>₹${sale.subtotal.toLocaleString("en-IN")}</span>
      </div>
      ${
        sale.coupon_discount && sale.coupon_discount > 0
          ? `<div class="totals-row discount">
          <span>Coupon (${escapeHtml(sale.coupon_code || "PROMO")})</span>
          <span>−₹${sale.coupon_discount.toLocaleString("en-IN")}</span>
        </div>`
          : ""
      }
      ${
        sale.discount > 0
          ? `<div class="totals-row discount">
          <span>${escapeHtml(discountLabel)}</span>
          <span>−₹${sale.discount.toLocaleString("en-IN")}</span>
        </div>`
          : ""
      }
      <div class="totals-row grand-total">
        <span>TOTAL</span>
        <span>₹${sale.total.toLocaleString("en-IN")}</span>
      </div>
      ${
        sale.store_credit_used && sale.store_credit_used > 0
          ? `<div class="totals-row" style="color:#047857; font-weight:700; background:#f0fdf4; font-size:9.5px;">
              <span>Credit Used ${sale.credit_token_used ? `[${escapeHtml(sale.credit_token_used)}]` : ""}</span>
              <span>−₹${sale.store_credit_used.toLocaleString("en-IN")}</span>
            </div>
            <div class="totals-row" style="font-weight:700; font-size:9.5px;">
              <span>Additional Paid (${escapeHtml(paymentDisplay)})</span>
              <span>₹${Math.max(0, sale.total - sale.store_credit_used).toLocaleString("en-IN")}</span>
            </div>`
          : ""
      }
    </div>
  </div>

  <!-- ── FOOTER ── -->
  <div class="footer">
    <div class="footer-left">Thank You For Shopping At ZÉRAH BABY &amp; KIDS!</div>
    <div class="footer-right">zerahkids.com · ${escapeHtml(store.instagramUrl || "@zerah_kids")}</div>
  </div>
</div>

</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  HTML Sanitiser (prevents XSS in invoice content)                   */
/* ------------------------------------------------------------------ */
function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function A4Invoice({ sale, items, autoPrint, onPrintSuccess, onPrintFail, onClose }: Props) {
  const storeSettings = useSettings();
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  const [printFailedReason, setPrintFailedReason] = useState<string | null>(null);
  const [invoicePrinter, setInvoicePrinter] = useState<string>("Default A4 Printer");

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["print_invoice_printer_name"])
      .then(({ data }) => {
        const found = data?.find((r) => r.key === "print_invoice_printer_name");
        if (found && found.value) setInvoicePrinter(found.value);
      });
  }, []);

  /** Print directly via QZ Tray if active, otherwise seamless fallback to browser print */
  const doPrint = async () => {
    setPrintStatus("printing");
    setPrintFailedReason(null);
    try {
      const html = buildA4HTML(sale, items, storeSettings);

      // Attempt QZ Tray direct silent print if configured & not default
      if (invoicePrinter && invoicePrinter !== "Default A4 Printer") {
        try {
          const res = await sendHTMLViaQZTray(invoicePrinter, html, { isThermal: false });
          if (res.success) {
            setPrintStatus("success");
            onPrintSuccess?.();
            return;
          }
        } catch {
          // QZ Tray not active, continue to system print
        }
      }

      // Seamless browser system print dialog
      doSystemPrintFallback();
    } catch {
      doSystemPrintFallback();
    }
  };

  /** Print via hidden iframe */
  const doSystemPrintFallback = () => {
    setPrintStatus("printing");
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:297mm;height:210mm;border:none;visibility:hidden;";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        setPrintStatus("failed");
        setPrintFailedReason("Could not create print iframe");
        onPrintFail?.("Could not create print iframe");
        return;
      }

      let printed = false;
      const triggerPrint = () => {
        if (printed) return;
        printed = true;
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setPrintStatus("success");
          onPrintSuccess?.();
        } catch (err) {
          setPrintStatus("failed");
          const msg = err instanceof Error ? err.message : "Print dialog failed";
          setPrintFailedReason(msg);
          onPrintFail?.(msg);
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
      doc.write(buildA4HTML(sale, items, storeSettings));
      doc.close();

      if (doc.readyState === "complete") {
        setTimeout(triggerPrint, 60);
      }
    } catch (err) {
      setPrintStatus("failed");
      const msg = err instanceof Error ? err.message : "Unknown print error";
      setPrintFailedReason(msg);
      onPrintFail?.(msg);
    }
  };

  // Auto-print on mount (only if not a duplicate sale)
  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => doPrint(), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  const date = sale.sale_date ?? new Date();

  const content = (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="A4 Invoice"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">A4 Invoice</h2>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-[#8B2020]/10 text-[#8B2020]">
                A4 Landscape
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{sale.sale_number}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted"
              aria-label="Close invoice"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Preview Summary ── */}
        <div className="p-5 space-y-3">
          {/* Print status indicator */}
          {printStatus === "printing" && (
            <div className="flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              Opening print dialog…
            </div>
          )}
          {printStatus === "success" && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              Invoice print ready.
            </div>
          )}
          {printStatus === "failed" && (
            <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <span>{printFailedReason || "Print dialog closed or canceled."}</span>
              <button
                onClick={doSystemPrintFallback}
                className="font-bold underline text-amber-900 cursor-pointer ml-2 shrink-0"
              >
                Retry Print
              </button>
            </div>
          )}

          {/* Sale summary */}
          <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice #</span>
              <span className="font-bold">{sale.sale_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-semibold">{sale.customer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span>
                {date.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items</span>
              <span>{items.reduce((s, i) => s + i.qty, 0)}</span>
            </div>
            {sale.coupon_discount && sale.coupon_discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Coupon ({sale.coupon_code || "PROMO"})</span>
                <span className="font-semibold">−{formatPrice(sale.coupon_discount)}</span>
              </div>
            )}
            {sale.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Discount</span>
                <span className="font-semibold">−{formatPrice(sale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 mt-1">
              <span className="font-black text-foreground">Total</span>
              <span className="font-black text-[#8B2020] text-base">{formatPrice(sale.total)}</span>
            </div>
            {sale.store_credit_used && sale.store_credit_used > 0 && (
              <div className="flex justify-between text-emerald-700 text-xs">
                <span>Exchange Credit Tender</span>
                <span>−{formatPrice(sale.store_credit_used)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Action Buttons ── */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-all"
          >
            Close
          </button>
          <button
            onClick={doPrint}
            disabled={printStatus === "printing"}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#8B2020] py-2.5 text-sm font-bold text-white hover:bg-[#7a1c1c] disabled:opacity-60 transition-all"
          >
            <Printer className="h-4 w-4" />
            {printStatus === "printing" ? "Printing…" : "Print A4 Invoice (Landscape)"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
