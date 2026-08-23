//
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/store";
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

import { useState } from "react";

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
  const shipping = subtotal === 0 || subtotal >= 999 ? 0 : 79;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Your bag is empty</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add a few essentials and they'll show up here.
        </p>
        <Link
          to="/shop"
          className="press mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
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
          {items.map(({ product, qty }) => (
            <li key={product.id} className="flex gap-4 rounded-2xl border border-border p-4">
              <ResponsiveMedia
                src={product.image}
                alt={product.name}
                width={800}
                height={800}
                fit="cover"
                aspect="1/1"
                containerClassName="size-24 shrink-0 rounded-xl"
              />
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
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Clear bag
            </button>
          </li>
        </ul>

        <aside className="h-fit rounded-2xl border border-border p-6 lg:sticky lg:top-24">
          <h2 className="font-display text-xl font-bold">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            {savings > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">You save (MRP − our price)</dt>
                <dd className="text-primary">{formatPrice(savings)}</dd>
              </div>
            )}

            {coupon ? (
              <div className="flex items-center justify-between text-green-600">
                <dt className="flex items-center gap-2">
                  Code: {coupon.code}
                  <button
                    onClick={removeCoupon}
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
              className="press mt-6 block w-full rounded-full bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Proceed to checkout
            </Link>
          ) : (
            <>
              <Link
                to="/auth"
                onClick={() => toast.info("Please sign in to place your order")}
                className="press mt-6 block w-full rounded-full bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
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
