// src/components/ui/LazyImage.tsx
import React, { useState, useMemo } from "react";
import { getOptimizedImageUrl, generateProductFallbackSvg } from "@/lib/product-media";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Optional placeholder src while image is not yet loaded */
  placeholderSrc?: string;
  /** Desired optimized width (defaults to 600) */
  optimizedWidth?: number;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  placeholderSrc,
  alt = "",
  optimizedWidth = 600,
  className = "",
  onError,
  ...rest
}) => {
  const [errorLevel, setErrorLevel] = useState<0 | 1 | 2>(0);

  const fallbackSvg = useMemo(() => {
    return generateProductFallbackSvg({ name: alt || "Zérah Baby" });
  }, [alt]);

  const targetSrc = (() => {
    if (errorLevel === 0) {
      return getOptimizedImageUrl(src, optimizedWidth) || placeholderSrc || fallbackSvg;
    }
    if (errorLevel === 1) {
      return placeholderSrc || fallbackSvg;
    }
    return fallbackSvg;
  })();

  return (
    <img
      src={targetSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={(e) => {
        if (errorLevel === 0) {
          if (placeholderSrc && placeholderSrc !== src) {
            setErrorLevel(1);
          } else {
            setErrorLevel(2);
          }
        } else if (errorLevel === 1) {
          setErrorLevel(2);
        }
        onError?.(e);
      }}
      {...rest}
    />
  );
};
