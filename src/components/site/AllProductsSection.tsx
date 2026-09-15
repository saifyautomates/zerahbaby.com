import { useState, useMemo, memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  SlidersHorizontal,
  Search,
  X,
  PackageSearch,
  ArrowRight,
  Filter,
} from "lucide-react";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { type Product, type Category, productsQueryOptions, matchesAgeGroup } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { useAdminMode } from "@/lib/admin-mode";
import { safeLazy } from "@/lib/safe-lazy";
import { Suspense } from "react";

const LazyAdminAddProduct = safeLazy(() =>
  import("@/components/admin/InlineAdmin").then((m) => ({ default: m.AdminAddProduct })),
);

function AdminAddProduct(props: { defaultCategory?: string; label?: string; className?: string }) {
  const { adminMode } = useAdminMode();
  if (!adminMode) return null;
  return (
    <Suspense fallback={null}>
      <LazyAdminAddProduct {...props} />
    </Suspense>
  );
}

const PAGE_SIZE = 12;
const AGE_GROUPS = ["All", "0-6m", "6-12m", "12-24m", "2-4y", "4-8y", "8-16y"];

type SortOption = "featured" | "newest" | "price_asc" | "price_desc" | "rating";

interface AllProductsSectionProps {
  initialProducts?: Product[];
  categories?: Category[];
  isLoading?: boolean;
}

