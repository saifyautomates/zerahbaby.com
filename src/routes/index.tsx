//
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Truck, RotateCcw, Sparkles, Star, Images } from "lucide-react";
import { useCategories, useProducts, useSettings } from "@/lib/store";
import { useHeroMedia } from "@/lib/hero-media";
import { useAdminMode } from "@/lib/admin-mode";
import { HeroMedia } from "@/components/site/HeroMedia";
import { HeroMediaDialog } from "@/components/admin/HeroMediaManager";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { CategoryCarousel } from "@/components/site/CategoryCarousel";
import { AdminAddProduct, AdminEditableText } from "@/components/admin/InlineAdmin";
import heroFallback from "@/assets/hero-baby.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zerah Baby And Kids — Clothing, Toys, Diapers & Gear" },
      {
        name: "description",
        content:
          "Shop baby and kids essentials at Zerah Baby And Kids: organic clothing, wooden toys, diapers, skincare, strollers and car seats. Free delivery over ₹999.",
      },
      { property: "og:title", content: "Zerah Baby And Kids — Everything Your Little One Needs" },
      {
        property: "og:description",
        content:
          "Organic baby clothing, safe toys, nursery care and travel gear, curated by parents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const perks = [
  { icon: Truck, title: "Free delivery", text: "On every order above ₹999" },
  { icon: RotateCcw, title: "7-day returns", text: "Unused, unwashed, original packaging" },
  { icon: Sparkles, title: "Gentle materials", text: "Organic & non-toxic first" },
];

/** Shown until an admin uploads their own hero photos or videos. */
const defaultHeroSlides = [
  {
    id: "default-hero",
    type: "image" as const,
    url: heroFallback,
    alt: "Baby essentials from Zerah Baby And Kids",
  },
];

