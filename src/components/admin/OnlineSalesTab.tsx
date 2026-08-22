import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAllOrders, orderStatuses } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { formatPrice } from "@/lib/store";

export function OnlineSalesTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useAllOrders(true);
  const [filter, setFilter] = useState("all");

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: any }) => {
      const { error } = await supabase.from("orders").update({ status }).eq("id", id);
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
            {onlineOrdersData.filter((o) => o.status === "placed" || o.status === "pending").length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", ...orderStatuses].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-xl border px-4 py-2 text-xs font-semibold capitalize transition-all ${
              filter === s
                ? "border-[#8B2020] bg-red-50 text-[#8B2020] shadow-sm"
                : "border-gray-200 bg-white text-gray-500 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
        </div>
      )}
      {!isLoading && orders.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-sm font-medium text-gray-500">No online orders here yet.</p>
        </div>
      )}

      <ul className="space-y-4">
        {orders.map((order) => (
          <li
            key={order.id}
            className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-gray-200"
          >
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <p className="text-lg font-extrabold tracking-tight text-gray-900">
                    #{order.id.slice(0, 8).toUpperCase()}
                  </p>
                  <span className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 border border-gray-200">
                    {order.payment_method || "cod"}
                  </span>
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
                {order.notes && (
                  <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3.5 text-sm text-amber-700">
                    <strong>Note:</strong> “{order.notes}”
                  </div>
                )}
                <div className="mt-5 border-t border-gray-100 pt-5">
                  <InvoiceBox order={order as any} />
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
                      status: e.target.value as any,
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
