import { useState, useMemo } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  useAllOrders,
  orderStatuses,
  useRetryOrderNotification,
  useDeleteCancelledOrder,
  useProcessOrderRefund,
  useResendCustomerInvoice,
  type Order,
} from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { formatPrice, useProducts } from "@/lib/store";
import { useTableSelection, getOrdersSelectionMetrics } from "@/lib/table-selection";
import { SmartSelectionSummary } from "@/components/admin/SmartSelectionSummary";
import type { OfflineSale } from "@/lib/pos";
import { deleteQueuedSale } from "@/lib/offline-sync-engine";
import { invalidateCanonicalReportingQueries } from "@/lib/canonical-reporting";
import {
  useCreateShiprocketShipment,
  useGenerateShiprocketAWB,
  useRequestShiprocketPickup,
} from "@/lib/orders";
import {
  MailCheck,
  MailWarning,
  RotateCcw,
  Trash2,
  AlertTriangle,
  X,
  Loader2,
  Truck,
  PackageCheck,
  Send,
  Ban,
} from "lucide-react";
import { AdminTableSkeleton } from "@/components/ui/Skeletons";
import { AdminOrderItemsList } from "@/components/admin/AdminOrderItemsList";

export function OnlineSalesTab() {
  const qc = useQueryClient();
  const { data: onlineData, isLoading: onlineLoading } = useAllOrders(true);
  const isLoading = onlineLoading;

  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 25;
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

  // Bulk Cancel Orders State
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelTargetMode, setCancelTargetMode] = useState<"selected" | "visible" | "all">("selected");
  const [bulkCancelReason, setBulkCancelReason] = useState("Bulk cancelled by Admin");
  const [isBulkCancelling, setIsBulkCancelling] = useState(false);

  // Bulk Delete Cancelled Orders State
  const [isDeleteBulkModalOpen, setIsDeleteBulkModalOpen] = useState(false);
  const [deleteTargetMode, setDeleteTargetMode] = useState<"selected" | "all_cancelled">("selected");
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const retryNotification = useRetryOrderNotification();
  const deleteOrder = useDeleteCancelledOrder();
  const createShipment = useCreateShiprocketShipment();
  const generateAwb = useGenerateShiprocketAWB();
  const requestPickup = useRequestShiprocketPickup();
  const processRefund = useProcessOrderRefund();
  const resendCustomerInvoice = useResendCustomerInvoice();

  type OrderStatus = Database["public"]["Tables"]["orders"]["Row"]["status"];

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: status as OrderStatus })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      toast.success("Order updated");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      if (variables.status === "confirmed") {
        createShipment.mutate(variables.id);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleConfirmDelete() {
    if (!orderToDelete) return;
    try {
      if ((orderToDelete as Record<string, unknown>)._type === "offline") {
        const { error } = await supabase.rpc(
          "admin_void_offline_sale" as never,
          {
            _sale_id: orderToDelete.id,
            _reason: "Voided via Online Sales Tab",
            _restore_stock: true,
          } as never,
        );
        if (error) {
          throw new Error(error.message || "Failed to void POS sale");
        }
        toast.success("POS sale voided and stock restored. Audit trail preserved.");
        invalidateCanonicalReportingQueries(qc);
      } else {
        await deleteOrder.mutateAsync(orderToDelete.id);
      }
      setOrderToDelete(null);
    } catch (e) {
      if ((orderToDelete as Record<string, unknown>)._type === "offline") {
        toast.error((e as Error).message || "Failed to void POS sale");
      }
    }
  }

  // Filter out POS orders — Online Sales tab shows ONLY online storefront orders
  const onlineOrdersData = (onlineData ?? []).filter((o) => o.notes !== "POS Order");

  // Helper to test if an order was placed within the last 24 hours
  const isWithinLast24Hours = (createdAt: string) => {
    const orderTime = new Date(createdAt).getTime();
    const now = Date.now();
    return !isNaN(orderTime) && now - orderTime <= 24 * 60 * 60 * 1000;
  };

  const newOrders24hCount = onlineOrdersData.filter((o) =>
    isWithinLast24Hours(o.created_at),
  ).length;

  type OnlineOrderWithMeta = Order & {
    _type: "online";
    cancelled_at?: string | null;
    cancellation_reason?: string | null;
    payment_status?: string | null;
    shiprocket_order_id?: string | number | null;
    awb_code?: string | null;
    courier_name?: string | null;
    shiprocket_status?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    offline_sale_items?: OfflineSale["offline_sale_items"];
  };

  type OfflineOrderWithMeta = OfflineSale & {
    _type: "offline";
    cancelled_at?: string | null;
    cancellation_reason?: string | null;
    payment_status?: string | null;
    shiprocket_order_id?: string | number | null;
    awb_code?: string | null;
    courier_name?: string | null;
    shiprocket_status?: string | null;
    order_items?: Order["order_items"];
    full_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    notes?: string | null;
    email_sent?: boolean;
  };

  type UnifiedTransaction = OnlineOrderWithMeta | OfflineOrderWithMeta;

  const allData: UnifiedTransaction[] = onlineOrdersData
    .map((o) => ({ ...o, _type: "online" as const }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const revenue = allData
    .filter((o) => {
      if (o.status === "cancelled") return false;
      if (o.payment_status === "failed" || o.payment_status === "refunded") return false;
      return true;
    })
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const unpaidOrdersCount = allData.filter(
    (o) =>
      o._type === "online" &&
      o.payment_method?.toLowerCase() !== "cod" &&
      o.payment_status !== "paid" &&
      o.status !== "cancelled",
  ).length;

  const cancelledOrdersCount = allData.filter((o) => o.status === "cancelled").length;

  const orders = allData.filter((o) => {
    if (filter === "new_orders") {
      return isWithinLast24Hours(o.created_at);
    }
    if (filter === "all") return true;
    if (filter === "paid") {
      if (o._type === "offline") return o.status !== "cancelled";
      return (
        (o.payment_method?.toLowerCase() === "cod" || o.payment_status === "paid") &&
        o.status !== "cancelled"
      );
    }
    if (filter === "unpaid") {
      return (
        o._type === "online" &&
        o.payment_method?.toLowerCase() !== "cod" &&
        o.payment_status !== "paid" &&
        o.status !== "cancelled"
      );
    }
    if (filter === "cancelled") {
      return o.status === "cancelled";
    }
    if (o._type === "offline" && filter === "completed") return o.status === "completed";
    return o.status === filter;
  });

  const { data: products = [] } = useProducts(true);
  const selection = useTableSelection<UnifiedTransaction>({ items: orders });
  const visibleOrders = useMemo(
    () => orders.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE),
    [orders, page],
  );
  const selectionMetrics = useMemo(
    () => getOrdersSelectionMetrics(selection.selectedItems as unknown as Order[], products),
    [selection.selectedItems, products],
  );

  const activeOrdersToCancel = useMemo(() => {
    let pool: UnifiedTransaction[] = [];
    if (cancelTargetMode === "selected") {
      pool = (selection.selectedItems as unknown as UnifiedTransaction[]) || [];
    } else if (cancelTargetMode === "visible") {
      pool = visibleOrders;
    } else {
      pool = orders;
    }
    return pool.filter((o) => o.status !== "cancelled");
  }, [cancelTargetMode, selection.selectedItems, visibleOrders, orders]);

  function handleOpenCancelModal(mode: "selected" | "visible" | "all") {
    setCancelTargetMode(mode);
    setBulkCancelReason("Bulk cancelled by Admin");
    setIsCancelModalOpen(true);
  }

  async function handleExecuteBulkCancel() {
    if (activeOrdersToCancel.length === 0) {
      toast.error("No active orders found to cancel.");
      setIsCancelModalOpen(false);
      return;
    }

    setIsBulkCancelling(true);
    try {
      const orderIds = activeOrdersToCancel.map((o) => o.id);
      const reasonText = bulkCancelReason.trim() || "Bulk cancelled by Admin";

      const { error } = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reasonText,
        })
        .in("id", orderIds);

      if (error) throw error;

      // Non-blocking auto refund notice trigger for online paid orders
      activeOrdersToCancel.forEach((o) => {
        if (o.payment_status === "paid") {
          supabase.functions
            .invoke("process-order-cancellation-refund", {
              body: {
                order_id: o.id,
                reason: reasonText,
              },
            })
            .catch((err) => console.warn(`Refund notification notice for order ${o.id}:`, err));
        }
      });

      toast.success(`Successfully cancelled ${orderIds.length} orders and restored stock.`);
      selection.clearSelection();
      setIsCancelModalOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["all-orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      invalidateCanonicalReportingQueries(qc);
    } catch (err: unknown) {
      toast.error((err as Error)?.message || "Failed to cancel orders");
    } finally {
      setIsBulkCancelling(false);
    }
  }

  // Cancelled orders eligible for permanent deletion
  const ordersToDeletePool = useMemo(() => {
    if (deleteTargetMode === "all_cancelled") {
      return (onlineOrdersData || []).filter((o) => o.status === "cancelled");
    }
    const selectedList = (selection.selectedItems as unknown as UnifiedTransaction[]) || [];
    return selectedList.filter((o) => o.status === "cancelled");
  }, [deleteTargetMode, selection.selectedItems, onlineOrdersData]);

  function handleOpenDeleteModal(mode: "selected" | "all_cancelled") {
    setDeleteTargetMode(mode);
    setIsDeleteBulkModalOpen(true);
  }

  async function handleExecuteBulkDelete() {
    if (ordersToDeletePool.length === 0) {
      toast.error("No cancelled orders found to delete. Only cancelled orders can be permanently deleted.");
      setIsDeleteBulkModalOpen(false);
      return;
    }

    setIsBulkDeleting(true);
    try {
      const orderIds = ordersToDeletePool.map((o) => o.id);

      // 1. Try atomic bulk RPC
      const { error: bulkErr } = await supabase.rpc("delete_cancelled_orders_bulk" as never, {
        _order_ids: orderIds,
      } as never);

      if (bulkErr) {
        console.warn("[BulkDelete] Bulk RPC fallback:", bulkErr);
        // Resilient fallback in chunks of 10
        const CHUNK_SIZE = 10;
        for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
          const chunk = orderIds.slice(i, i + CHUNK_SIZE);
          await Promise.all(
            chunk.map(async (id) => {
              const { error: rpcErr } = await supabase.rpc("delete_cancelled_order", { _order_id: id });
              if (rpcErr) {
                await supabase.from("coupon_usage").delete().eq("order_id", id);
                await supabase.from("order_items").delete().eq("order_id", id);
                await supabase.from("order_status_history").delete().eq("order_id", id);
                await supabase.from("payments").delete().eq("order_id", id);
                await supabase.from("orders").delete().eq("id", id).eq("status", "cancelled");
              }
            }),
          );
        }
      }

      toast.success(`Successfully deleted ${orderIds.length} cancelled orders permanently.`);
      selection.clearSelection();
      setIsDeleteBulkModalOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["all-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      invalidateCanonicalReportingQueries(qc);
    } catch (err: unknown) {
      toast.error((err as Error)?.message || "Failed to delete cancelled orders");
    } finally {
      setIsBulkDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* New Orders in last 24 hours */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilter("new_orders")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setFilter("new_orders");
            }
          }}
          className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-xs transition-all hover:shadow-md cursor-pointer ${
            filter === "new_orders" ? "border-primary ring-2 ring-primary/20" : "border-border"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            New Orders (24h)
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {newOrders24hCount}
          </p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            Past 24 hours
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => setFilter("unpaid")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setFilter("unpaid");
            }
          }}
          className={`relative overflow-hidden rounded-2xl border bg-card p-5 shadow-xs transition-all hover:shadow-md cursor-pointer ${
            filter === "unpaid" ? "border-amber-500 ring-2 ring-amber-500/20" : "border-border"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" />
            Unpaid / Incomplete
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-amber-600 dark:text-amber-400">
            {unpaidOrdersCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Abandoned checkout attempts</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Confirmed Realized Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#8B2020]">
            {formatPrice(revenue)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Excludes unpaid & cancelled</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting Fulfillment
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {
              onlineOrdersData.filter(
                (o) =>
                  (o.status === "placed" || o.status === "processing") &&
                  (o.payment_method?.toLowerCase() === "cod" || o.payment_status === "paid"),
              ).length
            }
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Paid & confirmed orders</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* New Orders (24h) Filter Button before 'All' */}
          <button
            type="button"
            onClick={() => {
              setFilter("new_orders");
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              filter === "new_orders"
                ? "bg-[#8B2020] text-white shadow-sm ring-2 ring-[#8B2020]/20"
                : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/50"
            }`}
          >
            <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>New Orders</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                filter === "new_orders"
                  ? "bg-card/20 text-white"
                  : "bg-amber-200/60 dark:bg-amber-800/60 text-amber-900 dark:text-amber-200"
              }`}
            >
              {newOrders24hCount}
            </span>
          </button>

          {/* Unpaid & Incomplete Orders Tab Button */}
          <button
            type="button"
            onClick={() => {
              setFilter("unpaid");
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
              filter === "unpaid"
                ? "bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20"
                : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100 border border-amber-300"
            }`}
          >
            <span>Unpaid / Incomplete</span>
            {unpaidOrdersCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                  filter === "unpaid" ? "bg-card/20 text-white" : "bg-amber-200 text-amber-900"
                }`}
              >
                {unpaidOrdersCount}
              </span>
            )}
          </button>

          {[
            "all",
            "paid",
            "placed",
            "processing",
            "packed",
            "shipped",
            "delivered",
            "cancelled",
          ].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setFilter(s);
                setPage(1);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer ${
                filter === s
                  ? "bg-[#8B2020] text-white shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {s === "all" ? "All Orders" : s === "paid" ? "Paid / Confirmed" : s}
              {s === "cancelled" && cancelledOrdersCount > 0 && (
                <span className="ml-1.5 rounded-full bg-red-100 dark:bg-red-950 px-1.5 py-0.2 text-[10px] font-bold text-red-700 dark:text-red-300">
                  {cancelledOrdersCount}
                </span>
              )}
            </button>
          ))}

          {/* Dedicated Cancel Orders Pill / Tab */}
          {orders.length > 0 && (
            <button
              type="button"
              onClick={() => handleOpenCancelModal(selection.selectedCount > 0 ? "selected" : "all")}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition cursor-pointer shadow-2xs"
              title="Cancel multiple or all orders in view"
            >
              <Ban className="size-3 text-rose-600 dark:text-rose-400" />
              <span>
                {selection.selectedCount > 0
                  ? `Cancel Selected (${selection.selectedCount})`
                  : "Cancel All Orders"}
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {orders.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer bg-muted/50 hover:bg-muted px-3 py-1.5 rounded-xl border border-border transition-colors">
                <input
                  type="checkbox"
                  checked={selection.isAllVisibleSelected(visibleOrders)}
                  ref={(el) => {
                    if (el) el.indeterminate = selection.isIndeterminate(visibleOrders);
                  }}
                  onChange={() => selection.toggleAllVisible(visibleOrders)}
                  className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                />
                <span>Select Page ({visibleOrders.length})</span>
              </label>

              <button
                type="button"
                onClick={() => handleOpenCancelModal(selection.selectedCount > 0 ? "selected" : "visible")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/60 px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900 transition cursor-pointer shadow-2xs"
                title={
                  selection.selectedCount > 0
                    ? `Cancel ${selection.selectedCount} selected orders`
                    : `Cancel all ${visibleOrders.filter((o) => o.status !== "cancelled").length} visible orders on this page`
                }
              >
                <Ban className="size-3.5" />
                <span>
                  {selection.selectedCount > 0
                    ? `Cancel Selected (${selection.selectedCount})`
                    : `Cancel Visible (${visibleOrders.filter((o) => o.status !== "cancelled").length})`}
                </span>
              </button>
              {/* If on Cancelled tab, offer Delete All Cancelled */}
              {filter === "cancelled" && cancelledOrdersCount > 0 && (
                <button
                  type="button"
                  onClick={() => handleOpenDeleteModal("all_cancelled")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-2xs"
                  title="Permanently delete all cancelled orders in database"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete All Cancelled ({cancelledOrdersCount})</span>
                </button>
              )}
            </div>
          )}

          <p className="text-xs font-medium text-muted-foreground">
            Showing {(page - 1) * ITEMS_PER_PAGE + 1}-
            {Math.min(page * ITEMS_PER_PAGE, orders.length)} of {orders.length} transactions
            {filter === "new_orders" && " (placed in last 24 hours)"}
            {filter === "unpaid" && " (unpaid / abandoned payments)"}
          </p>
        </div>
      </div>

      {/* Sticky Smart Selection Summary */}
      <SmartSelectionSummary
        selectedCount={selection.selectedCount}
        selectedLabel="Selected Orders"
        metrics={selectionMetrics}
        onClear={selection.clearSelection}
        actions={
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Delete Selected (only for cancelled orders) */}
            {selection.selectedItems.some((o) => (o as unknown as Order).status === "cancelled") && (
              <button
                type="button"
                onClick={() => handleOpenDeleteModal("selected")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white px-3 py-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
                title="Permanently delete selected cancelled orders"
              >
                <Trash2 className="size-3.5" />
                <span>
                  Delete Selected (
                  {
                    selection.selectedItems.filter(
                      (o) => (o as unknown as Order).status === "cancelled",
                    ).length
                  }
                  )
                </span>
              </button>
            )}

            {/* Delete All Cancelled (when in Cancelled tab) */}
            {filter === "cancelled" && cancelledOrdersCount > 0 && (
              <button
                type="button"
                onClick={() => handleOpenDeleteModal("all_cancelled")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/80 bg-rose-700 hover:bg-rose-800 active:scale-95 text-white px-3 py-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
                title="Permanently delete all cancelled orders in the database"
              >
                <Trash2 className="size-3.5" />
                <span>Delete All Cancelled ({cancelledOrdersCount})</span>
              </button>
            )}

            {/* Cancel Selected (for active orders) */}
            {selection.selectedItems.some((o) => (o as unknown as Order).status !== "cancelled") && (
              <button
                type="button"
                onClick={() => handleOpenCancelModal("selected")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white px-3 py-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
                title="Cancel all active selected orders"
              >
                <Ban className="size-3.5" />
                <span>
                  Cancel Selected (
                  {
                    selection.selectedItems.filter(
                      (o) => (o as unknown as Order).status !== "cancelled",
                    ).length
                  }
                  )
                </span>
              </button>
            )}
          </div>
        }
      />

      {/* Select All in View Banner */}
      {selection.isAllVisibleSelected(visibleOrders) &&
        orders.length > visibleOrders.length &&
        selection.selectedCount < orders.length && (
          <div className="rounded-2xl border border-[#8B2020]/20 bg-[#8B2020]/5 p-3 text-center text-xs font-medium text-foreground flex items-center justify-center gap-2">
            <span>All {visibleOrders.length} orders on this page are selected.</span>
            <button
              type="button"
              onClick={() => selection.selectAllFiltered(orders)}
              className="font-bold text-[#8B2020] underline hover:text-[#8B2020]/80 cursor-pointer"
            >
              Select all {orders.length} orders in {filter === "cancelled" ? "Cancelled" : "this view"}
            </button>
          </div>
        )}

      {isLoading && <AdminTableSkeleton rows={5} />}

      {!isLoading && orders.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <p className="text-sm font-semibold text-muted-foreground">No transactions found</p>
          <p className="mt-1 text-xs text-gray-400">
            Online and POS transactions will appear here automatically.
          </p>
        </div>
      )}

      <ul className="space-y-4">
        {visibleOrders.map((order) => {
          const isSelected = selection.isSelected(order.id);
          return (
            <li
              key={order.id}
              className={`overflow-hidden rounded-3xl border bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-border ${
                isSelected
                  ? "border-[#8B2020] ring-2 ring-[#8B2020]/20 bg-[#8B2020]/5"
                  : "border-gray-100"
              }`}
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => selection.toggle(order.id)}
                      aria-label={`Select transaction ${order.id}`}
                      className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer mr-1"
                    />
                    <span className="font-mono text-sm font-bold text-foreground">
                      {order._type === "offline"
                        ? order.sale_number || `#${order.id.slice(0, 8).toUpperCase()}`
                        : `#${order.id.slice(0, 8).toUpperCase()}`}
                    </span>
                    <span className="rounded-full bg-red-50 text-[#8B2020] border border-red-100 px-2.5 py-0.5 text-xs font-semibold capitalize">
                      {order.status}
                    </span>
                    {order._type === "offline" && (
                      <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 text-xs font-semibold uppercase">
                        POS / Walk-in
                      </span>
                    )}
                    {order._type === "online" && order.payment_status && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                          order.payment_status === "paid"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                            : order.payment_status === "failed"
                              ? "bg-rose-50 text-rose-700 border border-rose-100"
                              : "bg-amber-50 text-amber-700 border border-amber-100"
                        }`}
                      >
                        Payment: {order.payment_status}
                      </span>
                    )}
                    {/* Owner Alert Status */}
                    {order.owner_notification_status === "sent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        <MailCheck className="size-3" /> Owner Notified
                      </span>
                    ) : order.owner_notification_status === "failed" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                        <MailWarning className="size-3" /> Email Alert Failed
                        <button
                          type="button"
                          onClick={() =>
                            retryNotification.mutate({
                              orderId: order.id,
                              type: order._type === "online" ? "online_order" : "offline_sale",
                            })
                          }
                          disabled={retryNotification.isPending}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 underline hover:text-rose-950 disabled:opacity-50"
                        >
                          <RotateCcw className="size-2.5" /> Retry
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    {new Date(order.created_at).toLocaleString("en-IN")}
                  </p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {order._type === "online"
                          ? order.full_name
                          : order.customer_name || "Walk-in Customer"}
                      </p>
                      <p className="text-sm font-medium text-muted-foreground mt-0.5">
                        {order._type === "online"
                          ? order.email
                          : order.customer_email || "No email"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {order._type === "online"
                          ? order.phone
                          : order.customer_phone || "No phone"}{" "}
                        {order._type === "online" && order.alt_phone && (
                          <span className="text-xs">/ {order.alt_phone}</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
                        {order._type === "online" ? (
                          <>
                            {order.address}
                            {order.address_line2 ? `, ${order.address_line2}` : ""}
                            {order.landmark ? `, near ${order.landmark}` : ""}
                            <br />
                            {[order.city, order.state, order.pincode].filter(Boolean).length
                              ? `${[order.city, order.state, order.pincode].filter(Boolean).join(", ")}`
                              : ""}
                          </>
                        ) : (
                          "In-store purchase"
                        )}
                      </p>
                    </div>
                  </div>

                  {order.status === "cancelled" && (
                    <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-3.5 text-xs text-red-800">
                      <p className="font-bold text-red-900">
                        Order Cancelled
                        {order.cancelled_at &&
                          ` on ${new Date(order.cancelled_at || "").toLocaleString("en-IN")}`}
                      </p>
                      {order.cancellation_reason && (
                        <p className="mt-0.5">Reason: “{order.cancellation_reason}”</p>
                      )}
                    </div>
                  )}

                  {order.notes && (
                    <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3.5 text-sm text-amber-700">
                      <strong>Note:</strong> “{order.notes}”
                    </div>
                  )}

                  {/* Complete Order Items & Financial Breakdown */}
                  <AdminOrderItemsList order={order as unknown as Order} products={products} />

                  <div className="mt-5 border-t border-gray-100 pt-5 flex flex-wrap items-center justify-between gap-3">
                    <InvoiceBox order={order as unknown as Order} />

                    {order._type === "online" && order.email && (
                      <div className="flex items-center gap-2">
                        {order.customer_notification_status === "sent" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
                            <MailCheck className="size-3.5" />
                            <span>Invoice Emailed</span>
                          </span>
                        ) : order.customer_notification_status === "failed" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700">
                            <MailWarning className="size-3.5" />
                            <span>Email Failed</span>
                          </span>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => resendCustomerInvoice.mutate({ orderId: order.id })}
                          disabled={resendCustomerInvoice.isPending}
                          title="Email official order confirmation & tax invoice directly to customer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted px-3 py-1 text-xs font-semibold text-foreground transition disabled:opacity-50 cursor-pointer shadow-2xs"
                        >
                          {resendCustomerInvoice.isPending ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Send className="size-3 text-muted-foreground" />
                          )}
                          <span>
                            {order.customer_notification_status === "sent"
                              ? "Resend Customer Email"
                              : "Email Customer Invoice"}
                          </span>
                        </button>
                      </div>
                    )}

                    {order._type === "online" && (
                      <div className="flex items-center gap-2">
                        {order.shiprocket_order_id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-bold text-blue-700">
                              <Truck className="size-3.5" />
                              <span>
                                SR #{order.shiprocket_order_id}{" "}
                                {order.shiprocket_status ? `(${order.shiprocket_status})` : ""}
                              </span>
                            </span>
                            {!order.shiprocket_shipment_id && (
                              <button
                                type="button"
                                onClick={() => generateAwb.mutate(order.id)}
                                disabled={generateAwb.isPending}
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer shadow-2xs"
                              >
                                {generateAwb.isPending ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  "Gen AWB"
                                )}
                              </button>
                            )}
                          </div>
                        ) : order.status !== "cancelled" ? (
                          <button
                            type="button"
                            onClick={() => createShipment.mutate(order.id)}
                            disabled={createShipment.isPending}
                            title="Push order to Shiprocket for fulfillment & courier assignment"
                            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/50 hover:bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 transition disabled:opacity-50 cursor-pointer shadow-2xs"
                          >
                            {createShipment.isPending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Truck className="size-3" />
                            )}
                            <span>Sync to Shiprocket</span>
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right sm:w-48">
                  <p className="text-xl font-extrabold text-foreground">
                    {formatPrice(Number(order.total))}
                  </p>
                  <select
                    value={order.status}
                    onChange={(e) =>
                      update.mutate({
                        id: order.id,
                        status: e.target.value,
                      })
                    }
                    disabled={update.isPending}
                    aria-label={`Status for order ${order.id}`}
                    className="mt-3 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium capitalize outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm text-foreground disabled:opacity-50"
                  >
                    {orderStatuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  {/* Shiprocket Actions */}
                  {order.payment_status === "paid" && order.status !== "cancelled" && (
                    <div className="mt-4 border-t border-border/50 pt-3 flex flex-col gap-2">
                      {!order.shiprocket_order_id ? (
                        <button
                          type="button"
                          onClick={() => createShipment.mutate(order.id)}
                          disabled={createShipment.isPending || order.status === "cancelled"}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-2.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 hover:border-indigo-300 shadow-sm disabled:opacity-50"
                        >
                          {createShipment.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <PackageCheck className="size-3.5" />
                          )}
                          Push to Shiprocket
                        </button>
                      ) : !order.awb_code ? (
                        <button
                          type="button"
                          onClick={() => generateAwb.mutate(order.id)}
                          disabled={generateAwb.isPending}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 shadow-sm disabled:opacity-60"
                        >
                          {generateAwb.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Send className="size-3.5" />
                          )}
                          Generate AWB
                        </button>
                      ) : order.shiprocket_status !== "PICKUP_SCHEDULED" &&
                        order.shiprocket_status !== "SHIPPED" &&
                        order.shiprocket_status !== "DELIVERED" ? (
                        <button
                          type="button"
                          onClick={() => requestPickup.mutate(order.id)}
                          disabled={requestPickup.isPending}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-700 shadow-sm disabled:opacity-60"
                        >
                          {requestPickup.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Truck className="size-3.5" />
                          )}
                          Request Pickup
                        </button>
                      ) : (
                        <div className="rounded-xl border border-border bg-muted/30 p-2 text-left">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase">
                            Shiprocket AWB
                          </p>
                          <p className="text-xs font-bold text-foreground mt-0.5">
                            {order.awb_code}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {order.courier_name}
                          </p>
                          <p className="mt-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 inline-block rounded">
                            {order.shiprocket_status}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Razorpay Refund Action & Status for Cancelled Orders */}
                  {order.status === "cancelled" && (
                    <div className="mt-2.5 flex flex-col gap-2">
                      {order._type === "online" && order.razorpay_refund_id ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-2 text-left">
                          <p className="text-[10px] font-bold text-emerald-800 uppercase">
                            Refunded via Razorpay
                          </p>
                          <p className="text-xs font-mono font-bold text-emerald-950 mt-0.5 truncate">
                            {order.razorpay_refund_id}
                          </p>
                          {order.refund_amount && (
                            <p className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                              {formatPrice(Number(order.refund_amount))} credited
                            </p>
                          )}
                        </div>
                      ) : order._type === "online" &&
                        (order.payment_status === "paid" ||
                          order.payment_status === "refunded" ||
                          Boolean(order.razorpay_payment_id)) ? (
                        <button
                          type="button"
                          onClick={() =>
                            processRefund.mutate({
                              orderId: order.id,
                              reason: "Admin initiated cancellation refund",
                            })
                          }
                          disabled={processRefund.isPending}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-500 hover:bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                        >
                          {processRefund.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                          Refund via Razorpay
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setOrderToDelete(order as unknown as Order)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 hover:text-rose-900 hover:border-rose-300 shadow-sm cursor-pointer"
                      >
                        <Trash2 className="size-3.5" />
                        Delete Permanently
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {Math.ceil(orders.length / ITEMS_PER_PAGE) > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm font-medium text-muted-foreground">
            Page {page} of {Math.ceil(orders.length / ITEMS_PER_PAGE)}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((p) => Math.min(Math.ceil(orders.length / ITEMS_PER_PAGE), p + 1))
            }
            disabled={page === Math.ceil(orders.length / ITEMS_PER_PAGE)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* ─── CONFIRMATION MODAL ──────────────────────────────── */}
      {orderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <button
              type="button"
              onClick={() => {
                if (!deleteOrder.isPending) setOrderToDelete(null);
              }}
              disabled={deleteOrder.isPending}
              aria-label="Close modal"
              className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted transition disabled:opacity-50"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                <AlertTriangle className="size-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-lg font-bold text-foreground">
                  Delete cancelled order?
                </h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  This permanently removes this cancelled order and its order items from the
                  database. This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Order Details Card */}
            <div className="mt-5 rounded-2xl border border-border bg-muted/40 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="font-semibold text-muted-foreground">Order ID</span>
                <span className="font-mono font-bold text-foreground">
                  #{orderToDelete.id.slice(0, 8).toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-muted-foreground">Customer</span>
                <span className="font-medium text-foreground">{orderToDelete.full_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-muted-foreground">Order Total</span>
                <span className="font-bold text-foreground">
                  {formatPrice(Number(orderToDelete.total))}
                </span>
              </div>
              {orderToDelete.cancelled_at && (
                <div className="flex justify-between">
                  <span className="font-semibold text-muted-foreground">Cancelled On</span>
                  <span className="font-medium text-foreground">
                    {new Date(orderToDelete.cancelled_at).toLocaleString("en-IN")}
                  </span>
                </div>
              )}
              {orderToDelete.cancellation_reason && (
                <div className="pt-1 border-t border-border/60">
                  <span className="font-semibold text-muted-foreground">Reason: </span>
                  <span className="italic text-foreground">
                    “{orderToDelete.cancellation_reason}”
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOrderToDelete(null)}
                disabled={deleteOrder.isPending}
                className="rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition disabled:opacity-50"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteOrder.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-rose-700 transition disabled:opacity-60"
              >
                {deleteOrder.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" />
                    Delete Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Cancel Orders Modal */}
      {isCancelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          onClick={() => !isBulkCancelling && setIsCancelModalOpen(false)}
        >
          <div
            className="flex flex-col w-full max-w-lg max-h-[90vh] rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-500/20">
                  <Ban className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Cancel Orders
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {activeOrdersToCancel.length} active{" "}
                    {activeOrdersToCancel.length === 1 ? "order" : "orders"} selected for cancellation
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBulkCancelling}
                onClick={() => setIsCancelModalOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:opacity-50"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Summary Card */}
              <div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-800 dark:text-rose-300">Orders to Cancel:</span>
                  <span className="font-bold text-foreground">{activeOrdersToCancel.length}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-800 dark:text-rose-300">Total Value:</span>
                  <span className="font-black text-rose-900 dark:text-rose-200 text-sm">
                    {formatPrice(activeOrdersToCancel.reduce((sum, o) => sum + Number(o.total || 0), 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-800 dark:text-rose-300">Stock Restoration:</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    Automatic (catalog stock restored)
                  </span>
                </div>
              </div>

              {/* Target Orders Preview */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Target Orders ({activeOrdersToCancel.length})
                </label>
                <div className="max-h-28 overflow-y-auto rounded-xl border border-border bg-background p-2.5 flex flex-wrap gap-1.5">
                  {activeOrdersToCancel.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No active (non-cancelled) orders selected.
                    </span>
                  ) : (
                    activeOrdersToCancel.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono font-medium text-foreground border border-border"
                      >
                        #{o.id.slice(0, 8).toUpperCase()}
                        <span className="text-[10px] text-muted-foreground font-sans">
                          ({formatPrice(Number(o.total))})
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Reason Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Cancellation Reason
                </label>
                <input
                  type="text"
                  value={bulkCancelReason}
                  onChange={(e) => setBulkCancelReason(e.target.value)}
                  placeholder="e.g. Bulk cancelled by Store Admin"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition shadow-2xs"
                />

                {/* Quick preset chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    "Bulk cancelled by Admin",
                    "Customer requested cancellation",
                    "Out of stock / Inventory correction",
                    "Test order cleanup",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBulkCancelReason(preset)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium border transition cursor-pointer ${
                        bulkCancelReason === preset
                          ? "bg-rose-50 dark:bg-rose-950 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200"
                          : "bg-muted/50 border-border hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <span>
                  Cancelling will mark each order as cancelled, record audit logs, and automatically
                  restore inventory for each product item back into live store stock.
                </span>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-border bg-muted/20">
              <button
                type="button"
                disabled={isBulkCancelling}
                onClick={() => setIsCancelModalOpen(false)}
                className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
              >
                Nevermind, Keep Orders
              </button>

              <button
                type="button"
                disabled={isBulkCancelling || activeOrdersToCancel.length === 0}
                onClick={handleExecuteBulkCancel}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 px-4 py-2 text-xs font-bold text-white transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isBulkCancelling ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Cancelling {activeOrdersToCancel.length} Orders…</span>
                  </>
                ) : (
                  <>
                    <Ban className="size-3.5" />
                    <span>Yes, Cancel {activeOrdersToCancel.length} Orders</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Cancelled Orders Modal */}
      {isDeleteBulkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          onClick={() => !isBulkDeleting && setIsDeleteBulkModalOpen(false)}
        >
          <div
            className="flex flex-col w-full max-w-lg max-h-[90vh] rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border bg-rose-50/40 dark:bg-rose-950/30">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-md">
                  <Trash2 className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    Permanently Delete Cancelled Orders
                  </h3>
                  <p className="text-xs text-rose-700 dark:text-rose-400 font-semibold">
                    {ordersToDeletePool.length}{" "}
                    {ordersToDeletePool.length === 1 ? "order" : "orders"} will be permanently purged
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isBulkDeleting}
                onClick={() => setIsDeleteBulkModalOpen(false)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:opacity-50"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Target Mode Toggle if in Cancelled filter */}
              {filter === "cancelled" && selection.selectedCount > 0 && (
                <div className="flex items-center gap-2 p-1 bg-muted/50 rounded-xl border border-border text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setDeleteTargetMode("selected")}
                    className={`flex-1 py-1.5 rounded-lg transition text-center cursor-pointer ${
                      deleteTargetMode === "selected"
                        ? "bg-card text-foreground shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Selected Orders ({selection.selectedItems.filter((o) => (o as unknown as Order).status === "cancelled").length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTargetMode("all_cancelled")}
                    className={`flex-1 py-1.5 rounded-lg transition text-center cursor-pointer ${
                      deleteTargetMode === "all_cancelled"
                        ? "bg-card text-foreground shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All Cancelled Orders ({cancelledOrdersCount})
                  </button>
                </div>
              )}

              {/* Summary Card */}
              <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-900 dark:text-rose-200">Orders to Delete:</span>
                  <span className="font-black text-rose-950 dark:text-rose-100 text-sm">
                    {ordersToDeletePool.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-900 dark:text-rose-200">Total Value:</span>
                  <span className="font-bold text-foreground">
                    {formatPrice(ordersToDeletePool.reduce((sum, o) => sum + Number(o.total || 0), 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-rose-900 dark:text-rose-200">Database Action:</span>
                  <span className="font-semibold text-rose-700 dark:text-rose-400">
                    Hard Cascade Delete (Audit logged)
                  </span>
                </div>
              </div>

              {/* Target Orders Preview */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Orders to be deleted ({ordersToDeletePool.length})
                </label>
                <div className="max-h-28 overflow-y-auto rounded-xl border border-border bg-background p-2.5 flex flex-wrap gap-1.5">
                  {ordersToDeletePool.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No cancelled orders found in this selection.
                    </span>
                  ) : (
                    ordersToDeletePool.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-mono font-medium text-foreground border border-border"
                      >
                        #{o.id.slice(0, 8).toUpperCase()}
                        <span className="text-[10px] text-muted-foreground font-sans">
                          ({formatPrice(Number(o.total))})
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-3.5 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
                <AlertTriangle className="size-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                <span className="leading-relaxed">
                  <strong>Permanent Action:</strong> This will completely remove these cancelled
                  orders, order items, coupon usages, and payment records from the database.
                  Audit logs will be permanently retained in the system security audit table.
                </span>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-border bg-muted/20">
              <button
                type="button"
                disabled={isBulkDeleting}
                onClick={() => setIsDeleteBulkModalOpen(false)}
                className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
              >
                Keep Orders
              </button>

              <button
                type="button"
                disabled={isBulkDeleting || ordersToDeletePool.length === 0}
                onClick={handleExecuteBulkDelete}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 px-4 py-2 text-xs font-bold text-white transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isBulkDeleting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Deleting {ordersToDeletePool.length} Orders…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="size-3.5" />
                    <span>Yes, Permanently Delete {ordersToDeletePool.length} Orders</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
