/**
 * ProductForm — Enhanced product creation/edit form with:
 * - Auto-generate SKU if empty
 * - Auto-generate barcode if empty
 * - Barcode preview in form
 * - Post-creation print prompt (label + invoice)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Barcode from "react-barcode";
import {
  Printer,
  GripVertical,
  Images,
  Star,
  Trash2,
  Upload,
  UploadCloud,
  Plus,
  Loader2,
  Check,
  Tag,
  Truck,
  Settings2,
  Store,
  Layers,
} from "lucide-react";
import { ageGroups, formatPrice, useCategories, useProducts, type Product } from "@/lib/store";
import { generateProductFallbackSvg } from "@/lib/product-media";
import { uploadMedia } from "@/lib/uploads";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useDirectLabelPrint } from "@/lib/label-printer";
import { supabase } from "@/integrations/supabase/client";

export type ProductDraft = {
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating?: number;
  reviews?: number;
  ageGroup: string;
  imageUrl: string;
  images: string[];
  stock: number;
  lowStockAt: number;
  deliveryFee: number;
  sku: string;
  barcode: string;
  description: string;
  highlights: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  buyingPrice: number;
  recommendationMode: "manual" | "auto" | "manual_fallback";
  relatedProductIds: string[];
  salesChannel: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  variants: { id?: string; name: string; sku: string; stock: number; price_override: number | null }[];
};

const CATEGORY_PREFIXES: Record<string, string> = {
  clothing: "CL",
  toys: "TY",
  care: "CR",
  gear: "GR",
};

/** Generate a unique SKU like ZR-CL-XXXXXX */
function generateSKU(category: string): string {
  const prefix = CATEGORY_PREFIXES[category] ?? "GN";
  const random = Math.floor(100000 + Math.random() * 900000);
  return `ZR-${prefix}-${random}`;
}

/** Generate a unique 12-digit numeric barcode */
function generateBarcode(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

const toDraft = (p: Product | null, defaultCategory?: string): ProductDraft => ({
  slug: p?.id ?? "",
  name: p?.name ?? "",
  brand: p?.brand ?? "",
  category: p?.category ?? defaultCategory ?? "clothing",
  price: p?.price ?? 0,
  mrp: p?.mrp ?? 0,
  rating: p?.rating ?? 0,
  reviews: p?.reviews ?? 0,
  ageGroup: p?.ageGroup ?? "0-6m",
  imageUrl: p?.imageUrl ?? "",
  images: p?.images ?? [],
  stock: p?.stock ?? 10,
  lowStockAt: p?.lowStockAt ?? 5,
  deliveryFee: p?.deliveryFee ?? (p ? 0 : 79),
  sku: p?.sku ?? "",
  barcode: p?.barcode ?? "",
  description: p?.description ?? "",
  highlights: (p?.highlights ?? []).join("\n"),
  isFeatured: p?.isFeatured ?? false,
  isActive: p?.isActive ?? true,
  sortOrder: p?.sortOrder ?? 0,
  buyingPrice: p?.buyingPrice ?? 0,
  recommendationMode: p?.recommendationMode ?? "manual",
  relatedProductIds: (p as any)?.relatedProductIds ?? [],
  salesChannel: p?.salesChannel ?? "ONLINE_AND_OFFLINE",
  variants: p?.variants?.length
    ? p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        sku: v.sku ?? "",
        stock: v.stock,
        price_override: v.priceOverride ?? null,
      }))
    : [{ name: "Default", sku: p?.sku ?? "", stock: p?.stock ?? 10, price_override: null }],
});

const input =
  "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

const MAX_IMAGES = 10;