function Index() {
  const { data: products, isLoading } = useProducts();
  const { data: categories } = useCategories();
  const { heroTitle, heroSubtitle } = useSettings();
  const { data: heroSlides } = useHeroMedia();
  const { adminMode } = useAdminMode();
  const [heroEditor, setHeroEditor] = useState(false);

  const slides = heroSlides && heroSlides.length > 0 ? heroSlides : defaultHeroSlides;
  const hasMedia = slides.length > 0;

  const list = products ?? [];
  const bestsellers = [...list].sort((a, b) => b.reviews - a.reviews).slice(0, 8);
  const deals = [...list]
    .sort((a, b) => (b.mrp - b.price) / (b.mrp || 1) - (a.mrp - a.price) / (a.mrp || 1))
    .slice(0, 4);

  return (
    <div>
      <section
        aria-label="Welcome to Zerah Baby And Kids"
        className={`relative isolate overflow-hidden ${
          hasMedia ? "bg-black" : "bg-gradient-to-b from-secondary via-secondary/60 to-background"
        }`}
      >
        {hasMedia ? (
          <>
            <HeroMedia slides={slides} />
          </>
        ) : (
          <>
            <span className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
            <span className="pointer-events-none absolute -right-16 top-20 size-80 rounded-full bg-accent/25 blur-3xl" />
          </>
        )}

        <div
          className={`relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 text-center ${
            hasMedia
              ? "min-h-[74svh] justify-center py-16 sm:py-24 md:min-h-[78vh] md:py-32"
              : "py-14 sm:py-20 md:py-28"
          }`}
        >
          <span
            className={`rise-in inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] backdrop-blur sm:px-4 sm:text-xs sm:tracking-[0.18em] ${
              hasMedia
                ? "border-background/40 bg-background/15 text-background"
                : "border-border bg-background/80 text-primary"
            }`}
          >
            <Sparkles className="size-3.5 shrink-0" />{" "}
            <span className="truncate">New arrivals · Baby essentials</span>
          </span>
          <AdminEditableText settingKey="hero_title" value={heroTitle}>
            <h1
              className={`rise-in delay-1 mt-6 font-display text-[2rem] font-bold leading-[1.08] sm:mt-7 sm:text-5xl md:text-6xl ${
                hasMedia ? "text-background drop-shadow-md" : "text-foreground"
              }`}
            >
              {heroTitle}
            </h1>
          </AdminEditableText>
          <AdminEditableText settingKey="hero_subtitle" value={heroSubtitle} multiline>
            <p
              className={`rise-in delay-2 mx-auto mt-4 max-w-2xl text-sm leading-relaxed sm:mt-6 sm:text-base md:text-lg ${
                hasMedia ? "text-background/90" : "text-muted-foreground"
              }`}
            >
              {heroSubtitle}
            </p>
          </AdminEditableText>

          <div className="rise-in delay-3 mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:mt-10 sm:w-auto sm:flex-row sm:flex-wrap">
            <Link
              to="/shop"
              className="focus-ring rounded-full bg-primary px-8 py-3.5 text-sm font-semibold tracking-wide text-primary-foreground shadow-lg shadow-primary/25 transition duration-300 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl"
            >
              Shop all products
            </Link>
            <Link
              to="/shop"
              search={{ category: "clothing" }}
              className={`focus-ring rounded-full border px-8 py-3.5 text-sm font-semibold tracking-wide transition duration-300 hover:-translate-y-0.5 ${
                hasMedia
                  ? "border-background/50 bg-background/10 text-background backdrop-blur hover:bg-background/25"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              Explore clothing
            </Link>
          </div>

          <ul
            className={`rise-in delay-4 mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold sm:mt-12 sm:gap-x-8 sm:gap-y-3 sm:text-sm ${
              hasMedia ? "text-background/90" : "text-muted-foreground"
            }`}
          >
            {[
              { icon: Truck, text: "Free delivery over ₹999" },
              { icon: RotateCcw, text: "7-day easy returns" },
            ].map((f) => (
              <li key={f.text} className="flex min-w-0 items-center gap-2">
                <f.icon
                  className={`size-4 shrink-0 ${hasMedia ? "text-accent" : "text-primary"}`}
                />
                {f.text}
              </li>
            ))}
          </ul>

          {adminMode && (
            <button
              type="button"
              onClick={() => setHeroEditor(true)}
              className="focus-ring mt-9 inline-flex items-center gap-2 rounded-full border border-dashed border-accent bg-background/90 px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
            >
              <Images className="size-4" /> Manage hero photos & videos
            </button>
          )}
        </div>
      </section>

      {heroEditor && <HeroMediaDialog onClose={() => setHeroEditor(false)} />}

      <section className="mx-auto max-w-7xl px-4 py-10">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {perks.map((perk) => (
            <li
              key={perk.title}
              className="flex items-center gap-3 rounded-2xl border border-border p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                <perk.icon className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-balance">{perk.title}</span>
                <span className="block text-xs text-muted-foreground text-balance">
                  {perk.text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-full py-10">
        <div className="mx-auto flex max-w-7xl items-end justify-between px-4 sm:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Shop by category</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Explore all curated collections for babies and kids
            </p>
          </div>
          <Link to="/shop" className="text-sm font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-6 w-full">
          <CategoryCarousel categories={categories ?? []} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Bestsellers</h2>
          <div className="flex items-center gap-3">
            <AdminAddProduct label="Add product" />
            <Link to="/shop" className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
        </div>

        {isLoading ? (
          <ProductGridSkeleton />
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {bestsellers.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-3xl bg-secondary p-6 md:p-10">
          <h2 className="font-display text-2xl font-bold">Deals of the week</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Biggest savings across the store, refreshed every Monday.
          </p>
          <AdminAddProduct label="Add a deal product" className="mt-4" />

          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {deals.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <h2 className="font-display text-2xl font-bold">Loved by parents</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {[
            {
              name: "Ananya R.",
              text: "The organic onesies survived a hundred washes and still feel soft. My go-to gift now.",
            },
            {
              name: "Vikram S.",
              text: "Stroller arrived a day early and folds with one hand while holding the baby. Brilliant.",
            },
            {
              name: "Meera J.",
              text: "Finally wipes that don't irritate my daughter's skin. Reordering on subscription.",
            },
          ].map((r) => (
            <figure key={r.name} className="rounded-2xl border border-border p-6">
              <div className="flex gap-0.5 text-accent">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-4 fill-accent" />
                ))}
              </div>
              <blockquote className="mt-3 text-sm text-muted-foreground">“{r.text}”</blockquote>
              <figcaption className="mt-4 text-sm font-semibold">{r.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
