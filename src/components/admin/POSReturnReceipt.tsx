/**
 * POSReturnReceipt — 80mm Thermal & A4 Exchange Credit Voucher for Offline Returns.
 *
 * Displays:
 * - Return Voucher Number & Date/Time
 * - Customer info & original sale reference
 * - Itemized returned products with quantities & return value
 * - Store Credit Voucher Available balance
 * - Exchange Policy note: "Exchange only — valid for purchasing any item at Zérah Baby & Kids"
 * - Restock confirmation
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer, RotateCcw, Sparkles, Tag, CheckCircle } from "lucide-react";
import { formatPrice } from "@/lib/store";

export type ReturnReceiptData = {
  return_number: string;
  credit_token?: string;
  customer_name: string;
  customer_phone?: string;
  refund_amount: number;
  refund_method: string;
  return_reason: string;
  notes?: string;
  created_at?: string;
  items: Array<{
    name: string;
    sku?: string;
    barcode?: string;
    variant_info?: string;
    refund_price: number;
    qty: number;
    subtotal: number;
  }>;
};

type Props = {
  returnData: ReturnReceiptData;
  onClose: () => void;
  onPrint?: () => void;
  autoPrint?: boolean;
};

function escHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildThermalReturnHTML(
  returnData: ReturnReceiptData,
  date: Date,
  isExchangeCredit: boolean,
  totalItemsCount: number,
): string {
  const dateStr = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const itemRows = returnData.items
    .map((item) => {
      const variantStr = [item.sku ? `SKU: ${escHtml(item.sku)}` : "", item.variant_info ? escHtml(item.variant_info) : ""]
        .filter(Boolean)
        .join(" · ");
      return `
      <div style="margin-bottom: 5px;">
        <div style="display: flex; justify-content: space-between; gap: 4px;">
          <span style="flex: 1; font-weight: 700; word-break: break-word;">${escHtml(item.name)}</span>
          <span style="white-space: nowrap; font-weight: 700;">₹${Number(item.subtotal || item.refund_price * item.qty).toLocaleString("en-IN")}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #444; margin-top: 1px;">
          <span>${variantStr || "Returned Item"}</span>
          <span>Qty: ${item.qty} × ₹${Number(item.refund_price).toLocaleString("en-IN")}</span>
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Return Voucher ${escHtml(returnData.return_number)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 80mm auto; margin: 3mm 2mm; }
  body {
    font-family: 'Courier New', Courier, monospace, -apple-system, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    background: #fff;
    width: 74mm;
    max-width: 74mm;
    padding: 2mm 1mm;
    margin: 0 auto;
  }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .text-center { text-align: center; }
  .bold { font-weight: 800; }
  .voucher-box {
    border: 2px dashed #000;
    padding: 6px 4px;
    margin: 8px 0;
    text-align: center;
  }
  .voucher-amount {
    font-size: 18px;
    font-weight: 900;
    margin: 3px 0;
  }
  .row { display: flex; justify-content: space-between; gap: 4px; }
</style>
</head>
<body>
  <div class="text-center">
    <div style="font-size: 14px; font-weight: 900; letter-spacing: 0.5px;">ZÉRAH BABY &amp; KIDS</div>
    <div style="font-size: 10px; color: #333;">Offline POS Returns &amp; Exchange</div>
    <div style="font-size: 10px; color: #333;">Kota, Rajasthan 324001</div>
    <div style="font-size: 10px; color: #333;">Support: +91 90570 74777</div>
    <div style="display: inline-block; border: 1px solid #000; padding: 2px 8px; font-size: 10px; font-weight: 800; margin-top: 5px; text-transform: uppercase;">
      ${isExchangeCredit ? "EXCHANGE CREDIT VOUCHER" : "RETURN RECEIPT"}
    </div>
  </div>

  ${
    isExchangeCredit
      ? `<div class="voucher-box">
          <div style="font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">AVAILABLE STORE CREDIT VALUE</div>
          <div class="voucher-amount">₹${Number(returnData.refund_amount).toLocaleString("en-IN")}</div>
          <div style="font-size: 9px; font-weight: 700;">✓ Valid for purchasing any item at store</div>
          ${returnData.credit_token ? `
            <div style="margin-top: 6px; border: 2px solid #000; padding: 4px; background: #fafafa;">
              <div style="font-size: 9px; font-weight: 800; text-transform: uppercase;">STORE CREDIT CODE</div>
              <div style="font-size: 22px; font-weight: 900; letter-spacing: 3px; font-family: monospace; color: #000; margin: 2px 0;">
                ${escHtml(returnData.credit_token)}
              </div>
              <div style="font-size: 8px; color: #555;">Show or enter this 4-character code at POS checkout</div>
            </div>` : ""}
        </div>`
      : ""
  }

  <div class="divider"></div>

  <div style="font-size: 10px; line-height: 1.4;">
    <div class="row"><span>Voucher / Return #:</span><span class="bold">${escHtml(returnData.return_number)}</span></div>
    ${returnData.credit_token ? `<div class="row" style="font-size: 11px; font-weight: 900; color: #000;"><span>Store Credit Code:</span><span style="font-family: monospace; letter-spacing: 1px;">${escHtml(returnData.credit_token)}</span></div>` : ""}
    <div class="row"><span>Date:</span><span>${dateStr}</span></div>
    <div class="row"><span>Time:</span><span>${timeStr}</span></div>
    ${returnData.customer_name ? `<div class="row" style="margin-top: 3px;"><span>Customer:</span><span class="bold">${escHtml(returnData.customer_name)}</span></div>` : ""}
    ${returnData.customer_phone ? `<div class="row"><span>Mobile:</span><span>${escHtml(returnData.customer_phone)}</span></div>` : ""}
  </div>

  <div class="divider"></div>
  <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">Returned Items (${totalItemsCount}):</div>
  ${itemRows}

  <div class="divider"></div>

  <div style="font-size: 11px; line-height: 1.4;">
    <div class="row"><span>Total Units Restocked:</span><span class="bold">+${totalItemsCount}</span></div>
    <div class="row" style="font-size: 12px; font-weight: 900; margin-top: 2px;">
      <span>TOTAL CREDIT ISSUED:</span>
      <span>₹${Number(returnData.refund_amount).toLocaleString("en-IN")}</span>
    </div>
    <div class="row" style="font-size: 10px; margin-top: 2px;">
      <span>Settlement Mode:</span>
      <span class="bold">${escHtml(isExchangeCredit ? "Store Credit Voucher" : returnData.refund_method || "Return")}</span>
    </div>
    ${returnData.return_reason ? `<div class="row" style="font-size: 10px;"><span>Reason:</span><span>${escHtml(returnData.return_reason)}</span></div>` : ""}
    ${returnData.notes ? `<div style="font-size: 9px; font-style: italic; margin-top: 2px;">Note: ${escHtml(returnData.notes)}</div>` : ""}
  </div>

  <div class="divider"></div>

  <div class="text-center" style="font-size: 9px; color: #222; line-height: 1.4; margin-top: 4px;">
    <div style="font-weight: 700; color: #000;">✓ Inventory Restocked</div>
    <div style="margin-top: 2px;">Policy: Store credit voucher is valid for purchasing any products at Zérah Baby &amp; Kids store.</div>
    <div style="margin-top: 4px; font-weight: 700;">Thank you for visiting Zérah Baby &amp; Kids!</div>
  </div>
</body>
</html>`;
}

function printViaIframe(htmlContent: string) {
  try {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(htmlContent);
    doc.close();

    iframe.onload = () => {
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
            /* already cleaned */
          }
        }, 2000);
      }
    };
  } catch {
    window.print();
  }
}

