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
  Video,
} from "lucide-react";
import {
  ageGroups,
  formatPrice,
  useCategories,
  useProducts,
  getProductColors,
  getColorSwatchImage,
  type Product,
} from "@/lib/store";
import { generateProductFallbackSvg } from "@/lib/product-media";
import { uploadMedia } from "@/lib/uploads";
import { useUploader, type UploadJob } from "@/lib/use-uploader";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useDirectLabelPrint } from "@/lib/label-printer";
import { supabase } from "@/integrations/supabase/client";

export type ProductVariantDraft = {
  id?: string;
  name: string;
  color?: string | null;
  size?: string | null;
  sku: string;
  barcode?: string | null;
  stock: number;
  price_override: number | null;
  mrp_override?: number | null;
  image_url?: string | null;
};

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
  productImages: {
    id?: string;
    public_url: string;
    is_primary: boolean;
    sort_order: number;
    color?: string | null;
    alt_text?: string | null;
  }[];
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
  colors: string[];
  variants: ProductVariantDraft[];
};

const CATEGORY_PREFIXES: Record<string, string> = {
  clothing: "CL",
  toys: "TY",
  care: "CR",
  gear: "GR",
};

/** Generate a unique SKU like ZR-CL-XXXXXX */
function generateSKU(category: string, color?: string | null, size?: string | null): string {
  const prefix = CATEGORY_PREFIXES[category] ?? "GN";
  const colorPart = color
    ? `-${color
        .slice(0, 3)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")}`
    : "";
  const sizePart = size
    ? `-${size
        .slice(0, 3)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")}`
    : "";
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ZR-${prefix}${colorPart}${sizePart}-${random}`;
}

/** Generate a unique 12-digit numeric barcode */
function generateBarcode(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

const toDraft = (
  p: Product | null,
  defaultCategory?: string,
  defaultSalesChannel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
): ProductDraft => {
  const pImages = (p?.product_images || []).map((img, i) => ({
    id: img.id,
    public_url: img.public_url,
    is_primary: img.is_primary ?? i === 0,
    sort_order: img.sort_order ?? i,
    color: img.color ?? null,
    alt_text: img.alt_text ?? null,
  }));

  if (pImages.length === 0 && p?.images?.length) {
    p.images.forEach((url, i) => {
      pImages.push({
        id: undefined,
        public_url: url,
        is_primary: i === 0,
        sort_order: i,
        color: null,
        alt_text: null,
      });
    });
  }

  const existingColors = p ? getProductColors(p) : [];

  return {
    slug: p?.id ?? "",
    name: p?.name ?? "",
    brand: p?.brand ?? "Zérah",
    category: p?.category ?? defaultCategory ?? "clothing",
    price: p?.price ?? 0,
    mrp: p?.mrp ?? 0,
    rating: p?.rating ?? 0,
    reviews: p?.reviews ?? 0,
    ageGroup: p?.ageGroup ?? "0-6m",
    imageUrl:
      p?.imageUrl && !p.imageUrl.startsWith("blob:") && !p.imageUrl.startsWith("data:")
        ? p.imageUrl
        : pImages[0]?.public_url || "",
    images: (p?.images && p.images.length > 0
      ? p.images
      : pImages.map((img) => img.public_url)
    ).filter(
      (u) =>
        typeof u === "string" &&
        u.trim().length > 0 &&
        !u.startsWith("blob:") &&
        !u.startsWith("data:"),
    ),
    productImages: pImages.filter(
      (img) =>
        img.public_url &&
        !img.public_url.startsWith("blob:") &&
        !img.public_url.startsWith("data:"),
    ),
    stock: p?.stock ?? 10,
    lowStockAt: p?.lowStockAt ?? 5,
    deliveryFee:
      (p?.salesChannel ?? defaultSalesChannel) === "OFFLINE_ONLY"
        ? 0
        : (p?.deliveryFee ?? (p ? 0 : 79)),
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
    salesChannel: p?.salesChannel ?? defaultSalesChannel ?? "ONLINE_AND_OFFLINE",
    colors: existingColors,
    variants: p?.variants?.length
      ? p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          color: v.color ?? null,
          size: v.size ?? null,
          sku: v.sku ?? "",
          barcode: v.barcode ?? null,
          stock: v.stock,
          price_override: v.priceOverride ?? null,
          mrp_override: v.mrpOverride ?? null,
          image_url: v.imageUrl ?? null,
        }))
      : [
          {
            name: "Default",
            color: null,
            size: null,
            sku: p?.sku || generateSKU(p?.category || defaultCategory || "clothing"),
            barcode: p?.barcode || generateBarcode(),
            stock: p?.stock ?? 10,
            price_override: null,
            mrp_override: null,
            image_url: null,
          },
        ],
  };
};

const input =
  "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

const MAX_IMAGES = 10;

export function ProductForm({
  product,
  saving,
  onSave,
  onCancel,
  defaultCategory,
  defaultSalesChannel,
}: {
  product: Product | null;
  saving: boolean;
  onSave: (draft: ProductDraft) => void | Promise<unknown>;
  onCancel: () => void;
  defaultCategory?: string;
  defaultSalesChannel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(
    toDraft(product, defaultCategory, defaultSalesChannel),
  );

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    jobs,
    addFiles: startUploads,
    removeJob,
    retryJob,
    reorderJobs,
    setInitialJobs,
    isUploading,
  } = useUploader({
    concurrency: 3,
    prefix: product ? product.uuid : "drafts",
    onSuccess: async (job) => {
      // Immediate database save for existing products
      if (product?.uuid && job.publicUrl) {
        try {
          const isVideo = job.file && job.file.type.startsWith("video/");
          if (isVideo) {
            await supabase.from("product_videos").insert({
              product_id: product.uuid,
              video_url: job.publicUrl,
              sort_order: 99,
            });
          } else {
            await supabase.from("product_images").insert({
              product_id: product.uuid,
              public_url: job.publicUrl,
              sort_order: 99,
            });
          }
        } catch (e) {
          console.error("Failed to save media record immediately", e);
        }
      }
    },
  });

  // Sync initial images to uploader jobs
  useEffect(() => {
    if (draft.images.length > 0) {
      setInitialJobs(
        draft.images.map((url) => ({
          id: url,
          file: null as any,
          previewUrl: url,
          publicUrl: url,
          progress: 100,
          state: "SAVED",
        })),
      );
    }
  }, [draft.images.length, setInitialJobs]); // Only run when draft.images length changes (initial load or external set)

  // Sync uploader jobs back to draft.images whenever jobs change
  useEffect(() => {
    const validJobs = jobs.filter(
      (j) =>
        j.state === "SAVED" &&
        j.publicUrl &&
        typeof j.publicUrl === "string" &&
        !j.publicUrl.startsWith("blob:") &&
        !j.publicUrl.startsWith("data:"),
    );
    const urls = validJobs.map((j) => j.publicUrl!);

    // Check if urls actually changed to prevent infinite loops
    const currentStr = JSON.stringify(draft.images);
    const newStr = JSON.stringify(urls);
    if (currentStr !== newStr) {
      setDraft((d) => {
        const existingMap = new Map((d.productImages || []).map((img) => [img.public_url, img]));
        const updatedProductImages = urls.map((u, i) => {
          const matched = existingMap.get(u);
          return {
            public_url: u,
            is_primary: i === 0,
            sort_order: i,
            color: matched?.color ?? null,
            alt_text: matched?.alt_text || d.name,
          };
        });

        return {
          ...d,
          images: urls,
          imageUrl: urls[0] ?? "",
          productImages: updatedProductImages,
        };
      });
    }
  }, [jobs, draft.images]);

  const [activeColorTab, setActiveColorTab] = useState<string>("ALL");
  const [newColorName, setNewColorName] = useState<string>("");
  const [matrixSizes, setMatrixSizes] = useState<string[]>(["0-6m", "6-12m", "1-2Y"]);
  const [customSizeInput, setCustomSizeInput] = useState<string>("");
  const [bulkStock, setBulkStock] = useState<number>(10);
  const [hasVariants, setHasVariants] = useState<boolean>(() => {
    return draft.variants.length > 1 || Boolean(draft.variants[0]?.color || draft.variants[0]?.size);
  });

  const popularColors = [
    "Blue",
    "Pink",
    "Red",
    "White",
    "Black",
    "Yellow",
    "Green",
    "Beige",
    "Grey",
    "Navy",
    "Brown",
    "Multi",
  ];

  const popularSizes = [
    "0-3m",
    "3-6m",
    "0-6m",
    "6-12m",
    "12-18m",
    "1-2Y",
    "2-3Y",
    "3-4Y",
    "4-5Y",
    "S",
    "M",
    "L",
    "XL",
    "Free Size",
  ];

  const syncMatrix = (colors: string[], sizes: string[]) => {
    const activeColors = colors.length > 0 ? colors : ["Default"];
    const activeSizes = sizes.length > 0 ? sizes : ["Standard"];

    const newVariants: ProductVariantDraft[] = [];

    for (const c of activeColors) {
      for (const s of activeSizes) {
        const colorName = c === "Default" ? null : c;
        const sizeName = s === "Standard" ? null : s;
        const varName =
          colorName && sizeName ? `${colorName} / ${sizeName}` : colorName || sizeName || "Default";

        const existing = draft.variants.find(
          (v) => (v.color ?? null) === colorName && (v.size ?? null) === sizeName,
        );

        if (existing) {
          newVariants.push(existing);
        } else {
          newVariants.push({
            name: varName,
            color: colorName,
            size: sizeName,
            sku: generateSKU(draft.category, colorName, sizeName),
            barcode: generateBarcode(),
            stock: bulkStock || 10,
            price_override: null,
            mrp_override: null,
            image_url: colorName
              ? getColorSwatchImage(
                  { ...product, product_images: draft.productImages } as any,
                  colorName,
                )
              : null,
          });
        }
      }
    }

    setDraft((d) => ({
      ...d,
      colors,
      variants: newVariants,
      stock: newVariants.reduce((sum, v) => sum + v.stock, 0),
    }));
  };

  const toggleColorPreset = (cName: string) => {
    const exists = draft.colors.some((c) => c.toLowerCase() === cName.toLowerCase());
    const nextColors = exists
      ? draft.colors.filter((c) => c.toLowerCase() !== cName.toLowerCase())
      : [...draft.colors, cName];
    syncMatrix(nextColors, matrixSizes);
  };

  const toggleSizePreset = (sName: string) => {
    const nextSizes = matrixSizes.includes(sName)
      ? matrixSizes.filter((s) => s !== sName)
      : [...matrixSizes, sName];
    setMatrixSizes(nextSizes);
    syncMatrix(draft.colors, nextSizes);
  };

  const handleApplyBulkStock = () => {
    const updated = draft.variants.map((v) => ({ ...v, stock: bulkStock }));
    setDraft((d) => ({
      ...d,
      variants: updated,
      stock: updated.reduce((sum, val) => sum + val.stock, 0),
    }));
    toast.success(`Updated stock to ${bulkStock} across all ${draft.variants.length} variants!`);
  };

  const handleAddColor = () => {
    const trimmed = newColorName.trim();
    if (!trimmed) return;
    if (!draft.colors.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      const nextColors = [...draft.colors, trimmed];
      syncMatrix(nextColors, matrixSizes);
      setActiveColorTab(trimmed);
    }
    setNewColorName("");
  };

  const handleRemoveColor = (colorToRemove: string) => {
    const updatedColors = draft.colors.filter((c) => c.toLowerCase() !== colorToRemove.toLowerCase());
    syncMatrix(updatedColors, matrixSizes);
    if (activeColorTab.toLowerCase() === colorToRemove.toLowerCase()) {
      setActiveColorTab("ALL");
    }
  };

  const handleSetImageColor = (imgUrl: string, color: string | null) => {
    const existing = draft.productImages || [];
    const idx = existing.findIndex((p) => p.public_url === imgUrl);
    let updated: typeof existing;
    if (idx >= 0) {
      updated = [...existing];
      updated[idx] = { ...updated[idx], color };
    } else {
      updated = [
        ...existing,
        {
          public_url: imgUrl,
          is_primary: existing.length === 0,
          sort_order: existing.length,
          color,
          alt_text: draft.name,
        },
      ];
    }
    setDraft((d) => ({ ...d, productImages: updated }));
  };

  const handleGenerateMatrix = () => {
    syncMatrix(draft.colors, matrixSizes);
    toast.success(`Generated ${draft.variants.length} Color × Size variants!`);
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showPostCreatePrompt, setShowPostCreatePrompt] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { printLabel, isPrinting: isDirectPrinting } = useDirectLabelPrint();
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // The barcode/sku to preview (shows auto-generated values)
  const previewSKU = draft.sku || generateSKU(draft.category);
  const previewBarcode = draft.barcode || generateBarcode();

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_IMAGES - jobs.length;
      if (room <= 0) {
        toast.error(`Up to ${MAX_IMAGES} images per product`);
        return;
      }

      const filesArray = Array.from(files).slice(0, room);
      startUploads(filesArray);
    },
    [jobs.length, startUploads],
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
    reorderJobs(from, to);
  }

  async function handleSave() {
    if (saving || isSubmitting) return;

    if (isUploading) {
      toast.warning("Please wait for images to finish uploading before saving.");
      return;
    }

    setIsSubmitting(true);

    // Filter out invalid or ephemeral blob/data URLs
    const validImages = draft.images.filter(
      (u) =>
        typeof u === "string" &&
        u.trim().length > 0 &&
        !u.startsWith("blob:") &&
        !u.startsWith("data:"),
    );

    const validProductImages = (draft.productImages || []).filter(
      (img) =>
        img &&
        typeof img.public_url === "string" &&
        img.public_url.trim().length > 0 &&
        !img.public_url.startsWith("blob:") &&
        !img.public_url.startsWith("data:"),
    );

    // Auto-generate SKU and barcode if empty, sync primary image
    const finalDraft = {
      ...draft,
      images: validImages,
      imageUrl: validImages[0] || "",
      productImages:
        validProductImages.length > 0
          ? validProductImages
          : validImages.map((u, i) => ({
              public_url: u,
              is_primary: i === 0,
              sort_order: i,
              color: null,
              alt_text: draft.name,
            })),
      sku: draft.sku.trim() || generateSKU(draft.category),
      barcode: draft.barcode.trim() || generateBarcode(),
    };

    try {
      const res = (await Promise.resolve(onSave(finalDraft))) as any;
      // Show post-creation prompt for NEW products ONLY when save succeeds
      if (!product) {
        const newProductObj: Product = {
          id: res?.slug || finalDraft.slug,
          uuid: res?.productId || "",
          name: finalDraft.name,
          brand: finalDraft.brand,
          category: finalDraft.category,
          price: Number(finalDraft.price),
          mrp: Number(finalDraft.mrp),
          stock: Number(finalDraft.stock),
          sku: finalDraft.sku,
          barcode: finalDraft.barcode,
          image: finalDraft.imageUrl || finalDraft.images[0] || "",
          imageUrl: finalDraft.imageUrl,
          images: finalDraft.images,
          description: finalDraft.description || "",
          rating: 5,
          reviews: 0,
          highlights: Array.isArray(finalDraft.highlights)
            ? finalDraft.highlights
            : (finalDraft.highlights || "")
                .split("\n")
                .map((h: string) => h.trim())
                .filter(Boolean),
          isFeatured: finalDraft.isFeatured || false,
          isActive: finalDraft.isActive,
          sortOrder: finalDraft.sortOrder || 0,
          lowStockAt: finalDraft.lowStockAt || 2,
          ageGroup: finalDraft.ageGroup || "",
          salesChannel: finalDraft.salesChannel,
          sales_channel: finalDraft.salesChannel,
          variants: (finalDraft.variants || []).map((v) => ({
            id: v.id || "",
            name: v.name,
            sku: v.sku,
            barcode: v.barcode ?? null,
            stock: v.stock,
            priceOverride: v.price_override ?? undefined,
            mrpOverride: v.mrp_override ?? undefined,
            color: v.color ?? null,
            size: v.size ?? null,
            imageUrl: v.image_url ?? null,
          })),
        };
        setCreatedProduct(newProductObj);
        setShowPostCreatePrompt(true);
      } else {
        onCancel();
      }
    } catch (err) {
      console.error("Failed to save product:", err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return createPortal(
    <>
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
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* CARD 1: 📸 PHOTOS & VIDEOS */}
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
            {isDraggingOver && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-primary/15 backdrop-blur-[2px] border-2 border-dashed border-primary pointer-events-none animate-in fade-in duration-150">
                <div className="flex flex-col items-center bg-card p-5 rounded-2xl shadow-xl border border-primary/30">
                  <UploadCloud className="size-10 text-primary animate-bounce" />
                  <p className="mt-2 text-sm font-bold text-primary">Drop files to upload</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>📸 Product Photos & Videos</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    ({jobs.length}/{MAX_IMAGES})
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  First photo will be the main display cover
                </p>
              </div>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 shadow-xs active:scale-95"
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                <span>{isUploading ? "Uploading…" : "+ Add Photos"}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                disabled={saving || isUploading}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Media Thumbnails Grid */}
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 pt-1">
              {jobs.map((job, i) => {
                const url = job.previewUrl || job.publicUrl || "";
                const isProcessing = job.state === "SELECTED" || job.state === "UPLOADING" || job.state === "SAVING";
                const isError = job.state === "FAILED";

                return (
                  <div
                    key={job.id}
                    draggable={!isProcessing}
                    onDragStart={() => setDragIndex(i)}
                    onDragEnd={() => setDragIndex(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (dragIndex !== null && dragIndex !== i) reorder(dragIndex, i);
                      setDragIndex(null);
                    }}
                    className={`group relative aspect-square overflow-hidden rounded-xl border bg-muted/30 transition-all ${
                      i === 0 ? "border-primary/80 ring-2 ring-primary/20" : "border-border"
                    } ${isProcessing ? "opacity-75" : "hover:border-primary/50"}`}
                  >
                    {url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ||
                      (job.file && job.file.type.startsWith("video/")) ? (
                        <div className="relative size-full">
                          <video src={url} className="size-full object-cover" muted playsInline />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Video className="size-5 text-white drop-shadow" />
                          </div>
                        </div>
                      ) : (
                        <img
                          src={url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = generateProductFallbackSvg({
                              name: draft.name,
                              category: draft.category,
                              slug: draft.slug,
                            });
                          }}
                        />
                      )}

                    {isProcessing && (
                      <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-2 text-center">
                        <Loader2 className="size-4 animate-spin text-primary mb-1" />
                        <span className="text-[9px] font-bold">{job.progress}%</span>
                      </div>
                    )}

                    {isError && (
                      <div className="absolute inset-0 bg-destructive/90 flex flex-col items-center justify-center p-1 text-center">
                        <span className="text-[9px] text-white font-bold mb-1">Failed</span>
                        <button
                          type="button"
                          onClick={() => retryJob(job.id)}
                          className="text-[9px] bg-white text-destructive px-1.5 py-0.5 rounded font-bold"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {i === 0 && !isProcessing && (
                      <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground shadow-xs">
                        <Star className="size-2.5 fill-current" /> Cover
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeJob(job.id);
                      }}
                      className="absolute right-1 top-1 z-20 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 hover:bg-destructive"
                      title="Remove"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}

              {jobs.length < MAX_IMAGES && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/10 text-muted-foreground transition hover:border-primary/50 hover:bg-muted/30 hover:text-primary active:scale-95"
                >
                  <Plus className="size-5 mb-0.5 opacity-70" />
                  <span className="text-[10px] font-bold">Add photo</span>
                </button>
              )}
            </div>
          </div>

          {/* CARD 2: 📝 BASIC PRODUCT DETAILS */}
          <div className="rounded-2xl border border-border p-5 bg-card space-y-4 shadow-2xs">
            <p className="text-sm font-bold text-foreground">📝 Basic Details</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-foreground sm:col-span-2">
                Product Title *
                <input
                  className={`${input} mt-1.5 font-medium text-sm`}
                  placeholder="e.g. 100% Organic Cotton Printed Baby Romper"
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

              <label className="text-xs font-bold text-foreground">
                Category *
                <select
                  className={`${input} mt-1.5 font-medium text-xs`}
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

              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Age Group *
                </label>
                <div className="flex flex-wrap items-center gap-1 mb-1.5">
                  {["0-6m", "6-12m", "1-2Y", "2-3Y", "3-4Y", "4-6Y", "All Ages"].map((ag) => (
                    <button
                      key={ag}
                      type="button"
                      onClick={() => set("ageGroup", ag)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer active:scale-95 ${
                        draft.ageGroup === ag
                          ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                          : "bg-muted/60 text-foreground hover:bg-muted"
                      }`}
                    >
                      {ag}
                    </button>
                  ))}
                </div>
                <input
                  className={`${input} mt-0 text-xs`}
                  placeholder="Or type custom e.g. 18-24m, Newborn"
                  value={draft.ageGroup}
                  onChange={(e) => set("ageGroup", e.target.value)}
                  list="age-group-suggestions"
                />
                <datalist id="age-group-suggestions">
                  <option value="0-3m" />
                  <option value="0-6m" />
                  <option value="3-6m" />
                  <option value="6-12m" />
                  <option value="12-18m" />
                  <option value="1-2y" />
                  <option value="2-3y" />
                  <option value="3-4y" />
                  <option value="4-6y" />
                  <option value="6-8y" />
                  <option value="All Ages" />
                </datalist>
              </div>
            </div>
          </div>

          {/* CARD 3: 💰 PRICING, STOCK & VARIANTS */}
          <div className="rounded-2xl border border-border p-5 bg-card space-y-4 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-foreground">💰 Pricing & Inventory</p>
              {draft.mrp > draft.price && draft.price > 0 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 shadow-2xs">
                  🎉 {Math.round(((draft.mrp - draft.price) / draft.mrp) * 100)}% OFF (Saves ₹{draft.mrp - draft.price})
                </span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-foreground">
                Selling Price (₹) *
                <input
                  type="number"
                  min="0"
                  className={`${input} mt-1.5 font-black text-sm`}
                  placeholder="e.g. 499"
                  value={draft.price === 0 ? "" : draft.price}
                  onChange={(e) =>
                    set("price", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                  }
                />
              </label>

              <label className="text-xs font-bold text-foreground">
                MRP (₹ Original Price) *
                <input
                  type="number"
                  min="0"
                  className={`${input} mt-1.5 text-sm font-semibold`}
                  placeholder="e.g. 999"
                  value={draft.mrp === 0 ? "" : draft.mrp}
                  onChange={(e) =>
                    set("mrp", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                  }
                />
              </label>
            </div>

            {/* VARIANT MODE TOGGLE */}
            <div className="pt-3 border-t border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <span className="text-xs font-bold text-foreground">
                    Does this product have multiple Colors or Sizes?
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {hasVariants ? "Variants enabled" : "Single item with one stock count"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextState = !hasVariants;
                    setHasVariants(nextState);
                    if (nextState) {
                      if (draft.colors.length === 0) setDraft((d) => ({ ...d, colors: ["Blue"] }));
                      syncMatrix(["Blue"], matrixSizes);
                    } else {
                      set("variants", [
                        {
                          name: "Default",
                          color: null,
                          size: null,
                          sku: generateSKU(draft.category),
                          barcode: generateBarcode(),
                          stock: draft.stock || 10,
                          price_override: null,
                          mrp_override: null,
                        },
                      ]);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 ${
                    hasVariants
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-muted border border-border text-foreground hover:bg-muted/80"
                  }`}
                >
                  <span>{hasVariants ? "✓ Multi-Variants Enabled" : "+ Enable Colors & Sizes"}</span>
                </button>
              </div>

              {!hasVariants ? (
                /* SINGLE ITEM STOCK */
                <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 max-w-xs">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    Stock Quantity *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      className={`${input} font-black text-sm pl-3`}
                      placeholder="e.g. 25"
                      value={draft.stock === 0 ? "" : draft.stock}
                      onChange={(e) => {
                        const val = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
                        set("stock", val);
                        if (draft.variants.length > 0) {
                          const updated = [...draft.variants];
                          updated[0].stock = val;
                          set("variants", updated);
                        }
                      }}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                      units
                    </span>
                  </div>
                </div>
              ) : (
                /* MULTI-VARIANT PICKER & COMPACT TABLE */
                <div className="space-y-3.5 mt-2">
                  <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-3">
                    {/* Colors */}
                    <div>
                      <span className="text-[11px] font-bold text-foreground block mb-1.5">
                        1. Select Colors:
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {popularColors.map((col) => {
                          const isSel = draft.colors.some((c) => c.toLowerCase() === col.toLowerCase());
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleColorPreset(col)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 ${
                                isSel
                                  ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                                  : "bg-background border border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              {col} {isSel && "✓"}
                            </button>
                          );
                        })}
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="+ Custom"
                            value={newColorName}
                            onChange={(e) => setNewColorName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddColor();
                              }
                            }}
                            className="h-7 w-20 rounded-lg border border-dashed border-border bg-background px-2 text-xs outline-none focus:border-primary"
                          />
                          {newColorName.trim() && (
                            <button
                              type="button"
                              onClick={handleAddColor}
                              className="h-7 px-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sizes */}
                    <div>
                      <span className="text-[11px] font-bold text-foreground block mb-1.5">
                        2. Select Sizes:
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {popularSizes.map((sz) => {
                          const isSel = matrixSizes.includes(sz);
                          return (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => toggleSizePreset(sz)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 ${
                                isSel
                                  ? "bg-primary text-primary-foreground font-bold shadow-2xs"
                                  : "bg-background border border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              {sz}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Bulk Stock Tool */}
                    <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground font-semibold">Bulk Stock:</span>
                        <input
                          type="number"
                          min="0"
                          value={bulkStock}
                          onChange={(e) => setBulkStock(Math.max(0, Number(e.target.value)))}
                          className="h-7 w-16 rounded-lg border border-border bg-background text-xs font-bold text-center"
                        />
                        <button
                          type="button"
                          onClick={handleApplyBulkStock}
                          className="h-7 px-2.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-bold transition cursor-pointer"
                        >
                          Apply to all
                        </button>
                      </div>
                      <span className="text-xs font-bold text-foreground">
                        {draft.variants.length} Variants ({draft.stock} Total Units)
                      </span>
                    </div>
                  </div>

                  {/* Sleek Variants Table */}
                  <div className="rounded-xl border border-border overflow-hidden bg-background">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-muted-foreground font-bold text-[11px] uppercase">
                            <th className="py-2 px-3">Variant</th>
                            <th className="py-2 px-3">Color</th>
                            <th className="py-2 px-3">Size</th>
                            <th className="py-2 px-3 w-24">Stock</th>
                            <th className="py-2 px-3 w-32">Price Override</th>
                            <th className="py-2 px-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {draft.variants.map((v, idx) => (
                            <tr key={idx} className="hover:bg-muted/20 transition">
                              <td className="py-2 px-3 font-semibold">{v.name || "Default"}</td>
                              <td className="py-2 px-3">{v.color || "—"}</td>
                              <td className="py-2 px-3">
                                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-bold">
                                  {v.size || "Standard"}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  min="0"
                                  className="w-16 rounded border border-border px-2 py-1 font-bold text-xs"
                                  value={v.stock}
                                  onChange={(e) => {
                                    const updated = [...draft.variants];
                                    updated[idx].stock = Math.max(0, Number(e.target.value));
                                    set("variants", updated);
                                    set("stock", updated.reduce((sum, val) => sum + val.stock, 0));
                                  }}
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder={`₹${draft.price || 0}`}
                                  className="w-24 rounded border border-border px-2 py-1 text-xs"
                                  value={v.price_override ?? ""}
                                  onChange={(e) => {
                                    const updated = [...draft.variants];
                                    updated[idx].price_override = e.target.value ? Number(e.target.value) : null;
                                    set("variants", updated);
                                  }}
                                />
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = draft.variants.filter((_, i) => i !== idx);
                                    if (updated.length === 0) {
                                      updated.push({
                                        name: "Default",
                                        color: null,
                                        size: null,
                                        sku: generateSKU(draft.category),
                                        barcode: generateBarcode(),
                                        stock: 10,
                                        price_override: null,
                                        mrp_override: null,
                                      });
                                    }
                                    set("variants", updated);
                                    set("stock", updated.reduce((sum, val) => sum + val.stock, 0));
                                  }}
                                  className="p-1 text-muted-foreground hover:text-destructive transition cursor-pointer"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CARD 4: ⚙️ OPTIONAL / ADVANCED DETAILS (COLLAPSIBLE - ZERO CLUTTER) */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all shadow-2xs">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex w-full items-center justify-between p-4 text-left font-semibold text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="size-4 text-primary" />
                <span className="text-foreground font-bold">
                  ⚙️ Optional Details (Description, Highlights, Brand, Shipping & Barcode)
                </span>
              </span>
              <span className="text-xs text-primary font-bold">
                {showAdvanced ? "Hide Optional Details ▲" : "Show Optional Details ▼"}
              </span>
            </button>

            {showAdvanced && (
              <div className="p-5 border-t border-border bg-background space-y-4 animate-in fade-in duration-150">
                <label className="block text-xs font-bold text-foreground">
                  Description
                  <textarea
                    rows={2}
                    placeholder="Product material, care instructions, and details..."
                    className={`${input} mt-1 text-xs`}
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>

                <label className="block text-xs font-bold text-foreground">
                  Highlights (one per line)
                  <textarea
                    rows={2}
                    placeholder="100% Organic Cotton&#10;Breathable & Super Soft"
                    className={`${input} mt-1 text-xs`}
                    value={draft.highlights}
                    onChange={(e) => set("highlights", e.target.value)}
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2 pt-2">
                  <label className="text-xs font-bold text-foreground">
                    Brand (Default: Zérah)
                    <input
                      className={`${input} mt-1 text-xs`}
                      value={draft.brand}
                      onChange={(e) => set("brand", e.target.value)}
                    />
                  </label>

                  <label className="text-xs font-bold text-foreground">
                    Delivery Fee (₹)
                    <input
                      type="number"
                      min="0"
                      className={`${input} mt-1 text-xs`}
                      value={draft.deliveryFee}
                      onChange={(e) => set("deliveryFee", Number(e.target.value))}
                    />
                  </label>

                  <label className="text-xs font-bold text-foreground">
                    Sales Channel
                    <select
                      className={`${input} mt-1 text-xs`}
                      value={draft.salesChannel}
                      onChange={(e) => set("salesChannel", e.target.value as any)}
                    >
                      <option value="ONLINE_AND_OFFLINE">Online Website + Offline POS</option>
                      <option value="OFFLINE_ONLY">Only Offline POS</option>
                    </select>
                  </label>

                  <label className="text-xs font-bold text-foreground">
                    Buying / Cost Price (₹)
                    <input
                      type="number"
                      min="0"
                      className={`${input} mt-1 text-xs`}
                      value={draft.buyingPrice === 0 ? "" : draft.buyingPrice}
                      onChange={(e) => set("buyingPrice", Number(e.target.value))}
                    />
                  </label>
                </div>

                {/* Label Preview */}
                <div className="p-3 rounded-xl border border-border bg-muted/20 flex flex-col items-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Live Barcode Label
                  </p>
                  <p className="text-xs font-semibold mt-0.5">{draft.name || "Product Name"}</p>
                  <div className="my-1 scale-90">
                    <Barcode
                      value={draft.barcode || draft.sku || previewBarcode}
                      format="CODE128"
                      width={1.1}
                      height={35}
                      fontSize={9}
                      margin={0}
                      displayValue={true}
                      background="transparent"
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground">SKU: {draft.sku || previewSKU}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* STICKY FOOTER ACTION BAR */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">
              Total Stock: {draft.stock} units
            </span>
            {hasVariants && (
              <span className="text-[11px] text-muted-foreground">
                ({draft.variants.length} variants)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-border px-4 py-2 text-xs font-bold hover:bg-muted cursor-pointer transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || isSubmitting || isUploading || !draft.name || !draft.slug}
              className="rounded-xl bg-primary px-6 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60 cursor-pointer transition-all active:scale-95 shadow-sm"
            >
              {saving || isSubmitting
                ? "Saving…"
                : isUploading
                  ? "Uploading images…"
                  : "Save Product"}
            </button>
          </div>
        </div>
      </div>
    </div>

      {/* Print Labels modal */}
      {printing && (product || createdProduct) && (
        <PrintLabelsModal
          products={[product || createdProduct!]}
          onClose={() => {
            setPrinting(false);
            if (!product) onCancel();
          }}
        />
      )}

      {/* Post-creation prompt */}
      {showPostCreatePrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => {
            setShowPostCreatePrompt(false);
            onCancel();
          }}
        >
          <div
            className="bg-card rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center animate-in zoom-in-95 duration-200"
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
                type="button"
                onClick={() => {
                  setShowPostCreatePrompt(false);
                  setPrinting(true);
                }}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition cursor-pointer active:scale-95"
              >
                <Printer className="size-4 inline mr-2" />
                Print Barcode Label
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPostCreatePrompt(false);
                  onCancel();
                }}
                className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
