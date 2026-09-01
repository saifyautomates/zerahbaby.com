/**
 * ProductForm.tsx — Ultra-Fast, Intelligent Product Creation & Editing Flow
 * Zérah Baby & Kids
 *
 * Features:
 * - ⚡ Quick Add Mode (5 fields: Name, Category, MRP, Price, Stock)
 * - 🎯 Smart Category Suggester based on product name keywords
 * - 🏷️ Live Discount & Savings calculation badge (₹ OFF + % OFF)
 * - 🔢 Auto-generated collision-free SKU & Barcode with 1-click regenerate
 * - 🖼️ Multi-image support with Drag & Drop, File Picker, and Clipboard Paste (Ctrl+V)
 * - 💾 Auto-save draft resiliency (never lose entered work)
 * - ⚡ Color × Size Variant Matrix Generator
 * - 🖨️ Instant Post-Creation "Print Labels", "Add Another", and "View on Store" actions
 * - ⌨️ Keyboard-first navigation (Enter flow + Ctrl/Cmd+S to save)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import Barcode from "react-barcode";
import {
  Printer,
  GripVertical,
  Star,
  Trash2,
  UploadCloud,
  Plus,
  Loader2,
  Check,
  Tag,
  Truck,
  Store,
  Layers,
  Sparkles,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
  Copy,
  Info,
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
import { useUploader } from "@/lib/use-uploader";
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
  feeding: "FD",
  diapering: "DP",
  bath: "BT",
  footwear: "FW",
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  clothing: [
    "frock", "dress", "shirt", "t-shirt", "tshirt", "pant", "jeans", "onesie",
    "romper", "dangri", "suit", "kurta", "top", "shorts", "cotton", "cloth",
    "sweater", "jacket", "pyjama", "trousers", "socks", "hoodie", "dungaree", "wear"
  ],
  toys: [
    "toy", "rattle", "game", "puzzle", "lego", "car", "doll", "plush",
    "bear", "musical", "blocks", "slimes", "ball", "stacking", "robot", "ride"
  ],
  gear: [
    "stroller", "pram", "walker", "carrier", "car seat", "gear", "crib",
    "cot bed", "swing", "high chair", "bouncer", "rocker", "bassinet"
  ],
  feeding: [
    "bottle", "sipper", "bib", "spoon", "feeder", "teether", "nipple",
    "bowl", "feeding", "sterilizer", "warmer", "breast pump", "highchair"
  ],
  diapering: [
    "diaper", "wipes", "nappy", "potty", "mat", "rash cream", "training pants"
  ],
  care: [
    "soap", "lotion", "oil", "shampoo", "cream", "bath", "towel", "care",
    "thermometer", "nasal", "nail clipper", "powder", "wash", "skincare"
  ],
  footwear: [
    "shoes", "booties", "sandals", "footwear", "slippers", "sneakers"
  ],
};

const POPULAR_CATEGORIES = [
  { slug: "clothing", name: "Clothing & Fashion" },
  { slug: "toys", name: "Toys & Games" },
  { slug: "gear", name: "Travel Gear" },
  { slug: "feeding", name: "Feeding & Nursing" },
  { slug: "diapering", name: "Diapering" },
  { slug: "care", name: "Nursery & Care" },
  { slug: "footwear", name: "Footwear" },
];

const DRAFT_STORAGE_KEY = "zerah_admin_product_draft";
const LAST_USED_CAT_KEY = "zerah_last_used_category";
const LAST_USED_BRAND_KEY = "zerah_last_used_brand";

/** Generate a unique SKU like ZR-CL-XXXXXX */
export function generateSKU(category: string, color?: string | null, size?: string | null): string {
  const prefix = CATEGORY_PREFIXES[category] ?? "GN";
  const colorPart = color
    ? `-${color.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "")}`
    : "";
  const sizePart = size
    ? `-${size.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "")}`
    : "";
  const random = Math.floor(100000 + Math.random() * 900000);
  return `ZR-${prefix}${colorPart}${sizePart}-${random}`;
}

/** Generate a unique 12-digit numeric barcode */
export function generateBarcode(): string {
  return Math.floor(100000000000 + Math.random() * 900000000000).toString();
}

