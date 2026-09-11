import { Link } from "@tanstack/react-router";
import { Heart, Star, ShoppingBag, Check } from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  formatPrice,
  imageFor,
  useSettings,
  singleProductQueryOptions,
  getProductColors,
  getColorGallery,
  getColorSwatchImage,
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

  // 1. Resolve distinct available colors
  const colors = useMemo(() => getProductColors(product), [product]);
  const hasMultipleColors = colors.length > 1;

  // Active color state
  const [selectedColor, setSelectedColor] = useState<string | null>(() =>
    colors.length > 0 ? colors[0] : null,
  );

  // 2. Resolve variants for active color
  const variantsForColor = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return [];
    if (!selectedColor) return product.variants;
    const matching = product.variants.filter(
      (v) => v.color && v.color.trim().toLowerCase() === selectedColor.trim().toLowerCase(),
    );
    return matching.length > 0 ? matching : product.variants;
  }, [product.variants, selectedColor]);

  // 3. Active variant state
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    if (variantsForColor.length > 0) {
      const inStock = variantsForColor.find((v) => v.stock > 0) || variantsForColor[0];
      return inStock.id;
    }
    return product.variants?.[0]?.id || null;
  });

  // Current active variant object
  const activeVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return null;
    return product.variants.find((v) => v.id === selectedVariantId) || product.variants[0];
  }, [product.variants, selectedVariantId]);

  // 4. Exact pricing hierarchy based on active variant (Zero cross-variant leakage)
  const activePrice =
    activeVariant?.priceOverride && activeVariant.priceOverride > 0
      ? activeVariant.priceOverride
      : product.price;

  const activeMrp =
    activeVariant?.mrpOverride && activeVariant.mrpOverride > 0
      ? activeVariant.mrpOverride
      : product.mrp && product.mrp > 0
        ? product.mrp
        : activePrice;

  const activeDiscountPct =
    activeMrp > activePrice ? Math.round(((activeMrp - activePrice) / activeMrp) * 100) : 0;

  // 5. Inventory & Stock Status from Supabase
  const activeStock = activeVariant ? activeVariant.stock : product.stock;
  const isOutOfStock = activeStock <= 0;
  const isLowStock = !isOutOfStock && activeStock <= (product.lowStockAt || 3);

  // 6. Color selection handler
  const handleColorSelect = (color: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedColor(color);
    const matching = (product.variants || []).filter(
      (v) => v.color && v.color.trim().toLowerCase() === color.trim().toLowerCase(),
    );
    if (matching.length > 0) {
      const inStock = matching.find((v) => v.stock > 0) || matching[0];
      setSelectedVariantId(inStock.id);
    }
  };

  // 7. Size selection handler
  const handleSizeSelect = (variantId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedVariantId(variantId);
    const v = (product.variants || []).find((item) => item.id === variantId);
    if (v?.color && v.color.trim()) {
      setSelectedColor(v.color.trim());
    }
  };

  // 8. Size variants to display
  const validSizes = useMemo(() => {
    return (variantsForColor || []).filter(
      (v) =>
        v.size &&
        v.size.trim().length > 0 &&
        v.size.toLowerCase() !== "default" &&
        v.size.toLowerCase() !== "standard" &&
        v.name?.toLowerCase() !== "default",
    );
  }, [variantsForColor]);

  // 9. Active Hero Image & Secondary Hover Image
  const activeHeroImage = useMemo(() => {
    if (activeVariant?.imageUrl) return activeVariant.imageUrl;
    if (selectedColor) {
      const colorImg = getColorSwatchImage(product, selectedColor);
      if (colorImg) return colorImg;
    }
    return product.image || product.imageUrl || imageFor(product.category, null, product);
  }, [activeVariant, selectedColor, product]);

  const activeSecondaryImage = useMemo(() => {
    if (!featHoverSwap) return null;
    if (selectedColor) {
      const colorGallery = getColorGallery(product, selectedColor);
      if (colorGallery.length > 1 && colorGallery[1] !== activeHeroImage) {
        return colorGallery[1];
      }
    }
    const distinct = (product.images || []).filter(
      (img) => img && img !== activeHeroImage && img.startsWith("http"),
    );
    return distinct.length > 0 ? distinct[0] : null;
  }, [featHoverSwap, selectedColor, activeHeroImage, product]);

  // Prefetch product details on hover for instantaneous navigation
  const handlePrefetch = () => {
    qc.prefetchQuery(singleProductQueryOptions(product.id, false));
  };

  return (
    <article
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:shadow-premium-md focus-within:ring-2 focus-within:ring-primary/20"
    >
      <AdminProductControls product={product} />

      {/* ── 1. PRODUCT HERO IMAGE CONTAINER (High-Fashion 4:5 Aspect Ratio) ── */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-stone-50/75 dark:bg-stone-900/40 p-2 sm:p-2.5">
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          className="focus-ring block h-full w-full overflow-hidden rounded-xl sm:rounded-2xl"
        >
          <div className="relative h-full w-full overflow-hidden">
            <LazyImage
              src={activeHeroImage}
              alt={product.name}
              placeholderSrc={imageFor(product.category, null, product)}
              className="h-full w-full object-contain object-center transition-transform duration-500 ease-out group-hover:scale-105"
            />
            {/* Smooth Second Image Swap on Desktop Hover if Available */}
            {activeSecondaryImage && (
              <LazyImage
                src={activeSecondaryImage}
                alt=""
                placeholderSrc={activeHeroImage}
                className="absolute inset-0 h-full w-full object-contain object-center opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100 pointer-events-none"
              />
            )}
          </div>
        </Link>

        {/* Floating Badges (Top Left) */}
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1 pointer-events-none">
          {activeDiscountPct > 0 ? (
            <span className="rounded-full bg-primary/95 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary-foreground shadow-xs backdrop-blur-md">
              {activeDiscountPct}% OFF
            </span>
          ) : product.isFeatured ? (
            <span className="rounded-full bg-foreground/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-background shadow-xs backdrop-blur-md">
              Featured
            </span>
          ) : null}

          {isOutOfStock ? (
            <span className="rounded-full bg-neutral-900/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-xs backdrop-blur-md">
              Sold Out
            </span>
          ) : isLowStock ? (
            <span className="rounded-full bg-amber-600/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-xs backdrop-blur-md">
              Only {activeStock} left
            </span>
          ) : null}
        </div>

        {/* Secondary Wishlist Heart Button (Top Right) */}
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
            className="press absolute right-3 top-3 z-10 grid size-8.5 place-items-center rounded-full bg-background/85 backdrop-blur-md shadow-xs transition-all duration-200 hover:scale-110 hover:bg-background border border-black/5 dark:border-white/10 cursor-pointer"
          >
            <Heart
              className={`size-4 transition-colors duration-200 ${
                wishlisted ? "fill-red-500 text-red-500" : "text-muted-foreground hover:text-red-500"
              }`}
            />
          </button>
        )}
      </div>

      {/* ── 2. CARD CONTENT & METADATA ── */}
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {/* Brand & Age-group meta line */}
        <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase font-bold tracking-widest text-muted-foreground/75">
          <span className="truncate">{product.brand || "Zérah Baby & Kids"}</span>
          {product.ageGroup && (
            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shrink-0">
              {product.ageGroup}
            </span>
          )}
        </div>

        {/* Consistent 2-Line Product Name */}
        <h3 className="mt-1 line-clamp-2 text-xs sm:text-sm font-bold leading-snug text-foreground group-hover:text-primary transition-colors min-h-[2.5rem] sm:min-h-[2.75rem] break-words">
          <Link to="/product/$id" params={{ id: product.id }}>
            {product.name}
          </Link>
        </h3>

        {/* Social Proof (Authoritative Supabase Data Only) */}
        {product.reviews > 0 ? (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-0.5 text-amber-500">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-bold text-foreground text-xs">{product.rating}</span>
            </div>
            <span className="text-muted-foreground/70">
              ({product.reviews.toLocaleString("en-IN")})
            </span>
          </div>
        ) : (
          <div className="h-4 mt-1" />
        )}

        {/* ── 3. VISUALLY DOMINANT PRICE HIERARCHY ── */}
        <div className="mt-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-base sm:text-lg font-black tracking-tight text-foreground">
            {formatPrice(activePrice)}
          </span>
          {activeMrp > activePrice && (
            <>
              <span className="text-xs font-semibold text-muted-foreground/60 line-through">
                {formatPrice(activeMrp)}
              </span>
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
                {activeDiscountPct}% OFF
              </span>
            </>
          )}
        </div>

        {/* ── 4. INTERACTIVE VARIANT SELECTORS ── */}
        {/* Color Swatches */}
        {hasMultipleColors && (
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            {colors.slice(0, 5).map((color) => {
              const isSelected = selectedColor?.toLowerCase() === color.toLowerCase();
              const swatchImg = getColorSwatchImage(product, color);
              return (
                <button
                  key={color}
                  type="button"
                  onClick={(e) => handleColorSelect(color, e)}
                  title={color}
                  aria-label={`Select color ${color}`}
                  className={`relative size-5 sm:size-5.5 rounded-full overflow-hidden border transition-all cursor-pointer ${
                    isSelected
                      ? "ring-2 ring-primary ring-offset-1 border-primary scale-110"
                      : "border-border/80 hover:scale-105 opacity-80 hover:opacity-100"
                  }`}
                >
                  {swatchImg ? (
                    <img src={swatchImg} alt={color} className="size-full object-cover" />
                  ) : (
                    <span className="size-full bg-muted flex items-center justify-center text-[8px] font-bold">
                      {color[0]}
                    </span>
                  )}
                </button>
              );
            })}
            {colors.length > 5 && (
              <span className="text-[10px] font-semibold text-muted-foreground pl-0.5">
                +{colors.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Size Pills */}
        {validSizes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {validSizes.slice(0, 4).map((v) => {
              const isSelected = v.id === selectedVariantId;
              const outOfStock = v.stock <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={(e) => handleSizeSelect(v.id, e)}
                  className={`px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold transition-all cursor-pointer border ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary"
                      : outOfStock
                        ? "opacity-40 line-through border-border/40 bg-muted/20 cursor-not-allowed"
                        : "border-border/80 text-muted-foreground hover:text-foreground hover:border-primary/60 bg-muted/30"
                  }`}
                >
                  {v.size || v.name}
                </button>
              );
            })}
            {validSizes.length > 4 && (
              <span className="text-[9px] text-muted-foreground self-center">
                +{validSizes.length - 4} more
              </span>
            )}
          </div>
        )}

        {/* ── 5. BOTTOM PINNED ADD TO BAG CTA ── */}
        <div className="mt-auto pt-3">
          <button
            type="button"
            disabled={isOutOfStock || isAdding}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isOutOfStock || isAdding) return;
              setIsAdding(true);
              add(product.id, 1, activeVariant?.id, product);
              trackEvent("add_to_cart", {
                productId: product.uuid,
                metadata: { variantId: activeVariant?.id },
              });
              toast.success("Added to bag", {
                description: `${product.name}${
                  activeVariant?.name && activeVariant.name !== "Default"
                    ? ` • ${activeVariant.name}`
                    : ""
                }`,
              });
              setTimeout(() => setIsAdding(false), 500);
            }}
            className={`focus-ring press w-full rounded-xl py-2 sm:py-2.5 px-3 text-xs sm:text-sm font-bold tracking-wide transition-all duration-300 text-center flex items-center justify-center gap-1.5 cursor-pointer shadow-xs ${
              isOutOfStock
                ? "bg-muted text-muted-foreground/60 border border-border/40 cursor-not-allowed"
                : isAdding
                  ? "bg-emerald-600 text-white scale-98 shadow-sm"
                  : "bg-primary text-primary-foreground hover:bg-primary/95 hover:shadow-premium-sm"
            }`}
          >
            {isOutOfStock ? (
              "Out of Stock"
            ) : isAdding ? (
              <>
                <Check className="size-3.5" /> Added!
              </>
            ) : (
              <>
                <ShoppingBag className="size-3.5" /> Add to Bag
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
