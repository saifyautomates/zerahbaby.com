/**
 * ProductPhotosModal.tsx — Admin Product Photos Gallery & Quick Channel Manager
 * Zérah Baby & Kids
 *
 * Allows administrators to:
 * - Inspect all photos of any product (both Online and Only Offline)
 * - Click directly on any photo to open interactive full-screen zoom / lightbox
 * - Directly upload new photos via instant file picker
 * - Set any photo as primary with 1-click
 * - Delete unwanted photos
 * - Quick-toggle sales channel (Live on Website vs Only Offline POS)
 * - Seamlessly launch the full product editor drawer
 */
import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Store,
  Package,
  Camera,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Trash2,
  Star,
  UploadCloud,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/store";
import { formatPrice, imageFor } from "@/lib/store";
import { uploadMedia } from "@/lib/uploads";
import { supabase } from "@/integrations/supabase/client";

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
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute initial photos list from product data
  const initialPhotos = useMemo<ProductPhotoItem[]>(() => {
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

    // 5. Fallback placeholder if empty
    if (list.length === 0) {
      list.push({
        url: imageFor(product.category, null, product),
        isPrimary: true,
        altText: product.name,
      });
    }

    return list;
  }, [product]);

  const [photos, setPhotos] = useState<ProductPhotoItem[]>(initialPhotos);
  const [activeIndex, setActiveIndex] = useState(0);

  // Sync state if initialPhotos changes
  useEffect(() => {
    setPhotos(initialPhotos);
  }, [initialPhotos]);

  // Fullscreen / Zoom Lightbox State
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);

  // Direct Photo Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [isActionBusy, setIsActionBusy] = useState(false);

  const activePhoto = photos[activeIndex] || photos[0];
  const isOfflineOnly = product.salesChannel === "OFFLINE_ONLY";

  // Preload ProductForm bundle on mount for instant transition on edit click
  useEffect(() => {
    import("@/components/admin/ProductForm").catch(() => {});
  }, []);

  // Keyboard navigation & escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isZoomed) {
          setIsZoomed(false);
          setZoomScale(1);
        } else {
          onClose();
        }
      }
      if (e.key === "ArrowLeft") {
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
      }
      if (e.key === "ArrowRight") {
        setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [photos.length, onClose, isZoomed]);

  // Handle Direct Upload
  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const toastId = toast.loading(`Uploading ${files.length} photo(s)...`);
    try {
      const pId = product.uuid || product.id;
      const newItems: ProductPhotoItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const publicUrl = await uploadMedia(file, pId);

        // Insert into Supabase product_images table if product has a valid UUID
        let insertedId: string | undefined;
        if (product.uuid) {
          const { data, error } = await supabase
            .from("product_images")
            .insert({
              product_id: product.uuid,
              public_url: publicUrl,
              sort_order: photos.length + i,
              is_primary: photos.length === 0 && i === 0,
              alt_text: product.name,
            })
            .select("id")
            .maybeSingle();

          if (!error && data) {
            insertedId = data.id;
          }
        }

        newItems.push({
          id: insertedId,
          url: publicUrl,
          isPrimary: photos.length === 0 && i === 0,
          altText: product.name,
        });
      }

      setPhotos((prev) => [...prev, ...newItems]);
      setActiveIndex(photos.length); // switch to first newly uploaded photo
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success(`${files.length} photo(s) added successfully!`, { id: toastId });
    } catch (err: any) {
      console.error("Direct upload failed:", err);
      toast.error(err?.message || "Failed to upload photo", { id: toastId });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle Set As Primary
  const handleSetPrimary = async () => {
    if (!activePhoto || activePhoto.isPrimary || !product.uuid) return;
    setIsActionBusy(true);
    try {
      // 1. Reset is_primary on all product images for this product
      await supabase
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", product.uuid);

      // 2. Set this image as primary in product_images
      if (activePhoto.id) {
        await supabase
          .from("product_images")
          .update({ is_primary: true })
          .eq("id", activePhoto.id);
      } else {
        await supabase
          .from("product_images")
          .update({ is_primary: true })
          .eq("product_id", product.uuid)
          .eq("public_url", activePhoto.url);
      }


      // Update local state
      setPhotos((prev) =>
        prev.map((p, idx) => ({
          ...p,
          isPrimary: idx === activeIndex,
        })),
      );

      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Set as primary photo!");
    } catch (err: any) {
      console.error("Failed to set primary:", err);
      toast.error("Could not set primary photo");
    } finally {
      setIsActionBusy(false);
    }
  };

  // Handle Delete Photo
  const handleDeletePhoto = async () => {
    if (!activePhoto || !product.uuid) return;
    if (photos.length <= 1) {
      toast.error("Cannot delete the only photo. Upload another photo first.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this photo from this product?")) {
      return;
    }

    setIsActionBusy(true);
    try {
      if (activePhoto.id) {
        await supabase.from("product_images").delete().eq("id", activePhoto.id);
      } else {
        await supabase
          .from("product_images")
          .delete()
          .eq("product_id", product.uuid)
          .eq("public_url", activePhoto.url);
      }

      const updated = photos.filter((_, idx) => idx !== activeIndex);
      setPhotos(updated);
      setActiveIndex((prev) => Math.min(prev, Math.max(0, updated.length - 1)));

      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Photo deleted.");
    } catch (err: any) {
      console.error("Failed to delete photo:", err);
      toast.error("Could not delete photo");
    } finally {
      setIsActionBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 p-3 sm:p-6 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Hidden File Input for Instant Upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleDirectUpload}
      />

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
            {/* Quick Upload Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 px-3 py-2 text-xs font-bold transition cursor-pointer active:scale-95 disabled:opacity-50"
              title="Add photos directly to this product"
            >
              {isUploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <UploadCloud className="size-3.5" />
              )}
              <span className="hidden sm:inline">
                {isUploading ? "Uploading..." : "Upload Photo"}
              </span>
            </button>

            {/* Edit Product & Photos (Direct transition) */}
            <button
              type="button"
              onClick={() => {
                onEditProduct(product);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer active:scale-95"
              title="Open full product editor"
            >
              <Edit3 className="size-3.5 text-primary" />
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
        <div className="relative flex flex-1 min-h-[360px] sm:min-h-[460px] items-center justify-center bg-black/95 p-4 sm:p-8 overflow-hidden select-none group">
          {/* Main Clickable Image — clicking triggers interactive zoom lightbox */}
          {activePhoto?.url && (
            <div
              className="relative max-h-[60vh] max-w-full cursor-zoom-in group/img"
              onClick={() => {
                setIsZoomed(true);
                setZoomScale(1.5);
              }}
              title="Click photo to zoom and inspect in high resolution"
            >
              <img
                src={activePhoto.url}
                alt={activePhoto.altText || product.name}
                className="max-h-[60vh] max-w-full rounded-2xl object-contain shadow-2xl transition-transform duration-300 group-hover/img:scale-[1.02]"
              />
              <div className="absolute inset-0 rounded-2xl bg-black/0 group-hover/img:bg-black/15 transition-all flex items-center justify-center pointer-events-none">
                <span className="opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/75 backdrop-blur-md text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                  <ZoomIn className="size-3.5" />
                  <span>Click to Zoom &amp; Inspect</span>
                </span>
              </div>
            </div>
          )}

          {/* Navigation Arrows */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
                }}
                className="absolute left-3 sm:left-6 flex size-10 sm:size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all backdrop-blur-sm cursor-pointer active:scale-95 z-10"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
                }}
                className="absolute right-3 sm:right-6 flex size-10 sm:size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition-all backdrop-blur-sm cursor-pointer active:scale-95 z-10"
                aria-label="Next photo"
              >
                <ChevronRight className="size-6" />
              </button>
            </>
          )}

          {/* Metadata Overlay Badge on Photo */}
          <div className="absolute top-4 left-4 flex flex-wrap items-center gap-1.5 pointer-events-none z-10">
            <span className="bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1 rounded-full border border-white/20">
              Photo {activeIndex + 1} of {photos.length}
            </span>
            {activePhoto?.isPrimary && (
              <span className="bg-[#8B2020] text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                <Star className="size-3 fill-current" />
                <span>Primary</span>
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

          {/* Quick Actions Bar (Bottom Overlay) */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-auto z-10 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {/* Set Primary Button */}
              {!activePhoto?.isPrimary && product.uuid && (
                <button
                  type="button"
                  onClick={handleSetPrimary}
                  disabled={isActionBusy}
                  className="flex items-center gap-1 bg-black/70 hover:bg-black/90 text-white text-xs font-semibold px-3 py-1.5 rounded-xl border border-white/20 backdrop-blur-md transition cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Make this the main cover photo for this product"
                >
                  <Star className="size-3.5 text-amber-400" />
                  <span>Set as Primary</span>
                </button>
              )}

              {/* Delete Button */}
              {product.uuid && photos.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeletePhoto}
                  disabled={isActionBusy}
                  className="flex items-center gap-1 bg-red-950/70 hover:bg-red-900/90 text-red-200 text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-red-500/30 backdrop-blur-md transition cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Remove this photo from product"
                >
                  <Trash2 className="size-3.5 text-red-400" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {/* Interactive Zoom / Lightbox Trigger */}
              <button
                type="button"
                onClick={() => {
                  setIsZoomed(true);
                  setZoomScale(1.5);
                }}
                className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 hover:bg-black/90 transition cursor-pointer active:scale-95"
                title="Open zoom lightbox"
              >
                <ZoomIn className="size-3.5" />
                <span>Zoom &amp; Inspect</span>
              </button>

              {/* Open in New Tab */}
              {activePhoto?.url && (
                <a
                  href={activePhoto.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/20 hover:bg-black/90 transition"
                  title="Open high resolution original image in new tab"
                >
                  <Maximize2 className="size-3.5" />
                  <span className="hidden sm:inline">Full Res</span>
                </a>
              )}
            </div>
          </div>
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

            {/* Direct Add Photos Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="shrink-0 size-16 sm:size-18 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted hover:text-foreground hover:border-primary/50 transition cursor-pointer active:scale-95 disabled:opacity-50"
              title="Click to select photos from your device to upload"
            >
              {isUploading ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : (
                <Camera className="size-4" />
              )}
              <span className="text-[9px] font-bold">
                {isUploading ? "Adding..." : "+ Photos"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Full-Screen Lightbox / Zoom Dialog */}
      {isZoomed && activePhoto?.url && (
        <div
          className="fixed inset-0 z-[260] flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl animate-in fade-in duration-150 p-4 select-none"
          onClick={() => {
            setIsZoomed(false);
            setZoomScale(1);
          }}
        >
          {/* Top Controls Bar */}
          <div
            className="absolute top-4 inset-x-4 flex items-center justify-between z-20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-white text-xs font-semibold">
              <span>
                Photo {activeIndex + 1} of {photos.length}
              </span>
              <span>•</span>
              <span className="text-white/80">{Math.round(zoomScale * 100)}% Zoom</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomScale((s) => Math.max(0.5, s - 0.25))}
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition cursor-pointer active:scale-95"
                title="Zoom Out"
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(1)}
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition cursor-pointer active:scale-95"
                title="Reset Zoom (100%)"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale((s) => Math.min(3.5, s + 0.25))}
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition cursor-pointer active:scale-95"
                title="Zoom In"
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsZoomed(false);
                  setZoomScale(1);
                }}
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 border border-white/20 transition cursor-pointer active:scale-95 ml-2"
                title="Close Zoom (Esc)"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Centered Zoomable Image */}
          <div
            className="flex-1 flex items-center justify-center w-full h-full overflow-auto p-4 cursor-grab active:cursor-grabbing"
            onClick={(e) => {
              // Clicking directly toggles zoom between 1.5x and 2.5x
              if (e.target === e.currentTarget) {
                setIsZoomed(false);
                setZoomScale(1);
              }
            }}
          >
            <img
              src={activePhoto.url}
              alt={activePhoto.altText || product.name}
              style={{
                transform: `scale(${zoomScale})`,
                transition: "transform 0.15s ease-out",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setZoomScale((s) => (s >= 2 ? 1 : s + 0.5));
              }}
              className="max-h-[85vh] max-w-[90vw] object-contain shadow-2xl rounded-xl cursor-zoom-in"
              title="Click to zoom in further"
            />
          </div>

          {/* Navigation Arrows in Lightbox */}
          {photos.length > 1 && (
            <div
              className="absolute bottom-6 inset-x-6 flex items-center justify-between pointer-events-none"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
                  setZoomScale(1.5);
                }}
                className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 border border-white/25 transition backdrop-blur-md cursor-pointer active:scale-95"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-7" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
                  setZoomScale(1.5);
                }}
                className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 border border-white/25 transition backdrop-blur-md cursor-pointer active:scale-95"
                aria-label="Next photo"
              >
                <ChevronRight className="size-7" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
