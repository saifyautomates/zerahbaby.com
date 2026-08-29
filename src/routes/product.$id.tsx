import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Star,
  Truck,
  RotateCcw,
  ShieldCheck,
  Minus,
  Plus,
  Share2,
  Link2,
  Lock,
  ThumbsUp,
  Camera,
  Check,
  CheckCircle2,
  Sparkles,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { WhatsAppIcon, InstagramIcon } from "@/components/ui/BrandIcons";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { discountPct, formatPrice, useProducts, type Product } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import {
  useProductReviews,
  useCanUserReviewProduct,
  calculateReviewStats,
  type Review,
} from "@/lib/reviews";
import { ReviewModal } from "@/components/site/ReviewModal";
import { SizeGuideDrawer } from "@/components/site/SizeGuideDrawer";
import { useProfile, useSaveProfile, usePlaceOrder } from "@/lib/orders";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { ProductCard } from "@/components/site/ProductCard";
import { AdminProductControls } from "@/components/admin/InlineAdmin";
import { RelatedProducts } from "@/components/site/RelatedProducts";
import { RecentlyViewed } from "@/components/site/RecentlyViewed";
import { ResponsiveMedia } from "@/components/ui/ResponsiveMedia";

import { productsQueryOptions } from "@/lib/store";

export const Route = createFileRoute("/product/$id")({
  loader: async ({ context, params }) => {
    const products = await context.queryClient.ensureQueryData(productsQueryOptions(false));
    return {
      product: products.find((p) => p.id === params.id || p.uuid === params.id),
      products,
    };
  },
  head: (ctx) => {
    const product = ctx.loaderData?.product;
    if (!product) return { meta: [{ title: "Product Not Found" }] };

    const url = `https://zerahkids.com/product/${ctx.params.id}`;
    const description = product.description.substring(0, 155);
    const image = /^https?:\/\//.test(product.image)
      ? product.image
      : `https://zerahkids.com${product.image}`;

    return {
      meta: [
        { title: `${product.name} — Zerah Baby And Kid's Kota` },
        { name: "description", content: description },
        { property: "og:title", content: `${product.name} — Zerah Baby And Kid's` },
        { property: "og:description", content: description },
        { property: "og:image", content: image },
        { name: "twitter:image", content: image },
        { property: "og:url", content: url },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            description: product.description,
            image: [image],
            brand: { "@type": "Brand", name: product.brand || "Zerah Baby And Kid's" },
            sku: product.id,
            offers: {
              "@type": "Offer",
              url,
              priceCurrency: "INR",
              price: product.price,
              availability:
                (product.stock ?? 0) > 0
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
              seller: { "@type": "Organization", name: "Zerah Baby And Kid's" },
            },
          }),
        },
      ],
    };
  },
  component: ProductPage,
});

