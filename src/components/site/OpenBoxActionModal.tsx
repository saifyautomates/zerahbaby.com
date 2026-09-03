import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useProcessOpenBoxDelivery } from "@/lib/online-returns";
import type { Order } from "@/lib/orders";
import { Package, ShieldCheck, XCircle, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

interface OpenBoxActionModalProps {
  order: Order;
  onClose: () => void;
}

const OPEN_BOX_REJECTION_REASONS = [
  "Damaged item / broken seals",
  "Incorrect item / wrong color or size inside package",
  "Missing product accessories or parts",
  "Signs of previous usage / tampering",
  "Different product than ordered",
];

export function OpenBoxActionModal({ order, onClose }: OpenBoxActionModalProps) {
  const [step, setStep] = useState<"choose" | "confirm_accept" | "reject_form">("choose");
  const [selectedReason, setSelectedReason] = useState(OPEN_BOX_REJECTION_REASONS[0]);
  const [rejectionNotes, setRejectionNotes] = useState("");

  const processOpenBox = useProcessOpenBoxDelivery();

  const handleAccept = async () => {
    try {
      await processOpenBox.mutateAsync({
        orderId: order.id,
        decision: "ACCEPTED",
      });
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to confirm acceptance");
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await processOpenBox.mutateAsync({
        orderId: order.id,
        decision: "REJECTED",
        rejectionReason: selectedReason,
        rejectionNotes: rejectionNotes.trim(),
      });
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to reject open box delivery");
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                <Package className="size-4" />
              </span>
              <h2 className="font-display text-lg sm:text-xl font-bold text-foreground">
                Open Box Delivery Verification
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={processOpenBox.isPending}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content depending on step */}
        {step === "choose" && (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-900 leading-relaxed">
              <p className="font-bold flex items-center gap-1.5 text-amber-800 mb-1">
                <ShieldCheck className="size-4 text-amber-700" />
                Inspect before delivery confirmation
              </p>
              Under Zérah's Open Box Delivery policy, you can inspect the item in front of the
              courier agent to verify condition, tags, and contents before confirming receipt.
            </div>

            <p className="text-xs font-semibold text-foreground">
              What was the outcome of your inspection?
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStep("confirm_accept")}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border border-emerald-300 bg-emerald-50/40 text-emerald-900 hover:bg-emerald-50 transition cursor-pointer text-center"
              >
                <CheckCircle2 className="size-6 text-emerald-600" />
                <span className="text-xs font-bold">Package In Good Order</span>
                <span className="text-[11px] text-emerald-700/80">Accept Delivery</span>
              </button>

              <button
                type="button"
                onClick={() => setStep("reject_form")}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border border-rose-300 bg-rose-50/40 text-rose-900 hover:bg-rose-50 transition cursor-pointer text-center"
              >
                <XCircle className="size-6 text-rose-600" />
                <span className="text-xs font-bold">Issue Detected</span>
                <span className="text-[11px] text-rose-700/80">Reject at Doorstep</span>
              </button>
            </div>
          </div>
        )}

        {step === "confirm_accept" && (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 leading-relaxed">
              <p className="font-bold mb-1">Confirm Package Acceptance</p>
              By confirming, you acknowledge that all items have been inspected, are in new and
              undamaged condition, and you have received them in full.
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep("choose")}
                disabled={processOpenBox.isPending}
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={processOpenBox.isPending}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
              >
                {processOpenBox.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Confirming…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    <span>Confirm Acceptance</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === "reject_form" && (
          <form onSubmit={handleReject} className="mt-5 space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 leading-relaxed">
              <p className="font-bold flex items-center gap-1.5 text-rose-900 mb-1">
                <AlertTriangle className="size-4" />
                Rejecting Open Box Delivery
              </p>
              The package will be handed back to the delivery agent immediately. An automated return
              and refund process will be initiated without any return shipping fee.
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Rejection Reason
              </label>
              <select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold outline-none focus:border-[#8B2020]"
              >
                {OPEN_BOX_REJECTION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Agent or Inspector Notes (optional)
              </label>
              <textarea
                rows={2}
                value={rejectionNotes}
                onChange={(e) => setRejectionNotes(e.target.value)}
                placeholder="e.g. Broken packaging, product was damaged inside."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-[#8B2020]"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStep("choose")}
                disabled={processOpenBox.isPending}
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={processOpenBox.isPending}
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer"
              >
                {processOpenBox.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Processing Rejection…</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5" />
                    <span>Confirm Rejection</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}
