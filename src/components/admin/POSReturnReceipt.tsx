/**
 * POSReturnReceipt — 80mm thermal printer optimized receipt for Offline Returns.
 *
 * Displays:
 * - Return Number & Date/Time
 * - Customer info
 * - Itemized returned products with quantities & refund prices
 * - Total refund amount & Refund Method (Cash, UPI, Card)
 * - Return Reason & Notes
 * - Inventory Restock confirmation
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer, RotateCcw } from "lucide-react";
import { formatPrice } from "@/lib/store";

export type ReturnReceiptData = {
  return_number: string;
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

export function POSReturnReceipt({ returnData, onClose, onPrint, autoPrint }: Props) {
  const date = returnData.created_at ? new Date(returnData.created_at) : new Date();

  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [autoPrint]);

  const handlePrint = () => {
    if (onPrint) onPrint();
    window.print();
  };

  const totalItemsCount = returnData.items.reduce((sum, i) => sum + (i.qty || 1), 0);

  const content = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs print:block print:bg-transparent print:p-0 print:inset-auto print:fixed-none animate-in fade-in duration-150"
      role="dialog"
      aria-label="Return Receipt"
      onClick={onClose}
    >
      {/* ── Print CSS ── */}
      <style>{`
        @media print {
          /* Hide everything except the thermal receipt */
          body > *:not(#thermal-return-receipt-portal) { display: none !important; }
          #thermal-return-receipt-portal { display: block !important; }

          @page {
            size: 80mm auto;
            margin: 3mm 4mm;
          }

          .thermal-no-print { display: none !important; }

          .thermal-body {
            width: 72mm !important;
            max-width: 72mm !important;
            font-size: 11px !important;
            line-height: 1.3 !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
          }

          .thermal-divider {
            border-top: 1px dashed #000 !important;
            margin: 4px 0 !important;
          }

          .thermal-bold { font-weight: 700 !important; }
          .thermal-total-row { font-size: 13px !important; font-weight: 900 !important; }
        }
      `}</style>

      <div
        id="thermal-return-receipt-portal"
        className="flex w-full max-w-sm flex-col rounded-2xl border border-border bg-card shadow-2xl print:rounded-none print:border-0 print:shadow-none print:max-w-none print:w-[72mm]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Screen header (hidden during print) ── */}
        <div className="thermal-no-print flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <RotateCcw className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Return Receipt</h2>
              <p className="text-xs text-muted-foreground">{returnData.return_number}</p>
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
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition shadow-xs cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </button>
          </div>
        </div>

        {/* ── Printable receipt body ── */}
        <div className="thermal-body overflow-y-auto p-5 print:p-0 print:overflow-visible font-mono text-xs text-foreground bg-card">
          {/* Store header */}
          <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
            <p className="text-sm font-black tracking-tight text-gray-900">ZÉRAH BABY &amp; KIDS</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Offline POS Returns</p>
            <p className="text-[10px] text-gray-500">Kota, Rajasthan 324001</p>
            <p className="text-[10px] text-gray-500">Ph: 9057074777</p>
            <div className="mt-2 inline-block rounded border border-gray-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-900">
              RETURN RECEIPT
            </div>
          </div>

          {/* Return details */}
          <div className="text-[11px] space-y-0.5 mb-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Return #</span>
              <span className="font-bold text-gray-900">{returnData.return_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Date</span>
              <span className="text-gray-900">
                {date.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Time</span>
              <span className="text-gray-900">
                {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>

          {/* Customer */}
          <div className="border-t border-dashed border-gray-400 pt-2 pb-2 mb-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-gray-600">Customer</span>
              <span className="font-semibold text-gray-900 text-right max-w-[55%] truncate">
                {returnData.customer_name}
              </span>
            </div>
            {returnData.customer_phone && returnData.customer_phone.trim() !== "" && (
              <div className="flex justify-between">
                <span className="text-gray-600">Mobile</span>
                <span className="text-gray-900">{returnData.customer_phone}</span>
              </div>
            )}
          </div>

          {/* Items Header */}
          <div className="border-t border-dashed border-gray-400 pt-2 pb-1">
            <div className="flex justify-between text-[10px] font-bold text-gray-700 uppercase">
              <span className="w-[50%]">Item Returned</span>
              <span className="w-[20%] text-center">Qty</span>
              <span className="w-[30%] text-right">Refund</span>
            </div>
          </div>

          {/* Items List */}
          <div className="space-y-2 py-1 text-[11px]">
            {returnData.items.map((item, idx) => (
              <div key={idx}>
                <div className="flex justify-between items-start">
                  <div className="w-[50%] pr-1">
                    <p className="font-bold text-gray-900 line-clamp-2 leading-tight">
                      {item.name}
                    </p>
                    {item.variant_info && (
                      <p className="text-[9px] text-gray-500">{item.variant_info}</p>
                    )}
                    {item.barcode && <p className="text-[9px] text-gray-400">{item.barcode}</p>}
                  </div>
                  <span className="w-[20%] text-center font-bold text-gray-900">{item.qty}</span>
                  <span className="w-[30%] text-right font-bold text-gray-900">
                    {formatPrice(item.subtotal)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Refund Totals & Method */}
          <div className="border-t-2 border-dashed border-gray-900 mt-2 pt-2 space-y-1 text-[11px]">
            <div className="flex justify-between text-gray-600">
              <span>Total Units Restocked</span>
              <span className="font-bold text-gray-900">+{totalItemsCount}</span>
            </div>
            <div className="flex justify-between text-[13px] font-black text-gray-900 pt-1 border-t border-dashed border-gray-300">
              <span>TOTAL REFUNDED</span>
              <span>{formatPrice(returnData.refund_amount)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-bold text-blue-700">
              <span>Refund Method</span>
              <span className="uppercase">{returnData.refund_method}</span>
            </div>
            <div className="flex justify-between text-[10px] text-gray-600 pt-0.5">
              <span>Reason</span>
              <span className="text-right max-w-[60%] truncate">{returnData.return_reason}</span>
            </div>
            {returnData.notes && (
              <div className="text-[9px] text-gray-500 italic pt-0.5">Note: {returnData.notes}</div>
            )}
          </div>

          {/* Footer Note */}
          <div className="border-t border-dashed border-gray-400 mt-3 pt-2 text-center text-[10px] text-gray-600">
            <p className="font-semibold text-emerald-800">✓ Inventory Restocked</p>
            <p className="mt-1">Thank you for visiting Zérah Baby &amp; Kids!</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
