//
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useProducts, formatPrice } from "@/lib/store";
import { useSession, useIsAdmin } from "@/lib/auth";
import { useMyOrders } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
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

function OrdersPage() {
  const { user } = useSession();
  const { data: isAdmin } = useIsAdmin(user?.id);
  const { data: orders, isLoading } = useMyOrders(user?.id);
  const { data: products } = useProducts();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">My orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

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

      <ul className="mt-8 space-y-4">
        {(orders ?? []).map((order) => (
          <li key={order.id} className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
              <div>
                <p className="text-sm font-semibold">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold capitalize text-secondary-foreground">
                {order.status}
              </span>
            </div>

            {/* Status Timeline */}
            <OrderTimeline orderId={order.id} />

            <ul className="mt-4 space-y-4">
              {order.order_items.map((item) => {
                const product = products?.find((p) => p.id === item.product_slug);
                return (
                  <li key={item.id} className="flex gap-4">
                    <Link
                      to="/product/$id"
                      params={{ id: item.product_slug }}
                      className="group flex flex-1 gap-4"
                    >
                      {product ? (
                        <img
                          src={product.image}
                          alt={item.name}
                          className="size-16 rounded-xl border border-border object-cover transition-opacity group-hover:opacity-80"
                        />
                      ) : (
                        <div className="size-16 rounded-xl border border-border bg-muted transition-opacity group-hover:opacity-80" />
                      )}
                      <div className="flex flex-1 flex-col justify-center">
                        <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                          {item.name}
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          Qty: {item.qty} · {formatPrice(Number(item.price))} each
                        </span>
                      </div>
                    </Link>
                    <div className="flex items-center text-sm font-semibold">
                      {formatPrice(Number(item.price) * item.qty)}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              {isAdmin && <InvoiceBox order={order} />}
              <p className="ml-auto text-sm font-bold">Total {formatPrice(Number(order.total))}</p>
            </div>
          </li>
        ))}
      </ul>
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
              <p className="text-xs font-semibold capitalize">{h.status?.replace(/_/g, " ")}</p>
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