export const AllProductsSection = memo(function AllProductsSection({
  initialProducts,
  categories = [],
  isLoading: initialLoading = false,
}: AllProductsSectionProps) {
  const { adminMode } = useAdminMode();

  // Ensure live synchronization with the single source of truth: Supabase products query
  const { data: liveProducts, isLoading } = useQuery({
    ...productsQueryOptions(false),
    initialData: initialProducts,
  });

  const products = liveProducts || initialProducts || [];

  // Local interactive filter and sort states
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedAge, setSelectedAge] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("featured");
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // Compute category item counts dynamically from active catalog
  const categoryTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      const cat = (p.category || "").toLowerCase().trim();
      if (cat) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }

    const tabs: Array<{ slug: string; name: string; count: number }> = [
      { slug: "all", name: "All Products", count: products.length },
    ];

    if (categories && categories.length > 0) {
      for (const c of categories) {
        const cSlug = c.slug.toLowerCase().trim();
        const count = counts[cSlug] || 0;
        if (count > 0 || adminMode) {
          tabs.push({ slug: c.slug, name: c.name, count });
        }
      }
    } else {
      // Fallback: derive categories directly from products
      Object.keys(counts).forEach((catSlug) => {
        const formattedName = catSlug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        tabs.push({ slug: catSlug, name: formattedName, count: counts[catSlug] });
      });
    }

    return tabs;
  }, [products, categories, adminMode]);

  // Filtered & Sorted master product list
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // 1. Category Filter
    if (selectedCategory !== "all") {
      const targetCat = selectedCategory.toLowerCase().trim();
      result = result.filter((p) => {
        const pCat = (p.category || "").toLowerCase().trim();
        return pCat === targetCat || pCat.includes(targetCat);
      });
    }

    // 2. Age Filter
    if (selectedAge !== "All") {
      result = result.filter((p) => matchesAgeGroup(p.ageGroup, selectedAge, p.variants));
    }

    // 3. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const desc = (p.description || "").toLowerCase();
        const brand = (p.brand || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        return (
          name.includes(q) ||
          desc.includes(q) ||
          brand.includes(q) ||
          sku.includes(q) ||
          (p.variants || []).some(
            (v: any) =>
              (v.name || "").toLowerCase().includes(q) ||
              (v.sku || "").toLowerCase().includes(q) ||
              (v.color || "").toLowerCase().includes(q) ||
              (v.size || "").toLowerCase().includes(q),
          )
        );
      });
    }

    // 4. Sorting
    switch (sortBy) {
      case "newest":
        result.sort((a, b) => {
          const tA = (a as any).created_at ? new Date((a as any).created_at).getTime() : 0;
          const tB = (b as any).created_at ? new Date((b as any).created_at).getTime() : 0;
          return tB - tA;
        });
        break;
      case "price_asc":
        result.sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case "price_desc":
        result.sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case "rating":
        result.sort((a, b) => (b.rating || 5) - (a.rating || 5));
        break;
      case "featured":
      default:
        // Use sort_order if available, otherwise preserve canonical database catalog ordering
        result.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        break;
    }

    return result;
  }, [products, selectedCategory, selectedAge, searchQuery, sortBy]);

  // Paginated slice for current page
  const visibleProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleCount);
  }, [filteredProducts, visibleCount]);

  const hasMore = visibleCount < filteredProducts.length;

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  const handleCategoryChange = (catSlug: string) => {
    setSelectedCategory(catSlug);
    setVisibleCount(PAGE_SIZE);
  };

  const handleAgeChange = (age: string) => {
    setSelectedAge(age);
    setVisibleCount(PAGE_SIZE);
  };

  const resetFilters = () => {
    setSelectedCategory("all");
    setSelectedAge("All");
    setSearchQuery("");
    setSortBy("featured");
    setVisibleCount(PAGE_SIZE);
  };

  const isFiltering =
    selectedCategory !== "all" ||
    selectedAge !== "All" ||
    searchQuery.trim().length > 0 ||
    sortBy !== "featured";

  return (
    <section
      id="all-products"
      aria-label="All Products"
      className="relative w-full py-12 sm:py-16 md:py-20 border-t border-border/40 bg-background/50"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Section Header ── */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary mb-2.5">
              <Sparkles className="size-3.5" />
              <span>Complete Catalog · Live Inventory</span>
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
              All Products
            </h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Explore our full collection of certified organic babywear, safe toys, and everyday essentials.
            </p>
          </div>

          {/* Header Action: Admin Quick Add & Shop Link */}
          <div className="flex items-center gap-3">
            {adminMode && (
              <AdminAddProduct
                defaultCategory={selectedCategory !== "all" ? selectedCategory : undefined}
                label="+ Add Product"
                className="rounded-full shadow-sm"
              />
            )}
            <Link
              to="/shop"
              search={{}}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-primary hover:text-primary/80 transition group"
            >
              <span>View full shop</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        {/* ── Controls Bar: Category Pills + Search + Sort ── */}
        <div className="space-y-3 pb-6">
          {/* Horizontal Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 scroll-smooth">
            {categoryTabs.map((tab) => {
              const isSelected = selectedCategory === tab.slug;
              return (
                <button
                  key={tab.slug}
                  type="button"
                  onClick={() => handleCategoryChange(tab.slug)}
                  className={`focus-ring shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm scale-100"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span>{tab.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      isSelected
                        ? "bg-primary-foreground/20 text-primary-foreground font-bold"
                        : "bg-background/80 text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sub-controls: Age filters, Search, and Sort */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            {/* Age Group Chips */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              <span className="text-[11px] font-bold text-muted-foreground/70 uppercase tracking-wider mr-1 shrink-0">
                Age:
              </span>
              {AGE_GROUPS.map((age) => {
                const isSelected = selectedAge === age;
                return (
                  <button
                    key={age}
                    type="button"
                    onClick={() => handleAgeChange(age)}
                    className={`focus-ring shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      isSelected
                        ? "bg-foreground text-background font-bold"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {age}
                  </button>
                );
              })}
            </div>

            {/* Quick Search & Sort */}
            <div className="flex items-center gap-2">
              {/* Search Bar */}
              <div className="relative flex-1 sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  placeholder="Search all products..."
                  className="w-full rounded-full border border-border/80 bg-background/80 pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <select
                aria-label="Sort products"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-full border border-border/80 bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs cursor-pointer"
              >
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="rating">Top Rated</option>
              </select>

              {/* Reset Filters (shown only when filtering) */}
              {isFiltering && (
                <button
                  type="button"
                  onClick={resetFilters}
                  title="Reset all filters"
                  className="flex size-7 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Product Grid ── */}
        {isLoading || initialLoading ? (
          <ProductGridSkeleton count={8} />
        ) : visibleProducts.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {visibleProducts.map((product) => (
              <ProductCard key={product.uuid || product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border py-16 text-center px-4">
            <PackageSearch className="size-12 text-muted-foreground/40 mb-3" />
            <h3 className="font-bold text-foreground text-base">No products found</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              {searchQuery
                ? `No products match your search "${searchQuery}". Try a different keyword.`
                : "No products match the selected filters."}
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* ── Pagination / Load More Footer ── */}
        {filteredProducts.length > 0 && (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-xs text-muted-foreground font-medium">
              Showing{" "}
              <span className="font-bold text-foreground">
                {Math.min(visibleCount, filteredProducts.length)}
              </span>{" "}
              of <span className="font-bold text-foreground">{filteredProducts.length}</span> products
            </p>

            {hasMore ? (
              <button
                type="button"
                onClick={handleLoadMore}
                className="focus-ring press inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-xs sm:text-sm font-bold text-foreground shadow-premium-sm transition-all duration-200 hover:bg-muted hover:shadow-premium-md active:scale-98 cursor-pointer"
              >
                <span>Load More Products</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-semibold">
                  +{Math.min(PAGE_SIZE, filteredProducts.length - visibleCount)}
                </span>
              </button>
            ) : filteredProducts.length > PAGE_SIZE ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded-full px-4 py-1.5">
                <span>You've reached the end of the collection</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
});
