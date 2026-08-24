import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  useAllOrders,
  orderStatuses,
  useRetryOrderNotification,
  useDeleteCancelledOrder,
  type Order,
} from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { formatPrice } from "@/lib/store";
import { MailCheck, MailWarning, RotateCcw, Trash2, AlertTriangle, X, Loader2 } from "lucide-react";

export function OnlineSalesTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useAllOrders(true);
  const [filter, setFilter] = useState("all");
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

  const retryNotification = useRetryOrderNotification();
  const deleteOrder = useDeleteCancelledOrder();

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("orders")
        .update({ status: status as any })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order updated");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleConfirmDelete() {
    if (!orderToDelete) return;
    try {
      await deleteOrder.mutateAsync(orderToDelete.id);
      setOrderToDelete(null);
    } catch {
      // Error toast already triggered in useDeleteCancelledOrder
    }
  }

  // Filter out POS orders (historical)
  const onlineOrdersData = (data ?? []).filter((o) => o.notes !== "POS Order");

  // Helper to test if an order was placed within the last 24 hours
  const isWithinLast24Hours = (createdAt: string) => {
    const orderTime = new Date(createdAt).getTime();
    const now = Date.now();
    return !isNaN(orderTime) && now - orderTime <= 24 * 60 * 60 * 1000;
  };

  const newOrders24hCount = onlineOrdersData.filter((o) =>
    isWithinLast24Hours(o.created_at),
  ).length;

  const orders = onlineOrdersData.filter((o) => {
    if (filter === "new_orders") {
      return isWithinLast24Hours(o.created_at);
    }
    if (filter === "all") return true;
    return o.status === filter;
  });

  const revenue = onlineOrdersData
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

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

        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Online Orders
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {onlineOrdersData.length}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Online Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#8B2020]">
            {formatPrice(revenue)}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Awaiting action
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {
              onlineOrdersData.filter((o) => o.status === "placed" || o.status === "processing")
                .length
            }
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* New Orders (24h) Filter Button before 'All' */}
          <button
            type="button"
            onClick={() => setFilter("new_orders")}
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

          {["all", "placed", "processing", "packed", "shipped", "delivered", "cancelled"].map(
            (s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer ${
                  filter === s
                    ? "bg-[#8B2020] text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ),
          )}
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          Showing {orders.length} of {onlineOrdersData.length} online orders
          {filter === "new_orders" && " (placed in last 24 hours)"}
        </p>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-400">Loading online orders…</div>
      )}

      {!isLoading && orders.length === 0 && (
        <div className="rounded-3xl border border-dashed border-border p-12 text-center">
          <p className="text-sm font-semibold text-muted-foreground">No online orders found</p>
          <p className="mt-1 text-xs text-gray-400">
            Online customer checkout orders will appear here automatically.
          </p>
        </div>
      )}

      <ul className="space-y-4">
        {orders.map((order) => (
          <li
            key={order.id}
            className="overflow-hidden rounded-3xl border border-gray-100 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-border"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-foreground">
                    #{order.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="rounded-full bg-red-50 text-[#8B2020] border border-red-100 px-2.5 py-0.5 text-xs font-semibold capitalize">
                    {order.status}
                  </span>
                  {order.payment_status && (
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
                        onClick={() => retryNotification.mutate(order.id)}
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
                    <p className="text-sm font-bold text-foreground">{order.full_name}</p>
                    <p className="text-sm font-medium text-muted-foreground mt-0.5">
                      {order.email}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {order.phone}{" "}
                      {order.alt_phone && <span className="text-xs">/ {order.alt_phone}</span>}
                    </p>
                  </div>
                  <div>
                    <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
                      {order.address}
                      {order.address_line2 ? `, ${order.address_line2}` : ""}
                      {order.landmark ? `, near ${order.landmark}` : ""}
                      <br />
                      {[order.city, order.state, order.pincode].filter(Boolean).length
                        ? `${[order.city, order.state, order.pincode].filter(Boolean).join(", ")}`
                        : ""}
                    </p>
                  </div>
                </div>

                {order.status === "cancelled" && (
                  <div className="mt-4 rounded-xl bg-red-50 border border-red-100 p-3.5 text-xs text-red-800">
                    <p className="font-bold text-red-900">
                      Order Cancelled
                      {order.cancelled_at &&
                        ` on ${new Date(order.cancelled_at).toLocaleString("en-IN")}`}
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
                <div className="mt-5 border-t border-gray-100 pt-5">
                  <InvoiceBox order={order} />
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

                {/* Secure Admin Delete Action for Cancelled Orders Only */}
                {order.status === "cancelled" && (
                  <button
                    type="button"
                    onClick={() => setOrderToDelete(order)}
                    className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 hover:text-rose-900 hover:border-rose-300 shadow-sm"
                  >
                    <Trash2 className="size-3.5" />
                    Delete Permanently
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

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
    </div>
  );
}