function getSavedCategory(fallback = "clothing"): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(LAST_USED_CAT_KEY) || fallback;
  } catch {
    return fallback;
  }
}

function getSavedBrand(fallback = "Zérah"): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(LAST_USED_BRAND_KEY) || fallback;
  } catch {
    return fallback;
  }
}

const toDraft = (
  p: Product | null,
  defaultCategory?: string,
  defaultSalesChannel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
): ProductDraft => {
  const initialCategory = p?.category ?? defaultCategory ?? getSavedCategory("clothing");
  const initialBrand = p?.brand ?? getSavedBrand("Zérah");

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
    brand: initialBrand,
    category: initialCategory,
    price: p?.price ?? 0,
    mrp: p?.mrp ?? 0,
    rating: p?.rating ?? 0,
    reviews: p?.reviews ?? 0,
    ageGroup: p?.ageGroup ?? "0-6m",
    imageUrl: p?.imageUrl ?? "",
    images: p?.images ?? [],
    productImages: pImages,
    stock: p?.stock ?? 10,
    lowStockAt: p?.lowStockAt ?? 5,
    deliveryFee:
      (p?.salesChannel ?? defaultSalesChannel) === "OFFLINE_ONLY"
        ? 0
        : (p?.deliveryFee ?? (p ? 0 : 79)),
    sku: p?.sku ?? generateSKU(initialCategory),
    barcode: p?.barcode ?? generateBarcode(),
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
          sku: v.sku ?? generateSKU(initialCategory, v.color, v.size),
          barcode: v.barcode ?? generateBarcode(),
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
            sku: p?.sku || generateSKU(initialCategory),
            barcode: p?.barcode || generateBarcode(),
            stock: p?.stock ?? 10,
            price_override: null,
            mrp_override: null,
            image_url: null,
          },
        ],
  };
};

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
  onSave: (draft: ProductDraft) => void;
  onCancel: () => void;
  defaultCategory?: string;
  defaultSalesChannel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
}) {
  const [mode, setMode] = useState<"quick" | "full">(product ? "full" : "quick");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  // Form Draft State
  const [draft, setDraft] = useState<ProductDraft>(() =>
    toDraft(product, defaultCategory, defaultSalesChannel),
  );

  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Focus Name input on mount
  useEffect(() => {
    nameInputRef.current?.focus();
  }, [mode]);

  // Check for saved local draft when creating new product
  useEffect(() => {
    if (!product && typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.name && parsed.name.trim()) {
            setHasSavedDraft(true);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }, [product]);

  // Auto-save draft on changes (if not editing an existing product)
  useEffect(() => {
    if (!product && !createdProduct && draft.name?.trim()) {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        /* ignore */
      }
    }
  }, [draft, product, createdProduct]);

  const loadSavedDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        setDraft(JSON.parse(saved));
        setHasSavedDraft(false);
        toast.success("Resumed your previous draft!");
      }
    } catch {
      toast.error("Failed to load draft");
    }
  };

  const discardSavedDraft = () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setHasSavedDraft(false);
      setDraft(toDraft(null, defaultCategory, defaultSalesChannel));
      toast.info("Draft discarded");
    } catch {
      /* ignore */
    }
  };

  const { data: categories } = useCategories();
  const { data: allProducts } = useProducts();

  // Smart Category Suggestion from Name
  const suggestedCategory = useMemo(() => {
    if (!draft.name || !draft.name.trim()) return null;
    const nameLower = draft.name.toLowerCase();
    const tokens = nameLower.split(/[^a-z0-9]+/);
    for (const [catSlug, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (
        keywords.some(
          (kw) =>
            tokens.includes(kw.toLowerCase()) ||
            nameLower.includes(` ${kw.toLowerCase()} `) ||
            nameLower.startsWith(`${kw.toLowerCase()} `) ||
            nameLower.endsWith(` ${kw.toLowerCase()}`),
        )
      ) {
        if (catSlug !== draft.category) {
          return catSlug;
        }
      }
    }
    return null;
  }, [draft.name, draft.category]);

  // Image Uploader Hook
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
  });

  // Sync initial images
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
  }, [draft.images.length, setInitialJobs]);

  // Sync uploaded images back to draft
  useEffect(() => {
    const urls = jobs.filter((j) => j.state === "SAVED" && j.publicUrl).map((j) => j.publicUrl!);
    const currentStr = JSON.stringify(draft.images);
    const newStr = JSON.stringify(urls);
    if (currentStr !== newStr) {
      setDraft((d) => ({ ...d, images: urls, imageUrl: urls[0] ?? "" }));
    }
  }, [jobs, draft.images]);

  // Clipboard Paste (Ctrl+V) for Instant Image Uploads
  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_IMAGES - jobs.length;
      if (room <= 0) {
        toast.error(`Maximum ${MAX_IMAGES} images allowed per product`);
        return;
      }
      const filesArray = Array.from(files).slice(0, room);
      startUploads(filesArray);
    },
    [jobs.length, startUploads],
  );

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
        toast.success(`Pasted ${files.length} image(s) from clipboard!`);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [matrixSizes, setMatrixSizes] = useState<string[]>(["0-3m", "3-6m", "6-12m", "1-2Y"]);
  const [activeColorTab, setActiveColorTab] = useState<string>("ALL");
  const [newColorName, setNewColorName] = useState<string>("");

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Auto Calculations
  const discountAmount = Math.max(0, draft.mrp - draft.price);
  const discountPct =
    draft.mrp > 0 && draft.price > 0 && draft.mrp > draft.price
      ? Math.round(((draft.mrp - draft.price) / draft.mrp) * 100)
      : 0;

  // Handle Form Submission
  const handleSave = () => {
    if (!draft.name?.trim()) {
      toast.error("Please enter a product name");
      nameInputRef.current?.focus();
      return;
    }

    if (Number(draft.price) < 0 || isNaN(Number(draft.price))) {
      toast.error("Please enter a valid selling price");
      return;
    }

    // Auto-generate SKU / Barcode if empty
    const finalSKU = draft.sku.trim() || generateSKU(draft.category);
    const finalBarcode = draft.barcode.trim() || generateBarcode();
    const finalSlug =
      draft.slug.trim() ||
      draft.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

    const finalDraft: ProductDraft = {
      ...draft,
      slug: finalSlug,
      sku: finalSKU,
      barcode: finalBarcode,
      imageUrl: draft.images[0] || draft.imageUrl || "",
      brand: draft.brand.trim() || "Zérah",
    };

    // Save recent defaults
    try {
      localStorage.setItem(LAST_USED_CAT_KEY, draft.category);
      if (draft.brand) localStorage.setItem(LAST_USED_BRAND_KEY, draft.brand);
    } catch {
      /* ignore */
    }

    onSave(finalDraft);

    // Prepare celebration card
    const savedProd: Product = {
      uuid: product?.uuid || `new-${Date.now()}`,
      id: finalSlug,
      name: draft.name,
      brand: finalDraft.brand,
      category: draft.category,
      price: Number(draft.price),
      mrp: Number(draft.mrp) || Number(draft.price),
      rating: 0,
      reviews: 0,
      ageGroup: draft.ageGroup,
      image: finalDraft.imageUrl,
      imageUrl: finalDraft.imageUrl,
      description: draft.description,
      highlights: [],
      isFeatured: draft.isFeatured,
      isActive: draft.isActive,
      sortOrder: draft.sortOrder,
      stock: Number(draft.stock),
      lowStockAt: Number(draft.lowStockAt),
      sku: finalSKU,
      barcode: finalBarcode,
      images: draft.images,
      product_images: [],
      deliveryFee: draft.deliveryFee,
      recommendationMode: "manual",
      salesChannel: draft.salesChannel,
      variants: draft.variants.map((v, i) => ({
        id: v.id || `v-${i}`,
        name: v.name,
        color: v.color ?? null,
        size: v.size ?? null,
        sku: v.sku || generateSKU(draft.category, v.color, v.size),
        barcode: v.barcode ?? null,
        stock: v.stock,
        priceOverride: v.price_override ?? undefined,
        mrpOverride: v.mrp_override ?? undefined,
        imageUrl: v.image_url ?? null,
      })),
    };

    setCreatedProduct(savedProd);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  // Keyboard Shortcuts (Ctrl+S / Cmd+S to save)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape" && !createdProduct) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, onCancel, createdProduct]);

  // Reset for "Add Another Product"
  const handleAddAnother = () => {
    setCreatedProduct(null);
    const lastCat = getSavedCategory("clothing");
    const lastBrand = getSavedBrand("Zérah");
    setDraft({
      ...toDraft(null, lastCat, defaultSalesChannel),
      category: lastCat,
      brand: lastBrand,
      stock: 10,
      sku: generateSKU(lastCat),
      barcode: generateBarcode(),
    });
    setInitialJobs([]);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  // Variant Matrix Generator
  const handleGenerateMatrix = () => {
    const colors = draft.colors.length > 0 ? draft.colors : ["Default"];
    const sizes = matrixSizes.length > 0 ? matrixSizes : ["Standard"];
    const newVariants: ProductVariantDraft[] = [];

    for (const c of colors) {
      for (const s of sizes) {
        const colorName = c === "Default" ? null : c;
        const sizeName = s === "Standard" ? null : s;
        const varName = colorName && sizeName ? `${colorName} / ${sizeName}` : colorName || sizeName || "Default";
        newVariants.push({
          name: varName,
          color: colorName,
          size: sizeName,
          sku: generateSKU(draft.category, colorName, sizeName),
          barcode: generateBarcode(),
          stock: Math.max(1, Math.round((draft.stock || 10) / (colors.length * sizes.length))),
          price_override: null,
          mrp_override: null,
          image_url: null,
        });
      }
    }

    setDraft((d) => ({
      ...d,
      variants: newVariants,
      stock: newVariants.reduce((sum, v) => sum + v.stock, 0),
    }));
    toast.success(`Generated ${newVariants.length} Color × Size variants!`);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="flex flex-col w-full max-w-2xl max-h-[100dvh] sm:max-h-[92dvh] rounded-t-3xl sm:rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="shrink-0 border-b border-border px-6 py-4 flex items-center justify-between bg-muted/20">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              {product ? "Edit Product" : "Add New Product"}
              {!product && (
                <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  Fast Flow
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              {product ? `Editing SKU: ${draft.sku}` : "Fill basic details; SKU, barcode, and slugs are auto-generated."}
            </p>
          </div>

          {!product && !createdProduct && (
            <div className="flex bg-muted/60 p-0.5 rounded-xl border border-border text-xs font-bold">
              <button
                type="button"
                onClick={() => setMode("quick")}
                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  mode === "quick" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="size-3 text-amber-500" /> Quick Add
              </button>
              <button
                type="button"
                onClick={() => setMode("full")}
                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  mode === "full" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3" /> Full Details
              </button>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {/* Post-Creation Success Celebration Card */}
          {createdProduct ? (
            <div className="py-6 flex flex-col items-center text-center space-y-5 animate-in fade-in duration-300">
              <div className="size-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-lg">
                <Check className="size-8 stroke-[3]" />
              </div>

              <div>
                <h3 className="text-xl font-black text-foreground">Product Created Successfully! 🎉</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  <b>{createdProduct.name}</b> has been synchronized with Online Storefront, Inventory, POS Terminal, and Barcode Engine.
                </p>
              </div>

              {/* Product Preview Ticket */}
              <div className="w-full max-w-md rounded-2xl border border-border bg-muted/30 p-4 text-left space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      Category
                    </span>
                    <p className="text-xs font-bold text-foreground capitalize">{createdProduct.category}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      Stock
                    </span>
                    <p className="text-xs font-bold text-emerald-600">{createdProduct.stock} units</p>
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground">Selling Price</span>
                    <p className="text-lg font-black text-foreground">{formatPrice(createdProduct.price)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground">MRP</span>
                    <p className="text-sm font-bold text-muted-foreground line-through">{formatPrice(createdProduct.mrp)}</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>SKU: {createdProduct.sku}</span>
                  <span>Barcode: {createdProduct.barcode}</span>
                </div>
              </div>

              {/* Actions Grid */}
              <div className="w-full max-w-md grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPrintModal(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#8B2020] text-white py-3 px-4 text-xs font-bold shadow-md hover:bg-[#721a1a] transition active:scale-95 cursor-pointer"
                >
                  <Printer className="size-4" />
                  <span>Print Barcode Label</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddAnother}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 px-4 text-xs font-bold shadow-md hover:bg-primary/90 transition active:scale-95 cursor-pointer"
                >
                  <Plus className="size-4" />
                  <span>Add Another Product</span>
                </button>

                <a
                  href={`/product/${createdProduct.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2.5 px-4 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
                >
                  <ExternalLink className="size-3.5" />
                  <span>View on Storefront</span>
                </a>

                <button
                  type="button"
                  onClick={onCancel}
                  className="w-full rounded-xl border border-border bg-card py-2.5 px-4 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                >
                  Close & Back to Table
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Draft Resume Alert */}
              {hasSavedDraft && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-amber-600 shrink-0" />
                    <span>Unsaved draft found for <b>{JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "{}").name || "Product"}</b></span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={loadSavedDraft}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 transition cursor-pointer"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={discardSavedDraft}
                      className="px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

              {/* Section 1: Basic Information */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Product Name *</span>
                    <span className="text-[10px] text-muted-foreground/80 font-normal">Autofocused</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    required
                    placeholder="e.g. Baby Cotton Romper, Wooden Rattle Toy"
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
                    className="mt-1.5 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition shadow-xs"
                  />

                  {/* Smart Category Auto-Suggester */}
                  {suggestedCategory && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Sparkles className="size-3 text-amber-500" /> Suggestion:
                      </span>
                      <button
                        type="button"
                        onClick={() => set("category", suggestedCategory)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-bold hover:scale-105 transition cursor-pointer"
                      >
                        <span>Set category to <b>{suggestedCategory.toUpperCase()}</b></span>
                        <Check className="size-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Category Selector with Quick Pills */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                    Category *
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {POPULAR_CATEGORIES.map((cat) => {
                      const isSelected = draft.category === cat.slug;
                      return (
                        <button
                          key={cat.slug}
                          type="button"
                          onClick={() => {
                            set("category", cat.slug);
                            set("sku", generateSKU(cat.slug));
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                            isSelected
                              ? "bg-primary text-primary-foreground shadow-xs scale-102"
                              : "bg-muted/50 border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>

                  <select
                    value={draft.category}
                    onChange={(e) => {
                      const newCat = e.target.value;
                      set("category", newCat);
                      set("sku", generateSKU(newCat));
                    }}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary"
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
                </div>
              </div>

              {/* Product Availability / Sales Channel */}
              <div className="rounded-2xl border border-border p-4 bg-muted/20 space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Product Availability Mode *</span>
                  <span className="text-[10px] text-muted-foreground font-semibold">Authoritative Channel</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => set("salesChannel", "ONLINE_AND_OFFLINE")}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                      draft.salesChannel === "ONLINE_AND_OFFLINE"
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-950 dark:text-blue-200 shadow-xs"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-sm shrink-0">
                      🌐
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">ONLINE & OFFLINE STORE</p>
                      <p className="text-[11px] text-muted-foreground">Storefront, Search, Cart, POS & Inventory</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => set("salesChannel", "OFFLINE_ONLY")}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition cursor-pointer ${
                      draft.salesChannel === "OFFLINE_ONLY"
                        ? "border-purple-600 bg-purple-50/50 dark:bg-purple-950/30 text-purple-950 dark:text-purple-200 shadow-xs"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <div className="size-8 rounded-lg bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold text-sm shrink-0">
                      🏪
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">ONLY OFFLINE (POS)</p>
                      <p className="text-[11px] text-muted-foreground">In-Store POS, Barcode, Returns & Inventory Only</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Section 2: Pricing (Simple & Automatic Discounts) */}
              <div className="rounded-2xl border border-border p-4 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Tag className="size-3.5 text-primary" /> Pricing & Savings
                  </span>
                  {discountPct > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-xs font-black">
                      ₹{discountAmount} OFF ({discountPct}% OFF)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground block mb-1">
                      MRP (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₹</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 999"
                        value={draft.mrp === 0 ? "" : draft.mrp}
                        onChange={(e) => set("mrp", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
                        className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2.5 text-base font-bold text-foreground outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-muted-foreground block mb-1">
                      Selling Price (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₹</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 799"
                        value={draft.price === 0 ? "" : draft.price}
                        onChange={(e) => set("price", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
                        className="w-full rounded-xl border-2 border-primary/40 bg-background pl-8 pr-3 py-2.5 text-base font-black text-foreground outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>

                {draft.price > draft.mrp && draft.mrp > 0 && (
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    ⚠️ Selling price is higher than MRP.
                  </p>
                )}
              </div>

              {/* Section 3: Inventory & Auto Identifiers */}
              <div className="rounded-2xl border border-border p-4 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Store className="size-3.5 text-primary" /> Inventory & Identifiers
                  </span>
                  <span className="text-[11px] text-muted-foreground font-semibold">Auto-Generated</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground block mb-1">
                      Stock Quantity *
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="10"
                      value={draft.stock === 0 ? "" : draft.stock}
                      onChange={(e) => set("stock", e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-bold text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-muted-foreground">SKU</label>
                      <button
                        type="button"
                        onClick={() => set("sku", generateSKU(draft.category))}
                        className="text-[10px] text-primary font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                        title="Generate fresh SKU"
                      >
                        <RotateCcw className="size-2.5" /> Auto
                      </button>
                    </div>
                    <input
                      type="text"
                      value={draft.sku}
                      onChange={(e) => set("sku", e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono font-bold text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-muted-foreground">Barcode</label>
                      <button
                        type="button"
                        onClick={() => set("barcode", generateBarcode())}
                        className="text-[10px] text-primary font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                        title="Generate fresh Barcode"
                      >
                        <RotateCcw className="size-2.5" /> Auto
                      </button>
                    </div>
                    <input
                      type="text"
                      value={draft.barcode}
                      onChange={(e) => set("barcode", e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono font-bold text-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Horizontal Barcode Live Sticker Preview */}
                <div className="pt-2 border-t border-border/60 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-semibold">Live Thermal Barcode Preview:</span>
                  <div className="scale-90 origin-right">
                    <Barcode
                      value={draft.barcode || draft.sku || "000000000000"}
                      format="CODE128"
                      width={1.2}
                      height={24}
                      fontSize={9}
                      margin={0}
                      displayValue={true}
                      background="transparent"
                      lineColor="#000000"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Media Gallery (Drag & Drop, Browse, Paste Ctrl+V) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  if (e.dataTransfer.files) void addFiles(e.dataTransfer.files);
                }}
                className={`rounded-2xl border-2 transition-all p-4 ${
                  isDraggingOver
                    ? "border-primary bg-primary/10 ring-4 ring-primary/10"
                    : "border-border bg-muted/10 hover:border-border/80"
                }`}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <UploadCloud className="size-3.5 text-primary" /> Product Images
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Drag & drop, browse, or <b>Paste (Ctrl+V)</b> directly.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition cursor-pointer"
                  >
                    {isUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    <span>Upload</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {jobs.length === 0 ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="py-6 border-2 border-dashed border-border/80 rounded-xl flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/30 transition"
                  >
                    <UploadCloud className="size-8 text-muted-foreground/60 mb-1.5" />
                    <p className="text-xs font-bold text-foreground">Click to upload or drag images here</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Supports JPG, PNG, WebP (First image = Primary)</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 pt-1">
                    {jobs.map((job, idx) => {
                      const url = job.previewUrl || job.publicUrl || "";
                      const isPrimary = idx === 0;
                      return (
                        <div
                          key={job.id}
                          className="group relative aspect-square rounded-xl overflow-hidden border border-border bg-background shadow-xs"
                        >
                          <img src={url} alt="" className="size-full object-cover" />
                          {isPrimary && (
                            <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-primary text-white text-[9px] font-black shadow-xs flex items-center gap-0.5">
                              <Star className="size-2.5" /> Main
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeJob(job.id)}
                            className="absolute top-1 right-1 p-1 rounded-md bg-destructive text-white opacity-0 group-hover:opacity-100 transition shadow-xs cursor-pointer"
                            title="Delete image"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 5: Optional Details Accordion */}
              <div className="rounded-2xl border border-border overflow-hidden bg-card">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-foreground hover:bg-muted/40 transition cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Info className="size-3.5 text-muted-foreground" />
                    <span>Additional Options (Sales Channel, Delivery, Age, Variants)</span>
                  </span>
                  {showAdvanced ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>

                {showAdvanced && (
                  <div className="p-4 border-t border-border space-y-4 animate-in fade-in duration-150 bg-muted/10">
                    {/* Sales Channel */}
                    <div>
                      <label className="text-xs font-bold text-muted-foreground block mb-1">Sales Channel</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => set("salesChannel", "ONLINE_AND_OFFLINE")}
                          className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                            draft.salesChannel === "ONLINE_AND_OFFLINE"
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-background border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <Store className="size-3.5" /> Online & Physical POS
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            set("salesChannel", "OFFLINE_ONLY");
                            set("deliveryFee", 0);
                          }}
                          className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                            draft.salesChannel === "OFFLINE_ONLY"
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : "bg-background border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <Store className="size-3.5" /> Only Offline (POS)
                        </button>
                      </div>
                    </div>

                    {/* Delivery Fee & Age Group */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {draft.salesChannel !== "OFFLINE_ONLY" && (
                        <div>
                          <label className="text-xs font-bold text-muted-foreground block mb-1">Delivery Fee (₹)</label>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => set("deliveryFee", 0)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                                draft.deliveryFee === 0 ? "bg-emerald-600 text-white border-emerald-600" : "bg-background border-border"
                              }`}
                            >
                              Free (₹0)
                            </button>
                            <button
                              type="button"
                              onClick={() => set("deliveryFee", 79)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                                draft.deliveryFee === 79 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"
                              }`}
                            >
                              Standard (₹79)
                            </button>
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-bold text-muted-foreground block mb-1">Age Group</label>
                        <select
                          value={draft.ageGroup}
                          onChange={(e) => set("ageGroup", e.target.value)}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground outline-none"
                        >
                          {ageGroups.map((a) => (
                            <option key={a} value={a}>{a}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Description & Brand */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-muted-foreground block mb-1">Brand</label>
                        <input
                          type="text"
                          value={draft.brand}
                          onChange={(e) => set("brand", e.target.value)}
                          placeholder="Zérah"
                          className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-muted-foreground block mb-1">Slug (URL)</label>
                        <input
                          type="text"
                          value={draft.slug}
                          onChange={(e) => set("slug", e.target.value)}
                          className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground outline-none"
                        />
                      </div>
                    </div>

                    {/* Color × Size Variants Generator */}
                    <div className="pt-2 border-t border-border/60">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-foreground">Color × Size Variants ({draft.variants.length})</span>
                        <button
                          type="button"
                          onClick={handleGenerateMatrix}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 transition cursor-pointer flex items-center gap-1"
                        >
                          <Zap className="size-3" /> Quick Matrix
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {["0-3m", "3-6m", "6-12m", "1-2Y", "2-3Y", "S", "M", "L"].map((sz) => {
                          const isSel = matrixSizes.includes(sz);
                          return (
                            <button
                              key={sz}
                              type="button"
                              onClick={() => setMatrixSizes((prev) => (isSel ? prev.filter((s) => s !== sz) : [...prev, sz]))}
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                                isSel ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {sz}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        {!createdProduct && (
          <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between bg-muted/20">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || isUploading}
                className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-[#721a1a] transition active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                <span>{saving ? "Saving..." : product ? "Update Product" : "Create Product (Ctrl+S)"}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Embedded Print Labels Modal on Post-Creation */}
      {showPrintModal && createdProduct && (
        <PrintLabelsModal
          products={[createdProduct]}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>,
    document.body,
  );
}
