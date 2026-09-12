import { Link } from "@tanstack/react-router";
import { Heart, Star, ShoppingBag, Check, ChevronRight } from "lucide-react";
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
import { useAdminMode } from "@/lib/admin-mode";
import { AdminProductControls } from "@/components/admin/InlineAdmin";
import { LazyImage } from "@/components/ui/LazyImage";
import { ProductCardSkeleton, ProductGridSkeleton } from "@/components/ui/Skeletons";
import type { CardStyle } from "@/lib/homepage-themes";

export { ProductCardSkeleton, ProductGridSkeleton };

export function ProductCard({
  product,
  cardStyle = "default",
}: {
  product: Product;
  cardStyle?: CardStyle;
}) {
  const qc = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const { add } = useCart();
  const { user } = useSession();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = user ? isWishlisted(product.uuid) : false;
  const { settings } = useSettings();
  const { adminMode } = useAdminMode();

  const featHoverSwap = settings?.["feature_hover_swap"] !== "false";
  const featPromoBadges = settings?.["feature_promo_badges"] !== "false";

  // ── 1. Colors & Variants ──────────────────────────────────────────────────
  const colors = useMemo(() => getProductColors(product), [product]);
  const hasMultipleColors = colors.length > 1;

  const [selectedColor, setSelectedColor] = useState<string | null>(() =>
    colors.length > 0 ? colors[0] : null,
  );

  const variantsForColor = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return [];
    if (!selectedColor) return product.variants;
    const matching = product.variants.filter(
      (v) => v.color && v.color.trim().toLowerCase() === selectedColor.trim().toLowerCase(),
    );
    return matching.length > 0 ? matching : product.variants;
  }, [product.variants, selectedColor]);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(() => {
    if (variantsForColor.length > 0) {
      const inStock = variantsForColor.find((v) => v.stock > 0) || variantsForColor[0];
      return inStock.id;
    }
    return product.variants?.[0]?.id || null;
  });

  const activeVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return null;
    return product.variants.find((v) => v.id === selectedVariantId) || product.variants[0];
  }, [product.variants, selectedVariantId]);

  // ── 2. Pricing (zero cross-variant leakage) ───────────────────────────────
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

  // ── 3. Stock ──────────────────────────────────────────────────────────────
  const activeStock = activeVariant ? activeVariant.stock : product.stock;
  const isOutOfStock = activeStock <= 0;
  const isLowStock = !isOutOfStock && activeStock <= (product.lowStockAt || 3);

  // ── 4. Variant handlers ───────────────────────────────────────────────────
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

  const handleSizeSelect = (variantId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedVariantId(variantId);
    const v = (product.variants || []).find((item) => item.id === variantId);
    if (v?.color && v.color.trim()) {
      setSelectedColor(v.color.trim());
    }
  };

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

  // ── 5. Images ─────────────────────────────────────────────────────────────
  const activeHeroImage = useMemo(() => {
    if (activeVariant?.imageUrl) return activeVariant.imageUrl;
    if (selectedColor) {
      const colorImg = getColorSwatchImage(product, selectedColor);
      if (colorImg) return colorImg;
    }
    return product.image || product.imageUrl || imageFor(product.category, null, product);
  }, [activeVariant, selectedColor, product]);

  // Collect all images for gallery dots
  const allImages = useMemo(() => {
    const imgs: string[] = [];
    if (activeHeroImage) imgs.push(activeHeroImage);
    if (selectedColor) {
      const colorGallery = getColorGallery(product, selectedColor);
      colorGallery.forEach((img) => {
        if (img && img !== activeHeroImage && img.startsWith("http") && !imgs.includes(img)) {
          imgs.push(img);
        }
      });
    }
    (product.images || []).forEach((img) => {
      if (img && img.startsWith("http") && !imgs.includes(img)) {
        imgs.push(img);
      }
    });
    return imgs.slice(0, 5);
  }, [activeHeroImage, selectedColor, product]);

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const displayImage = allImages[activeImageIndex] ?? activeHeroImage;

  const activeSecondaryImage = useMemo(() => {
    if (!featHoverSwap) return null;
    const distinct = allImages.filter((img) => img !== displayImage);
    return distinct.length > 0 ? distinct[0] : null;
  }, [featHoverSwap, displayImage, allImages]);

  // Prefetch product details on hover
  const handlePrefetch = () => {
    qc.prefetchQuery(singleProductQueryOptions(product.id, false));
  };

  // Default age/size label for subtitle
  const defaultSizeLabel = useMemo(() => {
    if (activeVariant?.size && activeVariant.size.toLowerCase() !== "default" && activeVariant.size.toLowerCase() !== "standard") {
      return activeVariant.size.toLowerCase();
    }
    if (product.ageGroup) return product.ageGroup.toLowerCase();
    if (product.variants && product.variants.length > 0) {
      const firstNamed = product.variants.find(
        (v) => v.size && v.size.toLowerCase() !== "default" && v.size.toLowerCase() !== "standard",
      );
      if (firstNamed?.size) return firstNamed.size.toLowerCase();
    }
    return "0-6m";
  }, [activeVariant, product.ageGroup, product.variants]);

  const cardStyleClasses = useMemo(() => {
    switch (cardStyle) {
      case "minimal":
        return "border border-border/30 bg-card/60 shadow-none hover:-translate-y-0.5 hover:shadow-sm";
      case "premium":
        return "border border-amber-200/60 dark:border-amber-500/20 bg-card shadow-md hover:-translate-y-1 hover:shadow-xl ring-1 ring-amber-500/10";
      case "festive":
        return "border-2 border-amber-400/90 dark:border-amber-400/60 bg-gradient-to-b from-card via-card to-amber-50/30 dark:to-amber-950/20 shadow-lg shadow-amber-500/10 hover:-translate-y-1 hover:shadow-amber-500/20 hover:border-amber-300 ring-2 ring-amber-300/30";
      default:
        return "border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-card shadow-xs hover:-translate-y-0.5 hover:shadow-md";
    }
  }, [cardStyle]);

  function formatTitle(name: string): string {
    if (!name) return "";
    const trimmed = name.trim();
    if (trimmed.toUpperCase() === "TSHIRT" || trimmed.toUpperCase() === "T-SHIRT") {
      return "T-Shirt";
    }
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 2) {
      return trimmed
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
    return trimmed;
  }

  return (
    <article
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className={`group relative flex h-full flex-col overflow-hidden rounded-[26px] sm:rounded-3xl border border-stone-200/80 dark:border-stone-800 bg-white dark:bg-card shadow-xs transition-all duration-300 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/20 ${cardStyleClasses}`}
    >
      {/* ── PRODUCT HERO IMAGE (Edge-to-edge full bleed luxury display matching mockup) ── */}
      <div className="relative aspect-[3/4] sm:aspect-[4/5] w-full overflow-hidden bg-stone-100 dark:bg-stone-900 shrink-0">
        {/* Main image clickable link */}
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          className="focus-ring block absolute inset-0 w-full h-full"
          tabIndex={-1}
          aria-label={product.name}
        >
          <LazyImage
            src={displayImage}
            alt={product.name}
            placeholderSrc={imageFor(product.category, null, product)}
            className="h-full w-full object-cover object-top sm:object-center transition-transform duration-500 ease-out group-hover:scale-104"
          />
          {/* Subtle hover secondary image swap */}
          {activeSecondaryImage && (
            <LazyImage
              src={activeSecondaryImage}
              alt=""
              placeholderSrc={displayImage}
              className="absolute inset-0 h-full w-full object-cover object-top sm:object-center opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100 pointer-events-none"
            />
          )}
        </Link>

        {/* ── TOP-LEFT: Discount badge ── */}
        <div className="absolute left-3.5 top-3.5 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
          {activeDiscountPct > 0 ? (
            <span className="rounded-full bg-[#8B3A3A] px-3 py-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-white shadow-sm">
              {activeDiscountPct}% OFF
            </span>
          ) : product.isFeatured ? (
            <span className="rounded-full bg-foreground/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-background shadow-sm">
              Featured
            </span>
          ) : null}
          {isOutOfStock && (
            <span className="rounded-full bg-neutral-900/85 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm backdrop-blur-sm">
              Sold Out
            </span>
          )}
          {isLowStock && !isOutOfStock && (
            <span className="rounded-full bg-amber-500/90 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm backdrop-blur-sm">
              Only {activeStock} left
            </span>
          )}
        </div>

        {/* ── TOP-RIGHT: Circular Luxury Wishlist Button + Admin Controls ── */}
        <div className="absolute right-3.5 top-3.5 z-20 flex items-center gap-2">
          {adminMode && <AdminProductControls product={product} inline />}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!user) {
                toast.info("Please sign in to save to your wishlist", {
                  action: {
                    label: "Sign in",
                    onClick: () => {
                      window.location.href = "/auth";
                    },
                  },
                });
                return;
              }
              toggle(product.uuid);
              trackEvent(wishlisted ? "wishlist_remove" : "wishlist_add", {
                productId: product.uuid,
              });
              toast.success(wishlisted ? "Removed from wishlist" : "Added to wishlist");
            }}
            aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
            className="press grid size-9 sm:size-10 place-items-center rounded-full bg-white shadow-md transition-all duration-200 hover:scale-108 hover:bg-white border border-black/5 cursor-pointer"
          >
            <Heart
              className={`size-4.5 sm:size-5 transition-colors duration-200 ${
                wishlisted ? "fill-red-500 text-red-500" : "text-neutral-800 hover:text-red-500"
              }`}
            />
          </button>
        </div>

        {/* ── BOTTOM-CENTER: Image gallery dots ── */}
        {allImages.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
            {allImages.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`View image ${idx + 1}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveImageIndex(idx);
                }}
                className={`rounded-full transition-all duration-200 cursor-pointer ${
                  idx === activeImageIndex
                    ? "size-2 bg-white shadow-sm"
                    : "size-1.5 bg-white/60 hover:bg-white/90"
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── CONTENT AREA (Below image) ─────────────────────────────── */}
      <div className="flex flex-1 flex-col p-3.5 sm:p-4 bg-white dark:bg-card">
        {/* Line 1: Brand + Age/Size pill on same row */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground/80 truncate">
            {product.brand || "ZÉRAH"}
          </span>
          {defaultSizeLabel && (
            <Link
              to="/product/$id"
              params={{ id: product.id }}
              className="inline-flex items-center gap-0.5 shrink-0 rounded-full bg-stone-100 dark:bg-stone-800/80 px-2.5 py-0.5 text-[10px] sm:text-xs font-semibold text-stone-600 dark:text-stone-300 hover:bg-stone-200 transition-colors"
            >
              <span>{defaultSizeLabel}</span>
              <ChevronRight className="size-3 text-stone-400" />
            </Link>
          )}
        </div>

        {/* Line 2: Product Name */}
        <h3 className="mt-1 line-clamp-1 text-base sm:text-lg font-bold leading-snug text-foreground tracking-tight">
          <Link
            to="/product/$id"
            params={{ id: product.id }}
            className="hover:text-primary transition-colors"
          >
            {formatTitle(product.name)}
          </Link>
        </h3>

        {/* Color Swatches (if multiple colors exist) */}
        {hasMultipleColors && (
          <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
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
                  className={`relative size-4.5 sm:size-5 rounded-full overflow-hidden border transition-all cursor-pointer ${
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
          </div>
        )}

        {/* ── PRICE HIERARCHY ─────────────────────────────────────────────── */}
        <div className="mt-2 flex items-baseline gap-2 sm:gap-2.5 flex-wrap">
          <span className="text-xl sm:text-2xl font-black tracking-tight text-[#8B3A3A] dark:text-rose-400 tabular-nums">
            {formatPrice(activePrice)}
          </span>
          {activeMrp > activePrice && (
            <>
              <span className="text-xs sm:text-sm font-semibold text-muted-foreground/60 line-through tabular-nums">
                {formatPrice(activeMrp)}
              </span>
              <span className="text-[10px] sm:text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200/60 dark:border-emerald-800/60 tabular-nums">
                {activeDiscountPct}% OFF
              </span>
            </>
          )}
        </div>

        {/* Star Rating below price */}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-0.5">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="font-bold text-foreground text-xs">{product.rating || "4.5"}</span>
          </div>
          <span className="text-muted-foreground/70">
            ({product.reviews ? product.reviews.toLocaleString("en-IN") : "96"})
          </span>
        </div>

        {/* ── ADD TO BAG CTA ───────────────────────────────────────────────── */}
        <div className="mt-3 pt-0.5">
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
            className={`focus-ring press w-full rounded-2xl h-11 sm:h-12 px-3 text-xs sm:text-sm font-bold tracking-wide transition-all duration-300 text-center flex items-center justify-center gap-2 cursor-pointer shadow-xs ${
              isOutOfStock
                ? "bg-muted text-muted-foreground/60 border border-border/40 cursor-not-allowed"
                : isAdding
                  ? "bg-emerald-600 text-white scale-98 shadow-sm"
                  : "bg-[#8B3A3A] hover:bg-[#783030] text-white hover:shadow-md active:scale-98"
            }`}
          >
            {isOutOfStock ? (
              "Out of Stock"
            ) : isAdding ? (
              <>
                <Check className="size-4" /> Added!
              </>
            ) : (
              <>
                <ShoppingBag className="size-4.5" /> Add to Bag
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
