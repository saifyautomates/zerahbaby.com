// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { normaliseMediaUrl, type HeroSlide } from "@/lib/hero-media";

const SLIDE_MS = 6500;

/**
 * Full-bleed background media (photos + videos) for the homepage hero.
 * Purely presentational — slides come from the backend.
 */
export function HeroMedia({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = slides.length;

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (count < 2) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, count]);

  if (count === 0) return null;

  return (
    <div className="absolute inset-0" aria-hidden={false}>
      {slides.map((slide, i) => {
        const active = i === index;
        const media = normaliseMediaUrl(slide.url);
        return (
          <div
            key={slide.id}
            className={`absolute inset-0 transition-opacity duration-[1200ms] ease-out motion-reduce:transition-none ${
              active ? "opacity-100" : "opacity-0"
            }`}
          >
            {slide.type === "video" ? (
              media.embed ? (
                <iframe
                  src={active ? media.url : "about:blank"}
                  title={slide.alt || "Hero video"}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  className="pointer-events-none size-full scale-[1.35] border-0 object-cover"
                />
              ) : (
                <video
                  src={media.url}
                  {...(slide.poster ? { poster: slide.poster } : {})}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload={i === 0 ? "auto" : "none"}
                  aria-label={slide.alt || "Hero video"}
                  className="size-full object-cover"
                />
              )
            ) : (
              <img
                src={media.url}
                alt={slide.alt || ""}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                {...(i === 0 ? { fetchPriority: "high" as const } : {})}
                sizes="100vw"
                className={`size-full object-cover transition-transform duration-[9000ms] ease-out motion-reduce:transition-none ${
                  active ? "scale-105" : "scale-100"
                }`}
              />
            )}
          </div>
        );
      })}

      <div className="absolute inset-0 bg-gradient-to-b from-foreground/70 via-foreground/45 to-foreground/70" />

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous hero slide"
            className="focus-ring absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-background/40 bg-background/25 p-2.5 text-background backdrop-blur transition hover:bg-background/45 md:block"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next hero slide"
            className="focus-ring absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full border border-background/40 bg-background/25 p-2.5 text-background backdrop-blur transition hover:bg-background/45 md:block"
          >
            <ChevronRight className="size-5" />
          </button>
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show hero slide ${i + 1}`}
                aria-current={i === index}
                className={`focus-ring h-2 rounded-full transition-all ${
                  i === index ? "w-8 bg-background" : "w-2 bg-background/50 hover:bg-background/80"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
