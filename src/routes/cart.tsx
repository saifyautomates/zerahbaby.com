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
    shipping,
    eligibleSubtotal,
    isFreeDelivery,
    freeDeliveryMessage,
    amountToFreeDelivery,
  } = useCart();
  const { user } = useSession();
  const [couponInput, setCouponInput] = useState("");
  const [isApplying, setIsApplying] = useState(false);

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
    <div className="mx-auto max-w-7xl px-4 py-10 pb-32 sm:pb-10">
      <h1 className="font-display text-3xl font-bold">Your bag</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <ul className="space-y-4">
          {items.map(({ product, qty }, i) => (
            <li
              key={product.id}
              className="flex flex-col sm:flex-row sm:items-start gap-4 rounded-2xl border border-border/60 p-3 sm:p-4 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both bg-card shadow-premium-sm hover:shadow-premium-md transition-shadow"
              style={{ animationDelay: `${i * 75}ms` }}
            >
              <div className="flex flex-1 gap-3 sm:gap-4">
                <Link
                  to="/product/$id"
                  params={{ id: product.id }}
                  className="size-20 sm:size-24 shrink-0 rounded-xl overflow-hidden bg-muted hover:opacity-90 transition block"
                  title={`View ${product.name}`}
                >
                  <img
                    src={product.image}
                    alt={product.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = imageFor(
                        product.category,
                        null,
                        product,
                      );
                    }}
                    className="w-full h-full object-cover object-center"
                  />
                </Link>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground truncate">
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
                </div>
              </div>

              <div className="flex items-center justify-between sm:flex-col sm:items-end gap-3 sm:gap-4 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-border/40">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5 bg-background shadow-xs">
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
                    <Trash2 className="size-3.5" /> <span className="hidden sm:inline">Remove</span>
                  </button>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground sm:hidden mb-0.5">Total</p>
                  <p className="text-sm font-bold text-foreground">
                    {formatPrice(product.price * qty)}
                  </p>
                </div>
              </div>
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

        <aside className="h-fit rounded-3xl border border-border/60 bg-card p-6 shadow-premium-md lg:sticky lg:top-24">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            Order summary
          </h2>

          <div className="mt-5 space-y-3.5 text-sm">
            {/* Subtotal */}
            <div className="flex justify-between items-center text-foreground">
              <span className="text-muted-foreground font-medium">Subtotal</span>
              <span className="font-semibold tabular-nums text-right">{formatPrice(subtotal)}</span>
            </div>

            {/* You save (positive display, never negative) */}
            {savings > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                  You save
                  <span
                    title={`You save ${formatPrice(savings)} compared with the original MRP value.`}
                    aria-label={`You save ${formatPrice(savings)} compared with original MRP`}
                    className="inline-flex size-4 cursor-help items-center justify-center rounded-full bg-muted/80 text-[11px] font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors select-none"
                  >
                    ⓘ
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-primary text-right">
                  {formatPrice(savings)}
                </span>
              </div>
            )}

            {/* Coupon discount line if applied */}
            {coupon && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                <span className="font-medium flex items-center gap-2">
                  Coupon ({coupon.code})
                  <button
                    type="button"
                    onClick={() => {
                      removeCoupon();
                      setCouponInput("");
                      toast.success("Coupon removed");
                    }}
                    className="text-[11px] font-semibold text-muted-foreground hover:text-destructive underline cursor-pointer"
                  >
                    Remove
                  </button>
                </span>
                <span className="font-semibold tabular-nums text-right">
                  −{formatPrice(coupon.discount)}
                </span>
              </div>
            )}

            {/* Promo Code Input (when no coupon applied) */}
            {!coupon && (
              <div className="pt-1">
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
                    placeholder="PROMO CODE"
                    aria-label="Promo code"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-semibold uppercase tracking-wider outline-none focus:border-primary placeholder:text-muted-foreground/60 transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isApplying || !couponInput.trim()}
                    className="focus-ring press shrink-0 rounded-xl bg-secondary px-4 py-2 text-xs font-bold transition hover:bg-secondary/80 disabled:opacity-50 cursor-pointer"
                  >
                    {isApplying ? "..." : "Apply"}
                  </button>
                </form>
              </div>
            )}

            {/* Delivery Status / Free Delivery Block */}
            <div className="pt-2">
              {isFreeDelivery ? (
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">Delivery</span>
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      FREE
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1.5 border-t border-emerald-500/15 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    <span className="text-base select-none">🎉</span>
                    <span>Free delivery unlocked</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground font-medium pl-6">
                    Delivery within 7 days
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground font-medium">Delivery</span>
                    <span className="font-semibold tabular-nums text-foreground text-right">
                      {formatPrice(shipping)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Delivery within 7 days</p>
                  {freeDeliveryMessage && amountToFreeDelivery > 0 && (
                    <div className="rounded-2xl bg-secondary/50 p-3 border border-border/40 text-xs">
                      <p className="font-medium text-foreground">
                        Add{" "}
                        <strong className="text-primary font-bold">
                          {formatPrice(amountToFreeDelivery)}
                        </strong>{" "}
                        more for <span className="font-bold text-primary">FREE DELIVERY</span> 🎉
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-500 rounded-full"
                          style={{
                            width: `${Math.min(100, (eligibleSubtotal / (eligibleSubtotal + amountToFreeDelivery)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border/60 my-4" />

            {/* TOTAL TO PAY */}
            <div className="flex justify-between items-baseline pt-1">
              <span className="text-sm sm:text-base font-black uppercase tracking-wider text-foreground">
                TOTAL TO PAY
              </span>
              <span className="text-xl sm:text-2xl font-black font-display tracking-tight text-foreground tabular-nums text-right">
                {formatPrice(total)}
              </span>
            </div>
          </div>

          {/* Primary CTA */}
          {user ? (
            <Link
              to="/checkout"
              onClick={(e) => {
                if (isNavigatingRef.current) {
                  e.preventDefault();
                  return;
                }
                isNavigatingRef.current = true;
                setTimeout(() => {
                  isNavigatingRef.current = false;
                }, 2000);
              }}
              className="focus-ring press mt-6 block w-full rounded-full bg-primary py-3.5 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover cursor-pointer"
            >
              Proceed to checkout
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ redirect: "/checkout" }}
                onClick={() => toast.info("Please sign in to place your order")}
                className="focus-ring press mt-6 block w-full rounded-full bg-primary py-3.5 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover cursor-pointer"
              >
                Proceed to checkout
              </Link>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Sign in to quickly complete your order.
              </p>
            </>
          )}

          {/* Secondary Action */}
          <Link
            to="/shop"
            className="mt-3.5 block text-center text-xs font-semibold text-muted-foreground hover:text-primary transition-colors py-1 cursor-pointer"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
