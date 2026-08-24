import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAllOrders, orderStatuses, useRetryOrderNotification } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { formatPrice } from "@/lib/store";
import { MailCheck, MailWarning, RotateCcw } from "lucide-react";

export function OnlineSalesTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useAllOrders(true);
  const [filter, setFilter] = useState("all");
  const retryNotification = useRetryOrderNotification();

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

  // Filter out POS orders (historical)
  const onlineOrdersData = (data ?? []).filter((o) => o.notes !== "POS Order");
  const orders = onlineOrdersData.filter((o) => filter === "all" || o.status === filter);
  const revenue = onlineOrdersData
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Online Orders
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">
            {onlineOrdersData.length}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Online Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#8B2020]">
            {formatPrice(revenue)}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Awaiting action
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">
            {
              onlineOrdersData.filter((o) => o.status === "placed" || o.status === "processing")
                .length
            }
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex flex-wrap gap-1.5">
          {["all", "placed", "processing", "packed", "shipped", "delivered", "cancelled"].map(
            (s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-all ${
                  filter === s
                    ? "bg-[#8B2020] text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s}
              </button>
            ),
          )}
        </div>
        <p className="text-xs font-medium text-gray-500">
          Showing {orders.length} of {onlineOrdersData.length} online orders
        </p>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-400">Loading online orders…</div>
      )}

      {!isLoading && orders.length === 0 && (
        <div className="rounded-3xl border border-dashed border-gray-200 p-12 text-center">
          <p className="text-sm font-semibold text-gray-700">No online orders found</p>
          <p className="mt-1 text-xs text-gray-400">
            Online customer checkout orders will appear here automatically.
          </p>
        </div>
      )}

      <ul className="space-y-4">
        {orders.map((order) => (
          <li
            key={order.id}
            className="overflow-hidden rounded-3xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-gray-200"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-gray-900">
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
                <p className="mt-1 text-xs font-medium text-gray-500">
                  {new Date(order.created_at).toLocaleString("en-IN")}
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{order.full_name}</p>
                    <p className="text-sm font-medium text-gray-600 mt-0.5">{order.email}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {order.phone}{" "}
                      {order.alt_phone && <span className="text-xs">/ {order.alt_phone}</span>}
                    </p>
                  </div>
                  <div>
                    <p className="max-w-xs text-sm text-gray-600 leading-relaxed">
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
                <p className="text-xl font-extrabold text-gray-900">
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
                  className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium capitalize outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm text-gray-800 disabled:opacity-50"
                >
                  {orderStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
