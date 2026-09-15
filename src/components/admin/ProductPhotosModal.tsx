/**
 * ProductPhotosModal.tsx — Admin Product Photos Gallery & Quick Channel Manager
 * Zérah Baby & Kids
 *
 * Allows administrators to inspect all photos of any product (both Online and Only Offline),
 * view variant/color badges, preview high-res images, and quickly toggle sales channel
 * (Live on Website vs Only Offline POS).
 */
import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Edit3,
  Store,
  Package,
  Sparkles,
  Camera,
  Maximize2,
  Check,
  Tag,
  Layers,
} from "lucide-react";
import type { Product } from "@/lib/store";
import { formatPrice, imageFor } from "@/lib/store";

export interface ProductPhotoItem {
  id?: string;
  url: string;
  isPrimary?: boolean;
  color?: string | null;
  altText?: string | null;
  variantSku?: string | null;
  sortOrder?: number;
}

export function ProductPhotosModal({
  product,
  onClose,
  onEditProduct,
  onToggleSalesChannel,
  isTogglingChannel,
}: {
  product: Product;
  onClose: () => void;
  onEditProduct: (product: Product) => void;
  onToggleSalesChannel: (
    product: Product,
    newChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
  ) => void;
  isTogglingChannel?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  // Extract all distinct images for this product
  const photos = useMemo<ProductPhotoItem[]>(() => {
    const list: ProductPhotoItem[] = [];
    const seenUrls = new Set<string>();

    // 1. From product_images table (authoritative)
    if (product.product_images && product.product_images.length > 0) {
      const sorted = [...product.product_images].sort((a, b) => {
        if (a.is_primary) return -1;
        if (b.is_primary) return 1;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
      for (const img of sorted) {
        if (img.public_url && !seenUrls.has(img.public_url)) {
          seenUrls.add(img.public_url);
          list.push({
            id: img.id,
            url: img.public_url,
            isPrimary: img.is_primary,
            color: img.color,
            altText: img.alt_text,
            variantSku: img.variant_sku,
            sortOrder: img.sort_order,
          });
        }
      }
    }

    // 2. From product.images array
    if (product.images && product.images.length > 0) {
      for (const url of product.images) {
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          list.push({
            url,
            isPrimary: list.length === 0,
          });
        }
      }
    }

    // 3. From product.image primary field
    if (product.image && !seenUrls.has(product.image)) {
      seenUrls.add(product.image);
      list.unshift({
        url: product.image,
        isPrimary: true,
      });
    }

    // 4. From variant images
    if (product.variants && product.variants.length > 0) {
      for (const v of product.variants) {
        if (v.imageUrl && !seenUrls.has(v.imageUrl)) {
          seenUrls.add(v.imageUrl);
          list.push({
            url: v.imageUrl,
            color: v.color,
            variantSku: v.sku,
          });
        }
      }
    }

    // 5. If completely empty, add fallback category placeholder
    if (list.length === 0) {
      list.push({
        url: imageFor(product.category, null, product),
        isPrimary: true,
        altText: product.name,
      });
    }

    return list;
  }, [product]);

  const activePhoto = photos[activeIndex] || photos[0];
  const isOfflineOnly = product.salesChannel === "OFFLINE_ONLY";

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") {
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
      }
      if (e.key === "ArrowRight") {
        setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [photos.length, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-4xl max-h-[92vh] my-auto flex-col overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-border/60 p-4 sm:p-5 bg-card/95">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Camera className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-base sm:text-lg font-bold text-foreground truncate">
                  {product.name}
                </h2>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border shrink-0">
                  {photos.length} Photo{photos.length !== 1 ? "s" : ""}
                </span>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                  {product.category}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                <span className="font-mono font-medium">{product.sku || product.id}</span>
                <span>•</span>
                <span className="font-bold text-foreground">{formatPrice(product.price)}</span>
                <span>•</span>
                {/* 1-Click Channel Switcher Badge */}
                <button
                  type="button"
                  onClick={() => {
                    const nextChannel = isOfflineOnly ? "ONLINE_AND_OFFLINE" : "OFFLINE_ONLY";
                    onToggleSalesChannel(product, nextChannel);
                  }}
                  disabled={isTogglingChannel}
                  title={
                    isOfflineOnly
                      ? "Click to make this product LIVE on website (Online & Offline)"
                      : "Click to set this product to ONLY OFFLINE (POS)"
                  }
                  className={`inline-flex items-center gap-1 text-[10px] uppercase font-extrabold px-2.5 py-0.5 rounded-full border transition-all cursor-pointer active:scale-95 ${
                    isOfflineOnly
                      ? "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100"
                      : "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100"
                  }`}
                >
                  {isOfflineOnly ? (
                    <>
                      <Store className="size-3" />
                      <span>Only Offline (POS) — Click to Make Live 🌐</span>
                    </>
                  ) : (
                    <>
                      <Package className="size-3" />
                      <span>Live on Website &amp; POS — Click for Offline 🏪</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onEditProduct(product);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <Edit3 className="size-3.5" />
              <span className="hidden sm:inline">Edit Product &amp; Photos</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Main Photo Viewer Stage */}
        <div className="relative flex flex-1 min-h-[360px] sm:min-h-[460px] items-center justify-center bg-black/90 p-4 sm:p-8 overflow-hidden select-none">
          {/* Main Displayed Image */}
          {activePhoto?.url && (
            <img
              src={activePhoto.url}
              alt={activePhoto.altText || product.name}
              className="max-h-[60vh] max-w-full rounded-2xl object-contain shadow-2xl transition-all duration-200"
            />
          )}

          {/* Navigation Arrows */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1))
                }
                className="absolute left-3 sm:left-6 flex size-10 sm:size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all backdrop-blur-sm cursor-pointer active:scale-95"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-6" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0))
                }
                className="absolute right-3 sm:right-6 flex size-10 sm:size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all backdrop-blur-sm cursor-pointer active:scale-95"
                aria-label="Next photo"
              >
                <ChevronRight className="size-6" />
              </button>
            </>
          )}

          {/* Metadata Overlay Badge on Photo */}
          <div className="absolute top-4 left-4 flex flex-wrap items-center gap-1.5 pointer-events-none">
            <span className="bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1 rounded-full border border-white/20">
              Photo {activeIndex + 1} of {photos.length}
            </span>
            {activePhoto?.isPrimary && (
              <span className="bg-[#8B2020] text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                Primary
              </span>
            )}
            {activePhoto?.color && (
              <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full capitalize">
                Color: {activePhoto.color}
              </span>
            )}
            {activePhoto?.variantSku && (
              <span className="bg-white/20 backdrop-blur-md text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded-full">
                SKU: {activePhoto.variantSku}
              </span>
            )}
          </div>

          {/* Open Original in New Tab */}
          {activePhoto?.url && (
            <a
              href={activePhoto.url}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 hover:bg-black/90 transition"
              title="Open full resolution image in new tab"
            >
              <Maximize2 className="size-3.5" />
              <span>Full Res</span>
            </a>
          )}
        </div>

        {/* Thumbnail Strip Gallery */}
        <div className="shrink-0 border-t border-border/60 bg-card p-3 sm:p-4">
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
            {photos.map((img, idx) => {
              const isCurrent = idx === activeIndex;
              return (
                <button
                  key={`${img.url}-${idx}`}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  className={`relative shrink-0 size-16 sm:size-18 rounded-2xl overflow-hidden border-2 transition-all cursor-pointer ${
                    isCurrent
                      ? "border-[#8B2020] scale-105 shadow-md ring-2 ring-[#8B2020]/30"
                      : "border-border/80 opacity-70 hover:opacity-100 hover:border-foreground/40"
                  }`}
                >
                  <img
                    src={img.url}
                    alt={img.altText || `Thumbnail ${idx + 1}`}
                    className="size-full object-cover"
                  />
                  {img.isPrimary && (
                    <span className="absolute top-1 left-1 size-2 rounded-full bg-[#8B2020] ring-1 ring-white" />
                  )}
                  {img.color && (
                    <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] text-white font-bold py-0.5 text-center truncate px-0.5">
                      {img.color}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Quick Add More button */}
            <button
              type="button"
              onClick={() => {
                onClose();
                onEditProduct(product);
              }}
              className="shrink-0 size-16 sm:size-18 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted hover:text-foreground hover:border-primary/50 transition cursor-pointer"
              title="Upload more photos for this product in edit drawer"
            >
              <Camera className="size-4" />
              <span className="text-[9px] font-bold">+ Photos</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
