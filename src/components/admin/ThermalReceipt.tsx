/**
 * ThermalReceipt — 80mm thermal printer optimized receipt for HGR HT-300X.
 *
 * Designed for:
 * - 80mm paper width (~72mm printable after margins)
 * - Monochrome thermal output
 * - Fast re-render for auto-print after sale
 *
 * Usage: createPortal into document.body from POSTab success step.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import { formatPrice } from "@/lib/store";

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
  /** Daily sequential walk-in token number (1, 2, 3...). Only set for offline POS sales. */
  pos_token_number?: number | null;
};

export type ThermalReceiptItem = {
  name: string;
  sku?: string;
  price: number;
  qty: number;
};

type Props = {
  sale: ThermalReceiptSale;
  items: ThermalReceiptItem[];
  saleDate?: Date;
  onClose: () => void;
  onPrint?: () => void;
  autoPrint?: boolean;
};

export function ThermalReceipt({ sale, items, saleDate, onClose, onPrint, autoPrint }: Props) {
  const date = saleDate ?? new Date();

  /** Build self-contained HTML for iframe printing (no CSS classes needed) */
  const buildPrintHTML = () => {
    const itemRows = items
      .map(
        (item) => `
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;gap:4px;">
          <span style="flex:1;font-weight:600;word-break:break-word;">${item.name}</span>
          <span style="white-space:nowrap;font-weight:600;">₹${(item.price * item.qty).toLocaleString("en-IN")}</span>
        </div>
        <div style="font-size:10px;color:#666;">₹${item.price.toLocaleString("en-IN")} × ${item.qty}</div>
      </div>`,
      )
      .join("");

    const discountRow =
      sale.discount > 0
        ? `<div style="display:flex;justify-content:space-between;color:#15803d;">
            <span>Discount${sale.discount_type === "percentage" ? ` (${sale.discount_value}%)` : sale.discount_type === "fixed" ? ` (₹${sale.discount_value})` : ""}</span>
            <span style="font-weight:600;">−₹${sale.discount.toLocaleString("en-IN")}</span>
           </div>`
        : "";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Receipt ${sale.sale_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 108mm auto; margin: 4mm; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; background: #fff; width: 100mm; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
</style>
</head>
<body>
  <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px;">
    <div style="font-size:14px;font-weight:900;letter-spacing:-0.5px;">ZÉRAH BABY & KIDS</div>
    <div style="font-size:10px;color:#555;">Premium Children's Clothing</div>
    <div style="font-size:10px;color:#555;">Gordhanpura, Kota, Rajasthan 324001</div>
    <div style="font-size:10px;color:#555;">Ph: 9057074777</div>
  </div>

  <div style="font-size:11px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Invoice</span><span style="font-weight:700;">${sale.sale_number}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Date</span><span>${date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#555;">Time</span><span>${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
  </div>

  <div class="divider"></div>
  <div style="font-size:11px;display:flex;justify-content:space-between;margin-bottom:8px;">
    <span style="color:#555;">Customer</span>
    <span style="font-weight:600;">${sale.customer_name}</span>
  </div>
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
      <span>Payment</span><span style="font-weight:700;text-transform:uppercase;">${sale.payment_method}</span>
    </div>
  </div>

  <div class="divider"></div>
  <div style="text-align:center;font-size:10px;color:#555;">
    <div style="font-weight:700;">Thank You For Shopping!</div>
    <div>Exchange/Return within 7 days with receipt.</div>
    <div style="margin-top:2px;">Visit us again · zerah_kids</div>
  </div>
</body>
</html>`;
  };

  const doPrint = () => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(buildPrintHTML());
    doc.close();
    // Wait for resources to load then print
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        // Remove iframe after a short delay (enough for print dialog to open)
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      }
    };
  };

  useEffect(() => {
    if (autoPrint) {
      setTimeout(() => doPrint(), 500);
    }
  }, [autoPrint]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = () => {
    if (onPrint) onPrint();
    doPrint();
  };

  const content = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm print:block print:bg-transparent print:p-0 print:inset-auto print:fixed-none"
      role="dialog"
      aria-label="Thermal Receipt"
      onClick={onClose}
    >
      <div
        id="thermal-receipt-portal"
        className="flex w-full max-w-sm flex-col rounded-2xl border border-border bg-card shadow-2xl print:rounded-none print:border-0 print:shadow-none print:max-w-none print:w-[100mm]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Screen header (hidden during print) ── */}
        <div className="thermal-no-print flex items-center justify-between border-b border-gray-100 px-5 py-4">
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
              className="flex items-center gap-1.5 rounded-full bg-[#8B2020] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#7a1c1c]"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
        </div>

        {/* ── Printable receipt body ── */}
        <div className="thermal-body overflow-y-auto p-4 print:p-0 print:overflow-visible">
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

          {/* Divider */}
          <div className="thermal-divider border-t border-dashed border-gray-400 my-2" />

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
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>
                    {formatPrice(item.price)} × {item.qty}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="thermal-divider border-t border-dashed border-gray-400 my-2" />

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
              <span className="thermal-total-row font-black text-foreground text-sm">TOTAL</span>
              <span className="thermal-total-row font-black text-foreground text-sm">
                {formatPrice(sale.total)}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>Payment</span>
              <span className="font-bold uppercase">{sale.payment_method}</span>
            </div>
          </div>

          {/* Divider */}
          <div className="thermal-divider border-t border-dashed border-gray-400 my-3" />

          {/* ── TOKEN NUMBER ── */}
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
