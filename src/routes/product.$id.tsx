import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Star,
  Truck,
  RotateCcw,
  ShieldCheck,
  Minus,
  Plus,
  Share2,
  Link2,
  MessageCircle,
  Instagram,
  Lock,
} from "lucide-react";
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
import { useProductReviews, useSubmitReview } from "@/lib/reviews";
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
    return { product: products.find((p) => p.id === params.id) };
  },
  head: (ctx) => {
    const product = ctx.loaderData?.product;
    if (!product) return { meta: [{ title: "Product Not Found" }] };

    const url = `https://zerahbaby.lovable.app/product/${ctx.params.id}`;
    const description = product.description.substring(0, 155);
    const image = /^https?:\/\//.test(product.image)
      ? product.image
      : `https://zerahbaby.lovable.app${product.image}`;

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

  const list = products ?? [];
  const product = list.find((p) => p.id === id) ?? loaderData?.product;
  const isLoading = productsLoading && !product;
  const gallery = (product?.images.length ? product.images : [product?.image]).filter(
    Boolean,
  ) as string[];
  const soldOut = (product?.stock ?? 0) <= 0;

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
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary">
          Home
        </Link>{" "}
        /{" "}
        <Link
          to="/shop"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          search={{ category: product.category } as any}
          className="hover:text-primary"
        >
          {product.category}
        </Link>{" "}
        / <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="relative">
          <AdminProductControls product={product} />
          {(() => {
            const activeUrl = gallery[activeImage] ?? product.image;
            const isVideo = !!activeUrl.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
            return (
              <ResponsiveMedia
                src={activeUrl}
                alt={product.name}
                isVideo={isVideo}
                fit="contain"
                containerClassName="rounded-3xl border border-border"
                aspect="1/1"
              />
            );
          })()}
          {gallery.length > 1 && (
            <div className="mt-3 flex overflow-x-auto snap-x snap-mandatory scrollbar-none gap-3 pb-2 sm:flex-wrap sm:overflow-visible sm:snap-none sm:pb-0">
              {gallery.map((url, i) => {
                const isVideo = !!url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
                return (
                  <button
                    key={url}
                    onClick={() => setActiveImage(i)}
                    aria-label={`View media ${i + 1}`}
                    className={`size-16 shrink-0 snap-start overflow-hidden rounded-xl border-2 transition ${
                      i === activeImage ? "border-primary" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <ResponsiveMedia
                      src={url}
                      isVideo={isVideo}
                      fit="cover"
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
                  className="cursor-pointer gap-3 rounded-lg py-2.5 text-green-600 focus:text-green-700"
                >
                  <MessageCircle className="size-4" />
                  <span className="font-semibold">Share to WhatsApp</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={shareInstagram}
                  className="cursor-pointer gap-3 rounded-lg py-2.5 text-pink-600 focus:text-pink-700"
                >
                  <Instagram className="size-4" />
                  <span className="font-semibold">Share to Instagram</span>
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
            <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 font-semibold">
              <Star className="size-3.5 fill-accent text-accent" />
              {product.rating}
            </span>
            <span className="text-muted-foreground">
              {product.reviews.toLocaleString("en-IN")} reviews
            </span>
            <span className="rounded-full bg-muted px-2 py-1 text-xs">Ages {product.ageGroup}</span>
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

          <p className="mt-5 text-sm font-semibold">
            {soldOut ? (
              <span className="text-destructive">Out of stock</span>
            ) : product.stock <= product.lowStockAt ? (
              <span className="text-primary">Only {product.stock} left in stock</span>
            ) : (
              <span className="text-muted-foreground">In stock</span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-full border border-border px-3 py-2">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center text-sm font-semibold">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                aria-label="Increase quantity"
              >
                <Plus className="size-4" />
              </button>
            </div>
            {(() => {
              const inCart = items.find((i) => i.product.id === product.id)?.qty || 0;
              const remaining = Math.max(0, product.stock - inCart);
              const maxed = remaining <= 0;

              return (
                <>
                  <button
                    disabled={soldOut || maxed || qty > remaining}
                    onClick={() => {
                      if (qty > remaining) {
                        toast.error("Not enough stock", {
                          description: `You can only add ${remaining} more.`,
                        });
                        return;
                      }
                      add(product.id, qty);
                      trackEvent("add_to_cart", {
                        productId: product.uuid,
                        metadata: { qty, from: "product_page" },
                      });
                      toast.success("Added to bag", { description: `${qty} × ${product.name}` });
                    }}
                    className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
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
                            search: { redirect: `/product/${product.id}` } as any,
                          });
                          return;
                        }
                        trackEvent("buy_now", { productId: product.uuid, metadata: { qty } });
                        setShowBuyNowModal(true);
                      }}
                      className="rounded-full border border-border px-8 py-3 text-sm font-semibold transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      Buy now
                    </button>
                  )}
                </>
              );
            })()}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Truck, text: "Free delivery over ₹999" },
              { icon: RotateCcw, text: "7-day easy returns" },
              { icon: ShieldCheck, text: "Safety lab tested" },
            ].map((f) => (
              <div
                key={f.text}
                className="flex items-center gap-2 rounded-xl border border-border p-3 text-xs"
              >
                <f.icon className="size-4 text-primary" />
                {f.text}
              </div>
            ))}
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

      {/* Reviews Section */}
      {product && <ReviewsSection product={product} user={user} />}

      {product && <RelatedProducts currentProductId={product.id} category={product.category} />}
      {product && <RecentlyViewed currentProductId={product.id} />}
    </div>
  );
}

function ReviewsSection({
  product,
  user,
}: {
  product: Product;
  user: ReturnType<typeof useSession>["user"];
}) {
  const { data: reviews } = useProductReviews(product.uuid);
  const submitReview = useSubmitReview();
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");

  return (
    <section className="mt-16">
      <h2 className="font-display text-2xl font-bold">Customer Reviews</h2>

      {reviews && reviews.length > 0 ? (
        <div className="mt-6 space-y-4">
          {reviews.map((review) => (
            <div key={review.id} className="rounded-2xl border border-border p-5">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`size-4 ${i < review.rating ? "fill-accent text-accent" : "text-muted-foreground"}`}
                    />
                  ))}
                </div>
                {review.verified_purchase && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                    Verified Purchase
                  </span>
                )}
              </div>
              {review.title && <p className="mt-2 text-sm font-semibold">{review.title}</p>}
              <p className="mt-1 text-sm text-muted-foreground">{review.comment}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(review.created_at).toLocaleDateString("en-IN")}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No reviews yet. Be the first to review this product!
        </p>
      )}

      {submitted && (
        <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary/10">
            <Star className="size-6 fill-primary text-primary" />
          </div>
          <h3 className="font-display text-xl font-bold text-foreground">
            Thank you for your review! 🌟
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your feedback helps us grow and helps other parents make great choices! If you love what
            we do, would you mind taking 10 seconds to share your experience on Google?
          </p>
          <a
            href="https://maps.app.goo.gl/79nYYFUSWre5ymHT6"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#4285F4] px-6 py-3 text-sm font-bold text-white shadow-md transition-transform hover:scale-105 hover:bg-[#3367D6]"
          >
            Review us on Google Maps
          </a>
        </div>
      )}

      {user && !showForm && !submitted && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-4 rounded-full border border-primary px-6 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
        >
          Write a review
        </button>
      )}

      {showForm && user && !submitted && (
        <form
          className="mt-4 space-y-3 rounded-2xl border border-border p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            await submitReview.mutateAsync({
              product_id: product.uuid,
              user_id: user.id,
              rating,
              title: title.trim(),
              comment: comment.trim(),
            });
            setShowForm(false);
            setSubmitted(true);
            setTitle("");
            setComment("");
            setRating(5);
          }}
        >
          <div>
            <p className="text-sm font-semibold">Rating</p>
            <div className="mt-1 flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <button key={i} type="button" onClick={() => setRating(i + 1)}>
                  <Star
                    className={`size-6 cursor-pointer transition ${i < rating ? "fill-accent text-accent" : "text-muted-foreground hover:text-accent"}`}
                  />
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Review title (optional)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <textarea
            required
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share your experience with this product..."
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitReview.isPending}
              className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {submitReview.isPending ? "Submitting..." : "Submit review"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-border px-6 py-2.5 text-sm font-semibold transition hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
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
  const shipping = subtotal >= 999 ? 0 : 79;
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

      // Create Razorpay Order via Edge Function
      const { data: createData, error: createError } = await supabase.functions.invoke(
        "create-razorpay-order",
        { body: { orderId } },
      );

      if (createError || !createData?.rzp_order_id) {
        let errorMsg = "Failed to initialize payment gateway";
        if (createError) {
          try {
            const ctx = (createError as { context?: Response }).context;
            if (ctx && typeof ctx.json === "function") {
              const errorBody = await ctx.clone().json();
              if (errorBody?.error) errorMsg = errorBody.error;
            }
          } catch {
            errorMsg = createError.message || errorMsg;
          }
        }
        throw new Error(errorMsg);
      }

      // Launch Razorpay Checkout Modal
      const options = {
        key: razorpayKey,
        amount: Math.round(finalTotal * 100),
        currency: "INR",
        name: "Zerah Baby And Kid's",
        description: `${qty} × ${product.name}`,
        order_id: createData.rzp_order_id,
        prefill: {
          name: form.full_name.trim(),
          email: user.email,
          contact: form.phone.trim(),
        },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            toast.loading("Verifying payment...", { id: "buy-now-verify" });
            const { error: verifyError } = await supabase.functions.invoke(
              "verify-razorpay-payment",
              {
                body: {
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              },
            );

            if (verifyError) {
              let vErrorMsg = "Payment verification failed";
              try {
                const vCtx = (verifyError as { context?: Response }).context;
                if (vCtx && typeof vCtx.json === "function") {
                  const vBody = await vCtx.clone().json();
                  if (vBody?.error) vErrorMsg = vBody.error;
                }
              } catch {
                vErrorMsg = verifyError.message || vErrorMsg;
              }
              throw new Error(vErrorMsg);
            }

            trackEvent("order_created", {
              metadata: {
                orderId,
                total: finalTotal,
                payment: "online",
                source: "buy_now",
              },
            });
            toast.success("Payment successful! Your order has been placed.", {
              id: "buy-now-verify",
            });
            onClose();
            navigate({ to: "/orders" });
          } catch (verifyErr: unknown) {
            const msg = (verifyErr as Error).message || "Payment verification failed";
            toast.error(`${msg}. If amount was deducted, it will be automatically confirmed.`, {
              id: "buy-now-verify",
            });
            onClose();
            navigate({ to: "/orders" });
          }
        },
        modal: {
          ondismiss: async () => {
            setSubmitting(false);
            toast.error("Payment was cancelled. Stock has been restored.");
            try {
              await (
                supabase as unknown as {
                  rpc: (name: string, args: { order_id: string }) => Promise<void>;
                }
              ).rpc("cancel_abandoned_order", { order_id: orderId });
            } catch (dismissErr) {
              console.warn("[BuyNow] Failed to cancel abandoned order on dismiss:", dismissErr);
            }
          },
        },
        theme: {
          color: "#db2777",
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
      ).Razorpay(options as Record<string, unknown>);
      rzp.on("payment.failed", (response: { error: { description: string } }) => {
        toast.error(response.error?.description || "Payment failed at gateway");
      });
      rzp.open();
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
