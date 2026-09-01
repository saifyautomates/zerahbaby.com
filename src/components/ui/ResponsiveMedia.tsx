/**
 * ResponsiveMedia — Global reusable media component.
 *
 * Handles images and videos of ANY dimension/aspect-ratio safely.
 * Provides:
 * - Consistent aspect-ratio container (prevents layout shift)
 * - Broken/missing image fallback
 * - Loading state placeholder
 * - Lazy loading by default
 * - Configurable object-fit strategy per use-case
 * - Safe containment (never blows out parent)
 */

import { useState, useEffect, type CSSProperties, type ImgHTMLAttributes } from "react";
import { ImageOff } from "lucide-react";

export type ObjectFitStrategy = "cover" | "contain" | "fill" | "scale-down" | "none";

interface ResponsiveMediaProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "onError" | "onLoad" | "src"
> {
  /** Source URL */
  src: string | undefined | null;
  /** Alt text */
  alt?: string;
  /** CSS aspect-ratio for the container (e.g. "1/1", "4/3", "16/9", "4/5"). Defaults to "1/1". */
  aspect?: string;
  /** object-fit strategy. Defaults to "cover". */
  fit?: ObjectFitStrategy;
  /** object-position. Defaults to "center". */
  position?: string;
  /** Extra classes on the outer container */
  containerClassName?: string;
  /** Extra classes on the img element */
  className?: string;
  /** Extra inline styles on the container */
  containerStyle?: CSSProperties;
  /** Extra inline styles on the img/video element */
  style?: CSSProperties;
  /** Show a muted bg-muted placeholder while loading */
  showPlaceholder?: boolean;
  /** If true, treat as video */
  isVideo?: boolean;
}

export function ResponsiveMedia({
  src,
  alt = "",
  aspect = "1/1",
  fit = "cover",
  position = "center",
  containerClassName = "",
  className = "",
  containerStyle,
  style,
  showPlaceholder = true,
  isVideo = false,
  loading = "lazy",
  decoding = "async",
  sizes,
  width,
  height,
  ...rest
}: ResponsiveMediaProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");

  useEffect(() => {
    if (!src) {
      setStatus("error");
    } else {
      setStatus("loading");
    }
  }, [src]);

  const handleImgRef = (img: HTMLImageElement | null) => {
    if (img && img.complete) {
      if (img.naturalWidth > 0) {
        setStatus("loaded");
      } else if (img.naturalWidth === 0 && img.src) {
        setStatus("error");
      }
    }
  };

  const hasCustomBg = containerClassName?.includes("bg-");
  const containerClasses = [
    "relative overflow-hidden",
    !hasCustomBg && "bg-muted",
    containerClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const aspectStyle = aspect && aspect !== "auto" ? { aspectRatio: aspect } : {};

  const mediaClasses = [
    "absolute inset-0 h-full w-full transition-opacity duration-300",
    status === "error" ? "opacity-0" : "opacity-100",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (!src || status === "error") {
    return (
      <div className={containerClasses} style={{ ...aspectStyle, ...containerStyle }}>
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
          <ImageOff className="size-6" />
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses} style={{ ...aspectStyle, ...containerStyle }}>
      {/* Loading placeholder */}
      {showPlaceholder && status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-muted/60 pointer-events-none" />
      )}

      {isVideo ? (
        <video
          src={src}
          className={mediaClasses}
          style={{ objectFit: fit, objectPosition: position, ...style }}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          onLoadedData={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      ) : (
        <img
          ref={handleImgRef}
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          sizes={sizes}
          width={width}
          height={height}
          className={mediaClasses}
          style={{ objectFit: fit, objectPosition: position, ...style }}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          {...rest}
        />
      )}
    </div>
  );
}
