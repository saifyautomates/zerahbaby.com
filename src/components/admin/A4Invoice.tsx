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
  discount_type?: string;
  discount_value?: number;
  total: number;
  store_credit_used?: number;
  credit_token_used?: string | null;
  coupon_code?: string | null;
  coupon_discount?: number;
  payment_method: string;
  notes?: string;
  sale_date?: Date | string;
  status?: "completed" | "pending_sync" | "failed";
  is_offline_queued?: boolean;
  is_inter_state?: boolean;
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
  hsn_code?: string | null;
  gst_rate?: number | null;
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
  // Resolve real date and real timing
  let date: Date;
  if (sale.sale_date instanceof Date && !isNaN(sale.sale_date.getTime())) {
    date = sale.sale_date;
  } else if (typeof sale.sale_date === "string" && sale.sale_date.trim()) {
    const raw = sale.sale_date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const now = new Date();
      date = new Date(`${raw}T${now.toTimeString().slice(0, 8)}`);
    } else {
      const parsed = new Date(raw);
      date = isNaN(parsed.getTime()) ? new Date() : parsed;
    }
  } else {
    date = new Date();
  }

  // Real date e.g. "27 September 2026"
  const dateStr = date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Real timing e.g. "10:26 am"
  const timeStr = date
    .toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  let totalTaxable = 0;
  let totalGstAmount = 0;

  // Detect whether item prices are base rates (exclusive of GST) or gross totals (inclusive)
  const isAdditive =
    sale.total > (sale.subtotal - (sale.discount || 0)) ||
    Math.round((sale.total - sale.subtotal) * 100) / 100 > 0;

  const itemRows = items
    .map((item, idx) => {
      const gstRate = item.gst_rate != null ? Number(item.gst_rate) : 0;
      let unitRate: number;
      let gstAmount: number;
      let lineTotal: number;

      if (isAdditive && gstRate > 0) {
        // Exclusive rate mode (typical POS with additive GST)
        unitRate = item.price;
        const lineBase = unitRate * item.qty;
        gstAmount = Math.round(lineBase * (gstRate / 100) * 100) / 100;
        lineTotal = lineBase + gstAmount;
        totalTaxable += lineBase;
      } else if (gstRate > 0) {
        // Inclusive rate mode
        lineTotal = item.price * item.qty;
        const taxable = Math.round((lineTotal / (1 + gstRate / 100)) * 100) / 100;
        gstAmount = Math.round((lineTotal - taxable) * 100) / 100;
        unitRate = Math.round((taxable / item.qty) * 100) / 100;
        totalTaxable += taxable;
      } else {
        unitRate = item.price;
        gstAmount = 0;
        lineTotal = unitRate * item.qty;
        totalTaxable += lineTotal;
      }

      totalGstAmount += gstAmount;

      const variantDetails = [
        item.color ? `Color: ${escapeHtml(item.color)}` : "",
        item.size ? `Size: ${escapeHtml(item.size)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const skuText = item.sku ? `SKU: ${escapeHtml(item.sku)}` : "";
      const subInfo = [variantDetails, skuText].filter(Boolean).join(" · ");

      const hsnDisplay = item.hsn_code ? escapeHtml(item.hsn_code) : "—";
      const gstRateStr = gstRate > 0 ? `${gstRate}%` : "0%";

      return `
    <tr style="border-bottom: 1px solid #f3f4f6;">
      <td style="padding: 10px 6px; text-align: center; font-weight: 700; color: #111; vertical-align: top;">${idx + 1}</td>
      <td style="padding: 10px 8px; text-align: left; vertical-align: top;">
        <div style="font-weight: 700; color: #111; font-size: 12px;">${escapeHtml(item.name)}</div>
        ${subInfo ? `<div style="font-size: 9.5px; color: #6b7280; font-family: monospace; margin-top: 3px;">${subInfo}</div>` : ""}
      </td>
      <td style="padding: 10px 8px; text-align: center; font-family: monospace; font-size: 11px; color: #374151; vertical-align: top;">${hsnDisplay}</td>
      <td style="padding: 10px 8px; text-align: center; font-size: 11px; color: #111; vertical-align: top;">${item.qty}</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 11px; color: #111; vertical-align: top;">₹${unitRate.toFixed(2)}</td>
      <td style="padding: 10px 8px; text-align: center; font-size: 11px; color: #374151; vertical-align: top;">${gstRateStr}</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 11px; color: #374151; vertical-align: top;">₹${gstAmount.toFixed(2)}</td>
      <td style="padding: 10px 8px; text-align: right; font-size: 11px; font-weight: 800; color: #111; vertical-align: top;">₹${lineTotal.toFixed(2)}</td>
    </tr>`;
    })
    .join("");

  const discountLabel =
    sale.discount > 0
      ? `Discount${sale.discount_type === "percentage" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}`
      : "";

  const paymentDisplay = sale.payment_method
    ? sale.payment_method.charAt(0).toUpperCase() + sale.payment_method.slice(1).toLowerCase()
    : "Cash";

  const subtotalDisplay = (totalTaxable > 0 ? totalTaxable : sale.subtotal).toFixed(2);
  const logoSrc = typeof window !== "undefined" && window.location ? `${window.location.origin}/logo.png` : "/logo.png";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Tax Invoice ${escapeHtml(sale.sale_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: A4 portrait;
    margin: 15mm 12mm 15mm 12mm;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11px;
    color: #111;
    background: #fff;
    line-height: 1.45;
    max-width: 210mm;
    margin: 0 auto;
    padding: 0 2mm;
  }
  .header {
    text-align: center;
    margin-bottom: 6px;
  }
  .totals {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }
  .footer {
    border-top: 2px solid #dc2626;
    margin-top: 28px;
    padding-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
  }
  .no-print { display: none !important; }
</style>
</head>
<body>

<!-- ── HEADER ── -->
<div class="header">
  <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px;">
    <img loading="lazy" decoding="async" src="${logoSrc}" alt="ZÉRAH" style="width: 44px; height: 44px; object-fit: contain; border-radius: 50%;" />
    <span style="font-size: 20px; font-weight: 900; color: #dc2626; letter-spacing: 0.5px; text-transform: uppercase;">ZÉRAH BABY &amp; KIDS STORE</span>
  </div>
  <div style="font-size: 11px; color: #111; line-height: 1.4;">
    In front of Hanumanji Temple, Atwal Nagar, Kota, Rajasthan
  </div>
  <div style="font-size: 11px; color: #111; line-height: 1.4;">
    Ph: ${escapeHtml(store.contactPhone || "9057074777")} &nbsp;|&nbsp; ${escapeHtml(store.contactEmail || "hello@zerahkids.com")}
  </div>
  <div style="border-bottom: 2px solid #dc2626; margin-top: 10px; width: 100%;"></div>
</div>

<!-- ── INVOICE META ── -->
<div style="margin: 12px 0 16px 0;">
  <div style="color: #dc2626; font-size: 22px; font-weight: 900; letter-spacing: 0.5px; line-height: 1.1;">TAX INVOICE</div>
  <div style="color: #111; font-size: 15px; font-weight: 800; margin-top: 4px;">${escapeHtml(sale.sale_number)}</div>
  <div style="color: #111; font-size: 11.5px; margin-top: 4px;">${dateStr}</div>
  <div style="color: #111; font-size: 11.5px; margin-top: 2px;">${timeStr}</div>
</div>

${
  sale.status === "pending_sync" || sale.is_offline_queued
    ? `<div style="margin: 10px 0; padding: 8px 12px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 6px; text-align: center; color: #b45309; font-weight: 700; font-size: 11px;">
        ⚡ PENDING CLOUD SYNCHRONIZATION — Recorded offline, syncing automatically.
       </div>`
    : ""
}

<!-- ── BILLED TO & PAYMENT MODE CARDS ── -->
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
  <!-- BILLED TO -->
  <div style="background: #fff5f5; border: 1px solid #fee2e2; border-radius: 8px; padding: 10px 14px; display: flex; align-items: flex-start; gap: 12px;">
    <div style="width: 34px; height: 34px; border-radius: 50%; background: #fee2e2; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </div>
    <div>
      <div style="color: #dc2626; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">BILLED TO</div>
      <div style="color: #111; font-size: 14px; font-weight: 800; margin-top: 2px;">${escapeHtml(sale.customer_name || "Walk-in Customer")}</div>
      <div style="color: #374151; font-size: 11px; margin-top: 2px;">Ph: ${escapeHtml(sale.customer_phone || "—")}</div>
      ${sale.customer_email ? `<div style="color: #6b7280; font-size: 10px; margin-top: 1px;">${escapeHtml(sale.customer_email)}</div>` : ""}
    </div>
  </div>

  <!-- PAYMENT MODE -->
  <div style="background: #f0fdf4; border: 1px solid #dcfce7; border-radius: 8px; padding: 10px 14px; display: flex; align-items: flex-start; gap: 12px;">
    <div style="width: 34px; height: 34px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
    </div>
    <div>
      <div style="color: #dc2626; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">PAYMENT MODE</div>
      <div style="margin-top: 4px;">
        <span style="border: 1.5px solid #16a34a; background: #fff; color: #16a34a; border-radius: 9999px; padding: 2px 14px; font-size: 11px; font-weight: 800; display: inline-block; text-transform: uppercase;">
          ${escapeHtml(paymentDisplay)}
        </span>
      </div>
      <div style="color: #374151; font-size: 11px; margin-top: 4px;">Status: PAID</div>
    </div>
  </div>
</div>

<!-- ── ITEMS TABLE ── -->
<table>
  <thead style="background: #fff5f5; border-bottom: 1.5px solid #fee2e2;">
    <tr>
      <th style="padding: 8px 6px; font-size: 10px; font-weight: 800; color: #111; text-align: center; width: 35px;">#</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: left;">PRODUCT</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: center; width: 65px;">HSN</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: center; width: 45px;">QTY</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: right; width: 65px;">RATE</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: center; width: 65px;">GST RATE</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: right; width: 75px;">GST AMOUNT</th>
      <th style="padding: 8px 8px; font-size: 10px; font-weight: 800; color: #111; text-align: right; width: 75px;">TOTAL</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>

<!-- ── TOTALS ── -->
<div class="totals">
  <div style="width: 250px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff;">
    <div style="display: flex; justify-content: space-between; padding: 7px 12px; font-size: 11px; color: #374151;">
      <span>Subtotal</span>
      <span>₹${subtotalDisplay}</span>
    </div>
    ${
      totalGstAmount > 0
        ? `<div style="display: flex; justify-content: space-between; padding: 7px 12px; font-size: 11px; background: #fef2f2; color: #dc2626; font-weight: 700; border-top: 1px solid #fee2e2; border-bottom: 1px solid #fee2e2;">
            <span>Total GST</span>
            <span>₹${totalGstAmount.toFixed(2)}</span>
          </div>`
        : ""
    }
    ${
      sale.coupon_discount && sale.coupon_discount > 0
        ? `<div style="display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; color: #15803d;">
            <span>Coupon (${escapeHtml(sale.coupon_code || "PROMO")})</span>
            <span>−₹${sale.coupon_discount.toFixed(2)}</span>
          </div>`
        : ""
    }
    ${
      sale.discount > 0
        ? `<div style="display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; color: #15803d;">
            <span>${escapeHtml(discountLabel)}</span>
            <span>−₹${sale.discount.toFixed(2)}</span>
          </div>`
        : ""
    }
    ${
      sale.store_credit_used && sale.store_credit_used > 0
        ? `<div style="display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; color: #047857; font-weight: 600;">
            <span>Store Credit</span>
            <span>−₹${sale.store_credit_used.toFixed(2)}</span>
          </div>`
        : ""
    }
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;">
      <span style="font-size: 18px; font-weight: 900; color: #111;">TOTAL</span>
      <span style="font-size: 18px; font-weight: 900; color: #111;">₹${sale.total.toFixed(2)}</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 7px 12px; font-size: 11px; color: #4b5563;">
      <span>Payment Method</span>
      <span>${escapeHtml(paymentDisplay)}</span>
    </div>
  </div>
</div>

${
  sale.notes
    ? `<div style="margin-top: 12px; font-size: 10px; color: #555;">
    <strong>Notes:</strong> ${escapeHtml(sale.notes)}
  </div>`
    : ""
}

<!-- ── FOOTER ── -->
<div class="footer">
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
        <span style="font-size: 11px; font-weight: 800; color: #111;">Return &amp; Exchange Policy:</span>
      </div>
      <div style="font-size: 9.5px; color: #4b5563; margin-top: 2px; margin-left: 21px;">Exchange/Return within 7 days with original receipt &amp; tags intact.</div>
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
      <span style="font-size: 10.5px; font-weight: 800; color: #111;">Website:</span>
      <a href="https://zerahkids.com" style="font-size: 10.5px; font-weight: 800; color: #dc2626; text-decoration: none;">zerahkids.com</a>
    </div>
  </div>

  <div style="width: 1.5px; height: 44px; background: #374151; margin: 0 16px;"></div>

  <div style="text-align: right;">
    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <span style="font-size: 11.5px; font-weight: 800; color: #dc2626;">Thank You for Shopping!</span>
    </div>
    <div style="font-family: 'Brush Script MT', 'Caveat', 'Segoe Script', cursive, sans-serif; font-size: 32px; font-weight: bold; color: #dc2626; line-height: 1.1; margin-top: 3px;">
      Visit Again <span style="font-size: 22px; vertical-align: middle;">&#9825;</span>
    </div>
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
        "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden;";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        setPrintStatus("failed");
        setPrintFailedReason("Could not create print iframe");
        onPrintFail?.("Could not create print iframe");
        return;
      }

      const triggerPrint = () => {
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

  const date =
    sale.sale_date instanceof Date
      ? sale.sale_date
      : sale.sale_date
        ? new Date(sale.sale_date)
        : new Date();

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
            {printStatus === "printing" ? "Printing…" : "Print A4 Invoice"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
