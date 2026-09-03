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
                  Up to {MAX_IMAGES} photos or videos · assign colors to images · first image is the
                  main thumbnail
                </p>
              </div>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 shadow-xs active:scale-95"
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                <span>{isUploading ? "Uploading…" : "Upload files"}</span>
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

            {/* COLOR MANAGEMENT FOR MEDIA */}
            <div className="mt-4 pt-3 border-t border-border/60">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Product Colors ({draft.colors.length})
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="e.g. Pink, Beige, Blue"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddColor();
                      }
                    }}
                    className="h-7 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary w-36"
                  />
                  <button
                    type="button"
                    onClick={handleAddColor}
                    className="h-7 rounded-lg bg-primary px-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="size-3" /> Add Color
                  </button>
                </div>
              </div>

              {/* Color filter tabs */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button
                  type="button"
                  onClick={() => setActiveColorTab("ALL")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    activeColorTab === "ALL"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  All Photos ({jobs.length})
                </button>
                {draft.colors.map((c) => {
                  const count = (draft.productImages || []).filter(
                    (img) => img.color && img.color.toLowerCase() === c.toLowerCase(),
                  ).length;
                  return (
                    <div
                      key={c}
                      className={`inline-flex items-center rounded-lg border text-xs font-semibold overflow-hidden transition ${
                        activeColorTab === c
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-card border-border text-foreground hover:bg-muted"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveColorTab(c)}
                        className="px-2.5 py-1 cursor-pointer"
                      >
                        {c} ({count})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveColor(c)}
                        className="px-1.5 py-1 hover:bg-destructive/20 text-destructive-foreground/80 hover:text-destructive cursor-pointer"
                        title={`Remove color ${c}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* If no images uploaded yet: large interactive clickable dropzone */}
            {jobs.length === 0 ? (
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
                className={`mt-2 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                  isDraggingOver
                    ? "border-primary bg-primary/10"
                    : "border-border/80 bg-muted/20 hover:border-primary/60 hover:bg-muted/40"
                }`}
              >
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
                  <UploadCloud className="size-6" />
                </div>
                <p className="text-sm font-bold text-foreground">
                  {isUploading
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
              <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {jobs
                  .filter((job) => {
                    if (activeColorTab === "ALL") return true;
                    const url = job.previewUrl || job.publicUrl || "";
                    const assignedColor = draft.productImages?.find(
                      (img) => img.public_url === url,
                    )?.color;
                    return assignedColor?.toLowerCase() === activeColorTab.toLowerCase();
                  })
                  .map((job, i) => {
                    const url = job.previewUrl || job.publicUrl || "";
                    const isError = job.state === "FAILED";
                    const isProcessing = job.state !== "SAVED" && !isError;
                    const assignedColor =
                      draft.productImages?.find((img) => img.public_url === url)?.color || "";

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
                        className={`group relative aspect-square overflow-hidden rounded-xl border border-border shadow-2xs ${isProcessing ? "bg-muted/40 animate-pulse" : "bg-muted/20"}`}
                      >
                        {url.match(/\.(mp4|webm|mov|ogg)(\?.*)?$/i) ||
                        (job.file && job.file.type.startsWith("video/")) ? (
                          <video
                            src={url}
                            className={`size-full object-cover ${isProcessing ? "opacity-50" : ""}`}
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
                            className={`size-full object-cover ${isProcessing ? "opacity-50" : ""}`}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = generateProductFallbackSvg({
                                name: draft.name,
                                category: draft.category,
                                slug: draft.slug,
                              });
                            }}
                          />
                        )}

                        {/* Progress overlay */}
                        {isProcessing && (
                          <div className="absolute inset-x-0 bottom-0 p-2 bg-background/80 backdrop-blur-sm z-10 flex flex-col justify-end">
                            <div className="text-[10px] font-semibold text-center mb-1">
                              {job.state === "UPLOADING" ? `${job.progress}%` : job.state}
                            </div>
                            <div className="h-1.5 w-full bg-muted overflow-hidden rounded-full">
                              <div
                                className="h-full bg-primary transition-all duration-300 ease-out"
                                style={{ width: `${job.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Error overlay */}
                        {isError && (
                          <div className="absolute inset-0 bg-destructive/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-2 text-center">
                            <span className="text-[10px] font-bold text-destructive-foreground mb-1 leading-tight">
                              {job.error || "Failed"}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                retryJob(job.id);
                              }}
                              className="text-[9px] bg-background text-foreground px-2 py-1 rounded shadow cursor-pointer"
                            >
                              Retry
                            </button>
                          </div>
                        )}

                        {i === 0 && !isProcessing && (
                          <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-xs">
                            <Star className="size-3" /> Main
                          </span>
                        )}

                        {/* Color Assignment Selector */}
                        <div className="absolute bottom-1 right-1 z-20">
                          <select
                            value={assignedColor}
                            onChange={(e) => handleSetImageColor(url, e.target.value || null)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-md bg-background/90 text-[10px] font-bold text-foreground px-1.5 py-0.5 border border-border shadow-xs outline-none cursor-pointer hover:bg-background"
                          >
                            <option value="">No Color</option>
                            {draft.colors.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        {!isProcessing && (
                          <span className="absolute bottom-1 left-1 rounded bg-background/80 p-1 text-muted-foreground shadow-xs">
                            <GripVertical className="size-3" />
                          </span>
                        )}

                        <button
                          type="button"
                          aria-label="Remove image"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeJob(job.id);
                          }}
                          className="absolute right-1 top-1 z-20 rounded-lg bg-background/90 p-1 text-destructive opacity-0 transition group-hover:opacity-100 shadow-xs hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}

                {jobs.length < MAX_IMAGES && (
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
                    className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/80 bg-muted/20 p-4 text-muted-foreground transition hover:border-primary/50 hover:bg-muted/40 hover:text-primary active:scale-95"
                  >
                    <Plus className="size-6 mb-1 opacity-70" />
                    <span className="text-[10px] font-bold">Add media</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold sm:col-span-2">
              Product Name *
              <input
                className={input}
                placeholder="e.g. Cotton Printed Baby Romper"
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

            <label className="text-sm font-semibold">
              Brand
              <input
                className={input}
                placeholder="e.g. Zérah, Saify"
                value={draft.brand}
                onChange={(e) => set("brand", e.target.value)}
                list="brand-suggestions"
              />
              <datalist id="brand-suggestions">
                <option value="Zérah" />
                <option value="Saify" />
              </datalist>
            </label>

            <label className="text-sm font-semibold">
              Category / Section
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

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-sm font-semibold">Age Group</label>
                <span className="text-[11px] text-muted-foreground">Click a preset or type custom</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {["0-6m", "6-12m", "12-24m", "1-2Y", "2-3Y", "3-4Y", "4-6Y", "6-8Y", "All Ages"].map((ag) => (
                  <button
                    key={ag}
                    type="button"
                    onClick={() => set("ageGroup", ag)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 ${
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
                className={input}
                placeholder="Or type custom e.g. 0-6m, 2-4y, 4-6y, Newborn, All Ages"
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
                <option value="12-24m" />
                <option value="18-24m" />
                <option value="2-3y" />
                <option value="2-4y" />
                <option value="3-4y" />
                <option value="4-6y" />
                <option value="6-8y" />
                <option value="8-10y" />
                <option value="10-12y" />
                <option value="12-14y" />
                <option value="Newborn" />
                <option value="Infant" />
                <option value="Toddler" />
                <option value="Kids" />
                <option value="All Ages" />
              </datalist>
            </div>

            {/* Label & Barcode Preview directly above Pricing */}
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

            {/* PRICING & PROFIT SECTION */}
            <div className="sm:col-span-2 rounded-xl border border-border p-4 bg-slate-50/50">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Tag className="size-4 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Pricing & Profit
                  </span>
                </div>
                {draft.mrp > draft.price && draft.price > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 shadow-2xs">
                    🎉 {Math.round(((draft.mrp - draft.price) / draft.mrp) * 100)}% OFF (Saves ₹{draft.mrp - draft.price})
                  </span>
                )}
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
                  Selling Price (₹) *
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
                  MRP (₹) *
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

              {/* Delivery Fee Section — Only applicable for Online Store products */}
              {draft.salesChannel !== "OFFLINE_ONLY" && (
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
                    💡 Naye product par default <b>₹79</b> rehta hai. Aap ise <b>Free (₹0)</b> ya
                    apni marzi ka koi bhi amount set kar sakte hain.
                  </p>
                </div>
              )}

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



            {/* VARIANTS & STOCK SECTION (Amazon / Flipkart / Shopify Style) */}
            <div className="sm:col-span-2 rounded-2xl border border-border p-5 bg-card shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                    <Layers className="size-4" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-foreground">
                      Inventory & Product Variants
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      {hasVariants
                        ? `${draft.variants.length} variant(s) configured · Total stock: ${draft.stock} units`
                        : "Single product inventory without color/size options"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!hasVariants ? (
                    <button
                      type="button"
                      onClick={() => {
                        setHasVariants(true);
                        if (draft.colors.length === 0) {
                          setDraft((d) => ({ ...d, colors: ["Blue"] }));
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary px-3.5 py-1.5 text-xs font-bold hover:bg-primary hover:text-primary-foreground transition cursor-pointer active:scale-95"
                    >
                      <Plus className="size-3.5" />
                      <span>+ Add Colors & Sizes (Variants)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setHasVariants(false);
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
                      }}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground transition underline cursor-pointer"
                    >
                      Switch to Single Item
                    </button>
                  )}
                </div>
              </div>

              {!hasVariants ? (
                /* SINGLE PRODUCT SIMPLE STOCK VIEW (AMAZON STYLE) */
                <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
                  <div className="max-w-xs">
                    <label className="block text-xs font-bold text-foreground mb-1.5">
                      Available Stock Quantity *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        className={`${input} font-black text-base pl-3`}
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
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Enter the total number of units available for sale.
                    </p>
                  </div>
                </div>
              ) : (
                /* MULTI-VARIANT BUILDER & TABLE (FLIPKART / SHOPIFY STYLE) */
                <div className="space-y-4">
                  {/* Step 1: Select Available Options */}
                  <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3.5">
                    {/* Colors Selection */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <span>1. Colors:</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            (Click pills to select or type custom)
                          </span>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {popularColors.map((col) => {
                          const isSel = draft.colors.some(
                            (c) => c.toLowerCase() === col.toLowerCase(),
                          );
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleColorPreset(col)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 ${
                                isSel
                                  ? "bg-primary text-primary-foreground shadow-2xs font-bold"
                                  : "bg-background border border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              <span>{col}</span>
                              {isSel && <span className="text-[10px] ml-0.5 opacity-80">✓</span>}
                            </button>
                          );
                        })}

                        {/* Custom Color Input */}
                        <div className="inline-flex items-center gap-1 ml-1">
                          <input
                            type="text"
                            placeholder="+ Custom Color"
                            value={newColorName}
                            onChange={(e) => setNewColorName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddColor();
                              }
                            }}
                            className="h-7 w-28 rounded-lg border border-dashed border-border bg-background px-2 text-xs outline-none focus:border-primary placeholder:text-muted-foreground"
                          />
                          {newColorName.trim() && (
                            <button
                              type="button"
                              onClick={handleAddColor}
                              className="h-7 px-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition cursor-pointer"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sizes Selection */}
                    <div>
                      <label className="text-xs font-bold text-foreground flex items-center gap-1.5 mb-2">
                        <span>2. Sizes:</span>
                        <span className="text-[11px] font-normal text-muted-foreground">
                          (Click pills to select)
                        </span>
                      </label>

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
                                  ? "bg-primary text-primary-foreground shadow-2xs font-bold"
                                  : "bg-background border border-border text-foreground hover:bg-muted"
                              }`}
                            >
                              {sz}
                            </button>
                          );
                        })}

                        {/* Custom Size Input */}
                        <div className="inline-flex items-center gap-1 ml-1">
                          <input
                            type="text"
                            placeholder="+ Custom Size"
                            value={customSizeInput}
                            onChange={(e) => setCustomSizeInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const trimmed = customSizeInput.trim();
                                if (trimmed && !matrixSizes.includes(trimmed)) {
                                  setMatrixSizes((prev) => [...prev, trimmed]);
                                  setCustomSizeInput("");
                                }
                              }
                            }}
                            className="h-7 w-28 rounded-lg border border-dashed border-border bg-background px-2 text-xs outline-none focus:border-primary placeholder:text-muted-foreground"
                          />
                          {customSizeInput.trim() && (
                            <button
                              type="button"
                              onClick={() => {
                                const trimmed = customSizeInput.trim();
                                if (trimmed && !matrixSizes.includes(trimmed)) {
                                  setMatrixSizes((prev) => [...prev, trimmed]);
                                  setCustomSizeInput("");
                                }
                              }}
                              className="h-7 px-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition cursor-pointer"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Generator & Bulk Action Bar */}
                    <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          Default stock per item:
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={bulkStock}
                          onChange={(e) => setBulkStock(Math.max(0, Number(e.target.value)))}
                          className="h-7 w-16 rounded-lg border border-border bg-background px-2 text-xs font-bold text-center"
                        />
                        {draft.variants.length > 0 && (
                          <button
                            type="button"
                            onClick={handleApplyBulkStock}
                            className="h-7 px-2.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-semibold transition cursor-pointer"
                          >
                            Apply to all
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleGenerateMatrix}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition cursor-pointer active:scale-95"
                      >
                        <span>⚡ Generate / Sync Variants Table ({draft.colors.length || 1} × {matrixSizes.length || 1} = {(draft.colors.length || 1) * (matrixSizes.length || 1)})</span>
                      </button>
                    </div>
                  </div>

                  {/* Step 3: Sleek Sober Variants Table */}
                  <div className="rounded-xl border border-border overflow-hidden bg-background">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-muted-foreground font-bold text-[11px] uppercase tracking-wider">
                            <th className="py-2.5 px-3">Variant Name</th>
                            <th className="py-2.5 px-3">Color</th>
                            <th className="py-2.5 px-3">Size</th>
                            <th className="py-2.5 px-3 w-28">Stock (Qty)</th>
                            <th className="py-2.5 px-3 w-36">Price (₹ Override)</th>
                            <th className="py-2.5 px-3">SKU</th>
                            <th className="py-2.5 px-3 text-right">Remove</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/70">
                          {draft.variants.map((v, idx) => {
                            const swatchImg = v.color
                              ? getColorSwatchImage(
                                  { ...product, product_images: draft.productImages } as any,
                                  v.color,
                                )
                              : draft.images[0] || "";

                            return (
                              <tr key={idx} className="hover:bg-muted/30 transition-colors">
                                <td className="py-2.5 px-3">
                                  <div className="flex items-center gap-2">
                                    <div className="size-7 rounded-md overflow-hidden border border-border/80 shrink-0 bg-muted/30 flex items-center justify-center">
                                      {swatchImg ? (
                                        <img
                                          loading="lazy"
                                          decoding="async"
                                          src={swatchImg}
                                          alt=""
                                          className="size-full object-cover"
                                        />
                                      ) : (
                                        <span className="text-[10px] font-bold text-muted-foreground">
                                          {v.color?.[0] || "✓"}
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-semibold text-foreground">
                                      {v.name || "Default"}
                                    </span>
                                  </div>
                                </td>

                                <td className="py-2.5 px-3">
                                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                    {v.color || <span className="text-muted-foreground italic">—</span>}
                                  </span>
                                </td>

                                <td className="py-2.5 px-3">
                                  <span className="inline-block px-2 py-0.5 rounded bg-muted font-semibold text-foreground text-[11px]">
                                    {v.size || "Standard"}
                                  </span>
                                </td>

                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    min="0"
                                    className="w-20 rounded-lg border border-border bg-background px-2.5 py-1 font-bold text-foreground text-xs focus:border-primary outline-none"
                                    value={v.stock}
                                    onChange={(e) => {
                                      const updated = [...draft.variants];
                                      updated[idx].stock = Math.max(0, Number(e.target.value));
                                      set("variants", updated);
                                      set(
                                        "stock",
                                        updated.reduce((sum, val) => sum + val.stock, 0),
                                      );
                                    }}
                                  />
                                </td>

                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder={`Base ₹${draft.price || 0}`}
                                    className="w-28 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary outline-none"
                                    value={v.price_override ?? ""}
                                    onChange={(e) => {
                                      const updated = [...draft.variants];
                                      updated[idx].price_override = e.target.value
                                        ? Number(e.target.value)
                                        : null;
                                      set("variants", updated);
                                    }}
                                  />
                                </td>

                                <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground">
                                  {v.sku}
                                </td>

                                <td className="py-2.5 px-3 text-right">
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
                                      set(
                                        "stock",
                                        updated.reduce((sum, val) => sum + val.stock, 0),
                                      );
                                    }}
                                    className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition cursor-pointer"
                                    title="Remove this variant"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="p-3 border-t border-border bg-muted/20 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          set("variants", [
                            ...draft.variants,
                            {
                              name: `Custom Variant ${draft.variants.length + 1}`,
                              color: draft.colors[0] || null,
                              size: "Free Size",
                              sku: generateSKU(draft.category, draft.colors[0], "Free Size"),
                              barcode: generateBarcode(),
                              stock: bulkStock || 10,
                              price_override: null,
                              mrp_override: null,
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline cursor-pointer"
                      >
                        <Plus className="size-3.5" />
                        <span>Add Another Custom Variant Row</span>
                      </button>

                      <span className="text-xs font-bold text-foreground">
                        Total Stock: {draft.stock} units
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <label className="text-sm font-semibold sm:col-span-2">
              Description
              <textarea
                rows={3}
                placeholder="Product material, care instructions, and details..."
                className={input}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">
              Highlights (one per line)
              <textarea
                rows={3}
                placeholder="100% Organic Cotton&#10;Breathable & Super Soft&#10;Easy Button Closure"
                className={input}
                value={draft.highlights}
                onChange={(e) => set("highlights", e.target.value)}
              />
            </label>

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
                  onChange={(e) => {
                    const val = e.target.value as "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
                    set("salesChannel", val);
                    if (val === "OFFLINE_ONLY") {
                      set("isFeatured", false);
                      set("deliveryFee", 0);
                    }
                  }}
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

            {draft.salesChannel !== "OFFLINE_ONLY" && (
              <>
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
              </>
            )}

            {/* COLLAPSIBLE ADVANCED & AUTO-GENERATED SETTINGS */}
            <div className="sm:col-span-2 rounded-2xl border border-border/80 bg-muted/20 overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex w-full items-center justify-between p-4 text-left font-semibold text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-primary" />
                  <span className="text-foreground font-bold">
                    Advanced & Custom Identifiers (Slug, SKU, Barcode, Recommendations)
                  </span>
                </span>
                <span className="text-xs text-primary font-semibold">
                  {showAdvanced ? "Hide Advanced ▲" : "Customize Auto-Generated Fields ▼"}
                </span>
              </button>

              {showAdvanced && (
                <div className="p-4 border-t border-border/60 bg-background/60 grid gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
                  <div className="sm:col-span-2 text-xs text-muted-foreground bg-primary/5 p-3 rounded-xl border border-primary/10">
                    💡 <strong>Auto-Generated:</strong> You don't need to fill these out manually. The system automatically creates clean SEO slugs, barcodes, and unique SKUs if left empty.
                  </div>

                  <label className="text-sm font-semibold">
                    Custom Slug (URL identifier)
                    <input
                      className={input}
                      value={draft.slug}
                      onChange={(e) => set("slug", e.target.value)}
                      placeholder="Auto: product-name"
                      list="existing-slugs"
                    />
                    <datalist id="existing-slugs">
                      {(allProducts ?? []).map((p) => (
                        <option key={p.id} value={p.id} />
                      ))}
                    </datalist>
                  </label>

                  <label className="text-sm font-semibold">
                    Custom SKU
                    <input
                      className={input}
                      value={draft.sku}
                      onChange={(e) => set("sku", e.target.value)}
                      placeholder={`Auto: ${generateSKU(draft.category)}`}
                    />
                  </label>

                  <label className="text-sm font-semibold">
                    Custom Barcode
                    <input
                      className={input}
                      value={draft.barcode}
                      onChange={(e) => set("barcode", e.target.value)}
                      placeholder="Auto-generated if empty"
                    />
                  </label>

                  <label className="text-sm font-semibold">
                    Low-stock alert threshold
                    <input
                      type="number"
                      min="0"
                      className={input}
                      placeholder="5"
                      value={draft.lowStockAt === 0 ? "" : draft.lowStockAt}
                      onChange={(e) =>
                        set("lowStockAt", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
                      }
                    />
                  </label>

                  <label className="text-sm font-semibold">
                    Sort order index
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

                  <label className="text-sm font-semibold sm:col-span-2">
                    Primary Image URL Override (Optional)
                    <input
                      className={input}
                      placeholder="Auto-detected from media gallery"
                      value={draft.imageUrl}
                      onChange={(e) => set("imageUrl", e.target.value)}
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
                                    <img
                                      loading="lazy"
                                      decoding="async"
                                      src={p.imageUrl}
                                      className="size-8 rounded-md object-cover"
                                    />
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
                          </div>
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
            type="button"
            onClick={handleSave}
            disabled={saving || isSubmitting || isUploading || !draft.name || !draft.slug}
            className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 cursor-pointer transition-all active:scale-95"
          >
            {saving || isSubmitting
              ? "Saving…"
              : isUploading
                ? "Uploading images…"
                : "Save product"}
          </button>
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
