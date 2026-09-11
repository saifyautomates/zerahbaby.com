import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { useProducts, type Product } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";

interface RelatedProductsProps {
  currentProduct: Product;
  title?: string;
  subtitle?: string;
  limit?: number;
  className?: string;
}

export function RelatedProducts({
  currentProduct,
  title,
  subtitle,
  limit = 6,
  className = "",
}: RelatedProductsProps) {
  const [mounted, setMounted] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: allProducts = [] } = useProducts();

  // Intelligent relevance sorting algorithm
  const related = useMemo(() => {
    if (!currentProduct || !allProducts.length) return [];

    // Filter only customer-eligible active online products, excluding current product
    const candidates = allProducts.filter(
      (p) =>
        p.id !== currentProduct.id &&
        p.uuid !== currentProduct.uuid &&
        p.isActive !== false &&
        p.salesChannel !== "OFFLINE_ONLY",
    );

    // Score candidates based on multi-factor relevance
    const scored = candidates.map((p) => {
      let score = 0;

      // 1. Category match (Highest weight)
      if (
        p.category &&
        currentProduct.category &&
        p.category.toLowerCase() === currentProduct.category.toLowerCase()
      ) {
        score += 50;
      }

      // 2. Brand / Collection match
      if (
        p.brand &&
        currentProduct.brand &&
        p.brand.toLowerCase() === currentProduct.brand.toLowerCase()
      ) {
        score += 25;
      }

      // 3. Similar age group match
      if (p.ageGroup && currentProduct.ageGroup && p.ageGroup === currentProduct.ageGroup) {
        score += 15;
      }

      // 4. Price affinity (within 35% range)
      if (currentProduct.price > 0 && p.price > 0) {
        const priceRatio = p.price / currentProduct.price;
        if (priceRatio >= 0.65 && priceRatio <= 1.35) {
          score += 10;
        }
      }

      // 5. In-stock priority
      if (p.stock > 0) {
        score += 20;
      }

      // 6. Rating / Popularity
      if (p.rating >= 4.5) {
        score += 5;
      }

      return { product: p, score };
    });

    // Sort by descending relevance score, then by sortOrder
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.product.sortOrder ?? 0) - (b.product.sortOrder ?? 0);
    });

    return scored.slice(0, limit).map((s) => s.product);
  }, [allProducts, currentProduct, limit]);

  // Check scroll capability for navigation arrows on mobile/touch carousel
  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [related]);

  const scroll = (direction: "left" | "right") => {
    if (!scrollContainerRef.current) return;
    const offset = scrollContainerRef.current.clientWidth * 0.75;
    scrollContainerRef.current.scrollBy({
      left: direction === "left" ? -offset : offset,
      behavior: "smooth",
    });
  };

  if (!mounted || related.length === 0) return null;

  const sectionTitle =
    title || (currentProduct.category ? `More in ${currentProduct.category}` : "You May Also Like");

  const sectionSubtitle =
    subtitle || "Curated complementary picks and popular essentials for little ones";

  return (
    <section
      aria-label="Related products"
      className={`mt-14 sm:mt-20 pt-10 border-t border-border/60 ${className}`}
    >
      {/* Header with Visual Distinction */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary mb-1.5">
            <Sparkles className="size-3.5" />
            <span>Complete The Look</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            {sectionTitle}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-xl">
            {sectionSubtitle}
          </p>
        </div>

        {/* Carousel controls for desktop/tablet */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            aria-label="Scroll related products left"
            className="grid size-9 place-items-center rounded-full border border-border bg-background/80 text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 disabled:opacity-30 disabled:pointer-events-none shadow-xs"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            aria-label="Scroll related products right"
            className="grid size-9 place-items-center rounded-full border border-border bg-background/80 text-foreground transition-all hover:bg-muted hover:scale-105 active:scale-95 disabled:opacity-30 disabled:pointer-events-none shadow-xs"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Product Cards Container: Horizontal Scroll on Mobile, Fluid Grid on Desktop */}
      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex sm:grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible pb-4 sm:pb-0 pt-1 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scrollbar-none"
      >
        {related.map((product) => (
          <div key={product.id} className="w-[190px] sm:w-auto shrink-0 snap-start flex flex-col">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}
