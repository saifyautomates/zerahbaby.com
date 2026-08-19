// @ts-nocheck
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  Plus,
  Pencil,
  Trash2,
  Store,
  Package,
  ShoppingBag,
  Users,
  Layers,
  Settings,
  Shield,
  Images,
  FolderOpen,
  Tag,
  MessageSquare,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin, useSession } from "@/lib/auth";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { useAllOrders, useCustomers, orderStatuses } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { HeroMediaManager } from "@/components/admin/HeroMediaManager";
import { MediaLibrary } from "@/components/admin/MediaLibrary";
import { useAllCoupons, useCreateCoupon, useDeleteCoupon, useToggleCoupon } from "@/lib/coupons";
import { useAllReviews, useUpdateReviewStatus, useDeleteReview } from "@/lib/reviews";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Store Admin — Zerah Baby And Kids" },
      {
        name: "description",
        content: "Manage products, categories and store settings for Zerah Baby And Kids.",
      },
      { property: "og:title", content: "Store Admin — Zerah Baby And Kids" },
      { property: "og:description", content: "Manage the Zerah Baby And Kids catalogue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Tab =
  "products" | "hero" | "media" | "orders" | "customers" | "categories" | "settings" | "admins" | "coupons" | "reviews";

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: isAdmin, isLoading: roleLoading, refetch: refetchRole } = useIsAdmin(user?.id);
  const [tab, setTab] = useState<Tab>("products");

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  useEffect(() => {
    if (roleLoading || isAdmin || !user) return;
    supabase.rpc("sync_admin_from_allowlist").then(({ data }) => {
      if (data) refetchRole();
    });
  }, [roleLoading, isAdmin, user, refetchRole]);

  if (roleLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold">Admin access needed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You're signed in as {user?.email}, which isn't an approved store admin account. Sign in
          with your admin email, or ask an existing admin to add you.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          Back to the store
        </Link>
        <button
          onClick={signOut}
          className="mt-4 block w-full text-sm text-muted-foreground hover:text-primary"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <p className="font-display text-lg font-bold">Zerah admin</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <nav className="flex flex-wrap gap-1 px-3 pb-3 lg:flex-col">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                tab === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1 border-t border-border px-3 py-3 lg:flex-col">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Store className="size-4" /> View store
          </Link>
          <button
            onClick={signOut}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="px-4 py-8 lg:px-8">
        <h1 className="font-display text-2xl font-bold capitalize">
          {TABS.find((t) => t.key === tab)?.label}
        </h1>
        <div className="mt-6 rounded-3xl bg-background p-4 shadow-sm lg:p-6">
          {tab === "products" && <ProductsTab />}
          {tab === "hero" && <HeroMediaManager />}
          {tab === "media" && <MediaLibrary />}
          {tab === "orders" && <OrdersTab />}
          {tab === "customers" && <CustomersTab />}
          {tab === "categories" && <CategoriesTab />}
          {tab === "settings" && <SettingsTab />}
          {tab === "admins" && <AdminsTab currentEmail={user?.email ?? ""} />}
          {tab === "coupons" && <CouponsTab />}
          {tab === "reviews" && <ReviewsTab />}
        </div>
      </main>
    </div>
  );
}

const TABS = [
  { key: "products" as const, label: "Products", icon: Package },
  { key: "hero" as const, label: "Hero media", icon: Images },
  { key: "media" as const, label: "Media library", icon: FolderOpen },
  { key: "orders" as const, label: "Orders", icon: ShoppingBag },
  { key: "customers" as const, label: "Customers", icon: Users },
  { key: "categories" as const, label: "Categories", icon: Layers },
  { key: "coupons" as const, label: "Coupons", icon: Tag },
  { key: "reviews" as const, label: "Reviews", icon: MessageSquare },
  { key: "settings" as const, label: "Pages & settings", icon: Settings },
  { key: "admins" as const, label: "Admin users", icon: Shield },
];

/* ---------------- Products ---------------- */

function ProductsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("sort_order");
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const save = useMutation({
    mutationFn: async ({ draft, uuid }: { draft: ProductDraft; uuid?: string }) => {
      const row = {
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        brand: draft.brand.trim(),
        category: draft.category,
        price: Number(draft.price),
        mrp: Number(draft.mrp),
        rating: Number(draft.rating),
        reviews: Number(draft.reviews),
        age_group: draft.ageGroup,
        image_url: (draft.imageUrl.trim() || draft.images[0]) ?? null,
        images: draft.images,
        stock: Number(draft.stock),
        low_stock_at: Number(draft.lowStockAt),
        sku: draft.sku.trim(),
        description: draft.description,
        highlights: draft.highlights
          .split("\n")
          .map((h) => h.trim())
          .filter(Boolean),
        is_featured: draft.isFeatured,
        is_active: draft.isActive,
        sort_order: Number(draft.sortOrder),
      };
      const { error } = uuid
        ? await supabase.from("products").update(row).eq("id", uuid)
        : await supabase.from("products").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product saved");
      setEditing(null);
      setCreating(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").delete().eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(
    () =>
      (data ?? []).filter((p) =>
        (p.name + p.brand + p.category + p.id).toLowerCase().includes(search.toLowerCase()),
      ),
    [data, search],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products"
          className="w-full max-w-xs rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="size-4" /> Add product
        </button>
      </div>

      {isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading products…</p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">MRP</th>
                <th className="px-4 py-3">Stock</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.uuid} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        width={40}
                        height={40}
                        className="size-10 rounded-lg object-cover"
                      />
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.brand} · {p.id}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize">{p.category}</td>
                  <td className="px-4 py-3 font-semibold">{formatPrice(p.price)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatPrice(p.mrp)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.stock === 0
                          ? "bg-destructive/10 text-destructive"
                          : p.stock <= p.lowStockAt
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground"
                      }`}
                    >
                      {p.stock === 0 ? "Out of stock" : `${p.stock} left`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        p.isActive
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.isActive ? "Live" : "Hidden"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditing(p)}
                        aria-label={`Edit ${p.name}`}
                        className="rounded-lg border border-border p-2 hover:bg-muted"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete "${p.name}"?`)) remove.mutate(p.uuid);
                        }}
                        aria-label={`Delete ${p.name}`}
                        className="rounded-lg border border-border p-2 text-destructive hover:bg-muted"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <ProductForm
          product={editing}
          saving={save.isPending}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(draft) => save.mutate(editing ? { draft, uuid: editing.uuid } : { draft })}
        />
      )}
    </div>
  );
}

/* ---------------- Categories ---------------- */

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  image_url: string | null;
  sort_order: number;
};

