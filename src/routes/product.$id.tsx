import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star, Truck, RotateCcw, ShieldCheck, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { discountPct, formatPrice, useProducts } from "@/lib/store";
import { useCart } from "@/lib/cart";
import { useSession } from "@/lib/auth";
import { useProductReviews, useSubmitReview } from "@/lib/reviews";
import { trackEvent } from "@/lib/analytics";
import { ProductCard } from "@/components/site/ProductCard";
import { AdminProductControls } from "@/components/admin/InlineAdmin";

export const Route = createFileRoute("/product/$id")({
  head: () => ({
    meta: [
      { title: "Product — Zerah Baby And Kids" },
      {
        name: "description",
        content: "Product details, highlights, pricing and delivery info at Zerah Baby And Kids.",
      },
      { property: "og:title", content: "Product — Zerah Baby And Kids" },
      {
        property: "og:description",
        content: "Product details, highlights and pricing at Zerah Baby And Kids.",
      },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { id } = Route.useParams();
  const { data: products, isLoading } = useProducts();
  const { add } = useCart();
  const { user } = useSession();
  const [qty, setQty] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  const list = products ?? [];
  const product = list.find((p) => p.id === id);
  const gallery = (product?.images.length ? product.images : [product?.image]).filter(
    Boolean,
  ) as string[];
  const soldOut = (product?.stock ?? 0) <= 0;

  // Track product view
  useEffect(() => {
    if (product) {
      trackEvent("product_view", { productId: product.uuid, metadata: { slug: product.id, name: product.name } });
    }
  }, [product?.uuid]);

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

  const related = list
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary">
          Home
        </Link>{" "}
        /{" "}
        <Link to="/shop" search={{ category: product.category } as any} className="hover:text-primary">
          {product.category}
        </Link>{" "}
        / <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="relative">
          <AdminProductControls product={product} />
          {(() => {
            const activeUrl = gallery[activeImage] ?? product.image;
            const isVideo = activeUrl.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
            return isVideo ? (
              <video
                src={activeUrl}
                className="w-full rounded-3xl border border-border object-cover"
                autoPlay
                muted
                loop
                playsInline
                controls
              />
            ) : (
              <img
                src={activeUrl}
                alt={product.name}
                width={800}
                height={800}
                className="w-full rounded-3xl border border-border object-cover"
              />
            );
          })()}
          {gallery.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {gallery.map((url, i) => {
                const isVideo = url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i);
                return (
                  <button
                    key={url}
                    onClick={() => setActiveImage(i)}
                    aria-label={`View media ${i + 1}`}
                    className={`size-16 overflow-hidden rounded-xl border-2 transition ${
                      i === activeImage ? "border-primary" : "border-border hover:border-primary/50"
                    }`}
                  >
                    {isVideo ? (
                      <video src={url} className="size-full object-cover" playsInline muted />
                    ) : (
                      <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                    )}
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
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight">{product.name}</h1>

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
            <button
              disabled={soldOut}
              onClick={() => {
                add(product.id, qty);
                trackEvent("add_to_cart", { productId: product.uuid, metadata: { qty, from: "product_page" } });
                toast.success("Added to bag", { description: `${qty} × ${product.name}` });
              }}
              className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {soldOut ? "Sold out" : "Add to bag"}
            </button>
            {!soldOut && (
              <Link
                to="/cart"
                onClick={() => {
                  add(product.id, qty);
                  trackEvent("buy_now", { productId: product.uuid, metadata: { qty } });
                }}
                className="rounded-full border border-border px-8 py-3 text-sm font-semibold transition hover:bg-muted"
              >
                Buy now
              </Link>
            )}
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

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-2xl font-bold">You may also like</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <ProductCard key={r.id} product={r} />
            ))}
          </div>
        </section>
      )}

      {/* Reviews Section */}
      {product && <ReviewsSection product={product} user={user} />}
    </div>
  );
}

function ReviewsSection({ product, user }: { product: any; user: any }) {
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
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Verified Purchase</span>
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
        <p className="mt-4 text-sm text-muted-foreground">No reviews yet. Be the first to review this product!</p>
      )}

      {submitted && (
        <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary/10">
            <Star className="size-6 fill-primary text-primary" />
          </div>
          <h3 className="font-display text-xl font-bold text-foreground">Thank you for your review! 🌟</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your feedback helps us grow and helps other parents make great choices! If you love what we do, would you mind taking 10 seconds to share your experience on Google?
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
                <button
                  key={i}
                  type="button"
                  onClick={() => setRating(i + 1)}
                >
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
