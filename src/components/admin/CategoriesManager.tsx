import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, ImagePlus, Upload, Check, Loader2, Save } from "lucide-react";
import { imageFor } from "@/lib/store";
import { uploadMedia } from "@/lib/uploads";

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  image_url: string | null;
  sort_order: number;
};

export function CategoriesTab() {
  const qc = useQueryClient();
  const [items, setItems] = useState<CategoryRow[]>([]);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    slug: "",
    name: "",
    tagline: "",
    image_url: "",
    sort_order: 0,
  });
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-categories"],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("sort_order");
      if (error) throw error;
      return data as CategoryRow[];
    },
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product"] });
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    qc.invalidateQueries({ queryKey: ["homepage-sections"] });
  }, [qc]);

  // Track unsaved modifications against the loaded query data
  const hasUnsavedChanges = useMemo(() => {
    if (!data || !items || items.length !== data.length) return false;
    return items.some((it) => {
      const orig = data.find((d) => d.id === it.id);
      if (!orig) return true;
      return (
        it.name !== orig.name ||
        it.slug !== orig.slug ||
        (it.tagline || "") !== (orig.tagline || "") ||
        Number(it.sort_order) !== Number(orig.sort_order) ||
        (it.image_url || "") !== (orig.image_url || "")
      );
    });
  }, [items, data]);

  const unsavedCount = useMemo(() => {
    if (!data || !items) return 0;
    return items.filter((it) => {
      const orig = data.find((d) => d.id === it.id);
      if (!orig) return false;
      return (
        it.name !== orig.name ||
        it.slug !== orig.slug ||
        (it.tagline || "") !== (orig.tagline || "") ||
        Number(it.sort_order) !== Number(orig.sort_order) ||
        (it.image_url || "") !== (orig.image_url || "")
      );
    }).length;
  }, [items, data]);

  // Sync data to items on first load or when clean
  useEffect(() => {
    if (data && !hasUnsavedChanges) {
      setItems(data);
    }
  }, [data, hasUnsavedChanges]);

  // Row field change handler
  const handleItemChange = (index: number, updated: CategoryRow) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  // Save all categories at once
  const handleSaveAll = useCallback(async () => {
    if (items.length === 0) return;

    // Validate that no category has empty name or slug
    for (const cat of items) {
      if (!cat.name?.trim()) {
        toast.error("Category name cannot be empty");
        return;
      }
      if (!cat.slug?.trim()) {
        toast.error(`Please provide a slug for category "${cat.name}"`);
        return;
      }
    }

    setIsSavingAll(true);
    try {
      const updatePromises = items.map((row) =>
        supabase
          .from("categories")
          .update({
            name: row.name.trim(),
            slug: row.slug.trim(),
            tagline: row.tagline || "",
            image_url: row.image_url || null,
            sort_order: Number(row.sort_order) || 0,
          })
          .eq("id", row.id)
      );

      const results = await Promise.all(updatePromises);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;

      toast.success(
        unsavedCount > 0
          ? `All ${items.length} categories saved successfully! (${unsavedCount} updated)`
          : `All ${items.length} categories saved successfully!`
      );

      invalidate();
      await qc.refetchQueries({ queryKey: ["admin-categories"] });
      await qc.refetchQueries({ queryKey: ["categories"] });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to save categories");
    } finally {
      setIsSavingAll(false);
    }
  }, [items, unsavedCount, invalidate, qc]);

  // Save single category
  const handleSaveSingle = async (row: CategoryRow) => {
    if (!row.name?.trim()) {
      toast.error("Category name cannot be empty");
      return;
    }
    if (!row.slug?.trim()) {
      toast.error("Category slug cannot be empty");
      return;
    }

    setSavingRowId(row.id);
    try {
      const { error } = await supabase
        .from("categories")
        .update({
          name: row.name.trim(),
          slug: row.slug.trim(),
          tagline: row.tagline || "",
          image_url: row.image_url || null,
          sort_order: Number(row.sort_order) || 0,
        })
        .eq("id", row.id);

      if (error) throw error;
      toast.success(`Category "${row.name}" saved successfully`);
      invalidate();
      await qc.refetchQueries({ queryKey: ["admin-categories"] });
      await qc.refetchQueries({ queryKey: ["categories"] });
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to save category");
    } finally {
      setSavingRowId(null);
    }
  };

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveAll]);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("categories").insert({
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        tagline: draft.tagline,
        image_url: draft.image_url || null,
        sort_order: Number(draft.sort_order),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Category added");
      setDraft({ slug: "", name: "", tagline: "", image_url: "", sort_order: 0 });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Category deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const input =
    "w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm placeholder:text-muted-foreground";

  return (
    <div className="space-y-8">
      {/* Top Header Bar with Save All Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-card p-4 sm:p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold text-foreground">Categories</h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {items.length} total
            </span>
            {hasUnsavedChanges && (
              <span className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300 px-2.5 py-0.5 text-xs font-bold animate-pulse">
                {unsavedCount} unsaved change{unsavedCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Edit names, slugs, taglines, sort order, and photos below. Click Save All or press Ctrl+S to save everything.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={() => {
                if (data) setItems(data);
                toast.info("Unsaved changes discarded");
              }}
              disabled={isSavingAll}
              className="rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted transition active:scale-95 disabled:opacity-50"
            >
              Discard
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSavingAll || items.length === 0}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-50 ${
              hasUnsavedChanges
                ? "bg-[#8B2020] hover:bg-[#7a1c1c] ring-4 ring-[#8B2020]/20"
                : "bg-[#8B2020] hover:bg-[#7a1c1c]"
            }`}
          >
            {isSavingAll ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Saving All...</span>
              </>
            ) : (
              <>
                <Check className="size-4" />
                <span>Save All Categories</span>
                {hasUnsavedChanges && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-extrabold">
                    {unsavedCount}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Category Rows */}
      <div className="space-y-4">
        {isLoading && items.length === 0 ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
            <Loader2 className="size-5 animate-spin mr-2" /> Loading categories...
          </div>
        ) : (
          items.map((c, index) => {
            const original = data?.find((d) => d.id === c.id);
            const isRowDirty = original && (
              c.name !== original.name ||
              c.slug !== original.slug ||
              (c.tagline || "") !== (original.tagline || "") ||
              Number(c.sort_order) !== Number(original.sort_order) ||
              (c.image_url || "") !== (original.image_url || "")
            );

            return (
              <CategoryRowEditor
                key={c.id}
                row={c}
                isDirty={Boolean(isRowDirty)}
                isSaving={savingRowId === c.id || isSavingAll}
                onChange={(updated) => handleItemChange(index, updated)}
                onSave={() => handleSaveSingle(c)}
                onDelete={() => {
                  if (window.confirm(`Delete category "${c.name}"?`)) remove.mutate(c.id);
                }}
              />
            );
          })
        )}
      </div>

      {/* Floating Save All bar if scrolled with unsaved changes */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-[#0f172a] text-white p-3 px-5 shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-400 animate-ping" />
            <span className="text-xs font-semibold">
              {unsavedCount} unsaved category change{unsavedCount > 1 ? "s" : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSavingAll}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#8B2020] hover:bg-[#7a1c1c] px-4 py-1.5 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50"
          >
            {isSavingAll ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Save All (Ctrl+S)
              </>
            )}
          </button>
        </div>
      )}

      {/* Add a Category Card */}
      <div className="rounded-2xl border border-gray-100 bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground">Add a category</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className={input}
            placeholder="Slug (e.g. bath)"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            aria-label="Category slug"
          />
          <input
            className={input}
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Category name"
          />
          <input
            className={input}
            placeholder="Tagline"
            value={draft.tagline}
            onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
            aria-label="Category tagline"
          />
          <div className="relative">
            <input
              type="file"
              id="add-category-image"
              accept="image/*,video/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const url = await uploadMedia(file, "categories");
                  setDraft({ ...draft, image_url: url });
                } catch (err: unknown) {
                  toast.error((err as Error).message || "Upload failed");
                } finally {
                  setUploading(false);
                }
              }}
            />
            <label
              htmlFor="add-category-image"
              className={`flex items-center justify-center gap-2 ${input} cursor-pointer hover:bg-muted/50 ${draft.image_url ? "border-primary text-primary font-medium" : ""}`}
            >
              <ImagePlus className="size-4 shrink-0" />
              <span className="truncate">
                {uploading
                  ? "Uploading..."
                  : draft.image_url
                    ? "Media Selected"
                    : "Upload Photo/Video"}
              </span>
            </label>
          </div>
          <input
            className={input}
            type="number"
            placeholder="Sort"
            value={draft.sort_order}
            onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
            aria-label="Sort order"
          />
        </div>
        <button
          onClick={() => create.mutate()}
          disabled={!draft.slug || !draft.name || create.isPending}
          className="mt-5 rounded-xl bg-[#8B2020] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a1c1c] disabled:opacity-60"
        >
          Add category
        </button>
      </div>
    </div>
  );
}