function ProductPage() {
  const { id } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { add, items } = useCart();
  const { user } = useSession();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [showBuyNowModal, setShowBuyNowModal] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  const [zoomStyle, setZoomStyle] = useState<React.CSSProperties>({});
  const [isZooming, setIsZooming] = useState(false);
  const [dispatchTime, setDispatchTime] = useState("");

  const list = useMemo(
    () => products ?? loaderData?.products ?? [],
    [products, loaderData?.products],
  );
  const product = list.find((p) => p.id === id || p.uuid === id) ?? loaderData?.product;
  const isLoading = productsLoading && !product;
  const gallery = (product?.images.length ? product.images : [product?.image]).filter(
    Boolean,
  ) as string[];

  // Reset image view and quantity when changing product
  useEffect(() => {
    setActiveImage(0);
    setQty(1);
    setIsZooming(false);
  }, [id]);

  const { data: swatchesData } = useQuery({
    queryKey: ["product-relations", product?.uuid],
    queryFn: async () => {
      if (!product?.uuid) return [];
      const { data, error } = await supabase.rpc("get_related_products", {
        p_product_id: product.uuid,
        p_limit: 8,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!product?.uuid,
  });

  const swatches = useMemo(() => {
    if (!swatchesData || !list) return [];
    const idMap = new Map(list.map((p) => [p.uuid, p]));
    return swatchesData
      .map((d: Record<string, unknown>) => idMap.get(d.id as string))
      .filter(Boolean) as Product[];
  }, [swatchesData, list]);

  const addToCartRef = useRef<HTMLDivElement>(null);
  const [isStickyVisible, setIsStickyVisible] = useState(false);

  const handleNext = useCallback(() => {
    setActiveImage((prev) => (prev + 1) % gallery.length);
  }, [gallery.length]);

  const handlePrev = useCallback(() => {
    setActiveImage((prev) => (prev - 1 + gallery.length) % gallery.length);
  }, [gallery.length]);

  const soldOut = product ? product.stock <= 0 : false;

  const { data: siteSettings } = useQuery({
    queryKey: ["site_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("key, value");
      if (error) throw error;
      return Object.fromEntries(
        data.map((r: { key: string; value: string }) => [r.key, r.value]),
      ) as Record<string, string>;
    },
  });

  const featMagnifier = siteSettings?.feature_image_magnifier !== "false";
  const featUrgency = siteSettings?.feature_urgency_badges !== "false";
  const featSwatches = siteSettings?.feature_swatches !== "false";
  const featStickyCart = siteSettings?.feature_sticky_cart !== "false";
  const featSizeGuide = siteSettings?.feature_size_guide !== "false";
  const dispatchHour = parseInt(siteSettings?.urgency_dispatch_cutoff_hour || "14", 10);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsStickyVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-100px" },
    );
    if (addToCartRef.current) observer.observe(addToCartRef.current);
    return () => observer.disconnect();
  }, []);

  const handleAddToCart = () => {
    if (!product) return;
    const inCart = items.find((i) => i.product.id === product.id)?.qty || 0;
    const remaining = Math.max(0, product.stock - inCart);
    if (qty > remaining) {
      toast.error("Not enough stock", { description: `You can only add ${remaining} more.` });
      return;
    }
    add(product.id, qty);
    trackEvent("add_to_cart", { productId: product.uuid, metadata: { qty, from: "product_page" } });
    toast.success("Added to bag", { description: `${qty} × ${product.name}` });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "Escape") setShowLightbox(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev]);

  useEffect(() => {
    const updateDispatch = () => {
      const now = new Date();
      const target = new Date();
      target.setHours(dispatchHour, 0, 0, 0);
      if (now > target) target.setDate(target.getDate() + 1);

      const diff = target.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setDispatchTime(`${hours}h ${mins}m`);
    };
    updateDispatch();
    const int = setInterval(updateDispatch, 60000);
    return () => clearInterval(int);
  }, [dispatchHour]);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomStyle({
      transformOrigin: `${x}% ${y}%`,
    });
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied to clipboard!");
  };

  const shareWhatsApp = () => {
    if (!product) return;
    const text = encodeURIComponent(
      `Check out ${product.name} on Zérah Baby And Kid's!\n\nPrice: ${formatPrice(product.price)}\n\n${product.description}\n\nShop here: ${window.location.href}`,
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
  };

  const shareInstagram = async () => {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied! Open Instagram to paste & share.");
  };

  const nativeShare = async () => {
    if (!product) return;
    try {
      let file: File | null = null;

      try {
        // Fetch the image and convert it to a File object
        const response = await fetch(product.image);
        const blob = await response.blob();
        file = new File([blob], `${product.name.replace(/[^a-z0-9]/gi, "_")}.jpg`, {
          type: blob.type,
        });
      } catch (e) {
        console.error("Could not fetch image for sharing", e);
      }

      const url = window.location.href;
      const shareData: ShareData = {
        title: product.name,
        text: `Check out ${product.name} on Zérah Baby And Kid's!\n\nPrice: ${formatPrice(product.price)}\n\n${product.description}`,
        url,
      };

      if (file && navigator.canShare && navigator.canShare({ ...shareData, files: [file] })) {
        shareData.files = [file];
      }

      await navigator.share(shareData);
    } catch (err) {
      console.error("Error sharing", err);
    }
  };

  // Track product view
  useEffect(() => {
    if (product) {
      trackEvent("product_view", {
        productId: product.uuid,
        metadata: { slug: product.id, name: product.name },
      });
    }
  }, [product]);

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 md:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-3xl bg-muted" />
        <div className="space-y-4">
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Product not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This item may have sold out or been renamed.
        </p>
        <Link
          to="/shop"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          Back to shop
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:py-10 pb-32 md:pb-10">
      <nav className="text-xs font-semibold tracking-wide text-muted-foreground mb-6">
        <Link to="/" className="hover:text-primary transition-colors">
          Home
        </Link>{" "}
        <span className="mx-2">/</span>{" "}
        <Link
          to="/shop"
          search={{ category: product.category ?? undefined }}
          className="hover:text-primary transition-colors"
        >
          {product.category}
        </Link>{" "}
        <span className="mx-2">/</span> <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-10 md:grid-cols-2 lg:gap-16">
        {/* Left Column: Sticky Media Gallery */}
        <div className="relative md:sticky md:top-24 self-start">
          <AdminProductControls product={product} />
          {(() => {
            const activeUrl = gallery[activeImage] ?? product.image;
            const isVideo = !!activeUrl.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
            return (
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-border/60 bg-card shadow-premium-sm transition-all duration-300 group">
                <button
                  onClick={() => setShowLightbox(true)}
                  className={`w-full block overflow-hidden ${featMagnifier ? "cursor-zoom-in" : "cursor-pointer"}`}
                  aria-label="View full screen"
                  onMouseMove={featMagnifier ? handleMouseMove : undefined}
                  onMouseEnter={() => setIsZooming(true)}
                  onMouseLeave={() => setIsZooming(false)}
                >
                  <ResponsiveMedia
                    src={activeUrl}
                    alt={product.name}
                    isVideo={isVideo}
                    fit="contain"
                    containerClassName="w-full h-full transition-transform overflow-hidden"
                    className={`w-full h-full object-contain transition-transform ease-out ${isZooming && !isVideo && featMagnifier ? "scale-[2.5] duration-75" : "duration-500 group-hover:scale-[1.03]"}`}
                    style={isZooming && !isVideo && featMagnifier ? zoomStyle : {}}
                    aspect="1/1"
                  />
                </button>
                {gallery.length > 1 && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrev();
                      }}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-sm text-foreground/80 hover:bg-white hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur-sm z-10"
                      aria-label="Previous image"
                    >
                      <ChevronLeft className="size-5 sm:size-6" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNext();
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-2 shadow-sm text-foreground/80 hover:bg-white hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur-sm z-10"
                      aria-label="Next image"
                    >
                      <ChevronRight className="size-5 sm:size-6" />
                    </button>
                  </>
                )}
              </div>
            );
          })()}
          {gallery.length > 1 && (
            <div className="mt-4 flex overflow-x-auto snap-x snap-mandatory scrollbar-none gap-3 pb-2 sm:flex-wrap sm:overflow-visible sm:snap-none sm:pb-0 px-1">
              {gallery.map((url, i) => {
                const isVideo = !!url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
                return (
                  <button
                    key={url}
                    onClick={() => setActiveImage(i)}
                    aria-label={`View media ${i + 1}`}
                    className={`size-16 shrink-0 snap-start overflow-hidden rounded-2xl border-2 transition-all duration-300 ${
                      i === activeImage
                        ? "border-primary shadow-premium-sm scale-105"
                        : "border-transparent bg-muted/50 hover:border-primary/30"
                    }`}
                  >
                    <ResponsiveMedia
                      src={url}
                      isVideo={isVideo}
                      fit="contain"
                      aspect="1/1"
                      containerClassName="rounded-none h-full w-full"
                      showPlaceholder={false}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          {featUrgency && (
            <div className="mb-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider">
              {product.stock > 0 && product.stock <= product.lowStockAt && (
                <span className="rounded-full bg-destructive/10 text-destructive px-2.5 py-1 animate-pulse border border-destructive/20 shadow-xs">
                  🔥 Only {product.stock} left in stock
                </span>
              )}
            </div>
          )}

          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {product.brand}
          </p>
          <div className="flex items-start justify-between gap-4 mt-2">
            <h1 className="font-display text-3xl font-bold leading-tight">{product.name}</h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="focus-ring mt-1 shrink-0 rounded-full border border-border bg-background p-2.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Share product options"
                  title="Share product"
                >
                  <Share2 className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl p-2">
                <DropdownMenuItem
                  onClick={copyLink}
                  className="cursor-pointer gap-3 rounded-lg py-2.5"
                >
                  <Link2 className="size-4" />
                  <span className="font-semibold">Copy link</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={shareWhatsApp}
                  className="cursor-pointer gap-3 rounded-lg py-2.5 text-[#25D366] hover:text-[#25D366] focus:text-[#25D366] focus:bg-[#25D366]/10"
                >
                  <WhatsAppIcon className="size-4" />
                  <span className="font-semibold text-foreground">Share to WhatsApp</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={shareInstagram}
                  className="cursor-pointer gap-3 rounded-lg py-2.5 text-[#E1306C] hover:text-[#E1306C] focus:text-[#E1306C] focus:bg-[#E1306C]/10"
                >
                  <InstagramIcon className="size-4" />
                  <span className="font-semibold text-foreground">Share to Instagram</span>
                </DropdownMenuItem>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <DropdownMenuItem
                    onClick={nativeShare}
                    className="cursor-pointer gap-3 rounded-lg py-2.5 mt-1 border-t"
                  >
                    <Share2 className="size-4" />
                    <span className="font-semibold">More options...</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm">
            {product.reviews > 0 && (
              <>
                <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 font-semibold">
                  <Star className="size-3.5 fill-accent text-accent" />
                  {product.rating}
                </span>
                <span className="text-muted-foreground">
                  {product.reviews.toLocaleString("en-IN")} reviews
                </span>
              </>
            )}
            <span className="rounded-full bg-muted px-2 py-1 text-xs">Ages {product.ageGroup}</span>
            {featSizeGuide && (
              <button
                onClick={() => setShowSizeGuide(true)}
                className="text-xs font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Size Guide
              </button>
            )}
          </div>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{formatPrice(product.price)}</span>
            {product.mrp > product.price && (
              <>
                <span className="text-muted-foreground line-through">
                  {formatPrice(product.mrp)}
                </span>
                <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                  {discountPct(product)}% off
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Inclusive of all taxes</p>

          <p className="mt-5 text-sm text-muted-foreground">{product.description}</p>

          <ul className="mt-4 space-y-1.5 text-sm">
            {product.highlights.map((h: string) => (
              <li key={h} className="flex gap-2">
                <span className="text-primary">•</span>
                {h}
              </li>
            ))}
          </ul>

          {featSwatches && swatches.length > 0 && (
            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                More in this style
              </p>
              <div className="flex items-center gap-3 overflow-x-auto scrollbar-none pb-2">
                {/* Current Active Product */}
                <div
                  className="size-14 shrink-0 rounded-full border-[2.5px] border-primary p-0.5 overflow-hidden shadow-sm ring-2 ring-primary/20"
                  title={`${product.name} (Current)`}
                >
                  <div className="w-full h-full rounded-full overflow-hidden bg-muted">
                    <img src={product.image} alt="Current" className="w-full h-full object-cover" />
                  </div>
                </div>

                {/* Swatch Links */}
                {swatches.map((s) => (
                  <Link
                    key={s.id || s.uuid}
                    to="/product/$id"
                    params={{ id: s.id || s.uuid }}
                    onClick={() => {
                      setActiveImage(0);
                      setQty(1);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="size-14 shrink-0 rounded-full border-2 border-border overflow-hidden opacity-80 hover:opacity-100 hover:border-primary transition-all duration-300 hover:scale-110 hover:shadow-md cursor-pointer bg-muted"
                    title={s.name}
                  >
                    <img src={s.image} alt={s.name} className="w-full h-full object-cover" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-4">
            <p className="text-sm font-bold uppercase tracking-wide">
              {soldOut ? (
                <span className="text-destructive flex items-center gap-1.5">
                  <X className="size-4" /> Out of stock
                </span>
              ) : product.stock <= product.lowStockAt ? (
                <span className="text-orange-500 flex items-center gap-1.5">
                  <RotateCcw className="size-4" /> Only {product.stock} left in stock
                </span>
              ) : (
                <span className="text-green-600 flex items-center gap-1.5">
                  <CheckCircle2 className="size-4" /> In stock & ready to ship
                </span>
              )}
            </p>

            {/* Standard Add to Cart (Observed for Sticky) */}
            <div
              ref={addToCartRef}
              className="relative z-0 border-t border-border/50 pt-4 md:border-none md:pt-0"
            >
              <div className="mx-auto flex max-w-7xl items-center gap-3">
                <div className="hidden md:flex items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-sm">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    aria-label="Decrease quantity"
                    className="hover:text-primary transition-colors"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="w-6 text-center text-sm font-bold">{qty}</span>
                  <button
                    onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                    aria-label="Increase quantity"
                    className="hover:text-primary transition-colors"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
                {(() => {
                  const inCart = items.find((i) => i.product.id === product.id)?.qty || 0;
                  const remaining = Math.max(0, product.stock - inCart);
                  const maxed = remaining <= 0;

                  return (
                    <div className="flex w-full md:w-auto flex-1 gap-2 sm:gap-3">
                      <button
                        disabled={soldOut || maxed || qty > remaining}
                        onClick={handleAddToCart}
                        className="focus-ring flex-1 rounded-full bg-primary px-4 py-3 sm:py-3.5 text-sm sm:text-base font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                      >
                        {soldOut ? "Sold out" : maxed ? "Max stock in bag" : "Add to bag"}
                      </button>
                      {!soldOut && !maxed && (
                        <button
                          type="button"
                          onClick={() => {
                            if (qty > remaining) {
                              toast.error("Not enough stock", {
                                description: `You can only add ${remaining} more.`,
                              });
                              return;
                            }
                            if (!user) {
                              toast.info("Please log in to proceed with Buy Now");
                              navigate({
                                to: "/auth",
                                search: { redirect: `/product/${product.id}` },
                              });
                              return;
                            }
                            trackEvent("buy_now", { productId: product.uuid, metadata: { qty } });
                            setShowBuyNowModal(true);
                          }}
                          className="focus-ring flex-1 rounded-full border-2 border-primary bg-background px-4 py-3 sm:py-3.5 text-sm sm:text-base font-bold text-primary transition-all duration-300 hover:bg-primary hover:text-primary-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Buy now
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Trust Signals */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-semibold text-muted-foreground md:text-sm pt-4 border-t border-border/50">
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  <Truck className="size-4" />
                </div>
                <div className="flex flex-col">
                  <span>
                    {(product?.deliveryFee ?? 79) === 0
                      ? "Fast & Free Delivery"
                      : `Standard Delivery: ₹${product?.deliveryFee ?? 79}`}
                  </span>
                  {featUrgency && dispatchTime && (
                    <span className="text-[10px] text-green-600 font-bold">
                      Order in {dispatchTime} for dispatch today
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" />
                </div>
                <span>100% Safe Checkout</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Buy Now Direct Checkout Modal */}
      {showBuyNowModal && product && (
        <BuyNowModal
          product={product}
          qty={qty}
          user={user}
          onClose={() => setShowBuyNowModal(false)}
        />
      )}

      {/* Size Guide Drawer */}
      <SizeGuideDrawer
        isOpen={showSizeGuide}
        onClose={() => setShowSizeGuide(false)}
        ageGroup={product?.ageGroup}
      />

      {/* Reviews Section */}
      {product && <ReviewsSection product={product} user={user} />}

      {product && <RelatedProducts currentProductId={product.id} category={product.category} />}
      {product && <RecentlyViewed currentProductId={product.id} />}

      {/* Global Sticky Add to Cart Bar */}
      {featStickyCart && (
        <div
          className={`fixed bottom-0 left-0 right-0 z-[60] border-t border-border/20 bg-background/95 backdrop-blur-xl p-3 sm:p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-out ${isStickyVisible ? "translate-y-0" : "translate-y-full"}`}
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="hidden md:flex items-center gap-4">
              <img
                src={product?.image}
                className="size-12 rounded-lg object-cover shadow-sm"
                alt=""
              />
              <div>
                <p className="font-semibold text-sm line-clamp-1">{product?.name}</p>
                <p className="text-primary font-bold">{formatPrice(product?.price || 0)}</p>
              </div>
            </div>

            <div className="flex flex-1 md:flex-none justify-end gap-3 w-full md:w-auto">
              <div className="flex items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-sm">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="hover:text-primary transition-colors"
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-6 text-center text-sm font-bold">{qty}</span>
                <button
                  onClick={() => setQty((q) => Math.min(product?.stock || 1, q + 1))}
                  className="hover:text-primary transition-colors"
                >
                  <Plus className="size-4" />
                </button>
              </div>

              <button
                onClick={handleAddToCart}
                disabled={soldOut || (product?.stock ?? 0) <= 0}
                className="flex-1 md:flex-none rounded-full bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-premium-sm hover:bg-primary/90 transition-all disabled:opacity-50"
              >
                Add to bag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {showLightbox && product && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setShowLightbox(false)}
        >
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute top-6 right-6 z-50 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition-colors"
            aria-label="Close fullscreen"
          >
            <X className="size-6 sm:size-8" />
          </button>

          {gallery.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrev();
                }}
                className="absolute left-4 sm:left-10 top-1/2 -translate-y-1/2 z-50 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition-colors"
                aria-label="Previous image"
              >
                <ChevronLeft className="size-6 sm:size-8" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNext();
                }}
                className="absolute right-4 sm:right-10 top-1/2 -translate-y-1/2 z-50 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 transition-colors"
                aria-label="Next image"
              >
                <ChevronRight className="size-6 sm:size-8" />
              </button>
            </>
          )}

          <div
            className="relative w-full max-w-5xl max-h-[85vh] flex items-center justify-center animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const activeUrl = gallery[activeImage] ?? product.image;
              const isVideo = !!activeUrl.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
              return isVideo ? (
                <video
                  src={activeUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
                />
              ) : (
                <img
                  src={activeUrl}
                  alt={product.name}
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                />
              );
            })()}
          </div>

          {/* Thumbnails inside lightbox */}
          {gallery.length > 1 && (
            <div
              className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[90vw] overflow-x-auto pb-2 scrollbar-none px-4"
              onClick={(e) => e.stopPropagation()}
            >
              {gallery.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setActiveImage(i)}
                  className={`size-12 sm:size-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                    i === activeImage
                      ? "border-white scale-110"
                      : "border-transparent opacity-50 hover:opacity-100"
                  }`}
                >
                  {url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ? (
                    <video src={url} className="size-full object-cover" />
                  ) : (
                    <img src={url} alt="" className="size-full object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function ReviewsSection({
  product,
  user,
}: {
  product: Product;
  user: ReturnType<typeof useSession>["user"];
}) {
  const { data: reviews = [], isLoading } = useProductReviews(product.uuid);
  const { data: canReviewData, isLoading: isCheckingPurchase } = useCanUserReviewProduct(
    product.uuid,
    product.id,
    user?.id,
  );
  const isVerifiedBuyer = canReviewData?.isVerifiedBuyer ?? false;
  const orderId = canReviewData?.orderId ?? null;
  const hasAlreadyReviewed = canReviewData?.hasAlreadyReviewed ?? false;
  const existingReview = canReviewData?.existingReview ?? null;

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [filterStar, setFilterStar] = useState<number | "all" | "photos">("all");
  const [sortBy, setSortBy] = useState<"recent" | "rating_desc" | "rating_asc">("recent");

  const stats = calculateReviewStats(reviews);

  // Filter & sort reviews
  const filteredReviews = reviews
    .filter((r) => {
      if (filterStar === "all") return true;
      if (filterStar === "photos") return r.images && r.images.length > 0;
      return Math.round(r.rating) === filterStar;
    })
    .sort((a, b) => {
      if (sortBy === "rating_desc") return b.rating - a.rating;
      if (sortBy === "rating_asc") return a.rating - b.rating;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <section className="mt-16 pt-10 border-t border-gray-100" id="customer-reviews">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
            Ratings & Reviews
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Genuine verified customer reviews from parents who bought this item
          </p>
        </div>

        {/* Verified Purchase Gating Action */}
        <div>
          {user ? (
            isCheckingPurchase ? (
              <div className="h-10 w-36 bg-muted animate-pulse rounded-full" />
            ) : isVerifiedBuyer ? (
              <button
                type="button"
                onClick={() => setShowReviewModal(true)}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#8B2020] text-white font-bold text-sm shadow-xs hover:bg-[#7a1c1c] transition hover:scale-102 cursor-pointer"
              >
                <Star className="size-4 fill-white" />
                <span>{hasAlreadyReviewed ? "Edit Your Review" : "Rate & Review Product"}</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                <ShieldCheck className="size-4 text-amber-600 shrink-0" />
                <span>Only verified buyers can write a review</span>
              </div>
            )
          ) : (
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-border text-muted-foreground font-semibold text-xs hover:bg-muted transition"
            >
              <span>Sign in to review product</span>
            </Link>
          )}
        </div>
      </div>

      {/* Ratings & Breakdown Hero Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 sm:p-8 bg-muted/70 rounded-3xl border border-gray-100 mb-8">
        {/* Left Column: Overall Score */}
        <div className="lg:col-span-4 flex flex-col justify-center items-center lg:items-start text-center lg:text-left lg:border-r lg:border-border/80 lg:pr-8">
          <div className="flex items-center gap-3">
            <span className="font-display text-4xl sm:text-5xl font-black text-foreground tracking-tight">
              {stats.totalRatings > 0
                ? stats.averageRating
                : product.rating > 0
                  ? product.rating
                  : "—"}
            </span>
            <div className="flex flex-col items-start">
              <div className="flex items-center gap-0.5 text-amber-400">
                {[1, 2, 3, 4, 5].map((s) => {
                  const currentAvg = stats.totalRatings > 0 ? stats.averageRating : product.rating;
                  return (
                    <Star
                      key={s}
                      className={`size-4 sm:size-5 ${
                        s <= Math.round(currentAvg || 0)
                          ? "fill-[#f59e0b] text-[#f59e0b]"
                          : "text-gray-300"
                      }`}
                    />
                  );
                })}
              </div>
              <span className="text-xs font-semibold text-muted-foreground mt-1">
                out of 5 stars
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs sm:text-sm font-semibold text-muted-foreground">
            {stats.totalRatings.toLocaleString("en-IN")} Verified Ratings &{" "}
            {stats.totalReviews.toLocaleString("en-IN")} Reviews
          </p>

          {stats.totalRatings > 0 && stats.recommendPct > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">
              <Check className="size-3.5" />
              <span>{stats.recommendPct}% of buyers recommend this product</span>
            </div>
          )}
        </div>

        {/* Right Column: 5-Tier Star Distribution Bars */}
        <div className="lg:col-span-8 flex flex-col justify-center space-y-2.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const bar = stats.breakdown[star as 1 | 2 | 3 | 4 | 5];
            const isCurrentFilter = filterStar === star;
            return (
              <button
                key={star}
                type="button"
                onClick={() => setFilterStar(filterStar === star ? "all" : star)}
                className={`w-full flex items-center gap-3 text-xs font-bold transition p-1 rounded-lg text-left cursor-pointer ${
                  isCurrentFilter ? "bg-card shadow-2xs" : "hover:bg-card/60"
                }`}
              >
                <span className="w-12 shrink-0 text-muted-foreground flex items-center gap-1">
                  <span>{star}</span>
                  <Star className="size-3 fill-[#f59e0b] text-[#f59e0b]" />
                </span>
                <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      star >= 4 ? "bg-[#388E3C]" : star === 3 ? "bg-[#f59e0b]" : "bg-[#e53935]"
                    }`}
                    style={{ width: `${bar.pct}%` }}
                  />
                </div>
                <span className="w-12 text-right shrink-0 text-muted-foreground font-semibold text-[11px]">
                  {bar.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Customer Photos Gallery Strip */}
      {stats.allImages.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Camera className="size-4 text-[#8B2020]" />
              <span>Customer Photos ({stats.allImages.length})</span>
            </h3>
            {filterStar !== "photos" && (
              <button
                type="button"
                onClick={() => setFilterStar("photos")}
                className="text-xs font-bold text-[#8B2020] hover:underline cursor-pointer"
              >
                View all photos
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none">
            {stats.allImages.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedPhoto(img.url)}
                className="group relative size-20 sm:size-24 rounded-2xl overflow-hidden border-2 border-border hover:border-[#8B2020] shrink-0 transition hover:scale-105 cursor-pointer shadow-2xs"
              >
                <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-bold flex items-center gap-0.5">
                  ★ {img.rating}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Sort Bar */}
      {reviews.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-6 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterStar("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                filterStar === "all"
                  ? "bg-[#8B2020] text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted"
              }`}
            >
              All ({reviews.length})
            </button>
            {stats.allImages.length > 0 && (
              <button
                type="button"
                onClick={() => setFilterStar("photos")}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  filterStar === "photos"
                    ? "bg-[#8B2020] text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted"
                }`}
              >
                <Camera className="size-3" />
                <span>With Photos ({stats.allImages.length})</span>
              </button>
            )}
            {[5, 4, 3, 2, 1].map((s) => {
              const count = stats.breakdown[s as 1 | 2 | 3 | 4 | 5].count;
              if (count === 0) return null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStar(s)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                    filterStar === s
                      ? "bg-[#8B2020] text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s} ★ ({count})
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground font-semibold">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "recent" | "rating_desc" | "rating_asc")}
              className="text-xs font-bold text-foreground bg-card border border-border rounded-xl px-3 py-1.5 outline-hidden focus:border-[#8B2020] cursor-pointer"
            >
              <option value="recent">Most Recent</option>
              <option value="rating_desc">Highest Rating</option>
              <option value="rating_asc">Lowest Rating</option>
            </select>
          </div>
        </div>
      )}

      {/* Review List */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading reviews...</div>
      ) : filteredReviews.length > 0 ? (
        <div className="space-y-5">
          {filteredReviews.map((review) => (
            <div
              key={review.id}
              className="p-5 sm:p-6 rounded-2xl border border-gray-100 bg-card shadow-2xs hover:border-border transition"
            >
              {/* Reviewer Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-[#8B2020]/10 text-[#8B2020] font-bold text-xs flex items-center justify-center border border-[#8B2020]/20">
                    {(review.user_name || "C").slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">
                        {review.user_name || "Verified Customer"}
                      </span>
                      {review.verified_purchase && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#2e7d32] bg-green-50 border border-green-200 px-2 py-0.5 rounded-md">
                          <ShieldCheck className="size-3" /> Certified Buyer
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400">
                      Reviewed on{" "}
                      {new Date(review.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>

                {/* Rating Badge */}
                <div
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black text-white ${
                    review.rating >= 4
                      ? "bg-[#388E3C]"
                      : review.rating === 3
                        ? "bg-[#f59e0b]"
                        : "bg-[#e53935]"
                  }`}
                >
                  <span>{review.rating}</span>
                  <Star className="size-3 fill-white" />
                </div>
              </div>

              {/* Review Title & Comment */}
              {review.title && (
                <h4 className="mt-3 text-sm font-bold text-foreground">{review.title}</h4>
              )}
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {review.comment}
              </p>

              {/* Customer Uploaded Photos */}
              {review.images && review.images.length > 0 && (
                <div className="flex flex-wrap gap-2.5 mt-3 pt-2">
                  {review.images.map((imgUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedPhoto(imgUrl)}
                      className="group relative size-16 sm:size-20 rounded-xl overflow-hidden border border-border hover:border-[#8B2020] transition hover:scale-105 cursor-pointer"
                    >
                      <img
                        src={imgUrl}
                        alt={`Review photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 px-6 rounded-3xl border border-gray-100 bg-muted/50 text-center space-y-3">
          <Star className="size-10 text-gray-300 mx-auto" />
          <h3 className="text-base font-bold text-foreground">No reviews found</h3>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
            {filterStar !== "all"
              ? "No reviews match the selected filter."
              : "Be the first verified buyer to share feedback on this product!"}
          </p>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && (
        <ReviewModal
          product={product}
          user={user}
          orderId={orderId}
          existingReview={existingReview}
          onClose={() => setShowReviewModal(false)}
        />
      )}

      {/* Full-Screen Photo Lightbox */}
      {selectedPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute -top-12 right-0 p-2 text-white/80 hover:text-white rounded-full bg-black/50 hover:bg-black/80 transition cursor-pointer"
            >
              <X className="size-6" />
            </button>
            <img
              src={selectedPhoto}
              alt="Enlarged review photo"
              className="max-h-[80vh] w-auto rounded-2xl object-contain shadow-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function BuyNowModal({
  product,
  qty,
  user,
  onClose,
}: {
  product: Product;
  qty: number;
  user: { id: string; email?: string } | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: profile } = useProfile(user?.id);
  const saveProfile = useSaveProfile(user?.id);
  const placeOrder = usePlaceOrder();

  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    alt_phone: "",
    address: "",
    address_line2: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
    notes: "",
  });

  const [editAddress, setEditAddress] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      full_name: f.full_name || profile.full_name || "",
      phone: f.phone || profile.phone || "",
      address: f.address || profile.address || "",
      city: f.city || profile.city || "",
      state: f.state || profile.state || "",
      pincode: f.pincode || profile.pincode || "",
    }));
  }, [profile]);

  const hasSavedAddress = Boolean(
    profile?.full_name &&
    profile?.phone &&
    profile?.address &&
    profile?.city &&
    profile?.state &&
    profile?.pincode,
  );

  const isFormComplete = Boolean(
    form.full_name.trim() &&
    form.phone.trim() &&
    form.address.trim() &&
    form.city.trim() &&
    form.state.trim() &&
    form.pincode.trim(),
  );

  const subtotal = product.price * qty;
  const shipping = subtotal >= 999 ? 0 : (product.deliveryFee ?? 79);
  const finalTotal = subtotal + shipping;

  async function handleBuyNowPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!user || submitting) return;

    if (!isFormComplete) {
      toast.error("Please fill in all delivery address fields");
      setEditAddress(true);
      return;
    }

    if (!/^\d{6}$/.test(form.pincode.trim())) {
      toast.error("Enter a valid 6-digit pincode");
      setEditAddress(true);
      return;
    }

    if (!/^[\d\s+-]{10,15}$/.test(form.phone.trim())) {
      toast.error("Enter a valid 10-digit phone number");
      setEditAddress(true);
      return;
    }

    const razorpayKey = import.meta.env.VITE_RAZORPAY_KEY_ID;
    if (!razorpayKey) {
      toast.error("Razorpay Key ID is not configured in client environment");
      return;
    }

    setSubmitting(true);

    let orderId = "";
    try {
      // Save profile address changes
      await saveProfile.mutateAsync({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
      });

      // Place single-item order securely via server RPC
      orderId = await placeOrder.mutateAsync({
        userId: user.id,
        email: user.email ?? "",
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        alt_phone: form.alt_phone.trim(),
        address: form.address.trim(),
        address_line2: form.address_line2.trim(),
        landmark: form.landmark.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        payment_method: "online",
        notes: form.notes.trim(),
        subtotal,
        shipping,
        discount: 0,
        items: [
          {
            product_slug: product.id,
            name: product.name,
            image_url: product.image,
            price: product.price,
            qty,
          },
        ],
      });

      // Load Razorpay Script
      await new Promise((resolve, reject) => {
        if (document.getElementById("razorpay-script")) return resolve(true);
        const script = document.createElement("script");
        script.id = "razorpay-script";
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = resolve;
        script.onerror = () =>
          reject(new Error("Failed to load Razorpay SDK. Please check your connection."));
        document.body.appendChild(script);
      });

      // Try creating Razorpay Order via Edge Function
      let rzpOrderId: string | undefined = undefined;
      let rzpKeyId: string = import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_live_TSOPbz5nCb4pLb";
      let rzpAmount: number = Math.round(finalTotal * 100);

      try {
        const { data: createData } = await supabase.functions.invoke("create-razorpay-order", {
          body: { orderId },
        });
        if (createData?.rzp_order_id) {
          rzpOrderId = createData.rzp_order_id;
        }
        if (createData?.key_id) {
          rzpKeyId = createData.key_id;
        }
        if (createData?.amount) {
          rzpAmount = createData.amount;
        }
      } catch (createErr) {
        console.warn("[BuyNow] create-razorpay-order backend fallback to client key:", createErr);
      }

      // Launch Razorpay Standard Checkout Modal
      const options: Record<string, unknown> = {
        key: rzpKeyId,
        amount: rzpAmount,
        currency: "INR",
        name: "Zerah Baby And Kid's",
        description: `${qty} × ${product.name}`,
        ...(rzpOrderId ? { order_id: rzpOrderId } : {}),
        prefill: {
          name: form.full_name.trim(),
          email: user.email,
          contact: form.phone.trim(),
        },
        notes: {
          order_id: orderId,
          store: "Zerah Baby And Kid's Kota",
        },
        handler: async (response: {
          razorpay_order_id?: string;
          razorpay_payment_id: string;
          razorpay_signature?: string;
        }) => {
          try {
            toast.loading("Verifying payment...", { id: "buy-now-verify" });
            if (response.razorpay_signature && (response.razorpay_order_id || rzpOrderId)) {
              await supabase.functions.invoke("verify-razorpay-payment", {
                body: {
                  razorpay_order_id: response.razorpay_order_id || rzpOrderId,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              });
            }

            // Update local order status in Supabase
            await supabase
              .from("orders")
              .update({
                payment_status: "paid",
                status: "processing",
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id || rzpOrderId || null,
              })
              .eq("id", orderId);

            trackEvent("order_created", {
              metadata: {
                orderId,
                total: finalTotal,
                payment: "online",
                source: "buy_now",
                razorpay_payment_id: response.razorpay_payment_id,
              },
            });
            toast.success("Payment successful! Your order has been placed.", {
              id: "buy-now-verify",
            });
            onClose();
            navigate({ to: "/orders" });
          } catch (verifyErr: unknown) {
            console.warn("[BuyNow] Payment verification notice:", verifyErr);
            toast.success("Payment received! Order confirmed.", {
              id: "buy-now-verify",
            });
            onClose();
            navigate({ to: "/orders" });
          }
        },
        modal: {
          ondismiss: async () => {
            setSubmitting(false);
            toast.error("Payment window closed. You can retry payment anytime.");
          },
        },
        theme: {
          color: "#883a3a", // Brand Primary Crimson Maroon
        },
      };

      type RazorpayInstance = {
        on: (event: string, cb: (res: { error: { description: string } }) => void) => void;
        open: () => void;
      };
      const rzp = new (
        window as unknown as {
          Razorpay: new (opts: Record<string, unknown>) => RazorpayInstance;
        }
      ).Razorpay(options);
      rzp.on("payment.failed", (response: { error: { description: string } }) => {
        toast.error(response.error?.description || "Payment failed at gateway");
      });
      rzp.open();
      return;
    } catch (err: unknown) {
      setSubmitting(false);
      const rawMessage = (err as Error).message || "Could not start payment";
      console.error("[BuyNow] Payment initiation error:", rawMessage);

      if (orderId) {
        try {
          await (
            supabase as unknown as {
              rpc: (name: string, args: { order_id: string }) => Promise<void>;
            }
          ).rpc("cancel_abandoned_order", { order_id: orderId });
        } catch (cancelErr) {
          console.warn("[BuyNow] Failed to cancel order after error:", cancelErr);
        }
      }

      toast.error(
        rawMessage.includes("credentials") ||
          rawMessage.includes("Authentication") ||
          rawMessage.includes("status 401")
          ? "Payment gateway is currently unavailable. Please try again later or contact support."
          : `Payment initialization error: ${rawMessage}`,
      );
    }
  }

  const field =
    "w-full rounded-xl border border-border bg-background px-3.5 py-2 text-xs sm:text-sm outline-none focus:border-primary transition";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="buy-now-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="buy-now-title" className="font-display text-xl font-bold text-foreground">
              Quick Buy
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Direct checkout powered by Razorpay
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Product preview */}
        <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-border bg-muted/30 p-3.5">
          <img
            src={product.image}
            alt={product.name}
            className="size-16 rounded-xl border border-border object-cover"
          />
          <div className="flex-1 min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{product.name}</h3>
            <p className="text-xs text-muted-foreground">
              Qty: {qty} · {formatPrice(product.price)} each
            </p>
            <p className="mt-0.5 text-xs font-bold text-primary">
              Subtotal: {formatPrice(subtotal)}
            </p>
          </div>
        </div>

        <form onSubmit={handleBuyNowPayment} className="mt-5 space-y-4">
          {/* Delivery Address Section */}
          <div className="rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Delivery Address
              </span>
              {hasSavedAddress && (
                <button
                  type="button"
                  onClick={() => setEditAddress(!editAddress)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {editAddress ? "Use saved" : "Change"}
                </button>
              )}
            </div>

            {!editAddress && hasSavedAddress ? (
              <div className="mt-2.5 text-xs text-foreground leading-relaxed">
                <p className="font-semibold">{form.full_name || profile?.full_name}</p>
                <p className="text-muted-foreground">{form.phone || profile?.phone}</p>
                <p className="mt-1 text-muted-foreground">
                  {[form.address, form.city, form.state, form.pincode].filter(Boolean).join(", ")}
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2.5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    required
                    type="text"
                    placeholder="Full Name *"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className={field}
                  />
                  <input
                    required
                    type="tel"
                    placeholder="10-digit Phone *"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className={field}
                  />
                </div>
                <input
                  required
                  type="text"
                  placeholder="Street Address / House No. *"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className={field}
                />
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    required
                    type="text"
                    placeholder="City *"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className={field}
                  />
                  <input
                    required
                    type="text"
                    placeholder="State *"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className={field}
                  />
                  <input
                    required
                    type="text"
                    maxLength={6}
                    placeholder="6-digit Pincode *"
                    value={form.pincode}
                    onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                    className={field}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Price Breakdown */}
          <div className="rounded-2xl border border-border p-4 space-y-2 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Items Total ({qty} items)</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Shipping Delivery</span>
              <span>
                {shipping === 0 ? (
                  <strong className="text-emerald-600 font-semibold">FREE</strong>
                ) : (
                  formatPrice(shipping)
                )}
              </span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
              <span>Payable Amount</span>
              <span className="text-primary font-extrabold">{formatPrice(finalTotal)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock className="size-3 text-emerald-600" /> 256-Bit SSL Encrypted Razorpay Checkout
            </span>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-full border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Opening Razorpay…" : `Pay ${formatPrice(finalTotal)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
