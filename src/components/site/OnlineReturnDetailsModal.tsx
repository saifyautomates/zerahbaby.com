import { createPortal } from "react-dom";
import {
  type OnlineReturn,
  RETURN_STATUS_BADGES,
  REFUND_STATUS_BADGES,
} from "@/lib/online-returns";
import { formatPrice } from "@/lib/store";
import { RotateCcw, PackageCheck, Truck, ShieldCheck, Clock, CheckCircle2, AlertCircle } from "lucide-react";

interface OnlineReturnDetailsModalProps {
  onlineReturn: OnlineReturn;
  onClose: () => void;
}

export function OnlineReturnDetailsModal({
  onlineReturn,
  onClose,
}: OnlineReturnDetailsModalProps) {
  const returnBadge = RETURN_STATUS_BADGES[onlineReturn.return_status] || {
    label: onlineReturn.return_status,
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  };

  const refundBadge = REFUND_STATUS_BADGES[onlineReturn.refund_status] || {
    label: onlineReturn.refund_status,
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4 shrink-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-[#8B2020]/10 text-[#8B2020]">
                <RotateCcw className="size-4" />
              </span>
              <h2 className="font-display text-xl font-bold text-foreground">
                Return #{onlineReturn.return_number}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted on {new Date(onlineReturn.created_at).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="mt-5 space-y-6 overflow-y-auto pr-1 flex-1">
          {/* Status Chips */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border ${returnBadge.bg} ${returnBadge.text} ${returnBadge.border}`}
            >
              {returnBadge.label}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border ${refundBadge.bg} ${refundBadge.text} ${refundBadge.border}`}
            >
              {refundBadge.label}
            </span>
          </div>

          {/* Key Details Card */}
          <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-2.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Reason:</span>
              <span className="font-semibold text-foreground text-right">{onlineReturn.reason_label}</span>
            </div>
            {onlineReturn.customer_note && (
              <div className="flex justify-between items-start pt-1 border-t border-border/50">
                <span className="text-muted-foreground shrink-0">Customer Note:</span>
                <span className="font-medium text-foreground text-right max-w-xs">{onlineReturn.customer_note}</span>
              </div>
            )}
            {onlineReturn.shiprocket_return_awb && (
              <div className="flex justify-between items-center pt-1 border-t border-border/50">
                <span className="text-muted-foreground">Reverse Pickup AWB:</span>
                <span className="font-mono font-bold text-indigo-700">{onlineReturn.shiprocket_return_awb}</span>
              </div>
            )}
            {onlineReturn.qc_summary && (
              <div className="flex justify-between items-start pt-1 border-t border-border/50">
                <span className="text-muted-foreground shrink-0">QC Summary:</span>
                <span className="font-semibold text-emerald-800 text-right">{onlineReturn.qc_summary}</span>
              </div>
            )}
          </div>

          {/* Returned Items List */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">
              Returned Items ({(onlineReturn.online_return_items ?? []).length})
            </h3>
            <div className="space-y-2.5">
              {(onlineReturn.online_return_items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/70 bg-card"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.image_snapshot ? (
                      <img
                        src={item.image_snapshot}
                        alt={item.product_name_snapshot}
                        className="size-11 rounded-xl border border-border object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-11 rounded-xl border border-border bg-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{item.product_name_snapshot}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.color_snapshot ? `${item.color_snapshot} · ` : ""}
                        {item.size_snapshot ? `Size: ${item.size_snapshot} · ` : ""}
                        Qty: {item.quantity_requested}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-foreground">
                      {formatPrice(Number(item.item_refund_amount))}
                    </p>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                        item.qc_status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-800"
                          : item.qc_status === "REJECTED"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      QC: {item.qc_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Refund Breakdown */}
          <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Items Value:</span>
              <span className="font-semibold text-foreground">
                {formatPrice(onlineReturn.eligible_refund_amount)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Return Shipping Fee:</span>
              <span className="font-semibold text-foreground">
                {onlineReturn.return_shipping_fee > 0
                  ? `- ${formatPrice(onlineReturn.return_shipping_fee)}`
                  : "FREE"}
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
              <span>Final Refund:</span>
              <span className="text-[#8B2020] font-extrabold text-base">
                {formatPrice(onlineReturn.final_refund_amount)}
              </span>
            </div>
          </div>

          {/* Event Timeline */}
          {(onlineReturn.online_return_events ?? []).length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">
                Timeline & Activity
              </h3>
              <ol className="relative border-l-2 border-border ml-3 space-y-3.5 pl-4">
                {(onlineReturn.online_return_events ?? []).map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[1.35rem] top-1 size-2.5 rounded-full bg-[#8B2020]" />
                    <p className="text-xs font-bold text-foreground">
                      {event.new_status ? event.new_status.replace(/_/g, " ") : event.event_type.replace(/_/g, " ")}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {event.note}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {new Date(event.created_at).toLocaleString("en-IN")}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 border-t border-border pt-4 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-primary px-6 py-2.5 text-xs sm:text-sm font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}