function CategoriesTab() {
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
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

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

      <div className="rounded-2xl border border-border p-5">
        <h2 className="font-display text-lg font-bold">Add a category</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
          className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
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
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="grid items-center gap-3 rounded-2xl border border-border p-4 lg:grid-cols-[64px_1fr_1fr_1fr_80px_auto]">
      <img
        src={imageFor(value.slug, value.image_url)}
        alt=""
        loading="lazy"
        width={56}
        height={56}
        className="size-14 rounded-xl object-cover"
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

/* ---------------- Settings ---------------- */

const SETTING_LABELS: Record<string, string> = {
  brand_name: "Brand name",
  announcement: "Announcement bar",
  hero_title: "Home hero title",
  hero_subtitle: "Home hero subtitle",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  store_address: "Store address",
  store_hours: "Opening hours",
  maps_url: "Google Maps link",
  instagram_url: "Instagram URL",
  facebook_url: "Facebook URL",
  whatsapp_url: "WhatsApp link",
};

function SettingsTab() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);

  const { data } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("key, value")
        .order("key");
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, string>;
    },
  });

  const current = values ?? data ?? {};

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(current).map(([key, value]) => ({ key, value }));
      const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-4">
      {Object.keys(current).map((key) => (
        <label key={key} className="block">
          <span className="text-sm font-semibold">{SETTING_LABELS[key] ?? key}</span>
          <textarea
            rows={key.includes("subtitle") || key === "announcement" ? 2 : 1}
            value={current[key]}
            onChange={(e) => setValues({ ...current, [key]: e.target.value })}
            className="mt-1 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      ))}
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        Save settings
      </button>
    </div>
  );
}

/* ---------------- Admins ---------------- */

function AdminsTab({ currentEmail }: { currentEmail: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-list"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admins");
      if (error) throw error;
      return data ?? [];
    },
  });

  const grant = useMutation({
    mutationFn: async (value: string) => {
      const { data, error } = await supabase.rpc("grant_admin_by_email", { _email: value });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (result) => {
      toast.success(
        result === "granted"
          ? "Admin access granted"
          : "Added to the admin list — they become admin the next time they sign in",
      );
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.rpc("revoke_admin_by_email", { _email: value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Admin access removed");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-2xl border border-border p-5">
        <h2 className="font-display text-lg font-bold">Give admin access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add someone by email. If they already have an account they become an admin right away,
          otherwise access is applied when they sign in with that email.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@email.com"
            aria-label="Email to make admin"
            className="min-w-56 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => grant.mutate(email)}
            disabled={!email.includes("@") || grant.isPending}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {grant.isPending ? "Adding…" : "Make admin"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr key={row.email} className="border-t border-border">
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      row.status === "active"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {row.status === "active" ? "Active admin" : "Invited"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {row.email.toLowerCase() === currentEmail.toLowerCase() ? (
                    <span className="text-xs text-muted-foreground">You</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (window.confirm(`Remove admin access for ${row.email}?`))
                          revoke.mutate(row.email);
                      }}
                      className="rounded-lg border border-border p-2 text-destructive hover:bg-muted"
                      aria-label={`Remove admin ${row.email}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && (data ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  No admins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
    </div>
  );
}

/* ---------------- Orders ---------------- */

function OrdersTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useAllOrders(true);
  const [filter, setFilter] = useState("all");

  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("orders").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Order updated");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const orders = (data ?? []).filter((o) => filter === "all" || o.status === filter);
  const revenue = (data ?? [])
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Orders</p>
          <p className="mt-1 font-display text-2xl font-bold">{(data ?? []).length}</p>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Revenue</p>
          <p className="mt-1 font-display text-2xl font-bold">{formatPrice(revenue)}</p>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Awaiting action</p>
          <p className="mt-1 font-display text-2xl font-bold">
            {(data ?? []).filter((o) => o.status === "placed").length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", ...orderStatuses].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
              filter === s
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading orders…</p>}
      {!isLoading && orders.length === 0 && (
        <p className="rounded-2xl border border-border p-10 text-center text-sm text-muted-foreground">
          No orders here yet.
        </p>
      )}

      <ul className="space-y-4">
        {orders.map((order) => (
          <li key={order.id} className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">#{order.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.created_at).toLocaleString("en-IN")}
                </p>
                <p className="mt-2 text-sm">
                  {order.full_name} · {order.phone}
                </p>
                <p className="text-sm text-muted-foreground">{order.email}</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {order.address}
                  {order.address_line2 ? `, ${order.address_line2}` : ""}
                  {order.landmark ? `, near ${order.landmark}` : ""}
                  {[order.city, order.state, order.pincode].filter(Boolean).length
                    ? ` — ${[order.city, order.state, order.pincode].filter(Boolean).join(", ")}`
                    : ""}
                </p>
                {order.alt_phone && (
                  <p className="text-xs text-muted-foreground">Alt: {order.alt_phone}</p>
                )}
                <p className="text-xs uppercase text-muted-foreground">
                  Pay: {order.payment_method || "cod"}
                </p>
                {order.notes && (
                  <p className="mt-1 text-sm italic text-muted-foreground">“{order.notes}”</p>
                )}
                <div className="mt-3">
                  <InvoiceBox order={order} />
                </div>
              </div>

              <div className="text-right">
                <p className="font-display text-xl font-bold">{formatPrice(Number(order.total))}</p>
                <select
                  value={order.status}
                  onChange={(e) => update.mutate({ id: order.id, status: e.target.value })}
                  aria-label={`Status for order ${order.id}`}
                  className="mt-2 rounded-xl border border-border bg-background px-3 py-1.5 text-sm capitalize outline-none focus:border-primary"
                >
                  {orderStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ul className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
              {order.order_items.map((item) => (
                <li key={item.id} className="flex items-center gap-3">
                  <img
                    src={imageFor("clothing", item.image_url)}
                    alt={item.name}
                    loading="lazy"
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-xl border border-border object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.product_slug} · qty {item.qty}
                    </span>
                  </span>
                  <span className="font-semibold">
                    {formatPrice(Number(item.price) * item.qty)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Customers ---------------- */

function CustomersTab() {
  const { data: customers, isLoading } = useCustomers(true);
  const { data: orders } = useAllOrders(true);

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; spend: number }>();
    for (const o of orders ?? []) {
      const cur = map.get(o.user_id) ?? { count: 0, spend: 0 };
      map.set(o.user_id, {
        count: cur.count + 1,
        spend: cur.spend + (o.status === "cancelled" ? 0 : Number(o.total)),
      });
    }
    return map;
  }, [orders]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Joined</th>
            <th className="px-4 py-3 text-right">Orders</th>
            <th className="px-4 py-3 text-right">Spend</th>
          </tr>
        </thead>
        <tbody>
          {(customers ?? []).map((c) => {
            const s = stats.get(c.id) ?? { count: 0, spend: 0 };
            return (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="px-4 py-3">
                  <span className="font-semibold">{c.full_name || "—"}</span>
                  <span className="block max-w-xs text-xs text-muted-foreground">{c.address}</span>
                </td>
                <td className="px-4 py-3">
                  {c.email}
                  <span className="block text-xs text-muted-foreground">{c.phone}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">{s.count}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatPrice(s.spend)}</td>
              </tr>
            );
          })}
          {!isLoading && (customers ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                No customers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Coupons ---------------- */

function CouponsTab() {
  const { data: coupons, isLoading } = useAllCoupons(true);
  const createCoupon = useCreateCoupon();
  const deleteCoupon = useDeleteCoupon();
  const toggleCoupon = useToggleCoupon();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "",
    discount_type: "percentage" as "percentage" | "fixed",
    discount_value: 10,
    minimum_order_value: 0,
    maximum_discount: 0,
    usage_limit: 0,
    per_user_limit: 1,
    starts_at: null as string | null,
    expires_at: null as string | null,
    active: true,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{(coupons ?? []).length} coupon(s)</p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" /> Add coupon
        </button>
      </div>

      {showForm && (
        <form
          className="space-y-3 rounded-2xl border border-border p-5"
          onSubmit={(e) => {
            e.preventDefault();
            createCoupon.mutate(form, {
              onSuccess: () => {
                setShowForm(false);
                setForm({ ...form, code: "" });
              },
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-semibold">
              Code
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="text-sm font-semibold">
              Type
              <select
                value={form.discount_type}
                onChange={(e) => setForm({ ...form, discount_type: e.target.value as any })}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Value
              <input
                type="number"
                required
                min={1}
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-semibold">
              Min order value (₹)
              <input
                type="number"
                min={0}
                value={form.minimum_order_value}
                onChange={(e) => setForm({ ...form, minimum_order_value: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="text-sm font-semibold">
              Max discount (₹, 0=unlimited)
              <input
                type="number"
                min={0}
                value={form.maximum_discount}
                onChange={(e) => setForm({ ...form, maximum_discount: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="text-sm font-semibold">
              Usage limit (0=unlimited)
              <input
                type="number"
                min={0}
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createCoupon.isPending}
              className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {createCoupon.isPending ? "Creating…" : "Create coupon"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-border px-6 py-2 text-sm font-semibold transition hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading coupons…</p>}

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Min order</th>
              <th className="px-4 py-3">Used</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(coupons ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border align-middle">
                <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                <td className="px-4 py-3">
                  {c.discount_type === "percentage" ? `${c.discount_value}%` : `₹${c.discount_value}`}
                  {c.maximum_discount > 0 && <span className="text-xs text-muted-foreground"> (max ₹{c.maximum_discount})</span>}
                </td>
                <td className="px-4 py-3">₹{c.minimum_order_value}</td>
                <td className="px-4 py-3">{c.usage_count}{c.usage_limit > 0 ? `/${c.usage_limit}` : ""}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleCoupon.mutate({ id: c.id, active: !c.active })}
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${c.active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}
                  >
                    {c.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteCoupon.mutate(c.id)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && (coupons ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No coupons yet. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Reviews ---------------- */

function ReviewsTab() {
  const { data: reviews, isLoading } = useAllReviews(true);
  const updateStatus = useUpdateReviewStatus();
  const deleteReview = useDeleteReview();
  const [filter, setFilter] = useState("all");

  const filtered = (reviews ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="mt-1 font-display text-2xl font-bold">{(reviews ?? []).length}</p>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending</p>
          <p className="mt-1 font-display text-2xl font-bold text-primary">
            {(reviews ?? []).filter((r) => r.status === "pending").length}
          </p>
        </div>
        <div className="rounded-2xl border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Approved</p>
          <p className="mt-1 font-display text-2xl font-bold">
            {(reviews ?? []).filter((r) => r.status === "approved").length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", "pending", "approved", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
              filter === s
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading reviews…</p>}

      {filtered.length === 0 && !isLoading && (
        <p className="rounded-2xl border border-border p-10 text-center text-sm text-muted-foreground">
          No reviews to show.
        </p>
      )}

      <ul className="space-y-3">
        {filtered.map((review) => (
          <li key={review.id} className="rounded-2xl border border-border p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`size-4 ${i < review.rating ? "fill-accent text-accent" : "text-muted-foreground"}`}
                      />
                    ))}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                    review.status === "approved" ? "bg-green-100 text-green-700"
                    : review.status === "rejected" ? "bg-red-100 text-red-700"
                    : "bg-yellow-100 text-yellow-700"
                  }`}>
                    {review.status}
                  </span>
                  {review.verified_purchase && (
                    <span className="text-xs text-muted-foreground">✓ Verified</span>
                  )}
                </div>
                {review.products && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Product: <span className="font-semibold">{review.products.name}</span>
                  </p>
                )}
                {review.title && <p className="mt-2 text-sm font-semibold">{review.title}</p>}
                <p className="mt-1 text-sm text-muted-foreground">{review.comment}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(review.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex gap-2">
                {review.status !== "approved" && (
                  <button
                    onClick={() => updateStatus.mutate({ id: review.id, status: "approved" })}
                    className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                  >
                    Approve
                  </button>
                )}
                {review.status !== "rejected" && (
                  <button
                    onClick={() => updateStatus.mutate({ id: review.id, status: "rejected" })}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
                  >
                    Reject
                  </button>
                )}
                <button
                  onClick={() => deleteReview.mutate(review.id)}
                  className="rounded-full border border-destructive px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
