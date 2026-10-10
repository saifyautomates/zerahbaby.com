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
  id?: string;
  sale_number: string;
  monthly_bill_number?: string | number | null;
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
/* ------------------------------------------------------------------ */
/*  Monthly Bill Number Resolution Helpers                             */
/* ------------------------------------------------------------------ */

/**
 * Formats a monthly number (e.g. 1 -> "Bill No - 01", 10 -> "Bill No - 10", 1000 -> "Bill No - 1000")
 */
export function formatMonthlyBillNumber(val: number | string): string {
  if (typeof val === "number" && !isNaN(val) && val > 0) {
    const padded = val < 10 ? `0${val}` : `${val}`;
    return `Bill No - ${padded}`;
  }
  const str = String(val || "").trim();
  if (/^Bill\s*No/i.test(str)) {
    return str;
  }
  const cleanDigits = str.replace(/\D/g, "");
  if (cleanDigits) {
    const num = parseInt(cleanDigits, 10);
    if (!isNaN(num) && num > 0) {
      const padded = num < 10 ? `0${num}` : `${num}`;
      return `Bill No - ${padded}`;
    }
  }
  return "Bill No - 01";
}

/**
 * Resolves the 1-based sequential bill number for a sale within its calendar month (IST).
 * 1st sale of month -> "Bill No - 01"
 * 2nd sale of month -> "Bill No - 02"
 * ...
 * 1000th sale of month -> "Bill No - 1000"
 * Resets back to "Bill No - 01" at the start of every new month.
 */
export async function getMonthlyBillNumberForSale(
  saleDate: Date | string,
  saleId?: string | null,
  saleNumber?: string | null,
): Promise<string> {
  try {
    const date = saleDate instanceof Date ? saleDate : new Date(saleDate);
    const safeDate = isNaN(date.getTime()) ? new Date() : date;

    const istFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
    });
    const [year, month] = istFmt.format(safeDate).split("-");
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    const startOfMonthIST = `${year}-${month}-01T00:00:00+05:30`;
    const nextMonthNum = monthNum === 12 ? 1 : monthNum + 1;
    const nextYearNum = monthNum === 12 ? yearNum + 1 : yearNum;
    const nextMonthStr = nextMonthNum < 10 ? `0${nextMonthNum}` : `${nextMonthNum}`;
    const endOfMonthIST = `${nextYearNum}-${nextMonthStr}-01T00:00:00+05:30`;

    const { data: monthSales, error } = await supabase
      .from("offline_sales")
      .select("id, sale_number, created_at")
      .gte("created_at", startOfMonthIST)
      .lt("created_at", endOfMonthIST)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error || !monthSales || monthSales.length === 0) {
      return "Bill No - 01";
    }

    let matchIdx = -1;
    if (saleId) {
      matchIdx = monthSales.findIndex((s) => s.id === saleId);
    }
    if (matchIdx === -1 && saleNumber) {
      matchIdx = monthSales.findIndex((s) => s.sale_number === saleNumber);
    }

    const billNum = matchIdx !== -1 ? matchIdx + 1 : monthSales.length;
    return formatMonthlyBillNumber(billNum);
  } catch {
    return "Bill No - 01";
  }
}

/* ------------------------------------------------------------------ */
/*  A4 HTML Builder (self-contained, no Tailwind)                      */
/* ------------------------------------------------------------------ */

