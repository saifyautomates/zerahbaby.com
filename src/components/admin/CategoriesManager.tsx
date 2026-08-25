import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { imageFor } from "@/lib/store";

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
  const [draft, setDraft] = useState({
    slug: "",
    name: "",
    tagline: "",
    image_url: "",
    sort_order: 0,
  });

  const { data } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("sort_order");
      if (error) throw error;
      return data as CategoryRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const update = useMutation({
    mutationFn: async (row: CategoryRow) => {
      const { error } = await supabase
        .from("categories")
        .update({
          name: row.name,
          slug: row.slug,
          tagline: row.tagline,
          image_url: row.image_url || null,
          sort_order: row.sort_order,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Category updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
      <div className="space-y-4">
        {(data ?? []).map((c) => (
          <CategoryRowEditor
            key={c.id}
            row={c}
            onSave={(r) => update.mutate(r)}
            onDelete={() => {
              if (window.confirm(`Delete category "${c.name}"?`)) remove.mutate(c.id);
            }}
          />
        ))}
      </div>

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
          <input
            className={input}
            placeholder="Image URL (optional)"
            value={draft.image_url}
            onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
            aria-label="Category image URL"
          />
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
  onSave,
  onDelete,
}: {
  row: CategoryRow;
  onSave: (r: CategoryRow) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(row);
  const input =
    "w-full rounded-xl border border-border bg-card px-3.5 py-2 text-sm text-foreground outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm placeholder:text-muted-foreground";

  return (
    <div className="grid items-center gap-4 rounded-2xl border border-gray-100 bg-card p-4 shadow-sm lg:grid-cols-[64px_1fr_1fr_1fr_80px_auto] transition-all hover:border-border">
      <img
        src={imageFor(value.slug, value.image_url)}
        alt=""
        loading="lazy"
        width={56}
        height={56}
        className="size-14 rounded-xl object-cover border border-gray-100 shadow-sm"
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = "0";
        }}
      />
      <input
        className={input}
        value={value.name}
        onChange={(e) => setValue({ ...value, name: e.target.value })}
        aria-label="Name"
      />
      <input
        className={input}
        value={value.slug}
        onChange={(e) => setValue({ ...value, slug: e.target.value })}
        aria-label="Slug"
      />
      <input
        className={input}
        value={value.tagline}
        onChange={(e) => setValue({ ...value, tagline: e.target.value })}
        aria-label="Tagline"
      />
      <input
        className={input}
        type="number"
        value={value.sort_order}
        onChange={(e) => setValue({ ...value, sort_order: Number(e.target.value) })}
        aria-label="Sort order"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(value)}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Save
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete category"
          className="rounded-lg border border-border p-2 text-destructive hover:bg-muted"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}
