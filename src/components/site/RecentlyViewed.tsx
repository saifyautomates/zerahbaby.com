import { useEffect, useState } from "react";
import { useProducts } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";

const RECENTLY_VIEWED_KEY = "zerah_recently_viewed";

export function useRecentlyViewed(currentProductId?: string) {
  const [viewedIds, setViewedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENTLY_VIEWED_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      let updated = Array.isArray(parsed) ? parsed : [];

      if (currentProductId) {
        updated = [currentProductId, ...updated.filter((id) => id !== currentProductId)].slice(
          0,
          5,
        );
        localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(updated));
      }

      setViewedIds(updated);
    } catch (e) {
      console.error("Failed to parse recently viewed", e);
    }
  }, [currentProductId]);

  return viewedIds;
}

export function RecentlyViewed({ currentProductId }: { currentProductId?: string }) {
  const viewedIds = useRecentlyViewed(currentProductId);
  const { data: allProducts = [] } = useProducts(true);

  if (viewedIds.length === 0) return null;

  // Map IDs to products, excluding current one if passed
  const products = viewedIds
    .filter((id) => id !== currentProductId)
    .map((id) => allProducts.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, 4);

  if (products.length === 0) return null;

  return (
    <section className="mt-16 sm:mt-24 border-t border-border pt-16">
      <h2 className="font-display text-2xl font-bold">Recently viewed</h2>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product!.id} product={product!} />
        ))}
      </div>
    </section>
  );
}
