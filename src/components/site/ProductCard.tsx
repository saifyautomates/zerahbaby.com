//
import { Link } from "@tanstack/react-router";
import { Heart, Star } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { discountPct, formatPrice, type Product } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { trackEvent } from "@/lib/analytics";
import { AdminProductControls } from "@/components/admin/InlineAdmin";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";

export function ProductCard({ product }: { product: Product }) {
  const [isAdding, setIsAdding] = useState(false);
  const { add } = useCart();
  const { user } = useSession();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = user ? isWishlisted(product.uuid) : false;

  return (
    <article className="lift group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card transition-all duration-500 hover:-translate-y-1.5 hover:border-primary/30 hover:shadow-premium-hover">
      <AdminProductControls product={product} />
      <Link
        to="/product/$id"
        params={{ id: product.id }}
        className="focus-ring relative block overflow-hidden bg-muted"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 mix-blend-multiply" />
        <ResponsiveMedia
          src={product.image}
          alt={product.name}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          width={800}
          height={800}
          fit="cover"
          aspect="1/1"
          containerClassName="w-full"
          className="transition-transform duration-700 ease-out group-hover:scale-[1.08]"
        />
        {discountPct(product) > 0 && (
          <span className="absolute left-3 top-3 rounded-full bg-destructive/90 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
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
          className="press absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-white/90 backdrop-blur-md shadow-premium-sm transition-all duration-300 hover:scale-110 hover:bg-white"
        >
          <Heart
            className={`size-4 transition-colors duration-300 ${wishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground group-hover/btn:text-red-400"}`}
          />
        </button>
      )}

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
          {product.brand}
        </p>
        <h3 className="mt-1 line-clamp-2 text-xs sm:text-sm font-semibold leading-snug">
          <Link
            to="/product/$id"
            params={{ id: product.id }}
            className="transition hover:text-primary"
          >
            {product.name}
          </Link>
        </h3>

        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
          {product.reviews > 0 && (
            <>
              <Star className="size-3.5 fill-accent text-accent" />
              <span className="font-semibold text-foreground">{product.rating}</span>
              <span>({product.reviews.toLocaleString("en-IN")})</span>
            </>
          )}
          <span
            className={`${product.reviews > 0 ? "ml-auto" : ""} rounded-full bg-muted px-2 py-0.5 text-[0.6rem] font-semibold`}
          >
            {product.ageGroup}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-sm sm:text-base font-bold tracking-tight">
            {formatPrice(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[10px] sm:text-xs text-muted-foreground line-through">
              {formatPrice(product.mrp)}
            </span>
          )}
        </div>

        <button
          disabled={product.stock === 0 || isAdding}
          onClick={() => {
            if (product.stock === 0 || isAdding) return;
            setIsAdding(true);
            add(product.id);
            trackEvent("add_to_cart", { productId: product.uuid });
            toast.success("Added to bag", { description: product.name });
            setTimeout(() => setIsAdding(false), 500);
          }}
          className="focus-ring press mt-auto pt-4 w-full"
        >
          <div
            className={`w-full rounded-full py-2.5 sm:py-3 text-xs sm:text-sm font-bold tracking-wide transition-all duration-300 text-center flex items-center justify-center gap-2 ${isAdding ? "bg-primary/80 text-primary-foreground/90 scale-95" : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-premium-sm hover:shadow-premium-md"} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {product.stock === 0 ? "Out of stock" : isAdding ? "Added!" : "Add to bag"}
          </div>
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
