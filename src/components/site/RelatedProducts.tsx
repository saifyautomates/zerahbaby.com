import { Link } from "@tanstack/react-router";
import { useProducts, type Product } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";

export function RelatedProducts({ currentProductId, category }: { currentProductId: string; category: string }) {
  const { data: allProducts = [] } = useProducts(true);
  
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
