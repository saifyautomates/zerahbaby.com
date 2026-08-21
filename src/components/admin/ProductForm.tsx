import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { GripVertical, Images, Star, Trash2, Upload } from "lucide-react";
import { ageGroups, useCategories, useProducts, type Product } from "@/lib/store";
import { MediaLibraryPicker } from "@/components/admin/MediaLibrary";
import { useUploadToLibrary } from "@/lib/media-library";

export type ProductDraft = {
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  ageGroup: string;
  imageUrl: string;
  images: string[];
  stock: number;
  lowStockAt: number;
  sku: string;
  description: string;
  highlights: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
};

const toDraft = (p: Product | null, defaultCategory?: string): ProductDraft => ({
  slug: p?.id ?? "",
  name: p?.name ?? "",
  brand: p?.brand ?? "",
  category: p?.category ?? defaultCategory ?? "clothing",
  price: p?.price ?? 0,
  mrp: p?.mrp ?? 0,
  rating: p?.rating ?? 4.5,
  reviews: p?.reviews ?? 0,
  ageGroup: p?.ageGroup ?? "0-6m",
  imageUrl: p?.imageUrl ?? "",
  images: p?.images ?? [],
  stock: p?.stock ?? 10,
  lowStockAt: p?.lowStockAt ?? 5,
  sku: p?.sku ?? "",
  description: p?.description ?? "",
  highlights: (p?.highlights ?? []).join("\n"),
  isFeatured: p?.isFeatured ?? false,
  isActive: p?.isActive ?? true,
  sortOrder: p?.sortOrder ?? 0,
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
  const [picker, setPicker] = useState(false);
  const uploadToLibrary = useUploadToLibrary();
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - draft.images.length;
    if (room <= 0) {
      toast.error(`Up to ${MAX_IMAGES} images per product`);
      return;
    }
    setUploading(true);
    try {
      const assets = await uploadToLibrary(Array.from(files).slice(0, room));
      const urls = assets.map((a) => a.url);
      setDraft((d) => {
        const images = [...d.images, ...urls].slice(0, MAX_IMAGES);
        return { ...d, images, imageUrl: d.imageUrl || images[0] || "" };
      });
      toast.success(`${urls.length} image${urls.length > 1 ? "s" : ""} uploaded`);
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      {picker && (
        <MediaLibraryPicker
          title="Pick product media"
          accept="all"
          onClose={() => setPicker(false)}
          onSelect={(assets) =>
            setDraft((d) => {
              const images = [...d.images, ...assets.map((a) => a.url)].slice(0, MAX_IMAGES);
              return { ...d, images, imageUrl: d.imageUrl || images[0] || "" };
            })
          }
        />
      )}
      <div className="flex flex-col w-full max-w-3xl max-h-full rounded-3xl border border-border bg-card shadow-2xl overflow-hidden">
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
              <button
                type="button"
                onClick={() => setPicker(true)}
                className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted"
              >
                <Images className="size-4" /> Choose from library
              </button>
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
            <label className="text-sm font-semibold">
              SKU
              <input
                className={input}
                value={draft.sku}
                onChange={(e) => set("sku", e.target.value)}
              />
            </label>
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
            <label className="text-sm font-semibold">
              Price (₹)
              <input
                type="number"
                className={input}
                value={draft.price}
                onChange={(e) => set("price", Number(e.target.value))}
              />
            </label>
            <label className="text-sm font-semibold">
              MRP (₹)
              <input
                type="number"
                className={input}
                value={draft.mrp}
                onChange={(e) => set("mrp", Number(e.target.value))}
              />
            </label>
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
              Rating
              <input
                type="number"
                step="0.1"
                min="0"
                max="5"
                className={input}
                value={draft.rating}
                onChange={(e) => set("rating", Number(e.target.value))}
              />
            </label>
            <label className="text-sm font-semibold">
              Reviews
              <input
                type="number"
                className={input}
                value={draft.reviews}
                onChange={(e) => set("reviews", Number(e.target.value))}
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
          <button
            onClick={onCancel}
            className="rounded-full border border-border px-5 py-2 text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={saving || uploading || !draft.name || !draft.slug}
            className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save product"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
