import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  DollarSign,
  CheckCircle2,
  Edit3,
  Trash2,
  X,
  Search,
  Check,
  AlertTriangle,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { CANONICAL_POS_SALES_KEY, invalidateCanonicalReportingQueries } from "@/lib/canonical-reporting";
import { safeLower } from "@/lib/utils";

export interface CashDueItem {
  id: string;
  source: "Online COD" | "Offline POS Due";
  date: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string;
  rawOrder?: any;
  rawSale?: any;
}

interface CashOutstandingDrillDownViewProps {
  orders: any[];
  posSales: any[];
  dateRangeText?: string;
}

export function CashOutstandingDrillDownView({
  orders,
  posSales,
  dateRangeText,
}: CashOutstandingDrillDownViewProps) {
  const qc = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSource, setFilterSource] = useState<"all" | "online" | "offline">("all");
  const [isUpdating, setIsUpdating] = useState(false);

  // Modal State for Editing Due
  const [editingItem, setEditingItem] = useState<CashDueItem | null>(null);
  const [editNewPaid, setEditNewPaid] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");

  // Modal State for Delete / Write-off
  const [deletingItem, setDeletingItem] = useState<CashDueItem | null>(null);
  const [deleteMode, setDeleteMode] = useState<"writeoff" | "void">("writeoff");

  // 1. Filter authoritative pending COD orders
  const pendingCodOrders: CashDueItem[] = useMemo(() => {
    return orders
      .filter((order) => {
        const paymentStatus = String(order.payment_status || "").toLowerCase().trim();
        const paymentMethod = String(order.payment_method || "").toLowerCase().trim();
        const orderStatus = String(order.status || "").toLowerCase().trim();
        const isCancelled = ["cancelled", "refunded", "failed"].includes(orderStatus);
        const isPaid = ["paid", "completed"].includes(paymentStatus);
        if (isCancelled || isPaid) return false;
        const isCod =
          paymentMethod.includes("cod") ||
          paymentMethod.includes("cash on delivery") ||
          paymentMethod === "cash_on_delivery";
        const isPendingPayment = ["pending", "partial", "partially_paid", "unpaid", "due"].includes(
          paymentStatus,
        );
        return isCod || isPendingPayment;
      })
      .map((o) => {
        const total = Number(o.total || 0);
        return {
          id: o.id,
          source: "Online COD" as const,
          date: o.created_at,
          orderNumber:
            o.order_number ||
            (o.invoice_no ? `#${o.invoice_no}` : `#${(o.id || "").substring(0, 8).toUpperCase()}`),
          customerName: o.full_name || o.email || "Online Customer",
          customerPhone: o.phone || "",
          total,
          amountPaid: 0,
          balanceDue: total,
          notes: o.notes || "",
          rawOrder: o,
        };
      });
  }, [orders]);

  // 2. Filter authoritative pending POS due sales
  const pendingPosDues: CashDueItem[] = useMemo(() => {
    return posSales
      .filter((sale) => {
        const paymentStatus = String(sale.payment_status || "").toLowerCase().trim();
        const paymentMethod = String(sale.payment_method || "").toLowerCase().trim();
        const returnStatus = String(sale.return_status || "").toLowerCase().trim();
        const saleStatus = String(sale.status || "").toLowerCase().trim();
        if (
          sale.is_voided ||
          ["cancelled", "voided", "failed", "sync_failed"].includes(saleStatus)
        ) {
          return false;
        }
        if (["returned", "fully_returned"].includes(returnStatus)) return false;
        const due =
          Number(sale.total || 0) -
          Number(sale.returned_amount || 0) -
          Number(sale.amount_paid || 0) -
          Number(sale.store_credit_used || 0);
        const isDueStatus = ["pending", "unpaid", "partial", "partially_paid", "due"].includes(
          paymentStatus,
        );
        const isDueMethod = paymentMethod === "due" || paymentMethod === "credit";
        return due > 0 && (isDueStatus || isDueMethod);
      })
      .map((sale) => {
        const total = Number(sale.total || 0);
        const returnedAmount = Number(sale.returned_amount || 0);
        const amountPaid = Number(sale.amount_paid || 0);
        const creditUsed = Number(sale.store_credit_used || 0);
        const due = Math.max(0, total - returnedAmount - amountPaid - creditUsed);
        return {
          id: sale.id,
          source: "Offline POS Due" as const,
          date: sale.created_at,
          orderNumber: sale.sale_number || `#${sale.id.substring(0, 8).toUpperCase()}`,
          customerName: sale.customer_name || "Walk-in Customer",
          customerPhone: sale.customer_phone || "",
          total,
          amountPaid,
          balanceDue: due,
          notes: sale.notes || "",
          rawSale: sale,
        };
      });
  }, [posSales]);

  // Combined and filtered list
  const combinedDues = useMemo(() => {
    let list: CashDueItem[] = [];
    if (filterSource === "online") list = pendingCodOrders;
    else if (filterSource === "offline") list = pendingPosDues;
    else list = [...pendingCodOrders, ...pendingPosDues];

    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (searchTerm.trim()) {
      const q = safeLower(searchTerm);
      list = list.filter(
        (i) =>
          safeLower(i.orderNumber).includes(q) ||
          safeLower(i.customerName).includes(q) ||
          safeLower(i.customerPhone).includes(q),
      );
    }
    return list;
  }, [pendingCodOrders, pendingPosDues, filterSource, searchTerm]);

  const totalCodAmount = pendingCodOrders.reduce((sum, o) => sum + o.balanceDue, 0);
  const totalPosDueAmount = pendingPosDues.reduce((sum, s) => sum + s.balanceDue, 0);
  const totalCashOutstanding = totalCodAmount + totalPosDueAmount;

  // Refresh queries after mutation
  const refreshAll = async () => {
    invalidateCanonicalReportingQueries(qc);
    await qc.invalidateQueries({ queryKey: CANONICAL_POS_SALES_KEY });
    await qc.invalidateQueries({ queryKey: ["orders"] });
    await qc.invalidateQueries({ queryKey: ["admin-orders"] });
    await qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
    await qc.invalidateQueries({ queryKey: ["admin-dashboard-stats"] });
    await qc.invalidateQueries({ queryKey: ["canonical-reporting"] });
  };

  // 1-Click Settle
  const handleSettle = async (item: CashDueItem) => {
    try {
      setIsUpdating(true);
      if (item.source === "Offline POS Due") {
        const fullPaid = Number(item.rawSale?.total || item.total);
        const dateNote = `[Settled ₹${item.balanceDue.toFixed(2)} on ${format(new Date(), "MMM dd, yyyy • hh:mm a")}]`;
        const updatedNotes = item.notes ? `${item.notes}\n${dateNote}` : dateNote;

        const { error: rpcErr } = await (supabase.rpc as any)("admin_settle_pos_due", {
          _sale_id: item.id,
          _amount_paid: fullPaid,
          _payment_status: "paid",
          _notes: dateNote,
        });

        if (rpcErr) {
          const { error: directErr } = await supabase
            .from("offline_sales")
            .update({
              amount_paid: fullPaid,
              payment_status: "paid",
              notes: updatedNotes,
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", item.id);

          if (directErr) throw directErr;
        }
        toast.success(`POS Sale ${item.orderNumber} marked as fully settled!`);
      } else {
        const { error: rpcErr } = await (supabase.rpc as any)("admin_settle_order_cod", {
          _order_id: item.id,
          _notes: "COD settled by admin",
        });

        if (rpcErr) {
          const { error: directErr } = await supabase
            .from("orders")
            .update({
              payment_status: "paid",
              status: item.rawOrder?.status === "placed" ? "delivered" : item.rawOrder?.status,
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          if (directErr) throw directErr;
        }
        toast.success(`Order ${item.orderNumber} marked as settled!`);
      }
      await refreshAll();
    } catch (err: any) {
      console.error("[CashOutstanding] Settle error:", err);
      toast.error(err?.message || "Failed to settle payment");
    } finally {
      setIsUpdating(false);
    }
  };

  // Save Edit Due Amount
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const newPaidVal = parseFloat(editNewPaid);
    if (isNaN(newPaidVal) || newPaidVal < 0) {
      toast.error("Please enter a valid amount paid");
      return;
    }

    try {
      setIsUpdating(true);
      if (editingItem.source === "Offline POS Due") {
        const total = Number(editingItem.rawSale?.total || editingItem.total);
        const isPaid = newPaidVal >= total;
        const noteAppend = editNotes.trim()
          ? `[Due adjusted by admin: paid ₹${newPaidVal} / total ₹${total} - ${editNotes.trim()}]`
          : `[Due adjusted by admin on ${format(new Date(), "MMM dd, yyyy")}]`;
        const updatedNotes = editingItem.notes
          ? `${editingItem.notes}\n${noteAppend}`
          : noteAppend;

        const { error: rpcErr } = await (supabase.rpc as any)("admin_settle_pos_due", {
          _sale_id: editingItem.id,
          _amount_paid: newPaidVal,
          _payment_status: isPaid ? "paid" : "partial",
          _notes: noteAppend,
        });

        if (rpcErr) {
          const { error: directErr } = await supabase
            .from("offline_sales")
            .update({
              amount_paid: newPaidVal,
              payment_status: isPaid ? "paid" : "partial",
              notes: updatedNotes,
              updated_at: new Date().toISOString(),
            } as any)
            .eq("id", editingItem.id);

          if (directErr) throw directErr;
        }
        toast.success(`Sale ${editingItem.orderNumber} updated!`);
      } else {
        const isPaid = newPaidVal >= editingItem.total;
        const { error } = await supabase
          .from("orders")
          .update({
            payment_status: isPaid ? "paid" : "pending",
            notes: editNotes.trim() || editingItem.notes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingItem.id);

        if (error) throw error;
        toast.success(`Order ${editingItem.orderNumber} updated!`);
      }

      setEditingItem(null);
      await refreshAll();
    } catch (err: any) {
      console.error("[CashOutstanding] Edit error:", err);
      toast.error(err?.message || "Failed to update due amount");
    } finally {
      setIsUpdating(false);
    }
  };

  // Delete / Write-off
  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    try {
      setIsUpdating(true);
      if (deletingItem.source === "Offline POS Due") {
        if (deleteMode === "writeoff") {
          // Write-off: mark as paid/cleared without taking extra cash
          const total = Number(deletingItem.rawSale?.total || deletingItem.total);
          const writeOffNote = `[Due of ₹${deletingItem.balanceDue.toFixed(2)} written off / waived by admin on ${format(new Date(), "MMM dd, yyyy")}]`;
          const updatedNotes = deletingItem.notes
            ? `${deletingItem.notes}\n${writeOffNote}`
            : writeOffNote;

          const { error: rpcErr } = await (supabase.rpc as any)("admin_settle_pos_due", {
            _sale_id: deletingItem.id,
            _amount_paid: total,
            _payment_status: "paid",
            _notes: writeOffNote,
          });

          if (rpcErr) {
            const { error: directErr } = await supabase
              .from("offline_sales")
              .update({
                amount_paid: total,
                payment_status: "paid",
                notes: updatedNotes,
                updated_at: new Date().toISOString(),
              } as any)
              .eq("id", deletingItem.id);

            if (directErr) throw directErr;
          }
          toast.success(`Due ₹${deletingItem.balanceDue.toFixed(2)} written off successfully!`);
        } else {
          // Void transaction
          const voidNote = `[VOIDED by admin on ${format(new Date(), "MMM dd, yyyy")}]`;
          const { error } = await supabase
            .from("offline_sales")
            .update({
              is_voided: true,
              status: "voided",
              notes: deletingItem.notes ? `${deletingItem.notes}\n${voidNote}` : voidNote,
              updated_at: new Date().toISOString(),
            })
            .eq("id", deletingItem.id);

          if (error) throw error;
          toast.success(`Sale ${deletingItem.orderNumber} voided/deleted!`);
        }
      } else {
        // Online order cancel
        const { error } = await supabase
          .from("orders")
          .update({
            status: "cancelled",
            payment_status: "refunded",
            updated_at: new Date().toISOString(),
          })
          .eq("id", deletingItem.id);

        if (error) throw error;
        toast.success(`Order ${deletingItem.orderNumber} cancelled!`);
      }

      setDeletingItem(null);
      await refreshAll();
    } catch (err: any) {
      console.error("[CashOutstanding] Delete error:", err);
      toast.error(err?.message || "Failed to process write-off / delete");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* KPI Summary Banner */}
      <div className="p-4 sm:p-5 rounded-2xl border border-border bg-card shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
            <DollarSign className="size-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Total Cash Outstanding {dateRangeText ? `• ${dateRangeText}` : ""}
            </p>
            <p className="text-2xl sm:text-3xl font-black text-rose-600 dark:text-rose-400">
              {formatPrice(totalCashOutstanding)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setFilterSource(filterSource === "online" ? "all" : "online")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold border transition cursor-pointer ${
              filterSource === "online"
                ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 hover:bg-blue-500/20"
            }`}
          >
            Online COD: {pendingCodOrders.length} orders ({formatPrice(totalCodAmount)})
          </button>
          <button
            type="button"
            onClick={() => setFilterSource(filterSource === "offline" ? "all" : "offline")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold border transition cursor-pointer ${
              filterSource === "offline"
                ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20 hover:bg-amber-500/20"
            }`}
          >
            Offline POS Due: {pendingPosDues.length} sales ({formatPrice(totalPosDueAmount)})
          </button>
        </div>
      </div>

      {/* Search & Channel Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by sale ID, name, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterSource("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterSource === "all"
                ? "bg-muted text-foreground border border-border font-extrabold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({pendingCodOrders.length + pendingPosDues.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterSource("offline")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterSource === "offline"
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            POS Due ({pendingPosDues.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterSource("online")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterSource === "online"
                ? "bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            COD ({pendingCodOrders.length})
          </button>
        </div>
      </div>

      {/* Main Table with Edit, Delete, Settle Actions */}
      <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[760px] text-left text-sm text-muted-foreground">
          <thead className="bg-muted text-xs uppercase text-foreground">
            <tr>
              <th className="px-6 py-3.5">Date</th>
              <th className="px-6 py-3.5">Order / Sale ID</th>
              <th className="px-6 py-3.5">Customer Details</th>
              <th className="px-6 py-3.5">Source</th>
              <th className="px-6 py-3.5 text-right">Pending Amount</th>
              <th className="px-6 py-3.5 text-center pr-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {combinedDues.map((item) => (
              <tr key={`${item.source}-${item.id}`} className="bg-background transition-colors hover:bg-muted/40">
                <td className="px-6 py-4 whitespace-nowrap text-xs">
                  {format(new Date(item.date), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 font-mono font-bold text-foreground">
                  {item.orderNumber}
                </td>
                <td className="px-6 py-4">
                  <p className="font-medium text-foreground">{item.customerName}</p>
                  {item.customerPhone && (
                    <p className="text-xs text-muted-foreground font-mono">{item.customerPhone}</p>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      item.source === "Online COD"
                        ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                    }`}
                  >
                    {item.source}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-black text-rose-600 dark:text-rose-400 text-sm whitespace-nowrap">
                  {formatPrice(item.balanceDue)}
                  {item.amountPaid > 0 && (
                    <p className="text-[10px] text-muted-foreground font-normal">
                      Paid: {formatPrice(item.amountPaid)} / Total: {formatPrice(item.total)}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-center pr-6 whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1.5">
                    {/* 1. Make Settled Button */}
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleSettle(item)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                      title="Mark fully settled (received cash/payment)"
                    >
                      <CheckCircle2 className="size-3.5" />
                      <span>Settle</span>
                    </button>

                    {/* 2. Edit Due Button */}
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => {
                        setEditingItem(item);
                        setEditNewPaid(String(item.amountPaid));
                        setEditNotes(item.notes || "");
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                      title="Edit due amount or paid status"
                    >
                      <Edit3 className="size-3.5" />
                      <span>Edit</span>
                    </button>

                    {/* 3. Delete / Write-off Button */}
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => {
                        setDeletingItem(item);
                        setDeleteMode("writeoff");
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-lg transition shadow-2xs cursor-pointer disabled:opacity-50"
                      title="Write-off due balance or delete record"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {combinedDues.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="size-8 mx-auto mb-2 text-emerald-500 opacity-60" />
                  <p className="font-semibold text-foreground">No cash outstanding.</p>
                  <p className="text-xs mt-0.5">All customer dues and COD orders are fully settled!</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Edit Due */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Edit3 className="size-5 text-primary" />
                <h3 className="font-bold text-foreground text-base">Edit Pending Due</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div className="bg-muted/40 rounded-xl p-3 border border-border/60 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Order / Sale:</span>
                  <span className="font-mono font-bold text-foreground">{editingItem.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-semibold text-foreground">{editingItem.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Bill Value:</span>
                  <span className="font-bold text-foreground">{formatPrice(editingItem.total)}</span>
                </div>
                <div className="flex justify-between text-rose-600 font-bold">
                  <span>Current Due:</span>
                  <span>{formatPrice(editingItem.balanceDue)}</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Amount Paid So Far (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={editingItem.total}
                  value={editNewPaid}
                  onChange={(e) => setEditNewPaid(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary font-bold"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Remaining Due will be:{" "}
                  <strong className="text-rose-600">
                    {formatPrice(Math.max(0, editingItem.total - (parseFloat(editNewPaid) || 0)))}
                  </strong>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-foreground mb-1">
                  Admin Adjustment Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Received partial cash payment via Sameer"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleSaveEdit}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete / Write-off */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Trash2 className="size-5 text-rose-600" />
                <h3 className="font-bold text-foreground text-base">Write Off or Delete Due</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <p className="text-muted-foreground">
                How would you like to handle the pending balance of{" "}
                <strong className="text-rose-600 font-bold">{formatPrice(deletingItem.balanceDue)}</strong> for{" "}
                <strong className="text-foreground">{deletingItem.orderNumber}</strong>?
              </p>

              <div className="space-y-2">
                <label
                  onClick={() => setDeleteMode("writeoff")}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                    deleteMode === "writeoff"
                      ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={deleteMode === "writeoff"}
                    onChange={() => setDeleteMode("writeoff")}
                    className="mt-0.5 text-emerald-600"
                  />
                  <div>
                    <p className="font-bold text-foreground">Write Off Due (Recommended for rounding/discounts)</p>
                    <p className="text-[11px] mt-0.5 text-muted-foreground">
                      Clears the remaining ₹{deletingItem.balanceDue.toFixed(2)} to ₹0 and keeps the sales transaction recorded.
                    </p>
                  </div>
                </label>

                <label
                  onClick={() => setDeleteMode("void")}
                  className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer ${
                    deleteMode === "void"
                      ? "border-rose-500 bg-rose-500/10 text-foreground"
                      : "border-border bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <input
                    type="radio"
                    name="deleteMode"
                    checked={deleteMode === "void"}
                    onChange={() => setDeleteMode("void")}
                    className="mt-0.5 text-rose-600"
                  />
                  <div>
                    <p className="font-bold text-foreground">Void / Cancel Transaction</p>
                    <p className="text-[11px] mt-0.5 text-muted-foreground">
                      Completely marks this sale/order as voided and excludes it from sales records.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleConfirmDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {deleteMode === "writeoff" ? "Confirm Write-Off" : "Confirm Void"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