export function POSReturnReceipt({ returnData, onClose, onPrint, autoPrint }: Props) {
  const date = returnData.created_at ? new Date(returnData.created_at) : new Date();
  const isExchangeCredit =
    returnData.refund_method === "exchange_credit" || !returnData.refund_method;
  const totalItemsCount = returnData.items.reduce((sum, i) => sum + (i.qty || 1), 0);

  const handlePrint = () => {
    if (onPrint) onPrint();
    const html = buildThermalReturnHTML(returnData, date, isExchangeCredit, totalItemsCount);
    printViaIframe(html);
  };

  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => {
        handlePrint();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [autoPrint]);

  const content = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-label="Return Receipt & Exchange Voucher"
      onClick={onClose}
    >
      <div
        id="thermal-return-receipt-portal"
        className="flex w-full max-w-sm flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Screen header (hidden during print) ── */}
        <div className="thermal-no-print flex items-center justify-between border-b border-border px-5 py-4 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {isExchangeCredit ? "Exchange Credit Voucher" : "Return Receipt"}
              </h2>
              <p className="text-xs font-mono text-muted-foreground">{returnData.return_number}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-xs cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Slip
            </button>
          </div>
        </div>

        {/* ── Printable receipt body ── */}
        <div className="thermal-body overflow-y-auto max-h-[80vh] p-5 font-mono text-xs text-foreground bg-card">
          {/* Store header */}
          <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
            <p className="text-sm font-black tracking-tight text-foreground">
              ZÉRAH BABY &amp; KIDS
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Offline POS Returns &amp; Exchange
            </p>
            <p className="text-[10px] text-muted-foreground">Kota, Rajasthan 324001</p>
            <p className="text-[10px] text-muted-foreground">Support: +91 90570 74777</p>
            <div className="mt-2 inline-block rounded border border-gray-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
              {isExchangeCredit ? "STORE CREDIT / EXCHANGE VOUCHER" : "RETURN RECEIPT"}
            </div>
          </div>

          {/* Prominent Exchange Voucher Box */}
          {isExchangeCredit && (
            <div className="my-2.5 rounded-xl border-2 border-dashed border-emerald-600 bg-emerald-500/10 p-2.5 text-center print:border-black print:bg-transparent">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 print:text-black block">
                AVAILABLE STORE CREDIT VALUE
              </span>
              <span className="text-xl font-black text-emerald-700 dark:text-emerald-400 print:text-black block mt-0.5">
                {formatPrice(returnData.refund_amount)}
              </span>
              {returnData.credit_token && (
                <div className="mt-1.5 bg-background print:bg-transparent border border-emerald-500/40 rounded-lg py-1 px-2 font-mono text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  TOKEN: {returnData.credit_token}
                </div>
              )}
              <div className="flex items-center justify-between text-[9px] font-bold text-emerald-900 dark:text-emerald-200 print:text-black mt-1.5 pt-1 border-t border-emerald-500/20">
                <span>Expiry: NEVER / NO EXPIRY</span>
                <span>All Store Items</span>
              </div>
            </div>
          )}

          {/* Return details */}
          <div className="text-[11px] space-y-0.5 mb-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Return Number</span>
              <span className="font-bold text-foreground">{returnData.return_number}</span>
            </div>
            {returnData.credit_token && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit Token</span>
                <span className="font-bold text-foreground font-mono">{returnData.credit_token}</span>
              </div>
            )}
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
                {returnData.customer_name}
              </span>
            </div>
            {returnData.customer_phone && returnData.customer_phone.trim() !== "" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mobile</span>
                <span className="text-foreground">{returnData.customer_phone}</span>
              </div>
            )}
          </div>

          {/* Items Header */}
          <div className="border-t border-dashed border-gray-400 pt-2 pb-1">
            <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase">
              <span className="w-[50%]">Item Returned</span>
              <span className="w-[20%] text-center">Qty</span>
              <span className="w-[30%] text-right">Value</span>
            </div>
          </div>

          {/* Items List */}
          <div className="space-y-2 py-1 text-[11px]">
            {returnData.items.map((item, idx) => (
              <div key={idx}>
                <div className="flex justify-between items-start">
                  <div className="w-[50%] pr-1">
                    <p className="font-bold text-foreground line-clamp-2 leading-tight">
                      {item.name}
                    </p>
                    {item.variant_info && (
                      <p className="text-[9px] text-muted-foreground">{item.variant_info}</p>
                    )}
                    {item.sku && (
                      <p className="text-[9px] text-muted-foreground">SKU: {item.sku}</p>
                    )}
                  </div>
                  <span className="w-[20%] text-center font-bold text-foreground">{item.qty}</span>
                  <span className="w-[30%] text-right font-bold text-foreground">
                    {formatPrice(item.subtotal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Refund Totals & Method */}
          <div className="border-t-2 border-dashed border-gray-900 mt-2 pt-2 space-y-1 text-[11px]">
            <div className="flex justify-between text-muted-foreground">
              <span>Total Units Restocked</span>
              <span className="font-bold text-foreground">+{totalItemsCount}</span>
            </div>
            <div className="flex justify-between text-[13px] font-black text-foreground pt-1 border-t border-dashed border-border">
              <span>{isExchangeCredit ? "TOTAL EXCHANGE CREDIT" : "TOTAL REFUNDED"}</span>
              <span className={isExchangeCredit ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {formatPrice(returnData.refund_amount)}
              </span>
            </div>
            <div className="flex justify-between text-[11px] font-bold text-primary">
              <span>Settlement Mode</span>
              <span className="uppercase">
                {isExchangeCredit ? "Exchange Credit Voucher" : returnData.refund_method}
              </span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
              <span>Reason</span>
              <span className="text-right max-w-[60%] truncate">{returnData.return_reason}</span>
            </div>
            {returnData.notes && (
              <div className="text-[9px] text-muted-foreground italic pt-0.5">
                Note: {returnData.notes}
              </div>
            )}
          </div>

          {/* Footer Note & Exchange Policy */}
          <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-[10px] text-muted-foreground space-y-1">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              ✓ Inventory Restocked
            </p>
            <p className="text-[9px] text-foreground font-medium">
              Policy: We do not offer cash refunds. Store credit voucher is valid for purchasing any
              products at Zérah Baby &amp; Kids store.
            </p>
            <p className="pt-1">Thank you for visiting Zérah Baby &amp; Kids!</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
