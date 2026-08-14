import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCategories, useProducts } from "@/lib/store";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { AdminAddProduct } from "@/components/admin/InlineAdmin";


type ShopSearch = { category?: string | undefined; age?: string | undefined };

export const Route = createFileRoute("/shop")({
  validateSearch: (search: Record<string, unknown>): ShopSearch => ({
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
    age: typeof search["age"] === "string" ? (search["age"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shop Baby & Kids Essentials — Zerah Baby And Kids" },
      {
        name: "description",
        content:
          "Browse the full Zerah Baby And Kids range: clothing, toys, diapers and skincare, strollers, car seats and carriers. Filter by age, brand and price.",
      },
      { property: "og:title", content: "Shop Baby & Kids Essentials — Zerah Baby And Kids" },
      { property: "og:description", content: "Filter baby clothing, toys, care and gear by age, brand and price." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  const { category, age } = Route.useSearch();
  const { data: products, isLoading } = useProducts();
  const { data: categories } = useCategories();
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [maxPrice, setMaxPrice] = useState(20000);
  const [sort, setSort] = useState("popular");

  const list = useMemo(() => products ?? [], [products]);
  const brands = useMemo(() => Array.from(new Set(list.map((x) => x.brand))).sort(), [list]);

  const toggle = (arr: string[], value: string, set: (v: string[]) => void) =>
    set(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);

  const visible = useMemo(() => {
    const filtered = list.filter(
      (p) =>
        (!category || p.category === category) &&
        (!age || p.ageGroup === age) &&
        (selectedBrands.length === 0 || selectedBrands.includes(p.brand)) &&
        p.price <= maxPrice,
    );
    const sorted = [...filtered];
    if (sort === "low") sorted.sort((a, b) => a.price - b.price);
    if (sort === "high") sorted.sort((a, b) => b.price - a.price);
    if (sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
    if (sort === "popular") sorted.sort((a, b) => b.reviews - a.reviews);
    return sorted;
  }, [list, category, age, selectedBrands, maxPrice, sort]);


  const activeCategory = (categories ?? []).find((c) => c.slug === category);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary">Home</Link> / <span>Shop</span>
        {activeCategory && <> / <span className="text-foreground">{activeCategory.name}</span></>}
      </nav>

      <h1 className="mt-3 font-display text-3xl font-bold">{activeCategory?.name ?? "All products"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {visible.length} product{visible.length === 1 ? "" : "s"}
        {activeCategory ? ` in ${activeCategory.tagline.toLowerCase()}` : " across the store"}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          to="/shop"
          className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
            !category ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
          }`}
        >
          All
        </Link>
        {(categories ?? []).map((c) => (
          <Link
            key={c.slug}
            to="/shop"
            search={{ category: c.slug }}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              category === c.slug
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-muted"
            }`}
          >
            {c.name}
          </Link>
        ))}
        <AdminAddProduct
          {...(category ? { defaultCategory: category } : {})}
          label={category ? `Add product to ${activeCategory?.name ?? category}` : "Add product"}
        />
      </div>


      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6 rounded-2xl border border-border p-5 h-fit">


          <div>
            <h2 className="text-sm font-semibold">Brand</h2>
            <div className="mt-3 space-y-2">
              {brands.map((b) => (
                <label key={b} className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={selectedBrands.includes(b)}
                    onChange={() => toggle(selectedBrands, b, setSelectedBrands)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {b}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">Max price</h2>
            <input
              type="range"
              min={400}
              max={20000}
              step={100}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--primary)]"
              aria-label="Maximum price"
            />
            <p className="text-xs text-muted-foreground">Up to ₹{maxPrice.toLocaleString("en-IN")}</p>
          </div>

          <button
            onClick={() => {
              setSelectedBrands([]);
              setMaxPrice(20000);
            }}
            className="w-full rounded-full border border-border py-2 text-sm font-medium transition hover:bg-muted"
          >
            Clear filters
          </button>
        </aside>

        <div>
          <div className="flex justify-end">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                <option value="popular">Popularity</option>
                <option value="rating">Rating</option>
                <option value="low">Price: low to high</option>
                <option value="high">Price: high to low</option>
              </select>
            </label>
          </div>

          {isLoading ? (
            <ProductGridSkeleton count={6} />
          ) : visible.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              No products match these filters. Try clearing a few.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3">
              {visible.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
