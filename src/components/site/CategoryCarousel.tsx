import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/store";

export function CategoryCarousel({ categories }: { categories: Category[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [paddingLeft, setPaddingLeft] = useState(16);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Drag to scroll state
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const hasDragged = useRef(false);

  useEffect(() => {
    // Calculate padding left so that the carousel aligns with max-w-7xl
    const calculatePadding = () => {
      const vw = document.documentElement.clientWidth;
      const maxW = 1280; // 80rem (max-w-7xl)
      let px = 16; // px-4
      if (vw >= 640) px = 24; // sm:px-6
      if (vw >= 1024) px = 32; // lg:px-8

      if (vw > maxW) {
        setPaddingLeft((vw - maxW) / 2 + px);
      } else {
        setPaddingLeft(px);
      }
    };

    calculatePadding();
    window.addEventListener("resize", calculatePadding);
    return () => window.removeEventListener("resize", calculatePadding);
  }, []);

  const handleScroll = () => {
    if (!viewportRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = viewportRef.current;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth - 10);
  };

  useEffect(() => {
    handleScroll();
  }, [categories]);

  const scroll = (dir: 1 | -1) => {
    if (!viewportRef.current) return;
    const card = viewportRef.current.querySelector<HTMLElement>("[data-card]");
    const amount = (card?.offsetWidth ?? 300) + 24; // width + gap
    viewportRef.current.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!viewportRef.current) return;
    isDragging.current = true;
    hasDragged.current = false;
    viewportRef.current.style.cursor = "grabbing";
    viewportRef.current.style.scrollSnapType = "none"; // Disable snap while dragging
    startX.current = e.pageX - viewportRef.current.offsetLeft;
    scrollLeft.current = viewportRef.current.scrollLeft;
  };

  const onMouseLeave = () => {
    if (!isDragging.current || !viewportRef.current) return;
    isDragging.current = false;
    viewportRef.current.style.cursor = "grab";
    viewportRef.current.style.scrollSnapType = "x mandatory";
  };

  const onMouseUp = () => {
    if (!isDragging.current || !viewportRef.current) return;
    isDragging.current = false;
    viewportRef.current.style.cursor = "grab";
    viewportRef.current.style.scrollSnapType = "x mandatory";
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !viewportRef.current) return;
    e.preventDefault(); // Prevent text selection
    const x = e.pageX - viewportRef.current.offsetLeft;
    const walk = (x - startX.current) * 2; // Scroll speed multiplier

    if (Math.abs(walk) > 10) {
      hasDragged.current = true;
    }

    viewportRef.current.scrollLeft = scrollLeft.current - walk;
  };

  if (categories.length === 0) return null;

  return (
    <div className="group/carousel relative w-full overflow-hidden">
      <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent sm:w-16 lg:w-24" />
      <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent sm:w-16 lg:w-24" />

      <div
        ref={viewportRef}
        onScroll={handleScroll}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        className="w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-none pb-8 pt-4 cursor-grab active:cursor-grabbing"
        style={{ paddingLeft: `${paddingLeft}px`, paddingRight: `${paddingLeft}px` }}
      >
        <div className="flex w-max gap-4 sm:gap-6 pointer-events-none sm:pointer-events-auto">
          {categories.map((c) => (
            <Link
              key={c.slug}
              data-card
              to="/shop"
              search={{ category: c.slug }}
              onDragStart={(e) => e.preventDefault()}
              onClick={(e) => {
                if (hasDragged.current) {
                  e.preventDefault();
                }
              }}
              className="group relative w-[72vw] snap-center shrink-0 overflow-hidden rounded-[2rem] border-0 bg-muted shadow-sm transition-all duration-300 hover:shadow-2xl sm:w-[300px] md:w-[340px] lg:w-[360px] xl:w-[380px]"
            >
              <img
                src={c.image}
                alt={c.name}
                loading="lazy"
                decoding="async"
                width={800}
                height={1000}
                className="aspect-[4/5] w-full object-cover transition duration-700 group-hover:scale-110"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0";
                }}
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent transition-opacity duration-300 group-hover:opacity-90" />
              <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-6 text-white sm:p-8">
                <h3 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {c.name}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-white/85 sm:text-base">
                  {c.tagline}
                </p>
                <div className="mt-5 overflow-hidden">
                  <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white transition-transform duration-300 group-hover:translate-x-2">
                    Shop now
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
                      <path
                        d="M6.75 3.5l4.5 4.5-4.5 4.5"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        stroke="currentColor"
                      />
                    </svg>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-between px-4 opacity-0 transition-opacity duration-300 group-hover/carousel:opacity-100 sm:px-8">
        <button
          type="button"
          onClick={() => scroll(-1)}
          disabled={!canScrollLeft}
          aria-label="Previous category"
          className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background disabled:opacity-0"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => scroll(1)}
          disabled={!canScrollRight}
          aria-label="Next category"
          className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background disabled:opacity-0"
        >
          <ChevronRight className="size-6" />
        </button>
      </div>
    </div>
  );
}
