import { useState, Suspense } from "react";
import { Check, Pencil, Plus, Trash2, X, Upload, FolderPlus } from "lucide-react";
import { useAdminMode } from "@/lib/admin-mode";
import type { ProductDraft } from "@/components/admin/ProductForm";
import { safeLazy } from "@/lib/safe-lazy";
const ProductForm = safeLazy(() =>
  import("@/components/admin/ProductForm").then((m) => ({ default: m.ProductForm })),
);
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useDeleteProduct, useSaveProduct, useSaveSetting } from "@/lib/admin-products";
import type { Product, Category } from "@/lib/store";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadMedia } from "@/lib/uploads";
import { toast } from "sonner";

/** Edit / delete controls that sit on a product card while admin mode is on. */
export function AdminProductControls({ product }: { product: Product }) {
  const { adminMode } = useAdminMode();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveProduct();
  const remove = useDeleteProduct();

  if (!adminMode) return null;

  return (
    <>
      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <button
          type="button"
          aria-label={`Edit ${product.name}`}
          title="Edit this product"
          onClick={(e) => {
            e.preventDefault();
            setEditing(true);
          }}
          className="rounded-full bg-background/95 p-2 text-foreground shadow-md transition hover:bg-primary hover:text-primary-foreground cursor-pointer"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${product.name}`}
          title="Delete this product"
          onClick={(e) => {
            e.preventDefault();
            setConfirmDelete(true);
          }}
          className="rounded-full bg-background/95 p-2 text-destructive shadow-md transition hover:bg-destructive hover:text-destructive-foreground cursor-pointer"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {editing && (
        <Suspense
          fallback={
            <div className="p-8 text-center text-muted-foreground animate-pulse rounded-2xl bg-card border shadow-xl mx-4 my-8">
              Loading editor...
            </div>
          }
        >
          <ProductForm
            product={product}
            saving={save.isPending}
            onCancel={() => setEditing(false)}
            onSave={(draft) => {
              save.mutate({ draft, uuid: product.uuid }, { onSuccess: () => setEditing(false) });
            }}
          />
        </Suspense>
      )}

      {confirmDelete && (
        <ConfirmDialog
          destructive
          title="Delete this product?"
          message={`"${product.name}" will be removed from the active store.`}
          confirmLabel="Yes, delete"
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() =>
            remove.mutate(product.uuid, {
              onSuccess: () => {
                setConfirmDelete(false);
                if (
                  typeof window !== "undefined" &&
                  window.location.pathname.startsWith("/product/")
                ) {
                  window.location.href = "/shop";
                }
              },
            })
          }
        />
      )}
    </>
  );
}

/** "Add Category" button on homepage Shop by Category section */
export function AdminAddCategory({ className = "" }: { className?: string }) {
  const { adminMode } = useAdminMode();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    slug: "",
    name: "",
    tagline: "",
    image_url: "",
    sort_order: 1,
  });
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("categories").insert({
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        tagline: draft.tagline.trim(),
        image_url: draft.image_url || null,
        sort_order: Number(draft.sort_order),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Category added successfully");
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["admin-categories"] });
      setOpen(false);
      setDraft({ slug: "", name: "", tagline: "", image_url: "", sort_order: 1 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!adminMode) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border border-dashed border-primary px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-primary-foreground cursor-pointer ${className}`}
      >
        <FolderPlus className="size-4" /> Add Category
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-background p-6 shadow-2xl border border-border">
            <div className="flex items-center justify-between mb-5 border-b border-border pb-4">
              <h3 className="text-xl font-black font-display text-foreground">Add New Category</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 bg-muted hover:bg-muted-foreground/20 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground">Category Name</label>
                <input
                  className="w-full mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Nursery & Care"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground">Slug (URL)</label>
                <input
                  className="w-full mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  placeholder="e.g. care"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground">Tagline</label>
                <input
                  className="w-full mt-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                  value={draft.tagline}
                  onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
                  placeholder="e.g. Gentle skincare and hygiene essentials"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground">Image</label>
                <div className="flex gap-2 mt-1.5">
                  <input
                    className="flex-1 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                    placeholder="https://..."
                    value={draft.image_url}
                    onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
                  />
                  <label className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted-foreground/20 text-xs font-bold cursor-pointer transition">
                    <Upload className="size-4" />
                    <span>{uploading ? "..." : "Upload"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploading(true);
                        try {
                          const url = await uploadMedia(file, "categories");
                          setDraft({ ...draft, image_url: url });
                          toast.success("Image uploaded!");
                        } catch (err: unknown) {
                          toast.error((err as Error).message);
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-5 py-2.5 rounded-full border border-border text-sm font-semibold hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    create.isPending || uploading || !draft.name.trim() || !draft.slug.trim()
                  }
                  onClick={() => create.mutate()}
                  className="px-6 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-bold shadow-md hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  {create.isPending ? "Adding..." : "Add Category"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "Add product" button placed inside any storefront section while admin mode is on. */
export function AdminAddProduct({
  defaultCategory,
  label = "Add product here",
  className = "",
}: {
  defaultCategory?: string;
  label?: string;
  className?: string;
}) {
  const { adminMode } = useAdminMode();
  const [open, setOpen] = useState(false);
  const save = useSaveProduct();

  if (!adminMode) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border border-dashed border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground cursor-pointer ${className}`}
      >
        <Plus className="size-4" /> {label}
      </button>

      {open && (
        <Suspense
          fallback={
            <div className="p-8 text-center text-muted-foreground animate-pulse rounded-2xl bg-card border shadow-xl">
              Loading editor...
            </div>
          }
        >
          <ProductForm
            product={null}
            defaultCategory={defaultCategory}
            saving={save.isPending}
            onCancel={() => setOpen(false)}
            onSave={(draft) => {
              save.mutate({ draft }, { onSuccess: () => setOpen(false) });
            }}
          />
        </Suspense>
      )}
    </>
  );
}

/** Inline editable text wrapper for site settings. */
export function AdminEditableText({
  settingKey,
  value,
  children,
  multiline = false,
}: {
  settingKey: string;
  value: string;
  children: React.ReactNode;
  multiline?: boolean;
}) {
  const { adminMode } = useAdminMode();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const save = useSaveSetting();

  if (!adminMode) return <>{children}</>;

  return (
    <span className="relative group/edit inline-block">
      {draft === null ? (
        <>
          {children}
          <button
            type="button"
            aria-label={`Edit ${settingKey}`}
            title="Edit this text"
            onClick={() => setDraft(value)}
            className="absolute -right-8 top-1/2 -translate-y-1/2 rounded-full bg-primary p-1.5 text-primary-foreground opacity-0 shadow-md transition group-hover/edit:opacity-100 cursor-pointer"
          >
            <Pencil className="size-3.5" />
          </button>
        </>
      ) : (
        <span className="block">
          {multiline ? (
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-2xl border border-primary bg-background p-3 text-base outline-none"
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-2xl border border-primary bg-background p-3 text-2xl font-bold outline-none"
            />
          )}
          <span className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground cursor-pointer"
            >
              <Check className="size-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-xs font-semibold cursor-pointer"
            >
              <X className="size-3.5" /> Cancel
            </button>
          </span>
        </span>
      )}

      {confirming && draft !== null && (
        <ConfirmDialog
          title="Update this text on the live site?"
          message="Everyone visiting the website will see the new text."
          confirmLabel="Yes, update"
          busy={save.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            save.mutate(
              { key: settingKey, value: draft },
              {
                onSuccess: () => {
                  setConfirming(false);
                  setDraft(null);
                },
              },
            )
          }
        />
      )}
    </span>
  );
}
