//
import { Link } from "@tanstack/react-router";
import { Heart, Star } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  discountPct,
  formatPrice,
  imageFor,
  useSettings,
  singleProductQueryOptions,
  type Product,
} from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { trackEvent } from "@/lib/analytics";
import { AdminProductControls } from "@/components/admin/InlineAdmin";
import { LazyImage } from "@/components/ui/LazyImage";
import { ProductCardSkeleton, ProductGridSkeleton } from "@/components/ui/Skeletons";

export { ProductCardSkeleton, ProductGridSkeleton };

export function ProductCard({ product }: { product: Product }) {
  const qc = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const { add } = useCart();
  const { user } = useSession();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = user ? isWishlisted(product.uuid) : false;
  const { settings } = useSettings();

  const featHoverSwap = settings?.["feature_hover_swap"] !== "false";
  const featPromoBadges = settings?.["feature_promo_badges"] !== "false";

  // Prefetch product details on hover for instantaneous navigation
  const handlePrefetch = () => {
    qc.prefetchQuery(singleProductQueryOptions(product.id, false));
  };

  return (
    <article
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className="lift group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card transition-all duration-500 hover:-translate-y-1.5 hover:border-primary/30 hover:shadow-premium-hover"
    >
      <AdminProductControls product={product} />
      <Link
        to="/product/$id"
        params={{ id: product.id }}
        className="focus-ring relative block overflow-hidden bg-muted"
      >
        <div className="relative aspect-square w-full overflow-hidden bg-muted">
          <LazyImage
            src={product.image}
            alt={product.name}
            placeholderSrc={imageFor(product.category, null, product)}
            className={`h-full w-full object-cover object-center ${
              featHoverSwap && product.images && product.images.length > 1
                ? "transition-opacity duration-500 group-hover:opacity-0"
                : "transition-transform duration-700 ease-out group-hover:scale-105"
            }`}
          />
          {/* Second Image Swap on Hover only if multiple distinct images exist */}
          {featHoverSwap && product.images && product.images.length > 1 && (
            <LazyImage
              src={product.images[1]}
              alt={`${product.name} alternate view`}
              className="absolute inset-0 h-full w-full object-cover object-center opacity-0 transition-all duration-500 ease-out group-hover:opacity-100 group-hover:scale-105"
            />
          )}
        </div>

        {/* Promo Floating Badges - Clean & Minimal */}
        {featPromoBadges && (
          <div className="absolute left-3 top-3 z-20 flex flex-col items-start gap-1 pointer-events-none">
            {discountPct(product) > 0 ? (
              <span className="rounded-full bg-primary/95 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-premium-sm backdrop-blur-md">
                {discountPct(product)}% OFF
              </span>
            ) : product.isFeatured ? (
              <span className="rounded-full bg-foreground/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-background shadow-premium-sm backdrop-blur-md">
                Featured
              </span>
            ) : null}
          </div>
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
          className="press absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-background/80 backdrop-blur-md shadow-premium-sm transition-all duration-300 hover:scale-110 hover:bg-background border border-white/20"
        >
          <Heart
            className={`size-4 transition-colors duration-300 ${wishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground hover:text-red-500"}`}
          />
        </button>
      )}

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground/80">
          {product.brand}
        </p>
        <h3 className="mt-1 line-clamp-2 text-xs sm:text-sm font-bold leading-snug break-words">
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
              <span className="font-bold text-foreground">{product.rating}</span>
              <span>({product.reviews.toLocaleString("en-IN")})</span>
            </>
          )}
          <span
            className={`${product.reviews > 0 ? "ml-auto" : ""} rounded-full bg-muted/60 px-2 py-0.5 text-[0.6rem] font-bold text-muted-foreground`}
          >
            {product.ageGroup}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-sm sm:text-base font-bold tracking-tight text-primary">
            {formatPrice(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground/70 line-through">
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
          className={`focus-ring press mt-auto mt-3.5 w-full rounded-full py-2.5 sm:py-3 text-xs sm:text-sm font-bold tracking-wide transition-all duration-300 text-center flex items-center justify-center gap-2 ${
            isAdding
              ? "bg-primary/80 text-primary-foreground/90 scale-95"
              : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-premium-sm hover:shadow-premium-md"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {product.stock === 0 ? "Out of stock" : isAdding ? "Added!" : "Add to bag"}
        </button>
      </div>
    </article>
  );
}
