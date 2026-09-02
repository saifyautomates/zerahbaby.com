import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ONLINE_RETURN_REASONS,
  useCalculateOnlineReturnRefund,
  useRequestOnlineReturn,
  type ReturnReasonOption,
} from "@/lib/online-returns";
import type { Order, OrderItem } from "@/lib/orders";
import { formatPrice } from "@/lib/store";
import { RotateCcw, AlertCircle, CheckCircle2, ShieldCheck, Truck, Loader2 } from "lucide-react";

interface OnlineReturnModalProps {
  order: Order;
  onClose: () => void;
}

export function OnlineReturnModal({ order, onClose }: OnlineReturnModalProps) {
  // Map of selected items: order_item_id -> qty to return
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    if (order.order_items.length > 0) {
      initial[order.order_items[0].id] = order.order_items[0].qty;
    }
    return initial;
  });

  const [selectedReason, setSelectedReason] = useState<ReturnReasonOption>(ONLINE_RETURN_REASONS[0]);
  const [customerNote, setCustomerNote] = useState("");

  const calculateRefund = useCalculateOnlineReturnRefund();
  const requestReturn = useRequestOnlineReturn();

  // Prepare items payload
  const itemsPayload = Object.entries(selectedItems)
    .filter(([_, qty]) => qty > 0)
    .map(([order_item_id, qty]) => ({ order_item_id, qty }));

  // Automatically recalculate refund preview whenever items or reason change
  useEffect(() => {
    if (itemsPayload.length > 0) {
      calculateRefund.mutate({
        orderId: order.id,
        items: itemsPayload,
        reasonCategory: selectedReason.category,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(itemsPayload), selectedReason.category]);

  const toggleItem = (item: OrderItem) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = item.qty;
      }
      return next;
    });
  };

  const updateItemQty = (item: OrderItem, qty: number) => {
    setSelectedItems((prev) => ({
      ...prev,
      [item.id]: Math.min(Math.max(1, qty), item.qty),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (itemsPayload.length === 0) {
      toast.error("Please select at least one item to return.");
      return;
    }

    try {
      await requestReturn.mutateAsync({
        orderId: order.id,
        items: itemsPayload,
        reasonCategory: selectedReason.category,
        reasonLabel: selectedReason.label,
        customerNote: customerNote.trim(),
      });

      toast.success("Return request submitted successfully!");
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to submit return request";
      toast.error(msg);
    }
  };

  const calcData = calculateRefund.data;
  const isEligible = calcData?.is_eligible !== false;
  const isFreeReturn = selectedReason.sellerFault;

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
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-[#8B2020]/10 text-[#8B2020]">
                <RotateCcw className="size-4" />
              </span>
              <h2 className="font-display text-xl font-bold text-foreground">
                Request Return — #{order.id.slice(0, 8).toUpperCase()}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Select items, select your reason, and inspect your calculated refund.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={requestReturn.isPending}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-6 overflow-y-auto pr-1 flex-1">
          {/* Item Selection Section */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-foreground mb-2.5">
              1. Select items to return
            </label>
            <div className="space-y-2.5">
              {order.order_items.map((item) => {
                const isSelected = Boolean(selectedItems[item.id]);
                const selectedQty = selectedItems[item.id] || 1;

                return (
                  <div
                    key={item.id}
                    onClick={() => toggleItem(item)}
                    className={`flex items-center justify-between gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? "border-[#8B2020] bg-red-50/20 shadow-2xs"
                        : "border-border bg-muted/10 opacity-75 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(item)}
                        className="size-4.5 rounded border-border text-[#8B2020] focus:ring-[#8B2020]/30 cursor-pointer"
                      />
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="size-12 rounded-xl border border-border object-cover shrink-0"
                        />
                      ) : (
                        <div className="size-12 rounded-xl border border-border bg-muted shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{item.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.color ? `${item.color} · ` : ""}
                          {item.size ? `Size: ${item.size} · ` : ""}
                          {formatPrice(Number(item.price))} each
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {isSelected && item.qty > 1 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground font-medium">Qty:</span>
                          <select
                            value={selectedQty}
                            onChange={(e) => updateItemQty(item, Number(e.target.value))}
                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-bold outline-none"
                          >
                            {Array.from({ length: item.qty }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <span className="text-xs font-bold text-foreground">
                        {formatPrice(Number(item.price) * (isSelected ? selectedQty : 1))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Return Reason Section */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-foreground mb-2.5">
              2. Reason for return
            </label>
            <select
              value={selectedReason.category}
              onChange={(e) => {
                const found = ONLINE_RETURN_REASONS.find((r) => r.category === e.target.value);
                if (found) setSelectedReason(found);
              }}
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-xs sm:text-sm font-semibold outline-none focus:border-[#8B2020] focus:ring-1 focus:ring-[#8B2020]/30"
            >
              {ONLINE_RETURN_REASONS.map((r) => (
                <option key={r.category} value={r.category}>
                  {r.label} {r.sellerFault ? "(Free Return)" : ""}
                </option>
              ))}
            </select>

            <div className="mt-2 flex items-center gap-2 text-xs">
              {isFreeReturn ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <ShieldCheck className="size-4" /> Free return — logistics fee waived for defective/wrong item
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Truck className="size-4" /> Standard reverse logistics fee (₹70) deducted from refund
                </span>
              )}
            </div>
          </div>

          {/* Customer Note */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">
              3. Additional details or comments (optional)
            </label>
            <textarea
              rows={2}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="e.g. The fabric was torn at the collar, or size runs smaller than standard measurements."
              className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-xs sm:text-sm outline-none focus:border-[#8B2020]"
            />
          </div>

          {/* Ineligible Warning if Window Expired */}
          {!isEligible && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
              <AlertCircle className="size-5 shrink-0" />
              <p className="font-semibold">{calcData?.ineligible_reason || "This order is not eligible for return."}</p>
            </div>
          )}

          {/* Refund Calculation Summary Box */}
          <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Items eligible refund:</span>
              <span className="font-semibold text-foreground">
                {formatPrice(calcData?.eligible_refund_amount || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Return shipping fee:</span>
              <span className="font-semibold text-foreground">
                {isFreeReturn ? (
                  <span className="text-emerald-700 font-bold">FREE</span>
                ) : (
                  `- ${formatPrice(calcData?.return_shipping_fee || 70)}`
                )}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-extrabold text-foreground">
              <span>Net Refund:</span>
              <span className="text-base text-[#8B2020]">
                {formatPrice(calcData?.final_refund_amount || 0)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground pt-1">
              {order.payment_method.toLowerCase() === "cod"
                ? "For COD orders, refund will be sent via direct UPI/NEFT transfer upon QC approval."
                : "Refund will be automatically credited to your original payment card/bank within 5-7 working days after quality check."}
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={requestReturn.isPending}
              className="rounded-full border border-border bg-background px-5 py-2.5 text-xs sm:text-sm font-semibold text-foreground transition hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={requestReturn.isPending || itemsPayload.length === 0 || !isEligible}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#8B2020] px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-md transition hover:bg-[#721a1a] disabled:opacity-50 cursor-pointer"
            >
              {requestReturn.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Submitting Request…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Submit Return Request</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}
