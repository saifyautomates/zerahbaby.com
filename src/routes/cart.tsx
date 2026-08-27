//
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatPrice, imageFor } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";

import { productsQueryOptions } from "@/lib/store";

export const Route = createFileRoute("/cart")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(productsQueryOptions(false)).catch(() => null);
  },
  head: () => ({
    meta: [
      { title: "Your Shopping Bag — Zerah Baby And Kid's" },
      {
        name: "description",
        content:
          "Review the baby essentials in your Zerah Baby And Kid's bag and check out securely.",
      },
      { property: "og:title", content: "Your Shopping Bag — Zerah Baby And Kid's" },
      {
        property: "og:description",
        content: "Review your baby essentials and check out securely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartPage,
});

import { useState, useRef } from "react";

/** Single source of truth for the free-delivery threshold */
const FREE_DELIVERY_THRESHOLD = 999;
/** Flat delivery fee below the free-delivery threshold */
const DELIVERY_FEE = 79;

function CartPage() {
  const {
    items,
    subtotal,
    savings,
    total,
    coupon,
    applyCoupon,
    removeCoupon,
    setQty,
    remove,
    clear,
  } = useCart();
  const { user } = useSession();
  const [couponInput, setCouponInput] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  // Shipping is free when cart is empty, subtotal meets threshold, or all items have free delivery
  const maxItemShipping = items.reduce(
    (max, i) =>
      Math.max(max, i.product.deliveryFee !== undefined ? i.product.deliveryFee : DELIVERY_FEE),
    0,
  );
  const shipping = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : maxItemShipping;
  // Guard against duplicate checkout navigations from rapid clicking
  const isNavigatingRef = useRef(false);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center animate-in fade-in zoom-in-95 duration-500">
        <div className="mb-6 mx-auto grid size-24 place-items-center rounded-full bg-primary/10">
          <Trash2 className="size-10 text-primary" />
        </div>
        <h1 className="font-display text-3xl font-bold">Your bag is empty</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add a few essentials and they'll show up here.
        </p>
        <Link
          to="/shop"
          className="focus-ring press mt-8 inline-block rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground shadow-premium-md transition-all hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Your bag</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <ul className="space-y-4">
          {items.map(({ product, qty }, i) => (
            <li
              key={product.id}
              className="flex gap-4 rounded-2xl border border-border p-4 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
              style={{ animationDelay: `${i * 75}ms` }}
            >
              <Link
                to="/product/$id"
                params={{ id: product.id }}
                className="size-24 shrink-0 rounded-xl overflow-hidden bg-muted hover:opacity-90 transition block"
                title={`View ${product.name}`}
              >
                <img
                  src={product.image}
                  alt={product.name}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = imageFor(product.category, null, product);
                  }}
                  className="w-full h-full object-cover object-center"
                />
              </Link>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {product.brand}
                </p>
                <h2 className="text-sm font-semibold">
                  <Link
                    to="/product/$id"
                    params={{ id: product.id }}
                    className="hover:text-primary"
                  >
                    {product.name}
                  </Link>
                </h2>
                <p className="mt-1 text-sm font-bold">{formatPrice(product.price)}</p>

                <div className="mt-3 flex items-center gap-4">
                  <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5">
                    <button
                      onClick={() => setQty(product.id, qty - 1)}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                    <button
                      disabled={qty >= product.stock}
                      onClick={() => {
                        if (qty >= product.stock) {
                          toast.error("Max stock reached");
                          return;
                        }
                        setQty(product.id, qty + 1);
                      }}
                      aria-label="Increase quantity"
                      className="disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => remove(product.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </button>
                </div>
              </div>
              <p className="text-sm font-bold">{formatPrice(product.price * qty)}</p>
            </li>
          ))}
          <li>
            <button
              onClick={clear}
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-destructive transition-colors underline decoration-border underline-offset-4"
            >
              Clear bag
            </button>
          </li>
        </ul>

        <aside className="h-fit rounded-3xl border border-border/60 bg-card p-6 shadow-premium-sm lg:sticky lg:top-24">
          {/* Free Shipping Progress Bar */}
          <div className="mb-6 rounded-2xl bg-secondary/50 p-4 border border-border/40">
            {subtotal >= FREE_DELIVERY_THRESHOLD ? (
              <div className="flex items-center gap-2 text-xs font-bold text-green-600">
                <span>🎉</span>
                <span>
                  You've unlocked <strong>FREE Delivery</strong> across India!
                </span>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Add{" "}
                  <strong className="text-primary">
                    {formatPrice(FREE_DELIVERY_THRESHOLD - subtotal)}
                  </strong>{" "}
                  more to get <strong>FREE Delivery</strong>!
                </p>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-500 rounded-full"
                    style={{
                      width: `${Math.min(100, (subtotal / FREE_DELIVERY_THRESHOLD) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <h2 className="font-display text-xl font-bold">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            {savings > 0 && (
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground flex items-center gap-1.5">
                  You save
                  {/* Tooltip: explains how savings are calculated without cluttering the label */}
                  <span
                    title="Savings = MRP minus our selling price, across all items in your bag"
                    aria-label="Savings = MRP minus our selling price"
                    className="inline-flex size-4 cursor-help items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors select-none"
                  >
                    ?
                  </span>
                </dt>
                <dd className="text-primary font-semibold">−{formatPrice(savings)}</dd>
              </div>
            )}

            {coupon ? (
              <div className="flex items-center justify-between text-green-600">
                <dt className="flex items-center gap-2">
                  Code: {coupon.code}
                  <button
                    onClick={() => {
                      removeCoupon();
                      setCouponInput("");
                      toast.success("Coupon removed");
                    }}
                    className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-destructive underline"
                  >
                    Remove
                  </button>
                </dt>
                <dd>−{formatPrice(coupon.discount)}</dd>
              </div>
            ) : (
              <div className="pt-2">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!couponInput.trim()) return;
                    setIsApplying(true);
                    try {
                      await applyCoupon(couponInput.trim());
                      toast.success("Coupon applied!");
                      setCouponInput("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Invalid coupon");
                    } finally {
                      setIsApplying(false);
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    placeholder="Promo code"
                    aria-label="Promo code"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm uppercase outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={isApplying || !couponInput.trim()}
                    className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-semibold transition hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {isApplying ? "..." : "Apply"}
                  </button>
                </form>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>{shipping === 0 ? "Free" : formatPrice(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatPrice(total + shipping)}</dd>
            </div>
          </dl>
          {user ? (
            <Link
              to="/checkout"
              onClick={(e) => {
                if (isNavigatingRef.current) {
                  e.preventDefault();
                  return;
                }
                isNavigatingRef.current = true;
                // Reset after 2s in case navigation is cancelled
                setTimeout(() => {
                  isNavigatingRef.current = false;
                }, 2000);
              }}
              className="focus-ring press mt-6 block w-full rounded-full bg-primary py-3.5 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover"
            >
              Proceed to checkout
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ redirect: "/checkout" }}
                onClick={() => toast.info("Please sign in to place your order")}
                className="focus-ring press mt-6 block w-full rounded-full bg-primary py-3.5 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover"
              >
                Sign in to check out
              </Link>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Your bag is saved — you'll come right back here.
              </p>
            </>
          )}
          <Link
            to="/shop"
            className="mt-3 block text-center text-sm text-muted-foreground hover:text-primary"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
