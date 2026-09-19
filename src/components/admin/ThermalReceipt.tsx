/**
 * ThermalReceipt — 80–108mm thermal POS receipt for HPRT HT300 / similar.
 *
 * PRINT PROFILE: THERMAL_RECEIPT (narrow POS slip, NOT the A4 customer invoice)
 *
 * Designed for:
 * - 80mm paper width (~72mm printable) or 108mm roll
 * - Monochrome thermal output
 * - Fast re-render for auto-print after sale commitment
 *
 * KEY RULES:
 *  - POS Token number IS shown on this receipt (walk-in queue tracking)
 *  - Token MUST NOT appear on the A4Invoice customer copy
 *  - Printing must NOT create a new sale / mutate business data
 *  - Sale must be committed BEFORE autoPrint fires
 *  - Duplicate sale guard: autoPrint must NOT fire if duplicate === true
 *  - Print failure shows [Retry] without rolling back the sale
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer, RotateCcw, CheckCircle, AlertTriangle } from "lucide-react";
import { formatPrice, useSettings } from "@/lib/store";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ThermalReceiptSale = {
  sale_number: string;
  customer_name: string;
  customer_phone?: string;
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
  /**
   * Daily sequential walk-in token number (1, 2, 3...).
   * Only set for offline POS sales. Shown on thermal receipt, NOT on A4 invoice.
   */
  pos_token_number?: number | null;
  /** Whether this was a duplicate-prevented sale — if true, autoPrint must NOT fire */
  duplicate?: boolean;
  /** Explicit transaction state */
  status?: "completed" | "pending_sync" | "failed";
  is_offline_queued?: boolean;
};

export type ThermalReceiptItem = {
  name: string;
  sku?: string;
  barcode?: string;
  color?: string | null;
  size?: string | null;
  price: number;
  mrp?: number;
  qty: number;
};

export type ThermalPrintStatus = "idle" | "printing" | "success" | "failed";

type Props = {
  sale: ThermalReceiptSale;
  items: ThermalReceiptItem[];
  saleDate?: Date;
  /** If true, triggers print automatically 500ms after mount (only when duplicate !== true) */
  autoPrint?: boolean;
  onClose: () => void;
  /** Called when print dialog opens successfully */
  onPrintSuccess?: () => void;
  /** Called when print fails */
  onPrintFail?: (error: string) => void;
};

/* ------------------------------------------------------------------ */
/*  HTML Builder (iframe-isolated, no CSS classes needed)              */
/* ------------------------------------------------------------------ */

