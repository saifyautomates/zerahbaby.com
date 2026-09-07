//
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  Tag,
  TicketPercent,
  Truck,
  CheckCircle2,
  ShieldCheck,
  Undo2,
  BadgeCheck,
  Lock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { formatPrice, imageFor } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";
import { CartPageSkeleton } from "@/components/ui/Skeletons";
import { CartItemCard } from "@/components/site/CartItemCard";

import { productsQueryOptions } from "@/lib/store";

export const Route = createFileRoute("/cart")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(productsQueryOptions(false)).catch(console.error);
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
    isLoading,
  } = useCart();
  const { user } = useSession();
  const [couponInput, setCouponInput] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  // Guard against duplicate checkout navigations from rapid clicking
  const isNavigatingRef = useRef(false);

  if (isLoading) {
    return <CartPageSkeleton />;
  }

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
          {items.map((item) => (
            <CartItemCard
              key={`${item.product.id}-${item.variantId || "default"}`}
              item={item}
              onSetQty={setQty}
              onRemove={remove}
            />
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
          {/* Order Summary Header */}
          <div className="flex items-center gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/5 text-primary border border-primary/10">
              <ShoppingBag className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
                Order Summary
              </h2>
              <p className="text-xs text-muted-foreground">Review your order details</p>
            </div>
          </div>

          <div className="border-t border-border/40 my-5" />

          <div className="space-y-3.5 text-sm">
            {/* Total MRP (Original Value before discount) */}
            {savings > 0 && (
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="font-medium">Total MRP</span>
                <span className="font-semibold tabular-nums text-right line-through">
                  {formatPrice(subtotal + savings)}
                </span>
              </div>
            )}

            {/* MRP Savings Discount */}
            {savings > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400">
                <span className="font-medium flex items-center gap-1.5">
                  <Sparkles className="size-3.5" />
                  MRP Discount
                </span>
                <span className="font-bold tabular-nums text-right">- {formatPrice(savings)}</span>
              </div>
            )}

            {/* Subtotal / Bag Value */}
            <div className="flex justify-between items-center text-foreground font-semibold pt-1 border-t border-border/40">
              <span className="text-foreground font-semibold">Subtotal</span>
              <span className="font-bold tabular-nums text-right">{formatPrice(subtotal)}</span>
            </div>

            {/* Coupon discount line if applied */}
            {coupon && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                <span className="font-medium flex items-center gap-2 text-xs">
                  <TicketPercent className="size-4 text-emerald-600" />
                  Promo Coupon ({coupon.code})
                  <button
                    type="button"
                    onClick={() => {
                      removeCoupon();
                      setCouponInput("");
                      toast.success("Coupon removed");
                    }}
                    className="text-[11px] font-bold text-muted-foreground hover:text-destructive underline cursor-pointer ml-1"
                  >
                    Remove
                  </button>
                </span>
                <span className="font-bold text-xs tabular-nums text-right">
                  - {formatPrice(coupon.discount)}
                </span>
              </div>
            )}

            {/* Delivery Charges */}
            <div className="flex justify-between items-center text-foreground">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Truck className="size-4 text-primary" />
                Delivery Fee
              </span>
              <span
                className={`font-bold tabular-nums text-right ${isFreeDelivery ? "text-emerald-600 font-black uppercase" : ""}`}
              >
                {isFreeDelivery ? "FREE" : `+ ${formatPrice(shipping)}`}
              </span>
            </div>

            {/* Free Delivery Banner / Progress */}
            <div className="pt-1">
              {!isFreeDelivery && amountToFreeDelivery > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-800 dark:text-amber-300">
                    <span>Add {formatPrice(amountToFreeDelivery)} more for FREE Delivery! 🎉</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-amber-500/20">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, Math.round(((subtotal - (coupon?.discount || 0)) / (amountToFreeDelivery + subtotal - (coupon?.discount || 0))) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ) : isFreeDelivery ? (
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Yay! You've unlocked FREE Delivery on this order 🎉
                </div>
              ) : null}
            </div>

            {/* Dashed Divider */}
            <div className="border-t border-dashed border-border/80 my-3" />

            {/* TOTAL TO PAY */}
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <span className="text-base font-bold text-foreground block">Total to pay</span>
                <span className="text-[11px] text-muted-foreground block">
                  Inclusive of all taxes
                </span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black font-display tracking-tight text-foreground tabular-nums block">
                  {formatPrice(total)}
                </span>
                {(savings > 0 || (coupon && coupon.discount > 0)) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 mt-1">
                    <Sparkles className="size-3" />
                    You save {formatPrice(savings + (coupon?.discount || 0))}
                  </span>
                )}
              </div>
            </div>

            {/* Promo Code Input */}
            <div className="pt-2">
              {!coupon ? (
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
                  className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/30 p-1.5 transition-colors focus-within:border-primary/50"
                >
                  <div className="pl-3 text-primary/70">
                    <TicketPercent className="size-5" />
                  </div>
                  <input
                    type="text"
                    placeholder="Enter promo code"
                    aria-label="Promo code"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    className="w-full bg-transparent px-2 py-2 text-sm font-medium outline-none placeholder:text-muted-foreground/60"
                  />
                  <button
                    type="submit"
                    disabled={isApplying || !couponInput.trim()}
                    className="focus-ring press shrink-0 rounded-lg bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isApplying ? "..." : "Apply"}
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          {/* Trust Badges */}
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border/40 my-4">
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-secondary/20 p-3 text-center">
              <ShieldCheck className="size-5 text-primary/70" strokeWidth={1.5} />
              <span className="text-[9px] font-medium leading-tight text-muted-foreground sm:text-[10px]">
                Secure
                <br />
                Checkout
              </span>
            </div>
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-secondary/20 p-3 text-center">
              <Undo2 className="size-5 text-primary/70" strokeWidth={1.5} />
              <span className="text-[9px] font-medium leading-tight text-muted-foreground sm:text-[10px]">
                7 Days
                <br />
                Easy Returns
              </span>
            </div>
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-secondary/20 p-3 text-center">
              <BadgeCheck className="size-5 text-primary/70" strokeWidth={1.5} />
              <span className="text-[9px] font-medium leading-tight text-muted-foreground sm:text-[10px]">
                100% Original
                <br />
                Products
              </span>
            </div>
          </div>

          {/* Primary CTA */}
          <div className="mt-6">
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
                className="focus-ring press flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-4 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover cursor-pointer"
              >
                <Lock className="size-4" strokeWidth={2.5} />
                Proceed to checkout
                <span className="ml-1 text-[10px]">❯</span>
              </Link>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ redirect: "/checkout" }}
                  onClick={() => toast.info("Please sign in to place your order")}
                  className="focus-ring press flex items-center justify-center gap-2 w-full rounded-2xl bg-primary py-4 text-center text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover cursor-pointer"
                >
                  <Lock className="size-4" strokeWidth={2.5} />
                  Proceed to checkout
                  <span className="ml-1 text-[10px]">❯</span>
                </Link>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Sign in to quickly complete your order.
                </p>
              </>
            )}
          </div>

          <div className="relative mt-5 flex items-center py-2">
            <div className="flex-grow border-t border-border/60"></div>
            <span className="mx-4 text-[11px] font-medium uppercase text-muted-foreground/70">
              or
            </span>
            <div className="flex-grow border-t border-border/60"></div>
          </div>

          <div className="mt-2 text-center">
            <Link
              to="/shop"
              className="text-xs font-bold text-primary transition-colors hover:text-primary/80"
            >
              Continue shopping
            </Link>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-secondary/30 py-2.5 px-4">
            <ShieldCheck className="size-3.5 text-primary/70" />
            <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground">
              Your payment details are secure and encrypted
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