function CategoryRowEditor({
  row,
  isDirty,
  isSaving,
  onChange,
  onSave,
  onDelete,
}: {
  row: CategoryRow;
  isDirty: boolean;
  isSaving?: boolean;
  onChange: (r: CategoryRow) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const input =
    "w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm placeholder:text-muted-foreground";

  return (
    <div
      className={`grid items-center gap-4 rounded-2xl border ${
        isDirty ? "border-[#8B2020]/40 bg-[#8B2020]/[0.02]" : "border-gray-100 bg-card"
      } p-4 shadow-sm lg:grid-cols-[64px_1fr_1fr_1fr_80px_auto] transition-all hover:border-border`}
    >
      <label className="relative cursor-pointer group rounded-xl overflow-hidden size-14 border border-gray-100 shadow-sm block bg-muted">
        <input
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            try {
              const url = await uploadMedia(file, "categories");
              onChange({ ...row, image_url: url });
            } catch (err: unknown) {
              toast.error((err as Error).message || "Upload failed");
            } finally {
              setUploading(false);
            }
          }}
        />
        <img
          src={imageFor(row.slug, row.image_url)}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity ${uploading ? "opacity-50" : ""}`}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = "0";
          }}
        />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Upload className="size-5 text-white" />
        </div>
      </label>
      <input
        className={input}
        value={row.name}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
        aria-label="Name"
        placeholder="Category name"
      />
      <input
        className={input}
        value={row.slug}
        onChange={(e) => onChange({ ...row, slug: e.target.value })}
        aria-label="Slug"
        placeholder="Category slug"
      />
      <input
        className={input}
        value={row.tagline || ""}
        onChange={(e) => onChange({ ...row, tagline: e.target.value })}
        aria-label="Tagline"
        placeholder="Tagline (optional)"
      />
      <input
        className={input}
        type="number"
        value={row.sort_order}
        onChange={(e) => onChange({ ...row, sort_order: Number(e.target.value) })}
        aria-label="Sort order"
      />
      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-full bg-[#8B2020] hover:bg-[#7a1c1c] px-4 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSaving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              <span>Save</span>
            </>
          ) : (
            <span>Save</span>
          )}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete category"
          className="rounded-lg border border-border p-2 text-destructive hover:bg-muted transition active:scale-95"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
