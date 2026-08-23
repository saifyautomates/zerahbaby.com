import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCategories, useProducts } from "@/lib/store";
import { ProductCard, ProductGridSkeleton } from "@/components/site/ProductCard";
import { AdminAddProduct } from "@/components/admin/InlineAdmin";

type ShopSearch = {
  category?: string | undefined;
  age?: string | undefined;
  q?: string | undefined;
};

import { productsQueryOptions, categoriesQueryOptions } from "@/lib/store";

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
  const [maxPrice, setMaxPrice] = useState(20000);
  const [sort, setSort] = useState("popular");

  const list = useMemo(() => products ?? [], [products]);
  const brands = useMemo(() => Array.from(new Set(list.map((x) => x.brand))).sort(), [list]);

  const toggle = (arr: string[], value: string, set: (v: string[]) => void) =>
    set(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);

  const visible = useMemo(() => {
    const query = (q ?? "").trim().toLowerCase();
    const filtered = list.filter(
      (p) =>
        (!category || p.category === category) &&
        (!age || p.ageGroup === age) &&
        (selectedBrands.length === 0 || selectedBrands.includes(p.brand)) &&
        p.price <= maxPrice &&
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
    return sorted;
  }, [list, category, age, q, selectedBrands, maxPrice, sort]);

  const activeCategory = (categories ?? []).find((c) => c.slug === category);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary">
          Home
        </Link>{" "}
        / <span>Shop</span>
        {activeCategory && (
          <>
            {" "}
            / <span className="text-foreground">{activeCategory.name}</span>
          </>
        )}
      </nav>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold">
          {activeCategory?.name ?? "All products"}
        </h1>
        <AdminAddProduct
          {...(category ? { defaultCategory: category } : {})}
          label={category ? `Add product to ${activeCategory?.name ?? category}` : "Add product"}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {visible.length} product{visible.length === 1 ? "" : "s"}
          {activeCategory ? ` in ${activeCategory.tagline.toLowerCase()}` : " across the store"}
        </p>
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

      <div className="mt-8">
        {isLoading ? (
          <ProductGridSkeleton count={8} />
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">No products found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
            {visible.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
