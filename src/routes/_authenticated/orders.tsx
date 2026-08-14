import { createFileRoute, Link } from "@tanstack/react-router";
import { formatPrice } from "@/lib/store";
import { useSession } from "@/lib/auth";
import { useMyOrders } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My Orders — Zerah Baby And Kids" },
      { name: "description", content: "Track the status of your Zerah Baby And Kids orders." },
      { property: "og:title", content: "My Orders — Zerah Baby And Kids" },
      { property: "og:description", content: "Track your Zerah Baby And Kids orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const { user } = useSession();
  const { data: orders, isLoading } = useMyOrders(user?.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">My orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>

      {isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (orders ?? []).length === 0 && (
        <div className="mt-10 rounded-2xl border border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">You haven't placed an order yet.</p>
          <Link to="/shop" className="mt-4 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">
            Start shopping
          </Link>
        </div>
      )}

      <ul className="mt-8 space-y-4">
        {(orders ?? []).map((order) => (
          <li key={order.id} className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("en-IN")}</p>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold capitalize text-secondary-foreground">
                {order.status}
              </span>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {order.order_items.map((item) => (
                <li key={item.id} className="flex justify-between">
                  <span className="text-muted-foreground">
                    {item.name} × {item.qty}
                  </span>
                  <span>{formatPrice(Number(item.price) * item.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <InvoiceBox order={order} />
              <p className="text-sm font-bold">Total {formatPrice(Number(order.total))}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
