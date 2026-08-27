// src/components/ui/LazyImage.tsx
import { useEffect, useRef, useState } from "react";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Optional placeholder src while image is not yet loaded */
  placeholderSrc?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({ src, placeholderSrc, alt = "", ...rest }) => {
  const [visibleSrc, setVisibleSrc] = useState<string>(placeholderSrc || "");
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) return;
    const img = imgRef.current;
    if (!img) return;
    let observer: IntersectionObserver;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleSrc(src);
              observer.disconnect();
            }
          });
        },
        { rootMargin: "200px" },
      );
      observer.observe(img);
    } else {
      // Fallback: load immediately
      setVisibleSrc(src);
    }
    return () => {
      if (observer) observer.disconnect();
    };
  }, [src]);

  return <img ref={imgRef} src={visibleSrc} alt={alt} loading="lazy" decoding="async" {...rest} />;
};
