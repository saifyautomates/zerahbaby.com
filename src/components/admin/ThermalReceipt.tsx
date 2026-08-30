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
  payment_method: string;
  /**
   * Daily sequential walk-in token number (1, 2, 3...).
   * Only set for offline POS sales. Shown on thermal receipt, NOT on A4 invoice.
   */
  pos_token_number?: number | null;
  /** Whether this was a duplicate-prevented sale — if true, autoPrint must NOT fire */
  duplicate?: boolean;
};

export type ThermalReceiptItem = {
  name: string;
  sku?: string;
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

function buildThermalHTML(
  sale: ThermalReceiptSale,
  items: ThermalReceiptItem[],
  date: Date,
  store: ReturnType<typeof useSettings>,
): string {
  const itemRows = items
    .map((item) => {
      const hasMRP = item.mrp && item.mrp > item.price;
      const savings = hasMRP ? (item.mrp! - item.price) * item.qty : 0;

      let priceInfo = `<div style="font-size:10px;color:#666;">₹${item.price.toLocaleString("en-IN")} × ${item.qty}${item.sku ? ` · SKU: ${escHtml(item.sku)}` : ""}</div>`;
      if (hasMRP) {
        priceInfo += `
        <div style="font-size:10px;color:#666;margin-top:2px;">
          <span style="text-decoration:line-through;margin-right:6px;">MRP ₹${item.mrp!.toLocaleString("en-IN")}</span>
          <span style="color:#15803d;font-weight:600;">Save ₹${savings.toLocaleString("en-IN")}</span>
        </div>`;
      }

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

  const discountRow =
    sale.discount > 0
      ? `<div style="display:flex;justify-content:space-between;color:#15803d;">
          <span>Discount${sale.discount_type === "percentage" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}</span>
          <span style="font-weight:600;">−₹${sale.discount.toLocaleString("en-IN")}</span>
         </div>`
      : "";

  // Token row — only shown on thermal POS receipt, never on A4 invoice
  const tokenRow =
    sale.pos_token_number != null
      ? `<div style="text-align:center;margin-top:10px;padding:6px 0;border:2px solid #000;border-radius:4px;">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#555;">Walk-In Token</div>
          <div style="font-size:28px;font-weight:900;color:#000;line-height:1;">${sale.pos_token_number}</div>
         </div>`
      : "";

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
    font-size: 12px;
    color: #000;
    background: #fff;
    width: 76mm;
  }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
</style>
</head>
<body>
  <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px;">
    <div style="font-size:15px;font-weight:900;letter-spacing:-0.5px;">ZÉRAH BABY &amp; KIDS STORE</div>
    <div style="font-size:9.5px;color:#555;margin-top:4px;">In Front of Hanumanji Temple,<br/>Atwal Nagar, Kota, Rajasthan</div>
    <div style="font-size:9.5px;color:#555;margin-top:2px;">Ph: ${escHtml(store.contactPhone)}</div>
  </div>

  <div style="font-size:11px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Invoice</span><span style="font-weight:700;">${escHtml(sale.sale_number)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Date</span><span>${date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Time</span><span>${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
  </div>

  <div class="divider"></div>
  <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:8px;">
    <span style="color:#555;">Customer</span>
    <span style="font-weight:600;">${escHtml(sale.customer_name)}</span>
  </div>
  ${sale.customer_phone ? `<div style="font-size:10px;display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#555;">Mobile</span><span>${escHtml(sale.customer_phone)}</span></div>` : ""}
  <div class="divider"></div>

  <div style="font-size:11px;margin-bottom:8px;">${itemRows}</div>

  <div class="divider"></div>
  <div style="font-size:11px;margin-bottom:4px;">
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Subtotal</span><span>₹${sale.subtotal.toLocaleString("en-IN")}</span></div>
    ${discountRow}
    <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:4px;margin-top:4px;">
      <span style="font-size:13px;font-weight:900;">TOTAL</span>
      <span style="font-size:13px;font-weight:900;">₹${sale.total.toLocaleString("en-IN")}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#555;margin-top:2px;">
      <span>Payment</span><span style="font-weight:700;text-transform:uppercase;">${escHtml(sale.payment_method)}</span>
    </div>
  </div>

  ${tokenRow}

  <div class="divider"></div>
  <div style="text-align:center;font-size:10px;color:#555;">
    <div style="font-weight:700;">Thank You For Shopping!</div>
    <div>Exchange/Return within 7 days with receipt.</div>
    <div style="margin-top:2px;">Visit us again · ${escHtml(store.instagramUrl)}</div>
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

      doc.open();
      doc.write(buildThermalHTML(sale, items, date, storeSettings));
      doc.close();

      iframe.onload = () => {
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
          <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
            <p className="text-sm font-black tracking-tight text-foreground">
              ZÉRAH BABY &amp; KIDS
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Premium Children's Clothing</p>
            <p className="text-[10px] text-muted-foreground">Gordhanpura, Kota, Rajasthan 324001</p>
            <p className="text-[10px] text-muted-foreground">Ph: 9057074777</p>
          </div>

          {/* Invoice details */}
          <div className="text-[11px] space-y-0.5 mb-3">
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

          {/* Customer */}
          <div className="border-t border-dashed border-gray-400 pt-2 pb-2 mb-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-semibold text-foreground text-right max-w-[55%] truncate">
                {sale.customer_name}
              </span>
            </div>
            {sale.customer_phone && sale.customer_phone.trim() !== "" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mobile</span>
                <span className="text-foreground">{sale.customer_phone}</span>
              </div>
            )}
          </div>

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Items */}
          <div className="space-y-1.5 text-[11px]">
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

          <div className="border-t border-dashed border-gray-400 my-2" />

          {/* Totals */}
          <div className="text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-foreground">{formatPrice(sale.subtotal)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>
                  Discount
                  {sale.discount_type === "percentage"
                    ? ` (${sale.discount_value}%)`
                    : sale.discount_type === "fixed"
                      ? ` (₹${sale.discount_value})`
                      : ""}
                </span>
                <span className="font-semibold">−{formatPrice(sale.discount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-gray-900">
              <span className="font-black text-foreground text-sm">TOTAL</span>
              <span className="font-black text-foreground text-sm">{formatPrice(sale.total)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>Payment</span>
              <span className="font-bold uppercase">{sale.payment_method}</span>
            </div>
          </div>

          {/* Token number (walk-in queue — shown on thermal, NOT on A4 invoice) */}
          {sale.pos_token_number != null && (
            <>
              <div className="border-t border-dashed border-gray-400 my-3" />
              <div className="text-center border-2 border-gray-800 rounded-lg p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Walk-In Token
                </p>
                <p className="text-5xl font-black text-foreground leading-none mt-1">
                  {sale.pos_token_number}
                </p>
              </div>
            </>
          )}

          <div className="border-t border-dashed border-gray-400 my-3" />

          {/* Footer */}
          <div className="text-center text-[10px] text-muted-foreground space-y-0.5">
            <p className="font-bold">Thank You For Shopping!</p>
            <p>Exchange/Return within 7 days with receipt.</p>
            <p className="mt-1">Visit us again · zerah_kids</p>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
