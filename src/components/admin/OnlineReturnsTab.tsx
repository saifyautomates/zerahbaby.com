import { useState, useMemo } from "react";
import {
  useAllOnlineReturns,
  useAdminUpdateReturnStatus,
  useAdminProcessReturnQC,
  useAdminProcessOnlineRefund,
  useCreateShiprocketReturnPickup,
  RETURN_STATUS_BADGES,
  REFUND_STATUS_BADGES,
  type OnlineReturn,
  type OnlineReturnStatus,
} from "@/lib/online-returns";
import { formatPrice } from "@/lib/store";
import {
  RotateCcw,
  Search,
  CheckCircle2,
  XCircle,
  Truck,
  ShieldCheck,
  Package,
  AlertCircle,
  Eye,
  CreditCard,
  Building2,
  RefreshCw,
  Loader2,
  Check,
  ChevronRight,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { AdminTableSkeleton } from "@/components/ui/Skeletons";

export function OnlineReturnsTab() {
  const { data: returns = [], isLoading, refetch } = useAllOnlineReturns(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedReturn, setSelectedReturn] = useState<OnlineReturn | null>(null);

  // Mutations
  const updateStatus = useAdminUpdateReturnStatus();
  const processQC = useAdminProcessReturnQC();
  const processRefund = useAdminProcessOnlineRefund();
  const createReversePickup = useCreateShiprocketReturnPickup();

  // Metrics
  const metrics = useMemo(() => {
    const total = returns.length;
    const requested = returns.filter((r) => r.return_status === "REQUESTED").length;
    const qcPending = returns.filter(
      (r) => r.return_status === "RECEIVED" || r.return_status === "QC_PENDING"
    ).length;
    const refundPending = returns.filter(
      (r) => r.return_status === "QC_APPROVED" && r.refund_status === "PENDING"
    ).length;
    const totalRefunded = returns
      .filter((r) => r.refund_status === "PROCESSED")
      .reduce((sum, r) => sum + Number(r.final_refund_amount || 0), 0);

    return { total, requested, qcPending, refundPending, totalRefunded };
  }, [returns]);

  // Filtered List
  const filteredReturns = useMemo(() => {
    return returns.filter((r) => {
      // Status filter
      if (statusFilter !== "ALL") {
        if (statusFilter === "PENDING_ACTION") {
          if (r.return_status !== "REQUESTED" && r.return_status !== "QC_PENDING") return false;
        } else if (statusFilter === "REFUND_PENDING") {
          if (r.refund_status !== "PENDING" && r.refund_status !== "MANUAL_REVIEW") return false;
        } else if (r.return_status !== statusFilter) {
          return false;
        }
      }

      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const returnNum = (r.return_number || "").toLowerCase();
        const orderNum = (r.orders?.order_number || r.orders?.invoice_no || r.order_id || "").toLowerCase();
        const customer = (r.orders?.full_name || "").toLowerCase();
        const phone = (r.orders?.phone || "").toLowerCase();
        const awb = (r.shiprocket_return_awb || "").toLowerCase();

        return (
          returnNum.includes(q) ||
          orderNum.includes(q) ||
          customer.includes(q) ||
          phone.includes(q) ||
          awb.includes(q)
        );
      }

      return true;
    });
  }, [returns, statusFilter, search]);

  if (isLoading) {
    return <AdminTableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Top Metrics Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Total Return Requests
          </p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{metrics.total}</p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-2xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
            Awaiting Approval
          </p>
          <p className="mt-1 text-2xl font-extrabold text-amber-900">{metrics.requested}</p>
        </div>

        <div className="rounded-2xl border border-orange-200 bg-orange-50/50 p-4 shadow-2xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-orange-900">
            QC Inspection Queue
          </p>
          <p className="mt-1 text-2xl font-extrabold text-orange-900">{metrics.qcPending}</p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-2xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
            Total Refunded
          </p>
          <p className="mt-1 text-2xl font-extrabold text-emerald-900">
            {formatPrice(metrics.totalRefunded)}
          </p>
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search return #, order #, customer, phone, AWB..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-full border border-border bg-background pl-10 pr-4 py-2 text-xs sm:text-sm outline-none focus:border-[#8B2020] focus:ring-1 focus:ring-[#8B2020]/30"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              statusFilter === "ALL"
                ? "bg-[#8B2020] text-white shadow-2xs"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            All Returns ({metrics.total})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("PENDING_ACTION")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              statusFilter === "PENDING_ACTION"
                ? "bg-amber-600 text-white shadow-2xs"
                : "border border-amber-200 bg-amber-50/50 text-amber-900 hover:bg-amber-100"
            }`}
          >
            Needs Action ({metrics.requested + metrics.qcPending})
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("REFUND_PENDING")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition whitespace-nowrap cursor-pointer ${
              statusFilter === "REFUND_PENDING"
                ? "bg-blue-600 text-white shadow-2xs"
                : "border border-blue-200 bg-blue-50/50 text-blue-900 hover:bg-blue-100"
            }`}
          >
            Refund Pending ({metrics.refundPending})
          </button>

          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-full border border-border bg-card p-2 text-muted-foreground hover:bg-muted cursor-pointer shrink-0"
            title="Refresh returns"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Main Returns Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase font-bold text-[11px] tracking-wider">
                <th className="py-3.5 px-4">Return Number</th>
                <th className="py-3.5 px-4">Customer &amp; Order</th>
                <th className="py-3.5 px-4">Reason</th>
                <th className="py-3.5 px-4 text-center">Items</th>
                <th className="py-3.5 px-4 text-right">Refund Amount</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-center">Refund</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    No return records found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredReturns.map((ret) => {
                  const rBadge = RETURN_STATUS_BADGES[ret.return_status] || {
                    label: ret.return_status,
                    bg: "bg-muted",
                    text: "text-muted-foreground",
                    border: "border-border",
                  };
                  const rfBadge = REFUND_STATUS_BADGES[ret.refund_status] || {
                    label: ret.refund_status,
                    bg: "bg-muted",
                    text: "text-muted-foreground",
                    border: "border-border",
                  };

                  return (
                    <tr
                      key={ret.id}
                      onClick={() => setSelectedReturn(ret)}
                      className="hover:bg-muted/20 transition-colors cursor-pointer"
                    >
                      {/* Return Number & Date */}
                      <td className="py-3.5 px-4 font-mono font-bold text-foreground">
                        #{ret.return_number}
                        <div className="text-[10px] font-normal text-muted-foreground">
                          {new Date(ret.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>

                      {/* Customer & Order Reference */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-foreground">
                          {ret.orders?.full_name || "Customer"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {ret.orders?.phone} · Order #{ret.orders?.invoice_no || ret.order_id.slice(0, 8).toUpperCase()}
                        </div>
                      </td>

                      {/* Reason */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <span className="font-semibold text-foreground line-clamp-1">
                          {ret.reason_label}
                        </span>
                        {ret.customer_note && (
                          <span className="text-[11px] text-muted-foreground line-clamp-1">
                            “{ret.customer_note}”
                          </span>
                        )}
                      </td>

                      {/* Items Count */}
                      <td className="py-3.5 px-4 text-center font-semibold">
                        {(ret.online_return_items ?? []).reduce(
                          (sum, i) => sum + (i.quantity_requested || 1),
                          0
                        )}
                      </td>

                      {/* Refund Amount */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-bold text-foreground">
                          {formatPrice(Number(ret.final_refund_amount))}
                        </div>
                        {ret.return_shipping_fee > 0 ? (
                          <div className="text-[10px] text-muted-foreground">
                            -₹{ret.return_shipping_fee} fee
                          </div>
                        ) : (
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            Free Return
                          </div>
                        )}
                      </td>

                      {/* Return Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${rBadge.bg} ${rBadge.text} ${rBadge.border}`}
                        >
                          {rBadge.label}
                        </span>
                      </td>

                      {/* Refund Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${rfBadge.bg} ${rfBadge.text} ${rfBadge.border}`}
                        >
                          {rfBadge.label}
                        </span>
                      </td>

                      {/* Action Button */}
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setSelectedReturn(ret)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
                        >
                          <span>Manage</span>
                          <ChevronRight className="size-3.5 text-muted-foreground" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Admin Return Drawer & QC Controller */}
      {selectedReturn && (
        <AdminReturnDetailsDrawer
          onlineReturn={selectedReturn}
          onClose={() => setSelectedReturn(null)}
          onUpdateStatus={updateStatus}
          onProcessQC={processQC}
          onProcessRefund={processRefund}
          onCreateReversePickup={createReversePickup}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Return Details & QC Controller Drawer                        */
/* ------------------------------------------------------------------ */

interface AdminReturnDetailsDrawerProps {
  onlineReturn: OnlineReturn;
  onClose: () => void;
  onUpdateStatus: ReturnType<typeof useAdminUpdateReturnStatus>;
  onProcessQC: ReturnType<typeof useAdminProcessReturnQC>;
  onProcessRefund: ReturnType<typeof useAdminProcessOnlineRefund>;
  onCreateReversePickup: ReturnType<typeof useCreateShiprocketReturnPickup>;
}

function AdminReturnDetailsDrawer({
  onlineReturn,
  onClose,
  onUpdateStatus,
  onProcessQC,
  onProcessRefund,
  onCreateReversePickup,
}: AdminReturnDetailsDrawerProps) {
  // QC state per item: order_item_id -> { passed: boolean, qty: number, note: string }
  const [qcState, setQcState] = useState<
    Record<string, { passed: boolean; qty: number; note: string }>
  >(() => {
    const initial: Record<string, { passed: boolean; qty: number; note: string }> = {};
    (onlineReturn.online_return_items ?? []).forEach((item) => {
      initial[item.order_item_id] = {
        passed: item.qc_status !== "REJECTED",
        qty: item.quantity_requested,
        note: item.qc_note || "",
      };
    });
    return initial;
  });

  const [qcSummary, setQcSummary] = useState(onlineReturn.qc_summary || "");
  const [restockApproved, setRestockApproved] = useState(true);
  const [refundNotes, setRefundNotes] = useState("");
  const [showQcForm, setShowQcForm] = useState(false);

  const isRefundable =
    onlineReturn.return_status === "QC_APPROVED" &&
    onlineReturn.refund_status !== "PROCESSED" &&
    Number(onlineReturn.final_refund_amount) > 0;

  const isCodOrder =
    (onlineReturn.orders?.payment_method || "").toLowerCase() === "cod";

  const handleApprove = async () => {
    try {
      await onUpdateStatus.mutateAsync({
        returnId: onlineReturn.id,
        newStatus: "APPROVED",
        adminNote: "Return approved by store administrator",
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to approve return");
    }
  };

  const handleMarkReceived = async () => {
    try {
      await onUpdateStatus.mutateAsync({
        returnId: onlineReturn.id,
        newStatus: "RECEIVED",
        adminNote: "Items received at store/warehouse facility",
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to mark return as received");
    }
  };

  const handleScheduleReversePickup = async () => {
    try {
      await onCreateReversePickup.mutateAsync(onlineReturn.id);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to schedule reverse pickup");
    }
  };

  const handleExecuteQC = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemsQcPayload = Object.entries(qcState).map(([order_item_id, val]) => ({
      order_item_id,
      passed: val.passed,
      qty_accepted: val.passed ? val.qty : 0,
      qc_note: val.note,
    }));

    try {
      await onProcessQC.mutateAsync({
        returnId: onlineReturn.id,
        itemsQc: itemsQcPayload,
        qcSummary,
        restockApproved,
      });
      setShowQcForm(false);
    } catch (err: unknown) {
      toast.error((err as Error).message || "QC inspection failed");
    }
  };

  const handleExecuteRefund = async () => {
    try {
      await onProcessRefund.mutateAsync({
        returnId: onlineReturn.id,
        notes: refundNotes.trim() || undefined,
      });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Refund execution failed");
    }
  };

  const rBadge = RETURN_STATUS_BADGES[onlineReturn.return_status];
  const rfBadge = REFUND_STATUS_BADGES[onlineReturn.refund_status];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in"
    >
      <div className="w-full max-w-2xl bg-card border-l border-border h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-start justify-between gap-4 bg-muted/20 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-[#8B2020]/10 text-[#8B2020]">
                <RotateCcw className="size-4" />
              </span>
              <h2 className="font-display text-lg sm:text-xl font-bold text-foreground">
                Return #{onlineReturn.return_number}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Order #{onlineReturn.orders?.invoice_no || onlineReturn.order_id.slice(0, 8).toUpperCase()} ·{" "}
              {new Date(onlineReturn.created_at).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Status Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border ${rBadge.bg} ${rBadge.text} ${rBadge.border}`}
            >
              {rBadge.label}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border ${rfBadge.bg} ${rfBadge.text} ${rfBadge.border}`}
            >
              {rfBadge.label}
            </span>
          </div>

          {/* Quick Action Bar for Admin Transitions */}
          <div className="flex flex-wrap items-center gap-2 p-3.5 rounded-2xl border border-border bg-muted/30">
            {onlineReturn.return_status === "REQUESTED" && (
              <button
                type="button"
                onClick={handleApprove}
                disabled={onUpdateStatus.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-blue-700 transition cursor-pointer"
              >
                <Check className="size-3.5" /> Approve Return
              </button>
            )}

            {(onlineReturn.return_status === "APPROVED" || onlineReturn.return_status === "REQUESTED") &&
              !onlineReturn.shiprocket_return_awb && (
                <button
                  type="button"
                  onClick={handleScheduleReversePickup}
                  disabled={onCreateReversePickup.isPending}
                  className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 transition cursor-pointer"
                >
                  {onCreateReversePickup.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Truck className="size-3.5" />
                  )}
                  Schedule Reverse Pickup
                </button>
              )}

            {(onlineReturn.return_status === "APPROVED" ||
              onlineReturn.return_status === "PICKUP_SCHEDULED" ||
              onlineReturn.return_status === "IN_TRANSIT") && (
              <button
                type="button"
                onClick={handleMarkReceived}
                disabled={onUpdateStatus.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-teal-700 transition cursor-pointer"
              >
                <Package className="size-3.5" /> Mark Received at Store
              </button>
            )}

            {(onlineReturn.return_status === "RECEIVED" ||
              onlineReturn.return_status === "QC_PENDING") && (
              <button
                type="button"
                onClick={() => setShowQcForm(!showQcForm)}
                className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-orange-700 transition cursor-pointer"
              >
                <ShieldCheck className="size-3.5" />
                {showQcForm ? "Hide QC Form" : "Inspect & Process QC"}
              </button>
            )}

            {isRefundable && (
              <button
                type="button"
                onClick={handleExecuteRefund}
                disabled={onProcessRefund.isPending}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 transition cursor-pointer"
              >
                {onProcessRefund.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CreditCard className="size-3.5" />
                )}
                {isCodOrder ? "Record Manual Bank Refund" : "Execute Razorpay Refund"}
              </button>
            )}
          </div>

          {/* Interactive QC Form (When Active) */}
          {showQcForm && (
            <form
              onSubmit={handleExecuteQC}
              className="p-4 rounded-2xl border-2 border-orange-300 bg-orange-50/40 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-orange-200 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-950 flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-orange-700" />
                  Quality Inspection Assessment
                </h3>
              </div>

              <div className="space-y-3">
                {(onlineReturn.online_return_items ?? []).map((item) => {
                  const itemQc = qcState[item.order_item_id] || {
                    passed: true,
                    qty: item.quantity_requested,
                    note: "",
                  };

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl border border-orange-200 bg-card space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-foreground">{item.product_name_snapshot}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {item.sku_snapshot} · Qty to verify: {item.quantity_requested}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setQcState((prev) => ({
                                ...prev,
                                [item.order_item_id]: { ...prev[item.order_item_id], passed: true },
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              itemQc.passed
                                ? "bg-emerald-600 text-white"
                                : "border border-border bg-background text-muted-foreground"
                            }`}
                          >
                            Pass
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setQcState((prev) => ({
                                ...prev,
                                [item.order_item_id]: { ...prev[item.order_item_id], passed: false },
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              !itemQc.passed
                                ? "bg-rose-600 text-white"
                                : "border border-border bg-background text-muted-foreground"
                            }`}
                          >
                            Reject
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        placeholder="Inspection note (e.g. Tags intact, unworn)"
                        value={itemQc.note}
                        onChange={(e) =>
                          setQcState((prev) => ({
                            ...prev,
                            [item.order_item_id]: {
                              ...prev[item.order_item_id],
                              note: e.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none"
                      />
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-xs font-bold text-orange-950 mb-1">
                  Overall QC Summary &amp; Remarks
                </label>
                <input
                  type="text"
                  placeholder="e.g. Inspection verified, approved for restock and refund."
                  value={qcSummary}
                  onChange={(e) => setQcSummary(e.target.value)}
                  className="w-full rounded-xl border border-orange-200 bg-background px-3 py-2 text-xs outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="restock-checkbox"
                  checked={restockApproved}
                  onChange={(e) => setRestockApproved(e.target.checked)}
                  className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020]"
                />
                <label htmlFor="restock-checkbox" className="text-xs font-semibold text-foreground cursor-pointer">
                  Atomically restock approved items to inventory ledger
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQcForm(false)}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={onProcessQC.isPending}
                  className="inline-flex items-center gap-1.5 rounded-full bg-orange-600 px-5 py-1.5 text-xs font-bold text-white hover:bg-orange-700 cursor-pointer"
                >
                  {onProcessQC.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  Submit Inspection Results
                </button>
              </div>
            </form>
          )}

          {/* Customer & Shipping Summary Card */}
          <div className="rounded-2xl border border-border bg-muted/20 p-4 space-y-2.5 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-foreground mb-2">
              Customer &amp; Logistics Details
            </h3>
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <div>
                <p className="text-[11px]">Customer:</p>
                <p className="font-semibold text-foreground">{onlineReturn.orders?.full_name}</p>
              </div>
              <div>
                <p className="text-[11px]">Contact:</p>
                <p className="font-semibold text-foreground">{onlineReturn.orders?.phone}</p>
              </div>
              <div>
                <p className="text-[11px]">Return Reason:</p>
                <p className="font-semibold text-foreground">{onlineReturn.reason_label}</p>
              </div>
              <div>
                <p className="text-[11px]">Reverse AWB:</p>
                <p className="font-mono font-bold text-indigo-700">
                  {onlineReturn.shiprocket_return_awb || "Pending reverse shipment"}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-border/50 text-muted-foreground">
              <p className="text-[11px]">Pickup Address:</p>
              <p className="font-medium text-foreground">
                {onlineReturn.orders?.address}, {onlineReturn.orders?.city}, {onlineReturn.orders?.state} - {onlineReturn.orders?.pincode}
              </p>
            </div>
          </div>

          {/* Itemized Returned Line Items */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">
              Return Line Items ({(onlineReturn.online_return_items ?? []).length})
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
                        className="size-12 rounded-xl border border-border object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-12 rounded-xl border border-border bg-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{item.product_name_snapshot}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.sku_snapshot ? `SKU: ${item.sku_snapshot} · ` : ""}
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
                    {item.inventory_restored && (
                      <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                        ✓ Restocked
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Refund Breakdown Card */}
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
            {onlineReturn.razorpay_refund_id && (
              <div className="flex justify-between border-t border-border/50 pt-2 text-xs text-muted-foreground">
                <span>Gateway Refund ID:</span>
                <span className="font-mono font-bold text-foreground">
                  {onlineReturn.razorpay_refund_id}
                </span>
              </div>
            )}
          </div>

          {/* Audit Timeline */}
          {(onlineReturn.online_return_events ?? []).length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">
                Authoritative Audit Trail
              </h3>
              <ol className="relative border-l-2 border-border ml-3 space-y-3.5 pl-4">
                {(onlineReturn.online_return_events ?? []).map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[1.35rem] top-1 size-2.5 rounded-full bg-[#8B2020]" />
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-foreground">
                        {event.new_status ? event.new_status.replace(/_/g, " ") : event.event_type.replace(/_/g, " ")}
                      </p>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                        {event.actor_role}
                      </span>
                    </div>
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
        <div className="p-4 border-t border-border flex justify-end bg-muted/20 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-primary px-6 py-2 text-xs sm:text-sm font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
