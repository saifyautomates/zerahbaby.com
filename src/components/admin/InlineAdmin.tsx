import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAdminMode } from "@/lib/admin-mode";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useDeleteProduct, useSaveProduct, useSaveSetting } from "@/lib/admin-products";
import type { Product } from "@/lib/store";

/** Edit / delete controls that sit on a product card while admin mode is on. */
export function AdminProductControls({ product }: { product: Product }) {
  const { adminMode } = useAdminMode();
  const [editing, setEditing] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ProductDraft | null>(null);
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
          className="rounded-full bg-background/95 p-2 text-foreground shadow-md transition hover:bg-primary hover:text-primary-foreground"
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
          className="rounded-full bg-background/95 p-2 text-destructive shadow-md transition hover:bg-destructive hover:text-destructive-foreground"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {editing && (
        <ProductForm
          product={product}
          saving={save.isPending}
          onCancel={() => setEditing(false)}
          onSave={(draft) => setPendingDraft(draft)}
        />
      )}

      {pendingDraft && (
        <ConfirmDialog
          title="Save these changes?"
          message={`"${pendingDraft.name}" will be updated on the live website right away.`}
          confirmLabel="Yes, save"
          busy={save.isPending}
          onCancel={() => setPendingDraft(null)}
          onConfirm={() =>
            save.mutate(
              { draft: pendingDraft, uuid: product.uuid },
              {
                onSuccess: () => {
                  setPendingDraft(null);
                  setEditing(false);
                },
              },
            )
          }
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          destructive
          title="Delete this product?"
          message={`"${product.name}" will be permanently removed from the store.`}
          confirmLabel="Yes, delete"
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() =>
            remove.mutate(product.uuid, { onSuccess: () => setConfirmDelete(false) })
          }
        />
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
  const [pendingDraft, setPendingDraft] = useState<ProductDraft | null>(null);
  const save = useSaveProduct();

  if (!adminMode) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border border-dashed border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground ${className}`}
      >
        <Plus className="size-4" /> {label}
      </button>

      {open && (
        <ProductForm
          product={null}
          {...(defaultCategory ? { defaultCategory } : {})}
          saving={save.isPending}
          onCancel={() => setOpen(false)}
          onSave={(draft) => setPendingDraft(draft)}
        />
      )}

      {pendingDraft && (
        <ConfirmDialog
          title="Publish this new product?"
          message={`"${pendingDraft.name}" will appear on the website immediately.`}
          confirmLabel="Yes, publish"
          busy={save.isPending}
          onCancel={() => setPendingDraft(null)}
          onConfirm={() =>
            save.mutate(
              { draft: pendingDraft },
              {
                onSuccess: () => {
                  setPendingDraft(null);
                  setOpen(false);
                },
              },
            )
          }
        />
      )}
    </>
  );
}

/** Inline-editable website text backed by site_settings. */
export function AdminEditableText({
  settingKey,
  value,
  multiline = false,
  children,
}: {
  settingKey: string;
  value: string;
  multiline?: boolean;
  children: React.ReactNode;
}) {
  const { adminMode } = useAdminMode();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const save = useSaveSetting();

  if (!adminMode) return <>{children}</>;

  return (
    <span className="group relative inline-block w-full">
      {draft === null ? (
        <>
          {children}
          <button
            type="button"
            aria-label={`Edit ${settingKey}`}
            onClick={() => setDraft(value)}
            className="ml-2 inline-flex items-center gap-1 rounded-full border border-dashed border-primary px-2.5 py-1 align-middle text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            <Pencil className="size-3" /> Edit
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
              className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              <Check className="size-3.5" /> Save
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-4 py-1.5 text-xs font-semibold"
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
