// src/components/ui/LazyImage.tsx
import React, { useState } from "react";
import { getOptimizedImageUrl } from "@/lib/product-media";

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
  const [hasError, setHasError] = useState(false);
  const targetSrc = hasError
    ? placeholderSrc || ""
    : getOptimizedImageUrl(src, optimizedWidth) || placeholderSrc || "";

  return (
    <img
      src={targetSrc || undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={(e) => {
        if (!hasError && placeholderSrc && src !== placeholderSrc) {
          setHasError(true);
        }
        onError?.(e);
      }}
      {...rest}
    />
  );
};

