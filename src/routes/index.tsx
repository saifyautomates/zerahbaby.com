//
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Truck,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  Images,
  Star,
  ChevronRight,
  Baby,
} from "lucide-react";
import { useCategories, useProducts, useSettings } from "@/lib/store";
import { useHeroMedia } from "@/lib/hero-media";
import { useAdminMode } from "@/lib/admin-mode";
import { HeroMedia } from "@/components/site/HeroMedia";
import { HeroMediaDialog } from "@/components/admin/HeroMediaManager";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { CategoryCarousel } from "@/components/site/CategoryCarousel";
import {
  AdminAddProduct,
  AdminAddCategory,
  AdminEditableText,
} from "@/components/admin/InlineAdmin";
import heroFallback from "@/assets/hero-baby.jpg";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { productsQueryOptions, categoriesQueryOptions } from "@/lib/store";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(productsQueryOptions(false)),
      context.queryClient.ensureQueryData(categoriesQueryOptions()),
    ]).catch(() => null);
  },
  head: () => ({
    meta: [
      { title: "Zerah Baby And Kid's — Clothing, Toys, Diapers & Gear" },
      {
        name: "description",
        content:
          "Shop Baby And Kid's essentials at Zerah Baby And Kid's: organic clothing, wooden toys, diapers, skincare, strollers and car seats. Free delivery over ₹999.",
      },
      { property: "og:title", content: "Zerah Baby And Kid's — Everything Your Little One Needs" },
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
  { icon: Sparkles, title: "100% Organic", text: "Safe & non-toxic for babies" },
  { icon: Truck, title: "Fast Delivery", text: "Free shipping over ₹999" },
  { icon: RotateCcw, title: "7-Day Returns", text: "Easy and hassle-free" },
  { icon: ShieldCheck, title: "Secure Payments", text: "100% safe checkout" },
];

/** Shown until an admin uploads their own hero photos or videos. */
const defaultHeroSlides = [
  {
    id: "default-hero",
    type: "image" as const,
    url: heroFallback,
    alt: "Baby essentials from Zerah Baby And Kid's",
  },
];

function Index() {
  const { data: products, isLoading } = useProducts();
  const { data: categories } = useCategories();
  const { heroTitle, heroSubtitle } = useSettings();
  const { data: heroSlides } = useHeroMedia();
  const { adminMode } = useAdminMode();
  const [heroEditor, setHeroEditor] = useState(false);

  const { data: realReviews } = useQuery({
    queryKey: ["homepage-reviews"],
    staleTime: 1000 * 60 * 30, // 30 minutes caching
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("reviews")
          .select("rating, comment")
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(3);
        if (error) return null;
        return data;
      } catch {
        return null;
      }
    },
  });

  const displayReviews =
    realReviews && realReviews.length > 0
      ? realReviews.map((r: { rating: number; comment: string }) => {
          return {
            name: "Verified Parent",
            text: r.comment,
            rating: r.rating,
          };
        })
      : [
          {
            name: "Ananya",
            text: "The organic onesies survived a hundred washes and still feel soft. My go-to gift now.",
            rating: 5,
          },
          {
            name: "Vikram",
            text: "Stroller arrived a day early and folds with one hand while holding the baby. Brilliant.",
            rating: 5,
          },
          {
            name: "Meera",
            text: "Finally wipes that don't irritate my daughter's skin. Reordering on subscription.",
            rating: 5,
          },
        ];

  const slides = heroSlides && heroSlides.length > 0 ? heroSlides : defaultHeroSlides;
  const hasMedia = slides.length > 0;

  const list = products ?? [];
  const bestsellers = [...list].sort((a, b) => b.reviews - a.reviews).slice(0, 8);
  const deals = [...list]
    .sort((a, b) => (b.mrp - b.price) / (b.mrp || 1) - (a.mrp - a.price) / (a.mrp || 1))
    .slice(0, 4);

  return (
    <div>
      {/* Mobile Circular Categories Row (App style) */}
      <section className="md:hidden w-full px-4 py-5 bg-background overflow-x-auto no-scrollbar">
        <div className="flex gap-4 items-start min-w-max">
          <Link to="/shop" search={{}} className="flex flex-col items-center gap-2 group w-[72px]">
            <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center p-3 group-hover:bg-primary/10 transition-colors border border-border/40 shadow-sm">
              <Baby className="size-full text-muted-foreground/70" />
            </div>
            <span className="text-[10px] font-bold text-center leading-tight text-foreground/80">
              All
              <br />
              Products
            </span>
          </Link>

          {(categories ?? []).map((c) => (
            <Link
              key={c.slug}
              to="/shop"
              search={{ category: c.slug }}
              className="flex flex-col items-center gap-2 group w-[72px]"
            >
              <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center p-1 group-hover:bg-primary/10 transition-colors border border-border/40 overflow-hidden shadow-sm">
                {c.image ? (
                  <img
                    loading="lazy"
                    decoding="async"
                    src={c.image}
                    alt={c.name}
                    className="size-full object-cover rounded-full"
                  />
                ) : (
                  <div className="size-full bg-muted rounded-full" />
                )}
              </div>
              <span className="text-[10px] font-bold text-center leading-tight text-foreground/80 line-clamp-2">
                {c.name.replace(" & ", "\n& ")}
              </span>
            </Link>
          ))}

          <Link to="/shop" search={{}} className="flex flex-col items-center gap-2 group w-[72px]">
            <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center group-hover:bg-primary/10 transition-colors border border-border/40 shadow-sm">
              <ChevronRight className="size-6 text-muted-foreground/60" />
            </div>
            <span className="text-[10px] font-bold text-center leading-tight text-foreground/80">
              View
              <br />
              All
            </span>
          </Link>
        </div>
      </section>

      <section
        aria-label="Welcome to Zerah Baby And Kid's"
        className={`relative isolate overflow-hidden mx-3 mt-1 rounded-[2rem] md:mx-0 md:mt-0 md:rounded-none shadow-sm md:shadow-none ${
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
              ? "min-h-[74svh] justify-center pt-16 pb-24 sm:py-24 md:min-h-[78vh] md:py-32"
              : "pt-14 pb-20 sm:py-20 md:py-28"
          }`}
        >
          <span
            className={`rise-in inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] backdrop-blur sm:px-4 sm:text-xs sm:tracking-[0.18em] ${
              hasMedia
                ? "border-background/40 bg-background/15 text-background"
                : "border-border bg-background/80 text-primary"
            }`}
          >
            <Sparkles className="size-3.5 shrink-0" /> <span>New arrivals · Baby essentials</span>
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

          <div className="rise-in delay-3 mt-8 flex w-full flex-row items-center justify-center gap-2.5 sm:mt-10 sm:w-auto sm:flex-wrap px-2">
            <Link
              to="/shop"
              className="flex-1 sm:flex-none focus-ring press rounded-full bg-primary px-4 sm:px-8 py-3.5 text-xs sm:text-sm font-semibold tracking-wide text-primary-foreground shadow-premium-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-premium-hover text-center"
            >
              <span className="sm:hidden">Shop all</span>
              <span className="hidden sm:inline">Shop all products</span>
            </Link>
            <Link
              to="/shop"
              search={{ category: "clothing" }}
              className={`flex-1 sm:flex-none focus-ring rounded-full border px-4 sm:px-8 py-3.5 text-xs sm:text-sm font-semibold tracking-wide transition duration-300 hover:-translate-y-0.5 text-center ${
                hasMedia
                  ? "border-background/50 bg-background/10 text-background backdrop-blur hover:bg-background/25"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              <span className="sm:hidden">Clothing</span>
              <span className="hidden sm:inline">Explore clothing</span>
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

      <section className="mx-auto max-w-7xl px-4 py-8 md:py-12 relative z-20">
        {/* Mobile App-style Perks */}
        <div className="md:hidden flex items-start justify-between gap-1 border-b border-border/60 pb-8 mb-4 pt-2">
          <div className="flex flex-col items-center gap-2 text-center w-1/3">
            <Truck className="size-5 text-amber-500" strokeWidth={1.5} />
            <span className="text-[10px] font-semibold leading-tight text-foreground/80">
              Free delivery
              <br />
              over ₹999
            </span>
          </div>
          <div className="w-[1px] h-10 bg-border/50 self-center"></div>
          <div className="flex flex-col items-center gap-2 text-center w-1/3">
            <RotateCcw className="size-5 text-amber-700" strokeWidth={1.5} />
            <span className="text-[10px] font-semibold leading-tight text-foreground/80">
              7-day easy
              <br />
              returns
            </span>
          </div>
          <div className="w-[1px] h-10 bg-border/50 self-center"></div>
          <div className="flex flex-col items-center gap-2 text-center w-1/3">
            <ShieldCheck className="size-5 text-amber-600" strokeWidth={1.5} />
            <span className="text-[10px] font-semibold leading-tight text-foreground/80">
              Safe & secure
              <br />
              payments
            </span>
          </div>
        </div>

        {/* Mobile Shop by Age */}
        <div className="md:hidden w-full pb-6 pt-2">
          <div className="flex items-end justify-between mb-4 px-1">
            <h2 className="font-display text-lg font-bold">Shop by Age</h2>
            <Link to="/shop" className="text-[11px] font-semibold text-primary">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Baby, age: "0-6m", color: "text-indigo-400 bg-indigo-50" },
              { icon: Baby, age: "6-12m", color: "text-emerald-400 bg-emerald-50" },
              { icon: Baby, age: "12-24m", color: "text-amber-400 bg-amber-50" },
              { icon: Baby, age: "2-4y", color: "text-rose-400 bg-rose-50" },
            ].map((a) => (
              <Link
                key={a.age}
                to="/shop"
                search={{ age: a.age }}
                className="flex items-center justify-center gap-3 bg-muted/30 rounded-2xl p-3.5 border border-border/50 hover:bg-muted/50 transition-colors"
              >
                <div className={`p-1.5 rounded-full ${a.color.split(" ")[1]}`}>
                  <a.icon className={`size-5 ${a.color.split(" ")[0]}`} />
                </div>
                <span className="text-xs font-bold">{a.age}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Desktop Grid Perks */}
        <ul className="hidden md:grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {perks.map((perk, i) => (
            <li
              key={perk.title}
              className={`flex items-center gap-4 rounded-3xl border border-border/50 bg-background/80 backdrop-blur-xl p-5 shadow-premium-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-premium-md animate-in fade-in slide-in-from-bottom-4`}
              style={{ animationDelay: `${i * 100}ms`, animationFillMode: "both" }}
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <perk.icon className="size-6" />
              </span>
              <span>
                <span className="block text-sm font-bold text-foreground">{perk.title}</span>
                <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground mt-0.5">
                  {perk.text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-full py-10 hidden md:block">
        <div className="mx-auto flex max-w-7xl items-end justify-between px-4 sm:px-6 lg:px-8">
          <div>
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Shop by category</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Explore all curated collections for babies and kids
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AdminAddCategory />
            <Link to="/shop" className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
        </div>
        <div className="mt-6 w-full">
          <CategoryCarousel categories={categories ?? []} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Bestsellers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Top picks loved by parents across India
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AdminAddProduct label="Add product" />
            <Link to="/shop" className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
        </div>

        {isLoading && list.length === 0 ? (
          <ProductGridSkeleton />
        ) : bestsellers.length === 0 ? (
          <div className="mt-8 text-center py-16 px-4 rounded-3xl border border-dashed border-border bg-card/40">
            <p className="text-base font-semibold text-foreground">No products listed yet</p>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto">
              Our curated collection of baby essentials will be appearing here shortly.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {bestsellers.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {deals.length > 0 && (
        <section key="deals-section" className="mx-auto max-w-7xl px-4 py-12">
          <div className="rounded-3xl bg-secondary/40 backdrop-blur-md border border-white/20 shadow-premium-sm p-6 md:p-10 relative overflow-hidden">
            <div className="absolute -top-24 -right-24 size-64 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative z-10">
              <h2 className="font-display text-2xl font-bold">Deals of the week</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Biggest savings across the store, refreshed every Monday.
              </p>
            </div>
            <AdminAddProduct label="Add a deal product" className="mt-4" />

            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {deals.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section key="reviews-section" className="mx-auto max-w-7xl px-4 py-14">
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Loved by parents</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Real words from real families who shop with us
          </p>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {displayReviews.map((r, idx) => (
            <figure
              key={idx}
              className="lift rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex gap-0.5 text-accent">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`size-4 ${i < r.rating ? "fill-accent" : "text-muted"}`}
                  />
                ))}
              </div>
              <blockquote className="mt-3 text-sm leading-relaxed text-muted-foreground">
                “{r.text}”
              </blockquote>
              <figcaption className="mt-4 text-sm font-bold">{r.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
