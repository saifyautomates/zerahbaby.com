//
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useProducts, formatPrice } from "@/lib/store";
import { useSession, useIsAdmin } from "@/lib/auth";
import { useMyOrders, useCancelCustomerOrder, isOrderCancellable, type Order } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { ReviewModal } from "@/components/site/ReviewModal";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My Orders — Zerah Baby And Kid's" },
      { name: "description", content: "Track the status of your Zerah Baby And Kid's orders." },
      { property: "og:title", content: "My Orders — Zerah Baby And Kid's" },
      { property: "og:description", content: "Track your Zerah Baby And Kid's orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

const CANCELLATION_REASONS = [
  "Changed my mind",
  "Ordered by mistake",
  "Found a different product / cheaper alternative",
  "Delivery taking too long",
  "Incorrect shipping address",
  "Other",
];

const statusColors: Record<string, string> = {
  pending: "bg-secondary text-secondary-foreground",
  processing: "bg-blue-100 text-blue-800 border border-blue-200",
  shipped: "bg-blue-100 text-blue-800 border border-blue-200",
  out_for_delivery: "bg-blue-100 text-blue-800 border border-blue-200",
  delivered: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  cancelled: "bg-destructive/15 text-destructive border border-destructive/20",
};

function OrdersPage() {
  const { user } = useSession();
  const { data: orders, isLoading } = useMyOrders(user?.id);
  const { data: products } = useProducts();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [reviewingProduct, setReviewingProduct] = useState<{
    product: { id: string; uuid: string; name: string; image?: string; brand?: string };
    orderId: string;
  } | null>(null);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">My Orders</h1>
        {orders && orders.length > 0 && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            {orders.length} order{orders.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (orders ?? []).length === 0 && (
        <div className="mt-10 rounded-2xl border border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">You haven't placed an order yet.</p>
          <Link
            to="/shop"
            className="mt-4 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Start shopping
          </Link>
        </div>
      )}

      <ul className="mt-8 space-y-5">
        {(orders ?? []).map((order) => {
          const cancellable = isOrderCancellable(order.status);
          const isCancelled = order.status === "cancelled";

          return (
            <li
              key={order.id}
              className={`rounded-2xl border p-5 transition-all ${
                isCancelled ? "border-border/60 bg-muted/20 opacity-90" : "border-border bg-card"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">#{order.id.slice(0, 8).toUpperCase()}</p>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase text-muted-foreground">
                      {order.payment_method || "cod"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(order.created_at).toLocaleString("en-IN")}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                      statusColors[order.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {order.status.replace(/_/g, " ")}
                  </span>

                  {cancellable && (
                    <button
                      type="button"
                      onClick={() => setCancellingOrder(order)}
                      className="rounded-full border border-destructive/30 bg-destructive/5 px-3 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive hover:text-destructive-foreground focus:outline-none focus:ring-2 focus:ring-destructive/40"
                    >
                      Cancel Order
                    </button>
                  )}
                </div>
              </div>

              {/* Status Timeline */}
              <OrderTimeline orderId={order.id} />

              {/* Cancellation & Refund Alert Banner */}
              {isCancelled && (
                <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs">
                  <p className="font-semibold text-destructive">
                    Order Cancelled
                    {order.cancelled_at &&
                      ` on ${new Date(order.cancelled_at).toLocaleString("en-IN")}`}
                  </p>
                  {order.cancellation_reason && (
                    <p className="mt-0.5 text-muted-foreground">
                      Reason: “{order.cancellation_reason}”
                    </p>
                  )}
                  {order.payment_status === "paid" && (
                    <p className="mt-1 font-medium text-amber-700">
                      Payment was completed online. Your refund will be credited to your original
                      payment method in 5-7 business days.
                    </p>
                  )}
                </div>
              )}

              <ul className="mt-4 space-y-3">
                {order.order_items.map((item) => {
                  const product = products?.find((p) => p.id === item.product_slug);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/20 border border-border/50"
                    >
                      <Link
                        to="/product/$id"
                        params={{ id: item.product_slug }}
                        className="group flex flex-1 items-center gap-4 min-w-0"
                      >
                        {product ? (
                          <img
                            src={product.image}
                            alt={item.name}
                            className="size-14 rounded-xl border border-border object-cover transition-opacity group-hover:opacity-80 shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity = "0";
                            }}
                          />
                        ) : (
                          <div className="size-14 rounded-xl border border-border bg-muted transition-opacity group-hover:opacity-80 shrink-0" />
                        )}
                        <div className="flex flex-1 flex-col justify-center min-w-0">
                          <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary truncate">
                            {item.name}
                          </span>
                          <span className="mt-0.5 text-xs text-muted-foreground">
                            Qty: {item.qty} · {formatPrice(Number(item.price))} each
                          </span>
                        </div>
                      </Link>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                        <div className="text-sm font-bold">
                          {formatPrice(Number(item.price) * item.qty)}
                        </div>

                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => {
                              const prodObj = product
                                ? {
                                    id: product.id,
                                    uuid: product.uuid,
                                    name: product.name,
                                    image: product.image,
                                    brand: product.brand,
                                  }
                                : {
                                    id: item.product_slug,
                                    uuid: item.product_slug,
                                    name: item.name,
                                    image: item.image_url ?? undefined,
                                  };
                              setReviewingProduct({ product: prodObj, orderId: order.id });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#8B2020]/30 bg-red-50/50 text-[#8B2020] text-xs font-bold hover:bg-[#8B2020] hover:text-white transition cursor-pointer shadow-2xs"
                          >
                            <Star className="size-3.5 fill-current" />
                            <span>Rate & Review</span>
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <InvoiceBox order={order} />
                <p className="ml-auto text-sm font-bold">
                  Total {formatPrice(Number(order.total))}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Cancellation Confirmation Dialog */}
      {cancellingOrder && (
        <CancelOrderModal order={cancellingOrder} onClose={() => setCancellingOrder(null)} />
      )}

      {/* Review Modal Dialog */}
      {reviewingProduct && (
        <ReviewModal
          product={reviewingProduct.product}
          user={user}
          orderId={reviewingProduct.orderId}
          onClose={() => setReviewingProduct(null)}
        />
      )}
    </div>
  );
}

function CancelOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const [selectedReason, setSelectedReason] = useState(CANCELLATION_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const cancelOrder = useCancelCustomerOrder();

  const isOther = selectedReason === "Other";
  const finalReason = isOther
    ? customReason.trim() || "Other reason specified by customer"
    : selectedReason;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (cancelOrder.isPending) return;

    try {
      await cancelOrder.mutateAsync({
        orderId: order.id,
        reason: finalReason,
      });
      toast.success("Your order has been cancelled.");
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error).message || "Failed to cancel order";
      toast.error(msg);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="cancel-modal-title" className="font-display text-xl font-bold text-foreground">
              Cancel Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Orders can be cancelled before shipment. Items will be returned to stock.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={cancelOrder.isPending}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleConfirm} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="cancel-reason-select"
              className="block text-xs font-semibold text-foreground"
            >
              Reason for cancellation (optional)
            </label>
            <select
              id="cancel-reason-select"
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              disabled={cancelOrder.isPending}
              className="mt-2 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            >
              {CANCELLATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {isOther && (
            <div>
              <label
                htmlFor="custom-reason-input"
                className="block text-xs font-semibold text-foreground"
              >
                Please tell us more
              </label>
              <textarea
                id="custom-reason-input"
                rows={2}
                required
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Why would you like to cancel?"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          )}

          {order.payment_status === "paid" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Refund Notice:</strong> Since this order was paid online, your payment of{" "}
              {formatPrice(Number(order.total))} will be automatically refunded to your original
              payment method within 5-7 business days.
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={cancelOrder.isPending}
              className="rounded-full border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              Keep Order
            </button>
            <button
              type="submit"
              disabled={cancelOrder.isPending}
              className="inline-flex items-center justify-center rounded-full bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50"
            >
              {cancelOrder.isPending ? "Cancelling…" : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderTimeline({ orderId }: { orderId: string }) {
  const { data: history } = useQuery({
    queryKey: ["order-history", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!history || history.length === 0) return null;

  return (
    <div className="mt-3 mb-1">
      <details className="group">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-primary transition">
          Order timeline ({history.length} update{history.length > 1 ? "s" : ""})
        </summary>
        <ol className="mt-2 ml-2 space-y-2 border-l-2 border-border pl-4">
          {history.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[1.35rem] top-1 size-2 rounded-full bg-primary" />
              <p className="text-xs font-semibold capitalize">{h.new_status?.replace(/_/g, " ")}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(h.created_at).toLocaleString("en-IN")}
                {h.note ? ` — ${h.note}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
