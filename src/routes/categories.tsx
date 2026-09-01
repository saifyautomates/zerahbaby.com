import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Search, ChevronRight, Sparkles, Layers, Package, ArrowRight } from "lucide-react";
import {
  useCategories,
  useProducts,
  ageGroups,
  categoriesQueryOptions,
  productsQueryOptions,
} from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { LazyImage } from "@/components/ui/LazyImage";

export const Route = createFileRoute("/categories")({
  loader: async ({ context }) => {
    const [categories, products] = await Promise.all([
      context.queryClient.ensureQueryData(categoriesQueryOptions()),
      context.queryClient.ensureQueryData(productsQueryOptions(false)),
    ]).catch(() => [[], []]);
    return {
      categories,
      products,
    };
  },
  head: () => ({
    meta: [
      { title: "All Categories — Zerah Baby And Kid's" },
      {
        name: "description",
        content:
          "Explore all baby and kids collections at Zérah: soft organic clothing, safety-tested wooden toys, nursery care essentials, and premium travel gear.",
      },
      { property: "og:title", content: "All Categories — Zerah Baby And Kid's" },
      {
        property: "og:description",
        content:
          "Browse gentle essentials for babies and kids curated by parents in Kota, Rajasthan.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://zerahkids.com/categories" },
    ],
    links: [{ rel: "canonical", href: "https://zerahkids.com/categories" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: "https://zerahkids.com",
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Categories",
              item: "https://zerahkids.com/categories",
            },
          ],
        }),
      },
    ],
  }),
  component: CategoriesPage,
});

function CategoriesPage() {
  const loaderData = Route.useLoaderData();
  const { data: categories = [], isLoading: catLoading } = useQuery({
    ...categoriesQueryOptions(),
    initialData: loaderData?.categories ?? undefined,
  });
  const { data: products = [] } = useQuery({
    ...productsQueryOptions(false),
    initialData: loaderData?.products ?? undefined,
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Calculate product counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      const cat = p.category?.toLowerCase();
      if (cat) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [products]);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.tagline?.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q),
    );
  }, [categories, searchQuery]);

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Hero / Header Section */}
      <section className="bg-gradient-to-b from-primary/5 via-secondary/30 to-background border-b border-border/60 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-bold text-primary mb-3 shadow-2xs">
            <Sparkles className="size-3.5" /> Curated Collections
          </div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground">
            Explore All Categories
          </h1>
          <p className="mt-2.5 max-w-xl mx-auto text-sm sm:text-base text-muted-foreground leading-relaxed">
            Everything your little ones need, lovingly curated from everyday organics to trusted
            gear.
          </p>

          {/* Quick Search Input */}
          <div className="mt-6 max-w-md mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search category or collection..."
              className="w-full rounded-full border border-border bg-card py-2.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none shadow-xs transition-all"
            />
          </div>
        </div>
      </section>

      {/* Age Groups Quick Filter Chips */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-5 border-b border-border/40 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 min-w-max">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground mr-1 flex items-center gap-1">
            <Layers className="size-3.5" /> Shop by Age:
          </span>
          {ageGroups.map((age) => (
            <Link
              key={age}
              to="/shop"
              search={{ age }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200 shadow-2xs"
            >
              {age}
            </Link>
          ))}
          <Link
            to="/shop"
            search={{}}
            className="rounded-full bg-primary/10 border border-primary/20 px-3.5 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-200 shadow-2xs"
          >
            All Products →
          </Link>
        </div>
      </section>

      {/* Categories Grid */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-8">
        {catLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-5 sm:gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-[280px] sm:h-[320px] rounded-3xl bg-muted/40 animate-pulse border border-border/60 p-6 flex flex-col justify-between"
              >
                <div className="h-6 w-20 rounded-full bg-muted/70" />
                <div className="space-y-2">
                  <div className="h-7 w-48 rounded-xl bg-muted/70" />
                  <div className="h-4 w-64 rounded-lg bg-muted/50" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 text-muted-foreground">
              <Package className="size-8" />
            </div>
            <h2 className="text-lg font-bold text-foreground">
              No categories match "{searchQuery}"
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Try a different keyword or view all products.
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition"
            >
              Clear Search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-5 sm:gap-6">
            {filteredCategories.map((c) => {
              const count =
                categoryCounts[c.slug.toLowerCase()] ?? categoryCounts[c.name.toLowerCase()] ?? 0;
              return (
                <Link
                  key={c.slug}
                  to="/shop"
                  search={{ category: c.slug }}
                  className="group relative overflow-hidden rounded-3xl border border-border/80 bg-card shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col h-[280px] sm:h-[320px]"
                >
                  {/* Background Image with subtle zoom on hover */}
                  <div className="absolute inset-0 overflow-hidden bg-muted">
                    <LazyImage
                      src={c.image}
                      alt={c.name}
                      placeholderSrc={c.image}
                      width={800}
                      height={600}
                      className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10 transition-opacity group-hover:opacity-95" />
                  </div>

                  {/* Top Badge: Item count */}
                  <div className="relative z-10 p-5 sm:p-6 flex justify-between items-start">
                    <span className="rounded-full bg-white/20 backdrop-blur-md border border-white/30 px-3 py-1 text-[11px] font-bold text-white shadow-xs">
                      {count > 0 ? `${count} Items` : "Explore"}
                    </span>
                    <div className="size-9 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white transition-transform duration-300 group-hover:translate-x-1 group-hover:bg-primary group-hover:border-primary">
                      <ArrowRight className="size-4" />
                    </div>
                  </div>

                  {/* Bottom Content */}
                  <div className="relative z-10 mt-auto p-5 sm:p-6 text-white">
                    <h2 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-sm">
                      {c.name}
                    </h2>
                    {c.tagline && (
                      <p className="mt-1 text-xs sm:text-sm text-white/85 line-clamp-2 leading-relaxed">
                        {c.tagline}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-amber-300 group-hover:text-white transition-colors">
                      <span>Shop {c.name}</span>
                      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
