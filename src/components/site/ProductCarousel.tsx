import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";
import type { CardStyle } from "@/lib/homepage-themes";

interface ProductCarouselProps {
  products: Product[];
  className?: string;
  cardStyle?: CardStyle;
}

export function ProductCarousel({
  products,
  className = "",
  cardStyle = "default",
}: ProductCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Drag state
  const isDown = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const isDragging = useRef(false);

  const checkScroll = () => {
    if (!viewportRef.current) return;
    const { scrollLeft: sl, scrollWidth: sw, clientWidth: cw } = viewportRef.current;
    setCanScrollLeft(sl > 10);
    setCanScrollRight(sl < sw - cw - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [products]);

  const scrollByAmount = (offset: number) => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!viewportRef.current) return;
    isDown.current = true;
    isDragging.current = false;
    startX.current = e.pageX - viewportRef.current.offsetLeft;
    scrollLeft.current = viewportRef.current.scrollLeft;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDown.current || !viewportRef.current) return;
    e.preventDefault();
    const x = e.pageX - viewportRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    if (Math.abs(walk) > 5) {
      isDragging.current = true;
    }
    viewportRef.current.scrollLeft = scrollLeft.current - walk;
  };

  const onMouseUpOrLeave = () => {
    isDown.current = false;
    setTimeout(() => {
      isDragging.current = false;
    }, 50);
  };

  return (
    <div className={`relative group ${className}`}>
      {/* Scroll controls - visible on desktop hover */}
      {canScrollLeft && (
        <button
          type="button"
          aria-label="Scroll products left"
          onClick={() => scrollByAmount(-320)}
          className="absolute -left-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex size-11 items-center justify-center rounded-full bg-background/90 backdrop-blur-md shadow-premium-md border border-border/80 text-foreground transition-all hover:scale-110 hover:bg-background cursor-pointer"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      {canScrollRight && (
        <button
          type="button"
          aria-label="Scroll products right"
          onClick={() => scrollByAmount(320)}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 hidden md:flex size-11 items-center justify-center rounded-full bg-background/90 backdrop-blur-md shadow-premium-md border border-border/80 text-foreground transition-all hover:scale-110 hover:bg-background cursor-pointer"
        >
          <ChevronRight className="size-5" />
        </button>
      )}

      {/* Product carousel track */}
      <div
        ref={viewportRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUpOrLeave}
        onMouseLeave={onMouseUpOrLeave}
        className="flex gap-3 sm:gap-5 overflow-x-auto pb-4 pt-1 no-scrollbar cursor-grab active:cursor-grabbing snap-x snap-mandatory"
        style={{ scrollBehavior: isDragging.current ? "auto" : "smooth" }}
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[180px] sm:w-[220px] md:w-[260px] shrink-0 snap-start select-none"
            onClickCapture={(e) => {
              // If user was dragging, prevent navigation click
              if (isDragging.current) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            <ProductCard product={product} cardStyle={cardStyle} />
          </div>
        ))}
      </div>
    </div>
  );
}