export function buildThermalHTML(
  sale: ThermalReceiptSale,
  items: ThermalReceiptItem[],
  date: Date,
  store: ReturnType<typeof useSettings>,
): string {
  const itemRows = items
    .map((item) => {
      const variantDetails = [
        item.color ? `Color: ${escHtml(item.color)}` : "",
        item.size ? `Size: ${escHtml(item.size)}` : "",
        item.sku ? `SKU: ${escHtml(item.sku)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const priceInfo = `<div style="font-size:10px;color:#666;">₹${item.price.toLocaleString("en-IN")} × ${item.qty}${variantDetails ? ` · ${variantDetails}` : ""}</div>`;

      return `
    <div style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;gap:4px;">
        <span style="flex:1;font-weight:600;word-break:break-word;">${escHtml(item.name)}</span>
        <span style="white-space:nowrap;font-weight:600;">₹${(item.price * item.qty).toLocaleString("en-IN")}</span>
      </div>
      ${priceInfo}
    </div>`;
    })
    .join("");

  const couponRow =
    sale.coupon_discount && sale.coupon_discount > 0
      ? `<div style="display:flex;justify-content:space-between;color:#15803d;">
          <span>Coupon (${escHtml(sale.coupon_code || "PROMO")})</span>
          <span style="font-weight:600;">−₹${sale.coupon_discount.toLocaleString("en-IN")}</span>
         </div>`
      : "";

  const discountRow =
    sale.discount > 0
      ? `<div style="display:flex;justify-content:space-between;color:#15803d;">
          <span>Discount${sale.discount_type === "percentage" || sale.discount_type === "percent" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}</span>
          <span style="font-weight:600;">−₹${sale.discount.toLocaleString("en-IN")}</span>
         </div>`
      : "";
  const dateStr = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const grossBillTotal = Math.max(
    sale.total,
    (sale.subtotal || 0) - (sale.discount || 0) - (sale.coupon_discount || 0),
  );
  const additionalPaid = Math.max(0, grossBillTotal - (sale.store_credit_used || 0));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Receipt ${escHtml(sale.sale_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 80mm auto; margin: 3mm 2mm; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    width: 76mm;
    max-width: 76mm;
    padding: 2mm 1mm;
    margin: 0 auto;
  }
  .divider { border-top: 1px dotted #000; margin: 6px 0; }
  .solid-divider { border-top: 1px solid #000; margin: 6px 0; }
  .text-center { text-align: center; }
  .bold { font-weight: 800; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
</style>
</head>
<body>
  <div class="text-center" style="margin-bottom: 6px;">
    <div style="font-size: 13.5px; font-weight: 900; letter-spacing: 0.5px;">ZÉRAH BABY &amp; KIDS STORE</div>
    <div style="font-size: 9.5px; color: #111; margin-top: 2px;">In Front of Hanumanji Temple,</div>
    <div style="font-size: 9.5px; color: #111;">Atwal Nagar, Kota, Rajasthan</div>
    <div style="font-size: 9.5px; color: #111;">Ph: 9057074777, 9667571712</div>
  </div>

  ${
    sale.status === "pending_sync" || sale.is_offline_queued
      ? `<div style="border: 1px dashed #000; padding: 4px 6px; margin: 4px 0 6px 0; font-weight: 800; font-size: 9px; text-align: center;">
          *** OFFLINE SALE — PENDING SYNC ***
          <div style="font-size: 8px; font-weight: normal; margin-top: 2px;">Saved locally. Will sync to cloud when connected.</div>
        </div>`
      : ""
  }

  <div class="divider"></div>

  <div style="font-size: 10.5px; line-height: 1.45;">
    <div class="row"><span>Invoice</span><span class="bold">${escHtml(sale.sale_number)}</span></div>
    <div class="row"><span>Date</span><span>${escHtml(dateStr)}</span></div>
    <div class="row"><span>Time</span><span>${escHtml(timeStr)}</span></div>
  </div>

  <div class="divider"></div>

  <div style="font-size: 10.5px; line-height: 1.45;">
    <div class="row"><span>Customer</span><span class="bold">${escHtml(sale.customer_name || "Walk-in Customer")}</span></div>
    ${sale.customer_phone ? `<div class="row"><span>Mobile</span><span>${escHtml(sale.customer_phone)}</span></div>` : ""}
  </div>

  <div class="divider"></div>
  ${itemRows}

  <div class="divider"></div>
  <div style="font-size: 10.5px; line-height: 1.45;">
    <div class="row"><span style="color:#333;">Subtotal</span><span>₹${sale.subtotal.toLocaleString("en-IN")}</span></div>
    ${couponRow}
    ${discountRow}
    <div style="border-top: 1px solid #000; margin-top: 4px; padding-top: 4px;">
      <div class="row">
        <span style="font-size: 13px; font-weight: 900;">TOTAL</span>
        <span style="font-size: 13px; font-weight: 900;">₹${grossBillTotal.toLocaleString("en-IN")}</span>
      </div>
    </div>
    ${
      sale.store_credit_used && sale.store_credit_used > 0
        ? `<div style="border-top: 1px dotted #666; padding-top: 3px; margin-top: 3px; font-size: 10px;">
            <div class="row" style="color: #047857; font-weight: 700;">
              <span>Exchange Credit ${sale.credit_token_used ? `[${escHtml(sale.credit_token_used)}]` : ""}</span><span>−₹${sale.store_credit_used.toLocaleString("en-IN")}</span>
            </div>
            ${
              additionalPaid > 0
                ? `<div class="row" style="font-weight: 700; margin-top: 1px;">
                    <span>Paid (${escHtml((sale.payment_method || "Cash").toUpperCase())})</span><span>₹${additionalPaid.toLocaleString("en-IN")}</span>
                   </div>`
                : `<div class="row" style="color: #047857; font-weight: 700; margin-top: 1px;">
                    <span>Settlement</span><span>100% Store Credit</span>
                   </div>`
            }
          </div>`
        : `<div class="row" style="margin-top: 2px;">
            <span style="color:#333;">Payment</span><span style="font-weight: 700; text-transform: uppercase;">${escHtml(sale.payment_method || "Cash")}</span>
          </div>`
    }
  </div>

  <div class="divider"></div>
  <div class="text-center" style="font-size: 9.5px; color: #111; line-height: 1.4;">
    <div style="font-weight: 800;">Thank You For Shopping!</div>
    <div>Exchange/Return within 7 days with receipt.</div>
    <div style="margin-top: 2px;">Visit us again ·</div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ThermalReceipt({
  sale,
  items,
  saleDate,
  autoPrint,
  onClose,
  onPrintSuccess,
  onPrintFail,
}: Props) {
  const storeSettings = useSettings();
  const date = saleDate ?? new Date();
  const [printStatus, setPrintStatus] = useState<ThermalPrintStatus>("idle");

  const doPrint = () => {
    setPrintStatus("printing");
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;";
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        setPrintStatus("failed");
        onPrintFail?.("Could not create print frame");
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
          onPrintFail?.(err instanceof Error ? err.message : "Print dialog failed");
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
      doc.write(buildThermalHTML(sale, items, date, storeSettings));
      doc.close();

      if (doc.readyState === "complete") {
        setTimeout(triggerPrint, 60);
      }
    } catch (err) {
      setPrintStatus("failed");
      onPrintFail?.(err instanceof Error ? err.message : "Unknown print error");
    }
  };

  // Auto-print guard:
  // 1. Only fires if autoPrint === true
  // 2. Does NOT fire if sale.duplicate === true (prevents double-printing on duplicate-prevented sales)
  useEffect(() => {
    if (autoPrint && !sale.duplicate) {
      const timer = setTimeout(() => doPrint(), 500);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, sale.duplicate]);

  const handlePrint = () => doPrint();

  const grossBillTotal = Math.max(
    sale.total,
    (sale.subtotal || 0) - (sale.discount || 0) - (sale.coupon_discount || 0),
  );
  const additionalPaid = Math.max(0, grossBillTotal - (sale.store_credit_used || 0));

  const content = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Thermal Receipt"
      onClick={onClose}
    >
      <div
        id="thermal-receipt-portal"
        className="flex w-full max-w-sm flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Modal Header ── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">Thermal Receipt</h2>
            <p className="text-xs text-muted-foreground">{sale.sale_number}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Close receipt"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              onClick={handlePrint}
              disabled={printStatus === "printing"}
              className="flex items-center gap-1.5 rounded-full bg-[#8B2020] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#7a1c1c] disabled:opacity-60"
            >
              <Printer className="h-3.5 w-3.5" />
              {printStatus === "printing" ? "Printing…" : "Print"}
            </button>
          </div>
        </div>

        {/* ── Status Banner ── */}
        {printStatus === "printing" && (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-800">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            Sending to thermal printer…
          </div>
        )}
        {printStatus === "success" && (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-2.5 text-xs text-green-800">
            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
            Receipt sent to printer.
          </div>
        )}
        {printStatus === "failed" && (
          <div className="mx-4 mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold text-red-800 mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Printer unavailable
            </div>
            <p className="text-[11px] text-red-700 mb-2">
              Sale was saved successfully. Only printing failed. Retry when printer is ready.
            </p>
            <button
              onClick={doPrint}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
            >
              <RotateCcw className="h-3 w-3" />
              Retry Print
            </button>
          </div>
        )}

        {/* ── Receipt Preview (screen-only) ── */}
        <div className="overflow-y-auto p-4">
          {/* Store header */}
          <div className="text-center pb-2">
            <p className="text-xs font-black tracking-tight text-foreground font-mono">
              ZÉRAH BABY &amp; KIDS STORE
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">In Front of Hanumanji Temple,</p>
            <p className="text-[10px] text-muted-foreground">Atwal Nagar, Kota, Rajasthan</p>
            <p className="text-[10px] text-muted-foreground">Ph: 9057074777, 9667571712</p>
          </div>

          <div className="border-t border-dotted border-gray-400 my-2.5" />

          {/* Status banner */}
          {sale.status === "pending_sync" || sale.is_offline_queued ? (
            <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/10 p-2 text-center text-xs mb-2.5 text-amber-700 dark:text-amber-300">
              <p className="font-extrabold text-[11px]">⚡ OFFLINE VOUCHER — PENDING SYNC</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Saved locally. Will synchronize to cloud database automatically.
              </p>
            </div>
          ) : null}

          {/* Invoice details */}
          <div className="text-[11px] space-y-0.5 mb-2.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice</span>
              <span className="font-bold text-foreground">{sale.sale_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="text-foreground">
                {date.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Time</span>
              <span className="text-foreground">
                {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>

          <div className="border-t border-dotted border-gray-400 my-2.5" />

          {/* Customer */}
          <div className="text-[11px] space-y-0.5 mb-2.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-semibold text-foreground text-right max-w-[55%] truncate">
                {sale.customer_name || "Walk-in Customer"}
              </span>
            </div>
            {sale.customer_phone && sale.customer_phone.trim() !== "" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mobile</span>
                <span className="text-foreground">{sale.customer_phone}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dotted border-gray-400 my-2.5" />

          {/* Items */}
          <div className="space-y-2 text-[11px]">
            {items.map((item, i) => (
              <div key={i}>
                <div className="flex justify-between gap-1">
                  <span className="flex-1 font-semibold text-foreground leading-tight truncate">
                    {item.name}
                  </span>
                  <span className="shrink-0 font-semibold text-foreground">
                    {formatPrice(item.price * item.qty)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatPrice(item.price)} × {item.qty}
                  {item.sku && ` · SKU: ${item.sku}`}
                </div>

              </div>
            ))}
          </div>

          <div className="border-t border-dotted border-gray-400 my-2.5" />

          {/* Totals */}
          <div className="text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatPrice(sale.subtotal)}</span>
            </div>
            {sale.coupon_discount && sale.coupon_discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Coupon ({sale.coupon_code || "PROMO"})</span>
                <span className="font-semibold">−{formatPrice(sale.coupon_discount)}</span>
              </div>
            )}
            {sale.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>
                  Discount
                  {sale.discount_type === "percentage" || sale.discount_type === "percent"
                    ? ` (${sale.discount_value}%)`
                    : sale.discount_type === "fixed"
                      ? ` (₹${sale.discount_value})`
                      : ""}
                </span>
                <span className="font-semibold">−{formatPrice(sale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-gray-900 mt-1">
              <span className="font-black text-foreground text-sm">TOTAL</span>
              <span className="font-black text-foreground text-sm">
                {formatPrice(grossBillTotal)}
              </span>
            </div>
            {sale.store_credit_used && sale.store_credit_used > 0 ? (
              <div className="pt-1 text-[10px] space-y-0.5 border-t border-dotted border-gray-300">
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>
                    Store Credit {sale.credit_token_used ? `[${sale.credit_token_used}]` : ""}
                  </span>
                  <span>−{formatPrice(sale.store_credit_used)}</span>
                </div>
                {additionalPaid > 0 ? (
                  <div className="flex justify-between font-bold">
                    <span>Paid ({sale.payment_method || "Cash"})</span>
                    <span>{formatPrice(additionalPaid)}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Settlement</span>
                    <span>100% Store Credit</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
                <span>Payment</span>
                <span className="font-bold uppercase">{sale.payment_method || "Cash"}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dotted border-gray-400 my-2.5" />

          {/* Footer */}
          <div className="text-center text-[10px] text-muted-foreground space-y-0.5">
            <p className="font-bold text-foreground">Thank You For Shopping!</p>
            <p>Exchange/Return within 7 days with receipt.</p>
            <p className="mt-0.5">Visit us again ·</p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
