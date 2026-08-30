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
  payment_method: string;
  notes?: string;
  sale_date?: Date;
};

export type A4InvoiceItem = {
  name: string;
  sku?: string;
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
  gst: "", // Not implemented — intentionally blank
  returnPolicy: "Exchange/Return within 7 days with original receipt & tags intact.",
};

/* ------------------------------------------------------------------ */
/*  A4 HTML Builder (self-contained, no Tailwind)                      */
/* ------------------------------------------------------------------ */

function buildA4HTML(sale: A4InvoiceSale, items: A4InvoiceItem[]): string {
  const date = sale.sale_date ?? new Date();

  const dateStr = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const itemRows = items
    .map(
      (item, i) => `
    <tr class="${i % 2 === 0 ? "even" : ""}">
      <td class="item-name">${escapeHtml(item.name)}${item.sku ? `<br/><span class="sku">SKU: ${escapeHtml(item.sku)}</span>` : ""}</td>
      <td class="center">${item.qty}</td>
      <td class="right">₹${item.price.toLocaleString("en-IN")}</td>
      ${item.mrp && item.mrp > item.price ? `<td class="right mrp-col">₹${item.mrp.toLocaleString("en-IN")}</td>` : `<td class="right">—</td>`}
      <td class="right bold">₹${(item.price * item.qty).toLocaleString("en-IN")}</td>
    </tr>`,
    )
    .join("");

  const discountLabel =
    sale.discount > 0
      ? `Discount${sale.discount_type === "percentage" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}`
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
  /* ── Header ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #8B2020;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .brand-name {
    font-size: 22px;
    font-weight: 900;
    color: #8B2020;
    letter-spacing: -0.5px;
  }
  .brand-tagline {
    font-size: 10px;
    color: #666;
    margin-top: 2px;
  }
  .brand-contact {
    font-size: 9.5px;
    color: #555;
    margin-top: 4px;
    line-height: 1.6;
  }
  .invoice-meta {
    text-align: right;
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
  /* ── Info rows ── */
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
  /* ── Items table ── */
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
  .sku { font-size: 9px; color: #888; font-weight: 400; font-family: monospace; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .mrp-col { color: #999; text-decoration: line-through; }
  /* ── Totals ── */
  .totals {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;
  }
  .totals-box {
    width: 220px;
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
  /* ── Payment ── */
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
  /* ── Footer ── */
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
    max-width: 300px;
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
  .no-print { display: none !important; }
</style>
</head>
<body>

<!-- ── HEADER ── -->
<div class="header">
  <div>
    <div class="brand-name">${escapeHtml(STORE.name)}</div>
    <div class="brand-tagline">${escapeHtml(STORE.tagline)}</div>
    <div class="brand-contact">
      ${escapeHtml(STORE.address.replace(/\n/g, "<br/>"))}<br/>
      Ph: ${escapeHtml(STORE.phone)}<br/>
      ${escapeHtml(STORE.email)} · ${escapeHtml(STORE.website)}
    </div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-title">Invoice</div>
    <div class="invoice-number">${escapeHtml(sale.sale_number)}</div>
    <div class="invoice-date">${dateStr}<br/>${timeStr}</div>
  </div>
</div>

<!-- ── BILLED TO / PAYMENT INFO ── -->
<div class="info-grid">
  <div class="info-card">
    <div class="info-card-title">Billed To</div>
    <div class="info-card-value">${escapeHtml(sale.customer_name)}</div>
    ${sale.customer_phone ? `<div class="info-card-sub">Ph: ${escapeHtml(sale.customer_phone)}</div>` : ""}
    ${sale.customer_email ? `<div class="info-card-sub">${escapeHtml(sale.customer_email)}</div>` : ""}
  </div>
  <div class="info-card">
    <div class="info-card-title">Payment</div>
    <div style="margin-top:2px;"><span class="payment-badge">${escapeHtml(paymentDisplay)}</span></div>
    <div class="info-card-sub" style="margin-top:6px;">Status: PAID</div>
  </div>
</div>

<!-- ── ITEMS TABLE ── -->
<table>
  <thead>
    <tr>
      <th style="text-align:left;">Product</th>
      <th class="center">Qty</th>
      <th class="right">Price</th>
      <th class="right">MRP</th>
      <th class="right">Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<!-- ── TOTALS ── -->
<div class="totals">
  <div class="totals-box">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>₹${sale.subtotal.toLocaleString("en-IN")}</span>
    </div>
    ${
      sale.discount > 0
        ? `<div class="totals-row alt discount">
        <span>${escapeHtml(discountLabel)}</span>
        <span>−₹${sale.discount.toLocaleString("en-IN")}</span>
      </div>`
        : ""
    }
    <div class="totals-row grand-total">
      <span>TOTAL</span>
      <span>₹${sale.total.toLocaleString("en-IN")}</span>
    </div>
  </div>
</div>

${
  sale.notes
    ? `<div style="margin-bottom:12px;font-size:10px;color:#555;">
    <strong>Notes:</strong> ${escapeHtml(sale.notes)}
  </div>`
    : ""
}

<!-- ── FOOTER ── -->
<div class="footer">
  <div>
    <div class="footer-policy">
      <strong>Return &amp; Exchange Policy:</strong><br/>
      ${escapeHtml(STORE.returnPolicy)}
    </div>
    <div style="margin-top:6px;font-size:9px;color:#aaa;">GST: Not Applicable</div>
  </div>
  <div class="footer-thanks">
    Thank You For Shopping!
    <div class="footer-web">${escapeHtml(STORE.website)} · ${escapeHtml(STORE.instagram)}</div>
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

  /** Print directly via QZ Tray (No Browser Dialog) */
  const doDirectPrint = async () => {
    setPrintStatus("printing");
    setPrintFailedReason(null);
    try {
      const html = buildA4HTML(sale, items);

      const res = await sendHTMLViaQZTray(invoicePrinter, html, { isThermal: false });
      if (res.success) {
        setPrintStatus("success");
        onPrintSuccess?.();
      } else {
        setPrintStatus("failed");
        setPrintFailedReason(res.error || "Direct print failed");
        onPrintFail?.(res.error || "Direct print failed");
      }
    } catch (err) {
      setPrintStatus("failed");
      const msg = err instanceof Error ? err.message : "Unknown print error";
      setPrintFailedReason(msg);
      onPrintFail?.(msg);
    }
  };

  /** Print via hidden iframe — ONLY as explicit fallback */
  const doSystemPrintFallback = () => {
    setPrintStatus("printing");
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden;";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        setPrintStatus("failed");
        setPrintFailedReason("Could not create print iframe");
        onPrintFail?.("Could not create print iframe");
        return;
      }

      doc.open();
      doc.write(buildA4HTML(sale, items));
      doc.close();

      iframe.onload = () => {
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
      const timer = setTimeout(() => doDirectPrint(), 500);
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
        className="flex w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">A4 Invoice</h2>
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
              Sending to printer…
            </div>
          )}
          {printStatus === "success" && (
            <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Invoice sent to printer successfully.
            </div>
          )}
          {printStatus === "failed" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center shadow-inner mt-4">
              <MonitorOff className="mx-auto size-8 text-red-500 mb-3" />
              <p className="font-bold text-red-800">Printer Unavailable</p>
              <p className="mt-1 text-xs text-red-600 mb-6">
                {printFailedReason || "Failed to communicate with QZ Tray or printer."}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row justify-center">
                <button
                  onClick={doDirectPrint}
                  className="rounded-lg bg-red-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-red-800 transition flex items-center justify-center gap-2"
                >
                  <Printer className="size-4" />
                  Retry Direct Print
                </button>
                <button
                  onClick={doSystemPrintFallback}
                  className="rounded-lg border-2 border-red-200 bg-white px-6 py-2.5 text-sm font-bold text-red-800 hover:bg-red-50 transition flex items-center justify-center gap-2"
                >
                  Use System Print
                </button>
              </div>
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
            <div className="flex justify-between border-t border-border pt-1.5 mt-1">
              <span className="font-black text-foreground">Total</span>
              <span className="font-black text-[#8B2020] text-base">{formatPrice(sale.total)}</span>
            </div>
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
            onClick={doDirectPrint}
            disabled={printStatus === "printing"}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#8B2020] py-2.5 text-sm font-bold text-white hover:bg-[#7a1c1c] disabled:opacity-60 transition-all"
          >
            <Printer className="h-4 w-4" />
            {printStatus === "printing" ? "Printing…" : "Print A4 Invoice"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