export function buildA4HTML(
  sale: A4InvoiceSale,
  items: A4InvoiceItem[],
  store: ReturnType<typeof useSettings>,
  billNoOverride?: string,
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

  // Real date e.g. "10 October 2026"
  const dateStr = date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Real timing e.g. "12:45 pm"
  const timeStr = date
    .toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  // Clean bill number e.g. "Bill No - 01" (resets to 01 at start of each month)
  let billNoDisplay = (billNoOverride || "").trim();
  if (!billNoDisplay) {
    if (sale.monthly_bill_number != null) {
      billNoDisplay = formatMonthlyBillNumber(sale.monthly_bill_number);
    } else {
      const rawSaleNo = (sale.sale_number || "01").trim();
      if (/^Bill\s*No/i.test(rawSaleNo)) {
        billNoDisplay = rawSaleNo;
      } else {
        billNoDisplay = formatMonthlyBillNumber(rawSaleNo);
      }
    }
  }

  // Store information with photo defaults
  const storeAddress =
    store.storeAddress || "In front of Hanumani Temple, Awal Napsar, Kota, Rajasthan";
  const storePhone = store.contactPhone || "9070172777";
  const storeEmail = store.contactEmail || "hello@zerahkids.com";
  const logoSrc =
    typeof window !== "undefined" && window.location
      ? `${window.location.origin}/logo.png`
      : "/logo.png";

  const paymentDisplay = sale.payment_method
    ? sale.payment_method.toUpperCase()
    : "CASH";

  // Determine overall percentage discount if configured on sale
  const overallDiscountPct =
    sale.discount_type === "percentage" || (sale.discount_type as string) === "percent"
      ? Number(sale.discount_value || 0)
      : sale.subtotal > 0 && sale.discount > 0
        ? Math.round((sale.discount / sale.subtotal) * 100)
        : 0;

  let totalMrp = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalDiscount = 0;
  let grandTotal = 0;

  const itemRows = items
    .map((item, idx) => {
      const qty = Math.max(1, item.qty || 1);
      const gstRate = item.gst_rate != null ? Number(item.gst_rate) : 5; // default 5% (2.5% CGST + 2.5% SGST)
      const cgstRate = gstRate / 2;
      const sgstRate = gstRate / 2;

      // Base unit MRP
      const unitMrp =
        item.mrp && item.mrp > item.price ? item.mrp : item.mrp || item.price;
      const lineMrp = Math.round(unitMrp * qty * 100) / 100;

      // Combined product-level and sale-level discount
      const productDiscount =
        item.mrp && item.mrp > item.price
          ? Math.round((item.mrp - item.price) * qty * 100) / 100
          : 0;

      let saleDiscount = 0;
      if (overallDiscountPct > 0) {
        saleDiscount = Math.round((lineMrp * (overallDiscountPct / 100)) * 100) / 100;
      } else if (sale.discount > 0 && items.length === 1) {
        saleDiscount = Math.round(sale.discount * 100) / 100;
      }

      const itemDiscountAmount = productDiscount + saleDiscount;
      const itemDiscountPct =
        lineMrp > 0 ? Math.round((itemDiscountAmount / lineMrp) * 100) : 0;

      // GST computed from line taxable / rate
      const lineCgst = Math.round((lineMrp * (cgstRate / 100)) * 100) / 100;
      const lineSgst = Math.round((lineMrp * (sgstRate / 100)) * 100) / 100;
      const lineTotal = Math.round((lineMrp - itemDiscountAmount + lineCgst + lineSgst) * 100) / 100;

      totalMrp += lineMrp;
      totalCgst += lineCgst;
      totalSgst += lineSgst;
      totalDiscount += itemDiscountAmount;
      grandTotal += lineTotal;

      let discountDisplay = "—";
      if (itemDiscountAmount > 0) {
        discountDisplay = `
          <div style="font-weight: 800; font-size: 11px;">${itemDiscountPct}%</div>
          <div style="font-weight: 700; font-size: 11px; white-space: nowrap;">- ₹${itemDiscountAmount.toFixed(2)}</div>
        `;
      }

      const skuText = item.sku ? `SKU: ${escapeHtml(item.sku)}` : "";
      const hsnDisplay = item.hsn_code ? escapeHtml(item.hsn_code) : "-";

      return `
    <tr style="vertical-align: top; page-break-inside: avoid;">
      <td style="padding: 10px 4px; text-align: center; font-weight: 800; font-size: 11.5px; color: #000;">${idx + 1}</td>
      <td style="padding: 10px 6px; text-align: left;">
        <div style="font-weight: 800; font-size: 12px; color: #000;">${escapeHtml(item.name)}</div>
        ${skuText ? `<div style="font-size: 9.5px; color: #6b7280; font-family: monospace; margin-top: 2px;">${skuText}</div>` : ""}
      </td>
      <td style="padding: 10px 6px; text-align: center; font-family: monospace; font-size: 11.5px; color: #000;">${hsnDisplay}</td>
      <td style="padding: 10px 6px; text-align: center; font-size: 11.5px; color: #000;">${qty}</td>
      <td style="padding: 10px 6px; text-align: right; font-size: 11.5px; color: #000;">₹${lineMrp.toFixed(2)}</td>
      <td style="padding: 10px 6px; text-align: right; font-size: 11.5px; color: #000;">₹${lineCgst.toFixed(2)}</td>
      <td style="padding: 10px 6px; text-align: right; font-size: 11.5px; color: #000;">₹${lineSgst.toFixed(2)}</td>
      <td style="padding: 10px 6px; text-align: right; font-size: 11.5px; color: #000;">${discountDisplay}</td>
      <td style="padding: 10px 6px; text-align: right; font-weight: 800; font-size: 12px; color: #000;">₹${lineTotal.toFixed(2)}</td>
    </tr>`;
    })
    .join("");

  // Determine overall discount cell for G.TOTAL row
  const displayTotalDiscount = sale.discount > 0 ? sale.discount : totalDiscount;
  let totalDiscountDisplay = "—";
  if (displayTotalDiscount > 0) {
    const gDiscountPct = totalMrp > 0 ? Math.round((displayTotalDiscount / totalMrp) * 100) : 0;
    totalDiscountDisplay = `
      <div style="font-weight: 800; font-size: 11px;">${overallDiscountPct > 0 ? `${overallDiscountPct}%` : `${gDiscountPct}%`}</div>
      <div style="font-weight: 800; font-size: 11px; white-space: nowrap;">- ₹${displayTotalDiscount.toFixed(2)}</div>
    `;
  }

  // Fallback to sale.total if closely matching
  const finalGrandTotal =
    sale.total > 0 && Math.abs(grandTotal - sale.total) < 2 ? sale.total : grandTotal;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Tax Invoice ${escapeHtml(sale.sale_number)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page {
    size: A4 portrait;
    margin: 14mm 14mm 14mm 14mm;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
    line-height: 1.4;
    max-width: 210mm;
    margin: 0 auto;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    text-align: center;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 14px;
    margin-bottom: 20px;
  }
  .no-print { display: none !important; }
</style>
</head>
<body>

<!-- ── HEADER ── -->
<div class="header">
  <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 3px;">
    <img loading="lazy" decoding="async" src="${logoSrc}" alt="ZÉRAH" style="width: 38px; height: 38px; object-fit: contain; border-radius: 50%;" />
    <span style="font-size: 19px; font-weight: 900; color: #000; letter-spacing: 0.5px; text-transform: uppercase;">ZÉRAH BABY &amp; KIDS STORE</span>
  </div>
  <div style="font-size: 11px; color: #111; line-height: 1.4;">
    ${escapeHtml(storeAddress)}
  </div>
  <div style="font-size: 11px; color: #111; line-height: 1.4;">
    Ph: ${escapeHtml(storePhone)} | ${escapeHtml(storeEmail)}
  </div>
  <div style="border-bottom: 1.5px solid #000; margin-top: 8px; width: 100%;"></div>
</div>

<!-- ── INVOICE META ── -->
<div style="margin: 14px 0 16px 0;">
  <div style="color: #000; font-size: 26px; font-weight: 900; letter-spacing: -0.3px; line-height: 1.1;">TAX INVOICE</div>
  <div style="color: #000; font-size: 17px; font-weight: 800; margin-top: 4px;">${escapeHtml(billNoDisplay)}</div>
  <div style="color: #111; font-size: 12px; margin-top: 5px;">${dateStr}</div>
  <div style="color: #111; font-size: 12px; margin-top: 2px;">${timeStr}</div>
</div>

${
  sale.status === "pending_sync" || sale.is_offline_queued
    ? `<div style="margin: 8px 0; padding: 6px 10px; border: 1px dashed #000; text-align: center; color: #000; font-weight: 800; font-size: 10.5px;">
        ⚡ PENDING CLOUD SYNCHRONIZATION — Recorded offline, syncing automatically.
       </div>`
    : ""
}

<!-- ── BILLED TO & PAYMENT MODE ── -->
<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; padding-right: 12px;">
  <!-- BILLED TO -->
  <div style="display: flex; align-items: flex-start; gap: 10px;">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 2px; flex-shrink: 0;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    <div>
      <div style="color: #111; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">BILLED TO</div>
      <div style="color: #000; font-size: 15px; font-weight: 800; margin-top: 2px;">${escapeHtml(sale.customer_name || "Walk-in Customer")}</div>
      <div style="color: #111; font-size: 11.5px; margin-top: 2px;">Ph: ${escapeHtml(sale.customer_phone || "--")}</div>
    </div>
  </div>

  <!-- PAYMENT MODE -->
  <div style="display: flex; align-items: flex-start; gap: 10px;">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 2px; flex-shrink: 0;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
    <div>
      <div style="color: #111; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">PAYMENT MODE</div>
      <div style="margin-top: 4px;">
        <span style="border: 1px solid #9ca3af; background: #e5e7eb; color: #000; border-radius: 9999px; padding: 2px 16px; font-size: 11.5px; font-weight: 800; display: inline-block; text-transform: uppercase;">
          ${escapeHtml(paymentDisplay)}
        </span>
      </div>
      <div style="color: #111; font-size: 11.5px; margin-top: 4px;">Status: PAID</div>
    </div>
  </div>
</div>

<!-- ── ITEMS TABLE ── -->
<table>
  <thead>
    <tr style="border-bottom: 1.5px solid #000;">
      <th style="padding: 8px 4px; font-size: 10.5px; font-weight: 800; color: #000; text-align: center; width: 30px;">#</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: left;">PRODUCT</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: center; width: 50px;">HSN</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: center; width: 40px;">QTY</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: right; width: 90px; line-height: 1.2;">M.R.P.<br/>(ORIGINAL)</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: right; width: 65px; line-height: 1.2;">CGST<br/>2.5%</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: right; width: 65px; line-height: 1.2;">SGST<br/>2.5%</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: right; width: 80px;">DISCOUNT</th>
      <th style="padding: 8px 6px; font-size: 10.5px; font-weight: 800; color: #000; text-align: right; width: 85px;">TOTAL</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
    <tr style="border-top: 1.5px solid #000; border-bottom: 2px solid #000;">
      <td colspan="4" style="padding: 10px 6px; text-align: right; font-size: 13px; font-weight: 900; letter-spacing: 0.5px; color: #000;">
        G.TOTAL
      </td>
      <td style="padding: 10px 6px; text-align: right; font-size: 12px; font-weight: 800; color: #000;">
        ₹${totalMrp.toFixed(2)}
      </td>
      <td style="padding: 10px 6px; text-align: right; font-size: 12px; font-weight: 800; color: #000;">
        ₹${totalCgst.toFixed(2)}
      </td>
      <td style="padding: 10px 6px; text-align: right; font-size: 12px; font-weight: 800; color: #000;">
        ₹${totalSgst.toFixed(2)}
      </td>
      <td style="padding: 10px 6px; text-align: right; font-size: 12px; font-weight: 800; color: #000;">
        ${totalDiscountDisplay}
      </td>
      <td style="padding: 10px 6px; text-align: right; font-size: 13px; font-weight: 900; color: #000;">
        ₹${finalGrandTotal.toFixed(2)}
      </td>
    </tr>
  </tbody>
</table>

<!-- ── FOOTER ── -->
<div style="border-top: 1.5px solid #000; margin-top: 24px; padding-top: 14px; display: flex; justify-content: space-between; align-items: flex-start;">
  <div style="display: flex; flex-direction: column; gap: 8px;">
    <div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
        <span style="font-size: 11.5px; font-weight: 800; color: #000;">Return &amp; Exchange Policy:</span>
      </div>
      <div style="font-size: 9.5px; color: #374151; margin-top: 2px; margin-left: 22px;">Exchange/returns within 7 days with original receipt &amp; tags intact.</div>
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
      <span style="font-size: 11px; font-weight: 800; color: #000;">Website:</span>
      <span style="font-size: 11px; font-weight: 800; color: #000;">zerahkids.com</span>
    </div>
  </div>

  <div style="width: 1.5px; height: 48px; background: #000; margin: 0 16px;"></div>

  <div style="text-align: right;">
    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <span style="font-size: 11.5px; font-weight: 800; color: #000;">Thank You for Shopping!</span>
    </div>
    <div style="font-family: 'Caveat', 'Segoe Script', 'Brush Script MT', 'Dancing Script', cursive, sans-serif; font-size: 32px; font-weight: 700; color: #000; line-height: 1.1; margin-top: 4px;">
      Visit Again <span style="font-size: 22px; vertical-align: middle;">&#9825;</span>
    </div>
  </div>
</div>

</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function A4Invoice({ sale, items, autoPrint, onPrintSuccess, onPrintFail, onClose }: Props) {
  const storeSettings = useSettings();
  const [printStatus, setPrintStatus] = useState<PrintStatus>("idle");
  const [printFailedReason, setPrintFailedReason] = useState<string | null>(null);
  const [invoicePrinter, setInvoicePrinter] = useState<string>("Default A4 Printer");

  // Monthly sequential bill number (e.g. "Bill No - 01", "Bill No - 02"... resets monthly)
  const [billNoDisplay, setBillNoDisplay] = useState<string>(() => {
    if (sale.monthly_bill_number != null) {
      return formatMonthlyBillNumber(sale.monthly_bill_number);
    }
    const rawSaleNo = (sale.sale_number || "01").trim();
    if (/^Bill\s*No/i.test(rawSaleNo)) {
      return rawSaleNo;
    }
    return formatMonthlyBillNumber(rawSaleNo);
  });

  useEffect(() => {
    let isMounted = true;
    if (sale.monthly_bill_number != null) {
      setBillNoDisplay(formatMonthlyBillNumber(sale.monthly_bill_number));
      return;
    }

    getMonthlyBillNumberForSale(
      sale.sale_date || new Date(),
      sale.id,
      sale.sale_number,
    ).then((resolved) => {
      if (isMounted && resolved) {
        setBillNoDisplay(resolved);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [sale.sale_number, sale.sale_date, sale.id, sale.monthly_bill_number]);

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
      let effectiveBillNo = billNoDisplay;
      if (!effectiveBillNo || effectiveBillNo === "Bill No - 01") {
        if (sale.monthly_bill_number != null) {
          effectiveBillNo = formatMonthlyBillNumber(sale.monthly_bill_number);
        } else {
          effectiveBillNo = await getMonthlyBillNumberForSale(
            sale.sale_date || new Date(),
            sale.id,
            sale.sale_number,
          );
          setBillNoDisplay(effectiveBillNo);
        }
      }

      const html = buildA4HTML(sale, items, storeSettings, effectiveBillNo);

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
      doSystemPrintFallback(effectiveBillNo);
    } catch {
      doSystemPrintFallback();
    }
  };

  /** Print via hidden iframe */
  const doSystemPrintFallback = async (overrideBillNo?: string) => {
    setPrintStatus("printing");
    try {
      let effectiveBillNo = overrideBillNo || billNoDisplay;
      if (!effectiveBillNo || effectiveBillNo === "Bill No - 01") {
        if (sale.monthly_bill_number != null) {
          effectiveBillNo = formatMonthlyBillNumber(sale.monthly_bill_number);
        } else {
          effectiveBillNo = await getMonthlyBillNumberForSale(
            sale.sale_date || new Date(),
            sale.id,
            sale.sale_number,
          );
          setBillNoDisplay(effectiveBillNo);
        }
      }

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
          }, 3000);
        }
      };

      const waitAndPrint = () => {
        const imgs = Array.from(doc.images || []);
        if (imgs.length === 0 || imgs.every((img) => img.complete)) {
          setTimeout(triggerPrint, 120);
        } else {
          let loaded = 0;
          imgs.forEach((img) => {
            img.onload = img.onerror = () => {
              loaded++;
              if (loaded >= imgs.length) setTimeout(triggerPrint, 60);
            };
          });
          setTimeout(triggerPrint, 600);
        }
      };

      iframe.onload = waitAndPrint;

      doc.open();
      doc.write(buildA4HTML(sale, items, storeSettings, effectiveBillNo));
      doc.close();

      if (doc.readyState === "complete") {
        waitAndPrint();
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
            <h2 className="text-base font-bold text-foreground">A4 Tax Invoice</h2>
            <p className="text-xs font-bold text-foreground">{billNoDisplay}</p>
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
                onClick={() => doSystemPrintFallback()}
                className="font-bold underline text-amber-900 cursor-pointer ml-2 shrink-0"
              >
                Retry Print
              </button>
            </div>
          )}

          {/* Sale summary */}
          <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bill No</span>
              <span className="font-extrabold text-foreground">{billNoDisplay}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Reference No</span>
              <span>{sale.sale_number}</span>
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
