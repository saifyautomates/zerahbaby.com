// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { useProducts, formatPrice, discountPct } from "@/lib/store";
import { useCart } from "@/lib/cart";

export const Route = createFileRoute("/_authenticated/wishlist")({
  head: () => ({
    meta: [
      { title: "My Wishlist — Zerah Baby And Kids" },
      { name: "description", content: "Your saved products at Zerah Baby And Kids." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WishlistPage,
});

function WishlistPage() {
  const { user } = useSession();
  const { productIds, remove } = useWishlist();
  const { data: products } = useProducts();
  const { add } = useCart();

  const wishlistedProducts = (products ?? []).filter((p) => productIds.includes(p.uuid));

  if (wishlistedProducts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <Heart className="mx-auto size-12 text-muted-foreground" />
        <h1 className="mt-4 font-display text-3xl font-bold">Your wishlist is empty</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tap the heart on any product to save it here.
        </p>
        <Link
          to="/shop"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">My wishlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {wishlistedProducts.length} saved product{wishlistedProducts.length !== 1 ? "s" : ""}
      </p>

      <ul className="mt-8 space-y-4">
        {wishlistedProducts.map((product) => (
          <li key={product.uuid} className="flex gap-4 rounded-2xl border border-border p-4">
            <Link to="/product/$id" params={{ id: product.id }}>
              <img
                src={product.image}
                alt={product.name}
                loading="lazy"
                className="size-24 shrink-0 rounded-xl object-cover transition hover:opacity-80"
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
                  className="transition hover:text-primary"
                >
                  {product.name}
                </Link>
              </h2>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-base font-bold">{formatPrice(product.price)}</span>
                {product.mrp > product.price && (
                  <>
                    <span className="text-xs text-muted-foreground line-through">
                      {formatPrice(product.mrp)}
                    </span>
                    <span className="text-xs font-bold text-primary">
                      {discountPct(product)}% off
                    </span>
                  </>
                )}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => {
                    add(product.id);
                    toast.success("Added to bag", { description: product.name });
                  }}
                  className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                  Add to bag
                </button>
                <button
                  onClick={() => {
                    remove.mutate(product.uuid);
                    toast.success("Removed from wishlist");
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
