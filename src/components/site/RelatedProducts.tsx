import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ChevronLeft, ChevronRight, Star, Heart } from "lucide-react";
import { discountPct, formatPrice, useProducts, type Product } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useWishlist } from "@/lib/wishlist";
import { LazyImage } from "@/components/ui/LazyImage";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";

interface RelatedProductsProps {
  currentProduct: Product;
  title?: string;
  subtitle?: string;
  limit?: number;
  className?: string;
}

export function RelatedProducts({
  currentProduct,
  title,
  subtitle,
  limit = 6,
  className = "",
}: RelatedProductsProps) {
  const [mounted, setMounted] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: allProducts = [] } = useProducts();

  // Intelligent relevance sorting algorithm
  const related = useMemo(() => {
    if (!currentProduct || !allProducts.length) return [];

    // Filter only customer-eligible active online products, excluding current product
    const candidates = allProducts.filter(
      (p) =>
        p.id !== currentProduct.id &&
        p.uuid !== currentProduct.uuid &&
        p.isActive !== false &&
        p.salesChannel !== "OFFLINE_ONLY",
    );

    // Score candidates based on multi-factor relevance
    const scored = candidates.map((p) => {
      let score = 0;

      // 1. Category match (Highest weight)
      if (
        p.category &&
        currentProduct.category &&
        p.category.toLowerCase() === currentProduct.category.toLowerCase()
      ) {
        score += 50;
      }

      // 2. Brand / Collection match
      if (
        p.brand &&
        currentProduct.brand &&
        p.brand.toLowerCase() === currentProduct.brand.toLowerCase()
      ) {
        score += 25;
      }

      // 3. Similar age group match
      if (p.ageGroup && currentProduct.ageGroup && p.ageGroup === currentProduct.ageGroup) {
        score += 15;
      }

      // 4. Price affinity (within 35% range)
      if (currentProduct.price > 0 && p.price > 0) {
        const priceRatio = p.price / currentProduct.price;
        if (priceRatio >= 0.65 && priceRatio <= 1.35) {
          score += 10;
        }
      }

      // 5. In-stock priority
      if (p.stock > 0) {
        score += 20;
      }

      // 6. Rating / Popularity
      if (p.rating >= 4.5) {
        score += 5;
      }

      return { product: p, score };
    });

    // Sort by descending relevance score, then by sortOrder
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.product.sortOrder ?? 0) - (b.product.sortOrder ?? 0);
    });

    return scored.slice(0, limit).map((s) => s.product);
  }, [allProducts, currentProduct, limit]);

  // Check scroll capability for navigation arrows on mobile/touch carousel
  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [related]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const offset = scrollContainerRef.current.clientWidth * 0.75;
    scrollContainerRef.current.scrollBy({
      left: direction === "left" ? -offset : offset,
      behavior: "smooth",
    });
  };

  if (!mounted || related.length === 0) return null;

  const sectionTitle =
    title || (currentProduct.category ? `More in ${currentProduct.category}` : "You May Also Like");

  const sectionSubtitle =
    subtitle || "Curated complementary picks and popular essentials for little ones";

  return (
    <section
      aria-label="Related products"
      className={`mt-14 sm:mt-20 pt-10 border-t border-border/60 ${className}`}
    >
      {/* Header with Visual Distinction */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary mb-1.5">
            <Sparkles className="size-3.5" />
            <span>Complete The Look</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            {sectionTitle}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-xl">
            {sectionSubtitle}
          </p>
        </div>

        {/* Carousel controls for desktop/tablet */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            aria-label="Scroll related products left"
            className="grid size-9 place-items-center rounded-full border border-border bg-background/80 text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 disabled:opacity-30 disabled:pointer-events-none shadow-xs"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            aria-label="Scroll related products right"
            className="grid size-9 place-items-center rounded-full border border-border bg-background/80 text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 disabled:opacity-30 disabled:pointer-events-none shadow-xs"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Product Cards Container: Horizontal Scroll on Mobile, Fluid Grid on Desktop */}
      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible pb-4 sm:pb-0 pt-1 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scrollbar-none"
      >
        {related.map((product) => (
          <div key={product.id} className="w-[168px] sm:w-auto shrink-0 snap-start flex flex-col">
            <RelatedProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

function RelatedProductCard({ product }: { product: Product }) {
  const { add } = useCart();
  const { user } = useSession();
  const { isWishlisted, toggle } = useWishlist();
  const [isAdding, setIsAdding] = useState(false);
  const wishlisted = user ? isWishlisted(product.uuid) : false;
  const discount = discountPct(product);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (product.stock <= 0 || isAdding) return;

    setIsAdding(true);
    add(product.id, 1, product.variants?.[0]?.id);
    trackEvent("add_to_cart", {
      productId: product.uuid,
      metadata: { from: "related_products_section" },
    });
    toast.success("Added to bag", { description: product.name });
    setTimeout(() => setIsAdding(false), 600);
  };

  return (
    <article className="group relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-premium-md">
      {/* Product Image Link */}
      <Link
        to="/product/$id"
        params={{ id: product.id }}
        onClick={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="focus-ring relative block aspect-square w-full overflow-hidden bg-muted/30"
      >
        <LazyImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
        />

        {/* Promo / Discount Badge */}
        <div className="absolute left-2.5 top-2.5 z-10 flex flex-col items-start gap-1 pointer-events-none">
          {discount > 0 ? (
            <span className="rounded-full bg-primary/95 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-primary-foreground shadow-xs backdrop-blur-md">
              {discount}% OFF
            </span>
          ) : product.isFeatured ? (
            <span className="rounded-full bg-foreground/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-background shadow-xs backdrop-blur-md">
              Featured
            </span>
          ) : null}
        </div>

        {/* Wishlist Button */}
        {user && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle(product.uuid);
              trackEvent(wishlisted ? "wishlist_remove" : "wishlist_add", {
                productId: product.uuid,
              });
              toast.success(wishlisted ? "Removed from wishlist" : "Added to wishlist");
            }}
            aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
            className="press absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-full bg-background/80 backdrop-blur-md shadow-xs transition-all duration-200 hover:scale-110 hover:bg-background border border-white/20"
          >
            <Heart
              className={`size-3.5 transition-colors duration-200 ${
                wishlisted
                  ? "fill-red-500 text-red-500"
                  : "text-muted-foreground group-hover:text-red-400"
              }`}
            />
          </button>
        )}
      </Link>

      {/* Details Container */}
      <div className="flex flex-1 flex-col p-3">
        {product.brand && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate">
            {product.brand}
          </p>
        )}

        <h3 className="mt-0.5 line-clamp-2 text-xs font-bold leading-snug break-words">
          <Link
            to="/product/$id"
            params={{ id: product.id }}
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="text-foreground transition-colors hover:text-primary"
          >
            {product.name}
          </Link>
        </h3>

        {/* Rating / Review Stats */}
        {product.reviews > 0 ? (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Star className="size-3 fill-accent text-accent" />
            <span className="font-bold text-foreground">{product.rating}</span>
            <span>({product.reviews})</span>
          </div>
        ) : null}

        {/* Pricing Block */}
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-display text-sm font-bold text-primary">
            {formatPrice(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[10px] font-semibold text-muted-foreground/70 line-through">
              {formatPrice(product.mrp)}
            </span>
          )}
        </div>

        {/* Action Button */}
        <div className="mt-auto pt-3">
          <button
            type="button"
            disabled={product.stock <= 0 || isAdding}
            onClick={handleAddToCart}
            className={`focus-ring w-full rounded-full py-1.5 text-[11px] font-bold tracking-wide transition-all duration-200 text-center flex items-center justify-center gap-1 shadow-xs ${
              product.stock <= 0
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                : isAdding
                  ? "bg-primary/80 text-primary-foreground scale-95"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
            }`}
          >
            {product.stock <= 0 ? "Out of stock" : isAdding ? "Added!" : "Add to bag"}
          </button>
        </div>
      </div>
    </article>
  );
}
