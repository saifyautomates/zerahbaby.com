/**
 * ProductForm — Enhanced product creation/edit form with:
 * - Auto-generate SKU if empty
 * - Auto-generate barcode if empty
 * - Barcode preview in form
 * - Post-creation print prompt (label + invoice)
 */
import { useState, useEffect } from "react";
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
  Check,
  Tag,
  Settings2,
} from "lucide-react";
import { ageGroups, formatPrice, useCategories, useProducts, type Product } from "@/lib/store";
import { uploadMedia } from "@/lib/uploads";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useDirectLabelPrint } from "@/lib/label-printer";

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
  sku: string;
  barcode: string;
  description: string;
  highlights: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  buyingPrice: number;
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
  sku: p?.sku ?? "",
  barcode: p?.barcode ?? "",
  description: p?.description ?? "",
  highlights: (p?.highlights ?? []).join("\n"),
  isFeatured: p?.isFeatured ?? false,
  isActive: p?.isActive ?? true,
  sortOrder: p?.sortOrder ?? 0,
  buyingPrice: p?.buyingPrice ?? 0,
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

  const { data: categories } = useCategories();
  const { data: allProducts } = useProducts();
  const [uploading, setUploading] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [showPostCreatePrompt, setShowPostCreatePrompt] = useState(false);
  const { printLabel, isPrinting: isDirectPrinting } = useDirectLabelPrint();
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // The barcode/sku to preview (shows auto-generated values)
  const previewSKU = draft.sku || generateSKU(draft.category);
  const previewBarcode = draft.barcode || generateBarcode();

  async function addFiles(files: FileList | null) {
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
      toast.success(`${uploadedUrls.length} image${uploadedUrls.length > 1 ? "s" : ""} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
    // Auto-generate SKU and barcode if empty
    const finalDraft = {
      ...draft,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-full rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border p-6">
          <h2 className="font-display text-xl font-bold">
            {product ? "Edit product" : "Add product"}
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* Gallery */}
          <div className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Media gallery</p>
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_IMAGES} photos or videos · drag to reorder · the first one is the main
                  thumbnail
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                <Upload className="size-4" />
                {uploading ? "Uploading…" : "Upload files"}
                <input
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
              </label>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex === null) void addFiles(e.dataTransfer.files);
              }}
              className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5"
            >
              {draft.images.map((url, i) => (
                <div
                  key={url}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== i) reorder(dragIndex, i);
                    setDragIndex(null);
                  }}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-border"
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
                        (e.target as HTMLImageElement).style.opacity = "0";
                      }}
                    />
                  )}
                  {i === 0 && (
                    <span className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      <Star className="size-3" /> Main
                    </span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-background/80 p-1 text-muted-foreground">
                    <GripVertical className="size-3" />
                  </span>
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() =>
                      setDraft((d) => {
                        const images = d.images.filter((u) => u !== url);
                        return { ...d, images, imageUrl: images[0] ?? "" };
                      })
                    }
                    className="absolute right-1 top-1 rounded-lg bg-background/90 p-1 text-destructive opacity-0 transition group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {draft.images.length === 0 && (
                <p className="col-span-full rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Drag & drop images here, or use the upload button.
                </p>
              )}
            </div>
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
                    value={draft.buyingPrice}
                    onChange={(e) => set("buyingPrice", Math.max(0, Number(e.target.value)))}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Selling Price (₹)
                  <input
                    type="number"
                    min="0"
                    className={input}
                    value={draft.price}
                    onChange={(e) => set("price", Math.max(0, Number(e.target.value)))}
                  />
                </label>
                <label className="text-sm font-semibold">
                  MRP (₹)
                  <input
                    type="number"
                    min="0"
                    className={input}
                    value={draft.mrp}
                    onChange={(e) => set("mrp", Math.max(0, Number(e.target.value)))}
                  />
                </label>
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
            <label className="text-sm font-semibold">
              Stock on hand
              <input
                type="number"
                min="0"
                className={input}
                value={draft.stock}
                onChange={(e) => set("stock", Number(e.target.value))}
              />
            </label>
            <label className="text-sm font-semibold">
              Low-stock alert at
              <input
                type="number"
                min="0"
                className={input}
                value={draft.lowStockAt}
                onChange={(e) => set("lowStockAt", Number(e.target.value))}
              />
            </label>
            <label className="text-sm font-semibold">
              Sort order
              <input
                type="number"
                className={input}
                value={draft.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
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
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.isFeatured}
                onChange={(e) => set("isFeatured", e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Featured
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Visible in store
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
