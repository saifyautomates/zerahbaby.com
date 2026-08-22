//
import { Link } from "@tanstack/react-router";
import { Heart, Star } from "lucide-react";
import { toast } from "sonner";
import { discountPct, formatPrice, type Product } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { trackEvent } from "@/lib/analytics";
import { AdminProductControls } from "@/components/admin/InlineAdmin";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";

export function ProductCard({ product }: { product: Product }) {
  const { add } = useCart();
  const { user } = useSession();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = user ? isWishlisted(product.uuid) : false;

  return (
    <article className="lift group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/30">
      <AdminProductControls product={product} />
      <Link
        to="/product/$id"
        params={{ id: product.id }}
        className="focus-ring relative block overflow-hidden bg-muted"
      >
        <ResponsiveMedia
          src={product.image}
          alt={product.name}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          width={800}
          height={800}
          fit="cover"
          aspect="1/1"
          containerClassName="w-full"
          className="transition-transform duration-300 ease-out group-hover:scale-[1.06]"
        />
        {discountPct(product) > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground">
            {discountPct(product)}% off
          </span>
        )}
      </Link>
      {user && (
        <button
          onClick={(e) => {
            e.preventDefault();
            toggle(product.uuid);
            trackEvent(wishlisted ? "wishlist_remove" : "wishlist_add", {
              productId: product.uuid,
            });
            toast.success(wishlisted ? "Removed from wishlist" : "Added to wishlist");
          }}
          aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
          className="press absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-background/80 backdrop-blur transition hover:bg-background hover:scale-110"
        >
          <Heart
            className={`size-4 transition ${wishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground"}`}
          />
        </button>
      )}

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {product.brand}
        </p>
        <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
          <Link
            to="/product/$id"
            params={{ id: product.id }}
            className="transition hover:text-primary"
          >
            {product.name}
          </Link>
        </h3>

        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="size-3.5 fill-accent text-accent" />
          <span className="font-semibold text-foreground">{product.rating}</span>
          <span>({product.reviews.toLocaleString("en-IN")})</span>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.6rem] font-semibold">
            {product.ageGroup}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-base font-bold tracking-tight">
            {formatPrice(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-xs text-muted-foreground line-through">
              {formatPrice(product.mrp)}
            </span>
          )}
        </div>

        <button
          disabled={product.stock === 0}
          onClick={() => {
            if (product.stock === 0) return;
            add(product.id);
            trackEvent("add_to_cart", { productId: product.uuid });
            toast.success("Added to bag", { description: product.name });
          }}
          className="focus-ring press mt-4 w-full rounded-full bg-primary py-2.5 text-sm font-semibold tracking-wide text-primary-foreground transition duration-300 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {product.stock === 0 ? "Out of stock" : "Add to bag"}
        </button>
      </div>
    </article>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-80 animate-pulse rounded-2xl border border-border bg-muted/50" />
      ))}
    </div>
  );
}
