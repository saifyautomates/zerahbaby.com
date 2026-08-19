// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Category } from "@/lib/store";

const SPEED = 42; // px per second

export function CategoryCarousel({ categories }: { categories: Category[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const paused = useRef(false);
  const halfWidth = useRef(0);

  const loop = categories.length > 0 ? [...categories, ...categories] : [];

  useEffect(() => {
    const track = trackRef.current;
    if (!track || categories.length === 0) return;

    let raf = 0;
    let last = performance.now();

    const measure = () => {
      halfWidth.current = track.scrollWidth / 2;
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(track);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const step = (now: number) => {
      const dt = Math.min(now - last, 64) / 1000;
      last = now;
      if (!paused.current && !reduce && halfWidth.current > 0) {
        offset.current += SPEED * dt;
      }
      if (halfWidth.current > 0) {
        if (offset.current >= halfWidth.current) offset.current -= halfWidth.current;
        if (offset.current < 0) offset.current += halfWidth.current;
      }
      track.style.transform = `translate3d(${-offset.current}px, 0, 0)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [categories.length]);

  const nudge = (dir: 1 | -1) => {
    const card = trackRef.current?.querySelector<HTMLElement>("[data-card]");
    const amount = (card?.offsetWidth ?? 260) + 20;
    offset.current += dir * amount;
  };

  if (categories.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onTouchStart={() => (paused.current = true)}
      onTouchEnd={() => (paused.current = false)}
      onFocusCapture={() => (paused.current = true)}
      onBlurCapture={() => (paused.current = false)}
    >
      <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent sm:w-12" />
      <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent sm:w-12" />
      <div ref={viewportRef} className="overflow-hidden">
        <div ref={trackRef} className="flex w-max gap-4 will-change-transform sm:gap-5">
          {loop.map((c, i) => (
            <Link
              key={`${c.slug}-${i}`}
              data-card
              to="/shop"
              search={{ category: c.slug }}
              aria-hidden={i >= categories.length}
              tabIndex={i >= categories.length ? -1 : 0}
              className="group w-[62vw] shrink-0 overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition hover:shadow-xl sm:w-[280px] lg:w-[300px]"
            >
              <div className="relative overflow-hidden">
                <img
                  src={c.image}
                  alt={c.name}
                  loading="lazy"
                  width={800}
                  height={600}
                  className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-110"
                />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-foreground/45 via-transparent to-transparent" />
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="font-display text-base font-bold sm:text-lg">{c.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.tagline}</p>
                <span className="mt-3 inline-block text-sm font-semibold text-primary">Shop now →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Previous categories"
        onClick={() => nudge(-1)}
        className="absolute left-1 top-1/2 z-20 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 shadow-lg transition hover:bg-muted md:grid"
      >
        <ChevronLeft className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Next categories"
        onClick={() => nudge(1)}
        className="absolute right-1 top-1/2 z-20 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/95 shadow-lg transition hover:bg-muted md:grid"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}
