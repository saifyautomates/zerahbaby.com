import { Link } from "@tanstack/react-router";
import { Heart, Star, ShoppingBag, Check, Maximize2 } from "lucide-react";
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
    if (activeVariant?.size && activeVariant.size.toLowerCase() !== "default") {
      return activeVariant.color && activeVariant.color.toLowerCase() !== "default"
        ? `${activeVariant.color} · ${activeVariant.size}`
        : activeVariant.size;
    }
    if (product.ageGroup) return product.ageGroup;
    return null;
  }, [activeVariant, product.ageGroup]);

  const cardStyleClasses = useMemo(() => {
    switch (cardStyle) {
      case "minimal":
        return "border border-border/30 bg-card/60 shadow-none hover:-translate-y-0.5 hover:shadow-sm";
      case "premium":
        return "border border-amber-200/60 dark:border-amber-500/20 bg-card shadow-md hover:-translate-y-1 hover:shadow-xl ring-1 ring-amber-500/10";
      case "festive":
        return "border-2 border-amber-400/90 dark:border-amber-400/60 bg-gradient-to-b from-card via-card to-amber-50/30 dark:to-amber-950/20 shadow-lg shadow-amber-500/10 hover:-translate-y-1 hover:shadow-amber-500/20 hover:border-amber-300 ring-2 ring-amber-300/30";
      default:
        return "border border-border/50 bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-premium-md";
    }
  }, [cardStyle]);

  return (
    <article
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20 ${cardStyleClasses}`}
    >
      {/* ── PRODUCT HERO IMAGE (Full-bleed, object-cover) ─────────────────── */}
      <div className="relative aspect-[3/4] sm:aspect-[4/5] w-full overflow-hidden bg-stone-100 dark:bg-stone-900 shrink-0">
        {/* Main image clickable link */}
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          className="focus-ring block absolute inset-0"
          tabIndex={-1}
          aria-label={product.name}
        >
          <LazyImage
            src={displayImage}
            alt={product.name}
            placeholderSrc={imageFor(product.category, null, product)}
            className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-103"
          />
          {/* Subtle hover secondary image swap */}
          {activeSecondaryImage && (
            <LazyImage
              src={activeSecondaryImage}
              alt=""
              placeholderSrc={displayImage}
              className="absolute inset-0 h-full w-full object-cover object-center opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100 pointer-events-none"
            />
          )}
        </Link>

        {/* ── TOP-LEFT: Discount badge + stock badges ── */}
        <div className="absolute left-3 top-3 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
          {featPromoBadges && activeDiscountPct > 0 && (
            <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] sm:text-xs font-extrabold uppercase tracking-wide text-primary-foreground shadow-sm">
              {activeDiscountPct}% OFF
            </span>
          )}
          {!featPromoBadges && product.isFeatured && (
            <span className="rounded-full bg-foreground/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-background shadow-sm">
              Featured
            </span>
          )}
          {isOutOfStock && (
            <span className="rounded-full bg-neutral-900/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm backdrop-blur-sm">
              Sold Out
            </span>
          )}
          {isLowStock && !isOutOfStock && (
            <span className="rounded-full bg-amber-500/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm backdrop-blur-sm">
              Only {activeStock} left
            </span>
          )}
        </div>

        {/* ── TOP-RIGHT: Admin Edit + Wishlist circular buttons ── */}
        <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
          {adminMode && <AdminProductControls product={product} inline />}
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
              className="press grid size-9 place-items-center rounded-full bg-white/92 shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white border border-black/5 cursor-pointer"
            >
              <Heart
                className={`size-[17px] transition-colors duration-200 ${
                  wishlisted ? "fill-red-500 text-red-500" : "text-neutral-600 group-hover:text-red-400"
                }`}
              />
            </button>
          )}
        </div>

        {/* ── BOTTOM-RIGHT: Expand → Product Page ── */}
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="View product details"
          className="absolute bottom-3 right-3 z-20 grid size-8 sm:size-9 place-items-center rounded-full bg-white/92 shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-white border border-black/5 cursor-pointer"
        >
          <Maximize2 className="size-3.5 text-neutral-700" />
        </Link>

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

      {/* ── CONTENT AREA (White, below image) ─────────────────────────────── */}
      <div className="flex flex-1 flex-col px-3.5 pt-3.5 pb-3.5 sm:px-4 sm:pt-4 sm:pb-4">
        {/* Brand + Size/Age-Group pill on same row */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 truncate">
            {product.brand || "Zérah Baby & Kids"}
          </span>
          {defaultSizeLabel && (
            <span className="shrink-0 rounded-full bg-muted/70 px-2.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-muted-foreground border border-border/50">
              {defaultSizeLabel}
            </span>
          )}
        </div>

        {/* Product Name */}
        <h3 className="mt-1.5 line-clamp-2 text-sm sm:text-[15px] font-bold leading-snug text-foreground min-h-[2.5rem] sm:min-h-[2.75rem] break-words">
          <Link
            to="/product/$id"
            params={{ id: product.id }}
            className="hover:text-primary transition-colors"
          >
            {product.name}
          </Link>
        </h3>

        {/* Star Rating (only when real data exists) */}
        {product.reviews > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-0.5">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-bold text-foreground text-xs">{product.rating}</span>
            </div>
            <span className="text-muted-foreground/70">({product.reviews.toLocaleString("en-IN")})</span>
          </div>
        )}

        {/* Color Swatches (only if multiple colors) */}
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

        {/* ── PRICE HIERARCHY ─────────────────────────────────────────────── */}
        <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
          <span className="text-lg sm:text-xl font-black tracking-tight text-foreground">
            {formatPrice(activePrice)}
          </span>
          {activeMrp > activePrice && (
            <>
              <span className="text-xs sm:text-sm font-semibold text-muted-foreground/60 line-through">
                {formatPrice(activeMrp)}
              </span>
              <span className="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/60">
                {activeDiscountPct}% OFF
              </span>
            </>
          )}
        </div>

        {/* ── ADD TO BAG CTA ───────────────────────────────────────────────── */}
        <div className="mt-3.5">
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
            className={`focus-ring press w-full rounded-2xl h-11 sm:h-12 px-4 text-sm font-bold tracking-wide transition-all duration-300 text-center flex items-center justify-center gap-2 cursor-pointer ${
              isOutOfStock
                ? "bg-muted text-muted-foreground/60 border border-border/40 cursor-not-allowed"
                : isAdding
                  ? "bg-emerald-600 text-white scale-98 shadow-sm"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-md active:scale-98"
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
                <ShoppingBag className="size-4" /> Add to Bag
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
