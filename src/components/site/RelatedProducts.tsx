import { useEffect, useState } from "react";
import { useProducts } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";

export function RelatedProducts({
  currentProductId,
  category,
}: {
  currentProductId: string;
  category: string;
}) {
  // Defer render to client-only to prevent SSR/client hydration mismatch.
  // The product list is async (React Query) and is empty during SSR even when
  // the loader prefetched it, causing the section to be absent in SSR HTML but
  // present after client hydration — which throws a React hydration error.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: allProducts = [] } = useProducts();

  if (!mounted) return null;

  const related = allProducts
    .filter((p) => p.category === category && p.id !== currentProductId)
    .slice(0, 4);

  if (related.length === 0) return null;

  return (
    <section className="mt-16 sm:mt-24">
      <h2 className="font-display text-2xl font-bold">You might also like</h2>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {related.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