export function ProductForm({
  product,
  saving,
  onSave,
  onCancel,
  defaultCategory,
}: {
  product: Product | null;
  saving: boolean;
  onSave: (draft: ProductDraft) => void;
  onCancel: () => void;
  defaultCategory?: string;
}) {
  const [draft, setDraft] = useState<ProductDraft>(toDraft(product, defaultCategory));

  useEffect(() => {
    async function loadRelated() {
      if (!product?.uuid) return;
      const uuidRegex =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!uuidRegex.test(product.uuid)) return;
      try {
        const { data, error } = await supabase.rpc("get_related_products", {
          p_product_id: product.uuid,
          p_limit: 50,
        });
        if (error) throw error;
        const manualIds = (data || [])
          .filter((d: Record<string, unknown>) => d.relation_source === "manual")
          .map((d: Record<string, unknown>) => String(d.id));
        setDraft((prev) => ({ ...prev, relatedProductIds: manualIds }));
      } catch (err) {
        console.error("Failed to load related products:", err);
      }
    }
    void loadRelated();
  }, [product?.uuid]);

  const { data: categories } = useCategories();
  const { data: allProducts } = useProducts();
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [printing, setPrinting] = useState(false);
  const [showPostCreatePrompt, setShowPostCreatePrompt] = useState(false);
  const { printLabel, isPrinting: isDirectPrinting } = useDirectLabelPrint();
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // The barcode/sku to preview (shows auto-generated values)
  const previewSKU = draft.sku || generateSKU(draft.category);
  const previewBarcode = draft.barcode || generateBarcode();

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_IMAGES - draft.images.length;
      if (room <= 0) {
        toast.error(`Up to ${MAX_IMAGES} images per product`);
        return;
      }
      setUploading(true);
      try {
        const prefix = product ? product.uuid : "drafts";
        const uploadedUrls: string[] = [];
        for (const file of Array.from(files).slice(0, room)) {
          const url = await uploadMedia(file, prefix);
          uploadedUrls.push(url);
        }
        setDraft((d) => {
          const images = [...d.images, ...uploadedUrls].slice(0, MAX_IMAGES);
          return { ...d, images, imageUrl: d.imageUrl || images[0] || "" };
        });
        toast.success(
          `${uploadedUrls.length} image${uploadedUrls.length > 1 ? "s" : ""} uploaded successfully`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [draft.images, product],
  );

  const handleDragOverContainer = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragEnterContainer = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeaveContainer = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  }, []);

  const handleDropContainer = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      if (dragIndex === null && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        void addFiles(e.dataTransfer.files);
      }
    },
    [dragIndex, addFiles],
  );

  function reorder(from: number, to: number) {
    setDraft((d) => {
      const images = [...d.images];
      const [moved] = images.splice(from, 1);
      if (moved === undefined) return d;
      images.splice(to, 0, moved);
      return { ...d, images, imageUrl: images[0] ?? d.imageUrl };
    });
  }

  function handleSave() {
    // Auto-generate SKU and barcode if empty, sync primary image
    const finalDraft = {
      ...draft,
      imageUrl: draft.images[0] || draft.imageUrl || "",
      sku: draft.sku.trim() || generateSKU(draft.category),
      barcode: draft.barcode.trim() || generateBarcode(),
    };
    onSave(finalDraft);

    // Show post-creation prompt for NEW products
    if (!product) {
      // The onSave will be async — show prompt after a brief delay
      setTimeout(() => setShowPostCreatePrompt(true), 500);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/40 p-0 sm:p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[100dvh] sm:max-h-[95dvh] rounded-t-3xl sm:rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border p-6">
          <h2 className="font-display text-xl font-bold">
            {product ? "Edit product" : "Add product"}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* Gallery with Full Drag & Drop Support */}
          <div
            onDragOver={handleDragOverContainer}
            onDragEnter={handleDragEnterContainer}
            onDragLeave={handleDragLeaveContainer}
            onDrop={handleDropContainer}
            className={`relative rounded-2xl border-2 transition-all p-4 ${
              isDraggingOver
                ? "border-primary bg-primary/5 ring-4 ring-primary/10 shadow-lg"
                : "border-border bg-card"
            }`}
          >
            {/* Active Drop Overlay */}
            {isDraggingOver && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-primary/15 backdrop-blur-[2px] border-2 border-dashed border-primary pointer-events-none animate-in fade-in duration-150">
                <div className="flex flex-col items-center bg-card p-5 rounded-2xl shadow-xl border border-primary/30">
                  <UploadCloud className="size-10 text-primary animate-bounce" />
                  <p className="mt-2 text-sm font-bold text-primary">Drop images to upload</p>
                  <p className="text-xs text-muted-foreground">
                    Release your mouse to add instantly
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Media gallery</p>
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_IMAGES} photos or videos · drag to reorder · first image is the main
                  thumbnail
                </p>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 shadow-xs active:scale-95"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                <span>{uploading ? "Uploading…" : "Upload files"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* If no images uploaded yet: large interactive clickable dropzone */}
            {draft.images.length === 0 ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                  isDraggingOver
                    ? "border-primary bg-primary/10"
                    : "border-border/80 bg-muted/20 hover:border-primary/60 hover:bg-muted/40"
                }`}
              >
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                  <UploadCloud className="size-6" />
                </div>
                <p className="text-sm font-bold text-foreground">
                  {uploading
                    ? "Uploading media files…"
                    : isDraggingOver
                      ? "Drop images right here!"
                      : "Drag & drop images here, or click to browse"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Supports JPEG, PNG, WebP, GIF, MP4 (Up to 10 MB each · Max {MAX_IMAGES} files)
                </p>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {draft.images.map((url, i) => (
                  <div
                    key={url}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (dragIndex !== null && dragIndex !== i) reorder(dragIndex, i);
                      setDragIndex(null);
                    }}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/20 shadow-2xs"
                  >
                    {url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ? (
                      <video
                        src={url}
                        className="size-full object-cover"
                        playsInline
                        muted
                        autoPlay
                        loop
                      />
                    ) : (
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = generateProductFallbackSvg({
                            name: draft.name,
                            category: draft.category,
                            slug: draft.slug,
                          });
                        }}
                      />
                    )}
                    {i === 0 && (
                      <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-xs">
                        <Star className="size-3" /> Main
                      </span>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-background/80 p-1 text-muted-foreground shadow-xs">
                      <GripVertical className="size-3" />
                    </span>
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft((d) => {
                          const images = d.images.filter((u) => u !== url);
                          return { ...d, images, imageUrl: images[0] ?? "" };
                        });
                      }}
                      className="absolute right-1 top-1 rounded-lg bg-background/90 p-1 text-destructive opacity-0 transition group-hover:opacity-100 shadow-xs hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}

                {draft.images.length < MAX_IMAGES && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/80 bg-muted/10 transition-all hover:border-primary hover:bg-muted/40 text-muted-foreground hover:text-primary"
                    title="Add more images"
                  >
                    <Plus className="size-5 mb-1" />
                    <span className="text-[11px] font-bold">Add More</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Name
              <input
                className={input}
                value={draft.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    name: newName,
                    slug: !product
                      ? newName
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/(^-|-$)/g, "")
                      : d.slug,
                  }));
                }}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Slug (URL id)
              <input
                className={input}
                value={draft.slug}
                onChange={(e) => set("slug", e.target.value)}
                list="existing-slugs"
              />
              <datalist id="existing-slugs">
                {(allProducts ?? []).map((p) => (
                  <option key={p.id} value={p.id} />
                ))}
              </datalist>
            </label>

            {/* SKU & Barcode with preview */}
            <label className="text-sm font-semibold">
              SKU
              <input
                className={input}
                value={draft.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder={`Auto: ${generateSKU(draft.category)}`}
              />
            </label>
            <label className="text-sm font-semibold">
              Barcode
              <input
                className={input}
                value={draft.barcode}
                onChange={(e) => set("barcode", e.target.value)}
                placeholder="Auto-generated if empty"
              />
            </label>

            {/* Barcode Preview */}
            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Tag className="size-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Label Preview
                </span>
              </div>
              <div className="flex flex-col items-center">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Zérah Baby & Kids
                </p>
                <p className="text-xs font-semibold mt-1 text-center">
                  {draft.name || "Product Name"}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-black">{formatPrice(draft.price || 0)}</span>
                  {draft.mrp > draft.price && (
                    <span className="text-[10px] text-muted-foreground line-through">
                      {formatPrice(draft.mrp)}
                    </span>
                  )}
                </div>
                <div className="mt-2 scale-90">
                  <Barcode
                    value={draft.barcode || draft.sku || previewBarcode}
                    format="CODE128"
                    width={1.2}
                    height={40}
                    fontSize={10}
                    margin={0}
                    displayValue={true}
                    background="transparent"
                  />
                </div>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  SKU: {draft.sku || previewSKU}
                </p>
              </div>
            </div>

            <label className="text-sm font-semibold">
              Brand
              <input
                className={input}
                value={draft.brand}
                onChange={(e) => set("brand", e.target.value)}
              />
            </label>
            <label className="text-sm font-semibold">
              Section / category
              <select
                className={input}
                value={draft.category}
                onChange={(e) => set("category", e.target.value)}
              >
                {(categories ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
                {!(categories ?? []).some((c) => c.slug === draft.category) && draft.category && (
                  <option value={draft.category}>{draft.category}</option>
                )}
              </select>
            </label>
            <label className="text-sm font-semibold">
              Age group
              <select
                className={input}
                value={draft.ageGroup}
                onChange={(e) => set("ageGroup", e.target.value)}
              >
                {ageGroups.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            {/* PRICING & PROFIT SECTION */}
            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-slate-50/50">
              <div className="flex items-center gap-2 mb-4">
                <Tag className="size-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Pricing & Profit
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <label className="text-sm font-semibold">
                  Buying Price (₹)
                  <input
                    type="number"
                    min="0"
                    className={input}
                    placeholder="0"
                    value={draft.buyingPrice === 0 ? "" : draft.buyingPrice}
                    onChange={(e) =>
                      set(
                        "buyingPrice",
                        e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                      )
                    }
                  />
                </label>
                <label className="text-sm font-semibold">
                  Selling Price (₹)
                  <input
                    type="number"
                    min="0"
                    className={input}
                    placeholder="0"
                    value={draft.price === 0 ? "" : draft.price}
                    onChange={(e) =>
                      set("price", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                    }
                  />
                </label>
                <label className="text-sm font-semibold">
                  MRP (₹)
                  <input
                    type="number"
                    min="0"
                    className={input}
                    placeholder="0"
                    value={draft.mrp === 0 ? "" : draft.mrp}
                    onChange={(e) =>
                      set("mrp", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                    }
                  />
                </label>
              </div>

              {/* Delivery Fee Section */}
              <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Truck className="size-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Delivery / Shipping Price
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-primary">
                    {draft.deliveryFee === 0
                      ? "🎉 Free Delivery Active"
                      : `₹${draft.deliveryFee} Shipping Charge`}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      Shipping Price (₹)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                        ₹
                      </span>
                      <input
                        type="number"
                        min="0"
                        className={`${input} pl-7 font-bold text-foreground`}
                        placeholder="0 (Free Delivery)"
                        value={draft.deliveryFee === 0 ? "" : draft.deliveryFee}
                        onChange={(e) =>
                          set(
                            "deliveryFee",
                            e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                          )
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      Quick Presets
                    </label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => set("deliveryFee", 0)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold border transition cursor-pointer ${
                          draft.deliveryFee === 0
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                            : "bg-background border-border hover:bg-muted text-foreground"
                        }`}
                      >
                        Free (₹0)
                      </button>
                      <button
                        type="button"
                        onClick={() => set("deliveryFee", 79)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold border transition cursor-pointer ${
                          draft.deliveryFee === 79
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-background border-border hover:bg-muted text-foreground"
                        }`}
                      >
                        Standard (₹79)
                      </button>
                      <button
                        type="button"
                        onClick={() => set("deliveryFee", 149)}
                        className={`rounded-xl px-3 py-2 text-xs font-bold border transition cursor-pointer ${
                          draft.deliveryFee === 149
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-background border-border hover:bg-muted text-foreground"
                        }`}
                      >
                        Express (₹149)
                      </button>
                    </div>
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] text-muted-foreground">
                  💡 Naye product par default <b>₹79</b> rehta hai. Aap ise <b>Free (₹0)</b> ya apni
                  marzi ka koi bhi amount set kar sakte hain.
                </p>
              </div>

              {/* Profit Calculation Box */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1">Expected Profit</p>
                    <p
                      className={`text-xl font-bold ${draft.price - draft.buyingPrice < 0 ? "text-destructive" : "text-emerald-600"}`}
                    >
                      {draft.price - draft.buyingPrice < 0 ? "-" : ""}
                      {formatPrice(Math.abs(draft.price - draft.buyingPrice))}
                    </p>
                  </div>
                  <div className="hidden sm:block w-px h-10 bg-border"></div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-1">Profit Margin</p>
                    <p
                      className={`text-xl font-bold ${draft.price - draft.buyingPrice < 0 ? "text-destructive" : "text-emerald-600"}`}
                    >
                      {draft.buyingPrice > 0
                        ? (((draft.price - draft.buyingPrice) / draft.buyingPrice) * 100).toFixed(2)
                        : draft.price > 0
                          ? "100.00"
                          : "0.00"}
                      %
                    </p>
                  </div>
                </div>

                {/* Validation Warnings */}
                {draft.price > draft.mrp && draft.mrp > 0 && (
                  <p className="mt-3 text-xs font-medium text-amber-600 flex items-center gap-1">
                    ⚠️ Selling Price is higher than MRP.
                  </p>
                )}
                {draft.price < draft.buyingPrice && (
                  <p className="mt-3 text-xs font-medium text-destructive flex items-center gap-1">
                    ⚠️ Warning: Selling Price is lower than Buying Price. This will result in a
                    loss.
                  </p>
                )}
              </div>
            </div>
            {/* VARIANTS SECTION */}
            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-slate-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Product Variants & Stock
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    set("variants", [
                      ...draft.variants,
                      { name: "", sku: generateSKU(draft.category), stock: 10, price_override: null },
                    ])
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-primary text-primary px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-white transition"
                >
                  <Plus className="size-3" /> Add Variant
                </button>
              </div>

              <div className="space-y-3">
                {draft.variants.map((v, idx) => (
                  <div key={idx} className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-border bg-background">
                    <label className="flex-1 min-w-[120px] text-xs font-semibold text-muted-foreground">
                      Variant Name
                      <input
                        className={`${input} mt-1 text-foreground`}
                        value={v.name}
                        placeholder="e.g. Size M, Red"
                        onChange={(e) => {
                          const updated = [...draft.variants];
                          updated[idx].name = e.target.value;
                          set("variants", updated);
                        }}
                      />
                    </label>
                    <label className="w-24 text-xs font-semibold text-muted-foreground">
                      Stock
                      <input
                        type="number"
                        min="0"
                        className={`${input} mt-1 text-foreground`}
                        value={v.stock}
                        onChange={(e) => {
                          const updated = [...draft.variants];
                          updated[idx].stock = Math.max(0, Number(e.target.value));
                          set("variants", updated);
                          // Auto update parent stock
                          set("stock", updated.reduce((sum, val) => sum + val.stock, 0));
                        }}
                      />
                    </label>
                    <label className="w-32 text-xs font-semibold text-muted-foreground">
                      SKU
                      <input
                        className={`${input} mt-1 text-foreground`}
                        value={v.sku}
                        placeholder="Auto"
                        onChange={(e) => {
                          const updated = [...draft.variants];
                          updated[idx].sku = e.target.value;
                          set("variants", updated);
                        }}
                      />
                    </label>
                    <label className="w-32 text-xs font-semibold text-muted-foreground">
                      Price (₹)
                      <input
                        type="number"
                        min="0"
                        placeholder="Default"
                        className={`${input} mt-1 text-foreground`}
                        value={v.price_override ?? ""}
                        onChange={(e) => {
                          const updated = [...draft.variants];
                          updated[idx].price_override = e.target.value ? Number(e.target.value) : null;
                          set("variants", updated);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = draft.variants.filter((_, i) => i !== idx);
                        if (updated.length === 0) {
                          updated.push({ name: "Default", sku: generateSKU(draft.category), stock: 10, price_override: null });
                        }
                        set("variants", updated);
                        set("stock", updated.reduce((sum, val) => sum + val.stock, 0));
                      }}
                      className="p-2 mb-0.5 rounded-lg border border-destructive/20 text-destructive hover:bg-destructive hover:text-white transition"
                      title="Remove Variant"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <label className="text-sm font-semibold">
              Low-stock alert at
              <input
                type="number"
                min="0"
                className={input}
                placeholder="0"
                value={draft.lowStockAt === 0 ? "" : draft.lowStockAt}
                onChange={(e) =>
                  set("lowStockAt", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                }
              />
            </label>
            <label className="text-sm font-semibold">
              Sort order
              <input
                type="number"
                className={input}
                placeholder="0"
                value={draft.sortOrder === 0 ? "" : draft.sortOrder}
                onChange={(e) =>
                  set("sortOrder", e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
            </label>
            <label className="text-sm font-semibold">
              Main image URL (optional override)
              <input
                className={input}
                value={draft.imageUrl}
                onChange={(e) => set("imageUrl", e.target.value)}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Description
              <textarea
                rows={3}
                className={input}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Highlights (one per line)
              <textarea
                rows={3}
                className={input}
                value={draft.highlights}
                onChange={(e) => set("highlights", e.target.value)}
              />
            </label>

            {/* MERCHANDISING / RELATED PRODUCTS SECTION */}
            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-amber-50/30">
              <div className="flex items-center gap-2 mb-4">
                <Tag className="size-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Merchandising / "More in this Style"
                </span>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-semibold">
                  Recommendation Logic
                  <select
                    className={input}
                    value={draft.recommendationMode}
                    onChange={(e) =>
                      set(
                        "recommendationMode",
                        e.target.value as "manual" | "manual_fallback" | "auto",
                      )
                    }
                  >
                    <option value="manual_fallback">
                      Admin Selected + Auto Fallback (Recommended)
                    </option>
                    <option value="manual">Admin Selected ONLY (Strict)</option>
                    <option value="auto">Auto Match ONLY (Same Category/Brand)</option>
                  </select>
                </label>

                {draft.recommendationMode !== "auto" && (
                  <label className="block text-sm font-semibold">
                    Manually Selected Related Products
                    <div className="text-[11px] font-normal text-muted-foreground mb-2">
                      Select products that should appear in the "More in this style" section.
                      Relationships are automatically bidirectional.
                    </div>
                    <div className="border border-border rounded-xl bg-background overflow-hidden max-h-60 overflow-y-auto">
                      {(allProducts || [])
                        .filter((p) => p.id !== draft.slug)
                        .map((p) => (
                          <label
                            key={p.id}
                            className="flex items-center gap-3 p-3 border-b border-border hover:bg-muted/50 cursor-pointer transition"
                          >
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--primary)]"
                              checked={draft.relatedProductIds.includes(p.uuid)}
                              onChange={(e) => {
                                const newIds = e.target.checked
                                  ? [...draft.relatedProductIds, p.uuid]
                                  : draft.relatedProductIds.filter((id) => id !== p.uuid);
                                set("relatedProductIds", newIds);
                              }}
                            />
                            {p.imageUrl ? (
                              <img src={p.imageUrl} className="size-8 rounded-md object-cover" />
                            ) : (
                              <div className="size-8 rounded-md bg-muted" />
                            )}
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{p.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {p.sku} • {p.category}
                              </span>
                            </div>
                          </label>
                        ))}
                      {allProducts?.length === 1 && (
                        <div className="p-4 text-sm text-center text-muted-foreground">
                          No other products available yet.
                        </div>
                      )}
                    </div>
                  </label>
                )}
              </div>
            </div>

            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-purple-50/30">
              <div className="flex items-center gap-2 mb-4">
                <Store className="size-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Sales Channel
                </span>
              </div>
              <label className="block text-sm font-semibold">
                Product Availability
                <select
                  className={input}
                  value={draft.salesChannel}
                  onChange={(e) =>
                    set("salesChannel", e.target.value as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY")
                  }
                >
                  <option value="ONLINE_AND_OFFLINE">Online Website + Offline POS</option>
                  <option value="OFFLINE_ONLY">Only Offline POS (Hidden from Website)</option>
                </select>
                <div className="text-[11px] font-normal text-muted-foreground mt-1.5">
                  Offline-only products will not be visible on the website and cannot be purchased
                  online.
                </div>
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.isFeatured}
                onChange={(e) => set("isFeatured", e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Featured{" "}
              <span className="text-muted-foreground font-normal ml-1">
                (Website ke homepage par special section me dikhega)
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Visible in store{" "}
              <span className="text-muted-foreground font-normal ml-1">
                (Customer ko website par dikhega aur wo khareed payenge)
              </span>
            </label>
          </div>
        </div>

        <div className="shrink-0 border-t border-border p-6 flex justify-end gap-3 bg-muted/50">
          {product && (
            <div className="mr-auto inline-flex items-center rounded-full border border-border bg-card shadow-2xs overflow-hidden">
              <button
                type="button"
                onClick={() => printLabel(product)}
                disabled={isDirectPrinting}
                title="Print Label (1-Click Direct Print)"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
              >
                <Printer className="size-4 text-[#8B2020]" />
                <span>Print Label</span>
              </button>
              <button
                type="button"
                onClick={() => setPrinting(true)}
                title="More print options (Customize quantities & format)"
                className="px-2.5 py-2 text-xs border-l border-border text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                <Settings2 className="size-3.5" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-muted cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading || !draft.name || !draft.slug}
            className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save product"}
          </button>
        </div>
      </div>

      {/* Print Labels modal */}
      {printing && product && (
        <PrintLabelsModal products={[product]} onClose={() => setPrinting(false)} />
      )}

      {/* Post-creation prompt */}
      {showPostCreatePrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowPostCreatePrompt(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 mb-4">
              <Check className="size-7 text-emerald-600" />
            </div>
            <h3 className="text-lg font-bold">Product Created!</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              Would you like to print labels for this product?
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setShowPostCreatePrompt(false);
                  setPrinting(true);
                }}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
              >
                <Printer className="size-4 inline mr-2" />
                Print Barcode Label
              </button>
              <button
                onClick={() => setShowPostCreatePrompt(false)}
                className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
