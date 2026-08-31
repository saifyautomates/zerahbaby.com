import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useCallback } from "react";
import { useCategories, useProducts } from "@/lib/store";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { AdminAddProduct } from "@/components/admin/InlineAdmin";
import { SlidersHorizontal, X, ChevronDown, ChevronUp, PackageSearch } from "lucide-react";

type ShopSearch = {
  category?: string | undefined;
  age?: string | undefined;
  q?: string | undefined;
};

import { productsQueryOptions, categoriesQueryOptions, ageGroups } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/shop")({
  validateSearch: (search: Record<string, unknown>): ShopSearch => ({
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
    age: typeof search["age"] === "string" ? (search["age"] as string) : undefined,
    q: typeof search["q"] === "string" && search["q"] ? (search["q"] as string) : undefined,
  }),
  loader: async ({ context }) => {
    const [products, categories] = await Promise.all([
      context.queryClient.ensureQueryData(productsQueryOptions(false)),
      context.queryClient.ensureQueryData(categoriesQueryOptions()),
    ]).catch(() => [null, null]);
    return { products, categories };
  },
  head: () => ({
    meta: [
      { title: "Shop Baby & Kids Essentials — Zerah Baby And Kid's" },
      {
        name: "description",
        content:
          "Browse the full Zerah Baby And Kid's range: clothing, toys, diapers and skincare, strollers, car seats and carriers. Filter by age, brand and price.",
      },
      { property: "og:title", content: "Shop Baby & Kids Essentials — Zerah Baby And Kid's" },
      {
        property: "og:description",
        content: "Filter baby clothing, toys, care and gear by age, brand and price.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopPage,
});

function FilterPanel({
  brands,
  selectedBrands,
  onBrandToggle,
  maxPrice,
  onMaxPrice,
  inStockOnly,
  onInStockToggle,
  onClearAll,
  hasActiveFilters,
  ageGroupsList,
  selectedAgeGroups,
  onAgeGroupToggle,
}: {
  brands: string[];
  selectedBrands: string[];
  onBrandToggle: (brand: string) => void;
  maxPrice: number;
  onMaxPrice: (v: number) => void;
  inStockOnly: boolean;
  onInStockToggle: () => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  ageGroupsList: string[];
  selectedAgeGroups: string[];
  onAgeGroupToggle: (age: string) => void;
}) {
  const [brandsOpen, setBrandsOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(true);
  const [ageOpen, setAgeOpen] = useState(true);

  return (
    <div className="space-y-5">
      {hasActiveFilters && (
        <button
          onClick={onClearAll}
          className="flex w-full items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
        >
          Clear all filters <X className="size-3.5" />
        </button>
      )}

      {/* In stock toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">In stock only</span>
        <button
          role="switch"
          aria-checked={inStockOnly}
          aria-label="Filter in-stock products only"
          onClick={onInStockToggle}
          className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${
            inStockOnly ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
              inStockOnly ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Price range */}
      <div>
        <button
          onClick={() => setPriceOpen((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold"
        >
          Price range
          {priceOpen ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>
        {priceOpen && (
          <div className="mt-3 space-y-2">
            <input
              type="range"
              min={0}
              max={20000}
              step={100}
              value={maxPrice}
              onChange={(e) => onMaxPrice(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>₹0</span>
              <span className="font-semibold text-foreground">
                Up to ₹{maxPrice.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Age Group */}
      {ageGroupsList.length > 0 && (
        <div>
          <button
            onClick={() => setAgeOpen((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-semibold text-foreground group"
          >
            Age Group
            {ageOpen ? (
              <ChevronUp className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
          {ageOpen && (
            <div className="mt-3 flex flex-wrap gap-2 pr-1">
              {ageGroupsList.map((age) => (
                <button
                  key={age}
                  onClick={() => onAgeGroupToggle(age)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
                    selectedAgeGroups.includes(age)
                      ? "border-primary bg-primary text-primary-foreground shadow-premium-sm"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Brand */}
      {brands.length > 0 && (
        <div>
          <button
            onClick={() => setBrandsOpen((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-semibold"
          >
            Brand
            {brandsOpen ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </button>
          {brandsOpen && (
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
              {brands.map((brand) => (
                <li key={brand}>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedBrands.includes(brand)}
                      onChange={() => onBrandToggle(brand)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="truncate">{brand}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center rounded-3xl border border-border/50 bg-card shadow-premium-sm mt-4 md:mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <span className="mb-6 grid size-24 place-items-center rounded-[2rem] bg-muted shadow-inner relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent mix-blend-multiply opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <PackageSearch className="size-12 text-muted-foreground/50 transition-transform duration-300 group-hover:scale-110" />
      </span>
      <h2 className="font-display text-xl font-bold">
        {hasFilters ? "No products match your filters" : "No products here yet"}
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        {hasFilters
          ? "Try adjusting your filters or clearing them to see more results."
          : "Check back soon — new arrivals are added regularly."}
      </p>
      {hasFilters ? (
        <Link
          to="/shop"
          className="focus-ring mt-8 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover flex items-center justify-center w-max mx-auto block"
        >
          Clear all filters
        </Link>
      ) : (
        <Link
          to="/"
          className="focus-ring mt-8 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground shadow-premium-md transition-all duration-300 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-premium-hover"
        >
          Go to homepage
        </Link>
      )}
    </div>
  );
}

function ShopPage() {
  const { category, age, q } = Route.useSearch();
  const loaderData = Route.useLoaderData();

  const { data: products, isLoading } = useQuery({
    ...productsQueryOptions(false),
    initialData: loaderData?.products ?? undefined,
  });
  const { data: categories } = useQuery({
    ...categoriesQueryOptions(),
    initialData: loaderData?.categories ?? undefined,
  });

  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState<string[]>(age ? [age] : []);
  const [maxPrice, setMaxPrice] = useState(20000);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState("popular");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const list = useMemo(() => products ?? [], [products]);
  const brands = useMemo(
    () => Array.from(new Set(list.map((x) => x.brand).filter(Boolean))).sort(),
    [list],
  );

  const onBrandToggle = useCallback((brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((x) => x !== brand) : [...prev, brand],
    );
  }, []);

  const onAgeGroupToggle = useCallback((ageGroup: string) => {
    setSelectedAgeGroups((prev) =>
      prev.includes(ageGroup) ? prev.filter((x) => x !== ageGroup) : [...prev, ageGroup],
    );
  }, []);

  const onClearAll = useCallback(() => {
    setSelectedBrands([]);
    setSelectedAgeGroups([]);
    setMaxPrice(20000);
    setInStockOnly(false);
  }, []);

  const hasActiveFilters =
    selectedBrands.length > 0 || selectedAgeGroups.length > 0 || maxPrice < 20000 || inStockOnly;

  const visible = useMemo(() => {
    const query = (q ?? "").trim().toLowerCase();
    const filtered = list.filter(
      (p) =>
        (!category || p.category?.toLowerCase().trim() === category.toLowerCase().trim()) &&
        (selectedAgeGroups.length === 0 || selectedAgeGroups.includes(p.ageGroup)) &&
        (selectedBrands.length === 0 || selectedBrands.includes(p.brand)) &&
        p.price <= maxPrice &&
        (!inStockOnly || p.stock > 0) &&
        (!query ||
          [p.name, p.brand, p.description, p.category]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(query))),
    );
    const sorted = [...filtered];
    if (sort === "low") sorted.sort((a, b) => a.price - b.price);
    if (sort === "high") sorted.sort((a, b) => b.price - a.price);
    if (sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
    if (sort === "popular") sorted.sort((a, b) => b.reviews - a.reviews);
    if (sort === "newest") sorted.sort((a, b) => (a.id < b.id ? 1 : -1));
    return sorted;
  }, [list, category, q, selectedBrands, selectedAgeGroups, maxPrice, inStockOnly, sort]);

  const activeCategory = (categories ?? []).find((c) => c.slug === category);
  const hasAnyFilter = hasActiveFilters || !!category || !!q;
  const filterCount =
    selectedBrands.length +
    selectedAgeGroups.length +
    (inStockOnly ? 1 : 0) +
    (maxPrice < 20000 ? 1 : 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumb - Hidden on Mobile */}
      <nav aria-label="Breadcrumb" className="hidden md:block text-xs text-muted-foreground">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link to="/" className="transition hover:text-primary">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            {activeCategory ? (
              <Link to="/shop" search={{}} className="transition hover:text-primary">
                Shop
              </Link>
            ) : (
              <span className="text-foreground">Shop</span>
            )}
          </li>
          {activeCategory && (
            <>
              <li aria-hidden>/</li>
              <li className="text-foreground">{activeCategory.name}</li>
            </>
          )}
          {q && (
            <>
              <li aria-hidden>/</li>
              <li className="text-foreground">Search: "{q}"</li>
            </>
          )}
        </ol>
      </nav>

      {/* Header row */}
      <div className="mt-2 md:mt-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {q
              ? `Results for "${q}"`
              : (activeCategory?.name ?? (age ? `Age: ${age}` : "All products"))}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading
              ? "Loading…"
              : `${visible.length} product${visible.length === 1 ? "" : "s"}${
                  activeCategory
                    ? ` in ${activeCategory.tagline?.toLowerCase() ?? activeCategory.name}`
                    : " across the store"
                }`}
          </p>
        </div>
        <div className="sticky top-[3.75rem] md:static z-40 -mx-4 px-4 py-2 md:p-0 bg-background/95 backdrop-blur-md md:bg-transparent flex items-center justify-between gap-3 border-b border-border/50 md:border-0">
          <div className="hidden md:block">
            <AdminAddProduct
              {...(category ? { defaultCategory: category } : {})}
              label={category ? `Add to ${activeCategory?.name ?? category}` : "Add product"}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full md:w-auto">
            {/* Mobile filter button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition hover:bg-muted lg:hidden whitespace-nowrap shrink-0 shadow-sm"
            >
              <SlidersHorizontal className="size-4" />
              Filters
              {filterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {filterCount}
                </span>
              )}
            </button>
            {/* Sort */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap shrink-0 ml-auto md:ml-0">
              <span className="hidden md:inline">Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-primary shadow-sm"
              >
                <option value="popular">Popularity</option>
                <option value="rating">Rating</option>
                <option value="newest">Newest</option>
                <option value="low">Price: low → high</option>
                <option value="high">Price: high → low</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedBrands.map((b) => (
            <button
              key={b}
              onClick={() => onBrandToggle(b)}
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
            >
              {b} <X className="size-3" />
            </button>
          ))}
          {maxPrice < 20000 && (
            <button
              onClick={() => setMaxPrice(20000)}
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
            >
              Up to ₹{maxPrice.toLocaleString("en-IN")} <X className="size-3" />
            </button>
          )}
          {inStockOnly && (
            <button
              onClick={() => setInStockOnly(false)}
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10"
            >
              In stock only <X className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Main layout: sidebar + grid */}
      <div className="mt-8 flex gap-6 lg:gap-8">
        {/* Desktop filter sidebar */}
        <aside className="hidden w-52 shrink-0 lg:block xl:w-60 2xl:w-64">
          <div className="sticky top-24 rounded-3xl border border-border/60 bg-card p-5 shadow-premium-sm overflow-hidden">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Filters
            </h2>
            <FilterPanel
              brands={brands}
              selectedBrands={selectedBrands}
              onBrandToggle={onBrandToggle}
              ageGroupsList={ageGroups}
              selectedAgeGroups={selectedAgeGroups}
              onAgeGroupToggle={onAgeGroupToggle}
              maxPrice={maxPrice}
              onMaxPrice={setMaxPrice}
              inStockOnly={inStockOnly}
              onInStockToggle={() => setInStockOnly((v) => !v)}
              onClearAll={onClearAll}
              hasActiveFilters={hasActiveFilters}
            />
          </div>
        </aside>

        {/* Product grid */}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <ProductGridSkeleton count={8} />
          ) : visible.length === 0 ? (
            <EmptyState hasFilters={hasAnyFilter} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85svh] overflow-y-auto scroll-ios rounded-t-3xl border-t border-border bg-background p-5 pb-safe shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Filters</h2>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
                className="rounded-full p-2 min-touch transition hover:bg-muted"
              >
                <X className="size-5" />
              </button>
            </div>
            <FilterPanel
              brands={brands}
              selectedBrands={selectedBrands}
              onBrandToggle={onBrandToggle}
              ageGroupsList={ageGroups}
              selectedAgeGroups={selectedAgeGroups}
              onAgeGroupToggle={onAgeGroupToggle}
              maxPrice={maxPrice}
              onMaxPrice={setMaxPrice}
              inStockOnly={inStockOnly}
              onInStockToggle={() => setInStockOnly((v) => !v)}
              onClearAll={onClearAll}
              hasActiveFilters={hasActiveFilters}
            />
            <button
              onClick={() => setDrawerOpen(false)}
              className="mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 min-touch"
            >
              Show {visible.length} result{visible.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
