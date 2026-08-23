//
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
  Star,
  Printer,
  Scan,
  Megaphone,
  MessageSquare,
  Search,
  Sun,
  Bell,
  X,
} from "lucide-react";
import logo from "@/assets/zerah-logo.png";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIsAdmin, useSession } from "@/lib/auth";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { useAllOrders, useCustomers, orderStatuses } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { HeroMediaManager } from "@/components/admin/HeroMediaManager";
import { MediaLibrary } from "@/components/admin/MediaLibrary";
import { useAllCoupons, useCreateCoupon, useDeleteCoupon, useToggleCoupon } from "@/lib/coupons";
import { useAllReviews, useUpdateReviewStatus, useDeleteReview } from "@/lib/reviews";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { BillingCenterTab } from "@/components/admin/BillingCenterTab";
import { SMSLogsTab } from "@/components/admin/SMSLogsTab";
import { DashboardTab } from "@/components/admin/DashboardTab";
import { OnlineSalesTab } from "@/components/admin/OnlineSalesTab";
import { BarChart3, Settings2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Store Admin — Zerah Baby And Kid's" },
      {
        name: "description",
        content: "Manage products, categories and store settings for Zerah Baby And Kid's.",
      },
      { property: "og:title", content: "Store Admin — Zerah Baby And Kid's" },
      { property: "og:description", content: "Manage the Zerah Baby And Kid's catalogue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Tab =
  | "dashboard"
  | "billing"
  | "products"
  | "hero"
  | "media"
  | "orders"
  | "customers"
  | "categories"
  | "settings"
  | "admins"
  | "coupons"
  | "reviews"
  | "inventory"
  | "analytics"
  | "marketing"
  | "sms";

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: isAdmin, isLoading: roleLoading, refetch: refetchRole } = useIsAdmin(user?.id);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu on ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Global hardware barcode scanner logic
  useEffect(() => {
    let buffer = "";
    let lastTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      // If we are already on the POS (billing) tab, let POSTab handle it to avoid duplicate triggers
      if (tab === "billing") return;

      const target = e.target as HTMLElement;
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      const now = Date.now();
      // Reset buffer if keystrokes are slow (human typing is usually > 50ms per key)
      if (now - lastTime > 60) {
        buffer = "";
      }
      lastTime = now;

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }

      if (e.key === "Enter" && buffer.trim().length >= 6) {
        // Most barcodes are > 6 chars
        e.preventDefault();
        const code = buffer.trim();
        buffer = "";

        // If typed into an input accidentally, clear the input so the barcode string isn't left behind
        if (isInput && target instanceof HTMLInputElement) {
          target.value = "";
          target.blur();
        }

        // Pass it to the POS system globally and switch tab
        (window as any).__PENDING_BARCODE = code;
        setTab("billing");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tab]);

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

  // Real data for Orders badge
  const { data: onlineOrders = [] } = useAllOrders(true);
  const { data: posSales = [] } = useQuery({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (q: string) => Promise<{
              data: Array<{ created_at: string } & Record<string, unknown>> | null;
              error: unknown;
            }>;
          };
        }
      )
        .from("offline_sales")
        .select("*");
      if (error) return [];
      return (data ?? []) as Array<{ created_at: string } & Record<string, unknown>>;
    },
  });

  const [lastViewedOrdersTime, setLastViewedOrdersTime] = useState<number>(() => {
    return parseInt(localStorage.getItem("admin_last_viewed_orders") || "0", 10);
  });

  useEffect(() => {
    if (tab === "orders" || tab === "billing") {
      const now = Date.now();
      setLastViewedOrdersTime(now);
      localStorage.setItem("admin_last_viewed_orders", now.toString());
    }
  }, [tab]);

  const unseenOrdersCount = useMemo(() => {
    const newOnline = onlineOrders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t > lastViewedOrdersTime && (o.status === "placed" || o.status === "pending");
    }).length;
    const newOffline = posSales.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t > lastViewedOrdersTime;
    }).length;
    return newOnline + newOffline;
  }, [onlineOrders, posSales, lastViewedOrdersTime]);

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

  const NAVIGATION = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "billing", label: "Print & Billing", icon: Settings2 },
    {
      key: "orders",
      label: "Orders",
      icon: ShoppingBag,
      badge: unseenOrdersCount > 0 ? unseenOrdersCount.toString() : undefined,
    },
    { key: "products", label: "Products", icon: Package },
    { key: "categories", label: "Categories", icon: Layers },
    { key: "customers", label: "Customers", icon: Users },
    { key: "inventory", label: "Inventory", icon: Layers },
    { key: "coupons", label: "Coupons", icon: Tag },
    { key: "reviews", label: "Reviews", icon: Star },
    { key: "hero", label: "Hero Media", icon: Images },
    { key: "media", label: "Media Library", icon: FolderOpen },
    { key: "analytics", label: "Analytics", icon: BarChart3 },
    { key: "sms", label: "SMS Logs", icon: MessageSquare },
    { key: "marketing", label: "Marketing", icon: Megaphone },
    { key: "settings", label: "Settings", icon: Settings },
    { key: "admins", label: "Admins", icon: Shield },
  ];

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#f8fafc] text-slate-800 antialiased selection:bg-primary/20">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[240px] flex flex-col border-r border-gray-100 bg-white transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <img
              src={logo}
              alt="Zerah"
              className="h-10 w-10 rounded-full object-cover shadow-sm border border-gray-100"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0";
              }}
            />
            <div>
              <h1 className="font-sans text-[15px] font-black tracking-tight text-gray-900 leading-none">
                Zérah <span className="text-[#8B2020]">Admin</span>
              </h1>
              <p className="text-[10px] text-gray-400 truncate max-w-[140px] mt-0.5">
                {user?.email || "store@zerahbaby.com"}
              </p>
            </div>
          </div>
          <button
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAVIGATION.map(({ key, label, icon: Icon, badge }) => {
            const isActive = tab === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setTab(key as Tab);
                  setIsMobileMenuOpen(false);
                }}
                className={`group flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all duration-200 ${
                  isActive
                    ? "bg-[#8B2020] text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      isActive ? "text-white" : "text-gray-400 group-hover:text-gray-600"
                    }`}
                  />
                  <span className="truncate">{label}</span>
                </div>

                {badge && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#e11d48] px-1 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="flex flex-col gap-2 border-t border-gray-100 p-3 bg-white">
          <Link
            to="/"
            className="group flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50"
          >
            <Store className="h-4 w-4 text-gray-400 group-hover:text-gray-700" />
            View Store
          </Link>
          <button
            onClick={signOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:bg-red-50 hover:text-red-700 hover:border-red-200"
          >
            <LogOut className="h-4 w-4 text-gray-400 group-hover:text-red-500" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col h-[100dvh] overflow-hidden relative">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-3.5 shadow-xs">
          {/* Left: Title & Subtitle */}
          <div className="flex items-center gap-3">
            <button
              className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 lg:hidden"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" x2="21" y1="6" y2="6" />
                <line x1="3" x2="21" y1="12" y2="12" />
                <line x1="3" x2="21" y1="18" y2="18" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-gray-900 tracking-tight capitalize">
                {NAVIGATION.find((t) => t.key === tab)?.label || "Dashboard"}
              </h1>
              <p className="text-[11px] text-gray-400 font-medium">
                {tab === "dashboard"
                  ? "Overview of your store performance"
                  : `Manage ${tab} and settings`}
              </p>
            </div>
          </div>
          {/* Right: Search, Theme, Notifications, User Profile */}
          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative hidden sm:block w-56 md:w-64">
              <input
                type="text"
                placeholder="Search anything..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-8 pr-14 py-1.5 text-xs text-gray-800 outline-none focus:border-[#8B2020]/30 focus:bg-white focus:ring-2 focus:ring-[#8B2020]/10 transition-all"
              />
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <kbd className="absolute right-2.5 top-1.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-gray-400">
                Ctrl K
              </kbd>
            </div>

            {/* Sun / Light mode indicator */}
            <button
              aria-label="Toggle theme"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-amber-400 hover:bg-amber-50 transition"
            >
              <Sun className="h-4 w-4" />
            </button>

            {/* Notifications with badge */}
            <button
              aria-label="Notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#e11d48] text-[9px] font-bold text-white">
                8
              </span>
            </button>

            {/* User Profile Pill */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-gray-200">
              {/* Monogram avatar — no external image */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8B2020] to-[#c0392b] text-white font-black text-[11px] shadow-sm select-none">
                SM
              </div>
              <div className="hidden md:block text-left leading-tight">
                <p className="text-xs font-bold text-gray-900">Sameer Mirza</p>
                <p className="text-[10px] font-medium text-gray-400">Administrator</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-[1600px]">
            {tab === "dashboard" && <DashboardTab onNavigate={setTab as (tab: string) => void} />}
            {tab === "billing" && <BillingCenterTab />}
            {tab === "products" && <ProductsTab />}
            {tab === "hero" && <HeroMediaManager />}
            {tab === "media" && <MediaLibrary />}
            {tab === "orders" && <OnlineSalesTab />}
            {tab === "customers" && <CustomersTab />}
            {tab === "categories" && <CategoriesTab />}
            {tab === "inventory" && <InventoryTab />}
            {tab === "analytics" && <SiteAnalyticsTab />}
            {tab === "marketing" && <MarketingTab />}
            {tab === "settings" && <SettingsTab />}
            {tab === "sms" && <SMSLogsTab />}
            {tab === "admins" && <AdminsTab currentEmail={user?.email ?? ""} />}
            {tab === "coupons" && <CouponsTab />}
            {tab === "reviews" && <ReviewsTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------------- Products ---------------- */

function ProductsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [printingLabels, setPrintingLabels] = useState(false);
  const [printingSingle, setPrintingSingle] = useState<Product | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const [productsRes, costsRes] = await Promise.all([
        supabase.from("products").select("*").order("sort_order"),
        supabase.from("product_costs").select("product_id, buying_price"),
      ]);

      if (productsRes.error) throw productsRes.error;

      const costMap = new Map((costsRes.data || []).map((c) => [c.product_id, c.buying_price]));

      return (productsRes.data as never[]).map((r: any) => {
        const prod = mapProduct(r as never);
        prod.buyingPrice = costMap.get(prod.uuid) || 0;
        return prod;
      });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const save = useMutation({
    mutationFn: async ({ draft, uuid }: { draft: ProductDraft; uuid?: string }) => {
      const row: Record<string, unknown> = {
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
        low_stock_at: Number(draft.lowStockAt),
        sku: draft.sku.trim(),
        barcode: draft.barcode.trim(),
        description: draft.description,
        highlights: draft.highlights
          .split("\n")
          .map((h) => h.trim())
          .filter(Boolean),
        is_featured: draft.isFeatured,
        is_active: draft.isActive,
        sort_order: Number(draft.sortOrder),
      };

      const hasStockChanged = uuid ? Number(draft.stock) !== editing?.stock : true;
      if (hasStockChanged) {
        row.stock = Number(draft.stock);
      }

      // Save product
      let productId = uuid;
      if (uuid) {
        const { error } = await supabase
          .from("products")
          .update(row as any)
          .eq("id", uuid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(row as any)
          .select("id")
          .single();
        if (error) throw error;
        productId = data.id;
      }

      // Save cost
      if (productId) {
        const { error: costError } = await supabase
          .from("product_costs")
          .upsert({ product_id: productId, buying_price: draft.buyingPrice });
        if (costError) throw costError;
      }
    },
    onSuccess: () => {
      toast.success("Product saved");
      setEditing(null);
      setCreating(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Archive (set is_active=false) instead of hard-delete
  const archive = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").update({ is_active: false }).eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product archived (hidden from store)");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Hard-delete â€” will fail server-side if product has transactions
  const remove = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").delete().eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product permanently deleted");
      invalidate();
    },
    onError: (e: Error) => {
      // Server-side trigger prevents deletion of products with transactions
      if (e.message.includes("historical transactions")) {
        toast.error("Cannot delete â€” product has sales history. Archiving instead.", {
          duration: 5000,
        });
      } else {
        toast.error(e.message);
      }
    },
  });

  // Restore archived product
  const restore = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").update({ is_active: true }).eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product restored and visible in store");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(
    () =>
      (data ?? []).filter((p) =>
        (p.name + p.brand + p.category + p.id + p.sku + p.barcode)
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [data, search],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, SKU, barcodeâ€¦"
            aria-label="Search products"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 pl-9 text-sm text-gray-800 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
          />
          <span className="absolute left-3 top-2.5 text-gray-400 text-sm">ðŸ”</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPrintingLabels(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
          >
            <Printer className="size-4 text-gray-500" /> Print Labels
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a1c1c]"
          >
            <Plus className="size-4" /> Add product
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">SKU / Barcode</th>
                <th className="px-5 py-4">Pricing & Profit</th>
                <th className="px-5 py-4">Stock</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((p) => (
                <tr
                  key={p.uuid}
                  className={`group transition-colors hover:bg-gray-50/50 ${!p.isActive ? "opacity-60" : ""}`}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-4">
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        width={48}
                        height={48}
                        className="size-12 shrink-0 rounded-xl border border-gray-100 object-cover shadow-sm transition-transform group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0";
                        }}
                      />
                      <div>
                        <p className="font-semibold text-gray-900">{p.name}</p>
                        <p className="text-xs font-medium text-gray-500 mt-0.5">
                          {p.brand} <span className="opacity-50">â€¢</span> {p.id}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-mono text-xs font-semibold text-gray-900">{p.sku}</p>
                    <p className="font-mono text-[10px] text-gray-500 mt-0.5">{p.barcode}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-between min-w-[120px]">
                      <div>
                        <p className="font-semibold text-gray-900" title="Selling Price">
                          {formatPrice(p.price)}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5" title="Buying Price">
                          Cost: {formatPrice(p.buyingPrice || 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xs font-bold ${p.price - (p.buyingPrice || 0) < 0 ? "text-destructive" : "text-emerald-600"}`}
                        >
                          {formatPrice(Math.abs(p.price - (p.buyingPrice || 0)))}
                        </p>
                        <p
                          className={`text-[10px] font-medium ${p.price - (p.buyingPrice || 0) < 0 ? "text-destructive" : "text-emerald-500"}`}
                        >
                          {p.buyingPrice
                            ? (((p.price - p.buyingPrice) / p.buyingPrice) * 100).toFixed(1)
                            : p.price > 0
                              ? "100.0"
                              : "0.0"}
                          %
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        p.stock === 0
                          ? "bg-red-50 text-red-600 border border-red-100"
                          : p.stock <= p.lowStockAt
                            ? "bg-amber-50 text-amber-600 border border-amber-100"
                            : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      }`}
                    >
                      {p.stock === 0 ? "Out of stock" : `${p.stock} left`}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                        p.isActive
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-gray-100 text-gray-700 border border-gray-200"
                      }`}
                    >
                      {p.isActive ? "Live" : "Archived"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={() => setPrintingSingle(p)}
                        aria-label={`Print label for ${p.name}`}
                        title="Print Label"
                        className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-all hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50"
                      >
                        <Printer className="size-4" />
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        aria-label={`Edit ${p.name}`}
                        title="Edit"
                        className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-all hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {!p.isActive ? (
                        <button
                          onClick={() => restore.mutate(p.uuid)}
                          aria-label={`Restore ${p.name}`}
                          title="Restore to store"
                          className="rounded-lg border border-emerald-200 bg-white p-2 text-emerald-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50"
                        >
                          <Package className="size-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                `Archive "${p.name}"? It will be hidden from the store but kept in records.`,
                              )
                            )
                              archive.mutate(p.uuid);
                          }}
                          aria-label={`Archive ${p.name}`}
                          title="Archive (hide from store)"
                          className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-all hover:border-amber-200 hover:text-amber-700 hover:bg-amber-50"
                        >
                          <Package className="size-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Permanently delete "${p.name}"? This cannot be undone.\n\nNote: Products with sales history cannot be deleted.`,
                            )
                          )
                            remove.mutate(p.uuid);
                        }}
                        aria-label={`Delete ${p.name}`}
                        title="Delete permanently"
                        className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-all hover:border-red-200 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                  >
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

      {printingLabels && (
        <PrintLabelsModal products={data ?? []} onClose={() => setPrintingLabels(false)} />
      )}

      {printingSingle && (
        <PrintLabelsModal products={[printingSingle]} onClose={() => setPrintingSingle(null)} />
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
    "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm placeholder:text-gray-400";

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

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">Add a category</h2>
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
    "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm placeholder:text-gray-400";

  return (
    <div className="grid items-center gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:grid-cols-[64px_1fr_1fr_1fr_80px_auto] transition-all hover:border-gray-200">
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
          : "Added to the admin list â€” they become admin the next time they sign in",
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
            {grant.isPending ? "Addingâ€¦" : "Make admin"}
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
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
          <tr>
            <th className="px-5 py-4">Customer</th>
            <th className="px-5 py-4">Contact</th>
            <th className="px-5 py-4">Joined</th>
            <th className="px-5 py-4 text-right">Orders</th>
            <th className="px-5 py-4 text-right">Spend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(customers ?? []).map((c) => {
            const s = stats.get(c.id) ?? { count: 0, spend: 0 };
            return (
              <tr key={c.id} className="group transition-colors hover:bg-gray-50/50 align-top">
                <td className="px-5 py-4">
                  <span className="font-semibold text-gray-900">{c.full_name || "â€”"}</span>
                  <span className="block max-w-xs text-xs text-gray-500 mt-1 whitespace-normal">
                    {c.address}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-gray-900 font-medium">{c.email}</span>
                  <span className="block text-xs text-gray-500 mt-1">{c.phone}</span>
                </td>
                <td className="px-5 py-4 text-xs text-gray-500 font-medium">
                  {new Date(c.created_at).toLocaleDateString("en-IN")}
                </td>
                <td className="px-5 py-4 text-right font-medium text-gray-700">{s.count}</td>
                <td className="px-5 py-4 text-right font-semibold text-gray-900">
                  {formatPrice(s.spend)}
                </td>
              </tr>
            );
          })}
          {!isLoading && (customers ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-16 text-center text-sm font-medium text-gray-500">
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{(coupons ?? []).length} coupon(s)</p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a1c1c]"
        >
          <Plus className="size-4" /> Add coupon
        </button>
      </div>

      {showForm && (
        <form
          className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
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
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-gray-900">
              Code
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-gray-900">
              Type
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm({ ...form, discount_type: e.target.value as "percentage" | "fixed" })
                }
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-gray-900">
              Value
              <input
                type="number"
                required
                min={1}
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-gray-900">
              Min order value (â‚¹)
              <input
                type="number"
                min={0}
                value={form.minimum_order_value}
                onChange={(e) => setForm({ ...form, minimum_order_value: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-gray-900">
              Max discount (â‚¹, 0=unlimited)
              <input
                type="number"
                min={0}
                value={form.maximum_discount}
                onChange={(e) => setForm({ ...form, maximum_discount: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-gray-900">
              Usage limit (0=unlimited)
              <input
                type="number"
                min={0}
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={createCoupon.isPending}
              className="rounded-xl bg-[#8B2020] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a1c1c] disabled:opacity-50"
            >
              {createCoupon.isPending ? "Creatingâ€¦" : "Create coupon"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-5 py-4">Code</th>
              <th className="px-5 py-4">Discount</th>
              <th className="px-5 py-4">Min order</th>
              <th className="px-5 py-4">Used</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(coupons ?? []).map((c) => (
              <tr key={c.id} className="group transition-colors hover:bg-gray-50/50">
                <td className="px-5 py-4 font-mono font-bold text-gray-900">{c.code}</td>
                <td className="px-5 py-4 font-medium text-gray-700">
                  {c.discount_type === "percentage"
                    ? `${c.discount_value}%`
                    : `â‚¹${c.discount_value}`}
                  {c.maximum_discount > 0 && (
                    <span className="text-xs text-gray-500 ml-1">
                      (max â‚¹{c.maximum_discount})
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-gray-700">â‚¹{c.minimum_order_value}</td>
                <td className="px-5 py-4 font-medium text-gray-700">
                  {c.usage_count}
                  {c.usage_limit > 0 ? <span className="text-gray-400">/{c.usage_limit}</span> : ""}
                </td>
                <td className="px-5 py-4">
                  <button
                    onClick={() => toggleCoupon.mutate({ id: c.id, active: !c.active })}
                    className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${c.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100" : "bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200"}`}
                  >
                    {c.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-5 py-4 text-right">
                  <button
                    onClick={() => deleteCoupon.mutate(c.id)}
                    className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-all hover:border-red-200 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && (coupons ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-16 text-center text-sm font-medium text-gray-500"
                >
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading reviewsâ€¦</p>}

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
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      review.status === "approved"
                        ? "bg-green-100 text-green-700"
                        : review.status === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {review.status}
                  </span>
                  {review.verified_purchase && (
                    <span className="text-xs text-muted-foreground">âœ“ Verified</span>
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

/* ---------------- Inventory ---------------- */
function InventoryTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["inventory-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, slug, name, brand, category, stock, low_stock_at, sku, is_active")
        .order("stock", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const updateStock = useMutation({
    mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
      const { error } = await supabase.from("products").update({ stock }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock updated");
      qc.invalidateQueries({ queryKey: ["inventory-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalSKUs = products.length;
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= p.low_stock_at).length;
  const outOfStock = products.filter((p) => p.stock === 0).length;

  const filtered = products.filter((p) => {
    if (filter === "low") return p.stock > 0 && p.stock <= p.low_stock_at;
    if (filter === "out") return p.stock === 0;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total SKUs</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">{totalSKUs}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Low Stock</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-amber-600">{lowStock}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Out of Stock
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-red-600">{outOfStock}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {(["all", "low", "out"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-xl border px-4 py-2 text-xs font-semibold capitalize transition-all ${
              filter === f
                ? "border-[#8B2020] bg-red-50 text-[#8B2020] shadow-sm"
                : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            {f === "low" ? "Low Stock" : f === "out" ? "Out of Stock" : "All"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/50 text-xs uppercase text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-semibold tracking-wider">Product</th>
                <th className="px-6 py-4 font-semibold tracking-wider">SKU</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Category</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Stock</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Threshold</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                    No products found.
                  </td>
                </tr>
              ) : (
                filtered.map((product) => (
                  <InventoryRow
                    key={product.id}
                    product={product}
                    onSave={(val) => updateStock.mutate({ id: product.id, stock: val })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InventoryRow({ product, onSave }: { product: any; onSave: (val: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(product.stock);

  const isOut = product.stock === 0;
  const isLow = product.stock > 0 && product.stock <= product.low_stock_at;

  return (
    <tr className="hover:bg-gray-50/50 transition-colors">
      <td className="px-6 py-4">
        <div className="font-semibold text-gray-900">{product.name}</div>
        <div className="text-xs text-gray-400">{product.brand}</div>
      </td>
      <td className="px-6 py-4 font-mono text-xs text-gray-500">{product.sku}</td>
      <td className="px-6 py-4 text-gray-500">{product.category}</td>
      <td className="px-6 py-4">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={val}
              onChange={(e) => setVal(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSave(val);
                  setEditing(false);
                }
              }}
              autoFocus
              className="w-16 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-[#8B2020] focus:ring-1 focus:ring-[#8B2020]"
            />
            <button
              onClick={() => {
                onSave(val);
                setEditing(false);
              }}
              className="rounded bg-gray-100 p-1 text-green-600 hover:bg-green-100"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={`font-semibold hover:underline ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-gray-900"}`}
          >
            {product.stock}
          </button>
        )}
      </td>
      <td className="px-6 py-4 text-gray-500">{product.low_stock_at}</td>
      <td className="px-6 py-4">
        {isOut ? (
          <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-1 text-[10px] font-bold tracking-wider text-red-600 uppercase">
            Out of stock
          </span>
        ) : isLow ? (
          <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] font-bold tracking-wider text-amber-600 uppercase">
            Low stock
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-green-50 border border-green-200 px-2 py-1 text-[10px] font-bold tracking-wider text-green-600 uppercase">
            In stock
          </span>
        )}
      </td>
    </tr>
  );
}

/* ---------------- Site Analytics ---------------- */
function SiteAnalyticsTab() {
  const { data: visitors = [], isLoading } = useQuery({
    queryKey: ["visitor-analytics"],
    queryFn: async () => {
      const { data, error, count } = await (supabase as any)
        .from("website_visitors")
        .select("id, session_id, country, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return Object.assign(data, { count: count || data.length });
    },
    staleTime: 60_000,
  });

  const totalCount = (visitors as any).count ?? 0;
  const lastVisit = visitors[0]
    ? new Date(visitors[0].created_at).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Total Visitors
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">{totalCount}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Last Visit</p>
          <p className="mt-2 text-xl font-bold tracking-tight text-gray-700">{lastVisit}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/50 text-xs uppercase text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-semibold tracking-wider">Session</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Country</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Visited At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : visitors.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-400">
                    No visitor data recorded yet.
                  </td>
                </tr>
              ) : (
                visitors.map((v: any) => (
                  <tr key={v.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs">{v.session_id.slice(0, 8)}…</td>
                    <td className="px-6 py-4">{v.country}</td>
                    <td className="px-6 py-4">
                      {new Date(v.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Marketing ---------------- */
function MarketingTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    announcement: "",
    instagram_url: "",
    facebook_url: "",
    whatsapp_url: "",
  });

  const { isLoading } = useQuery({
    queryKey: ["site_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("key, value");
      if (error) throw error;
      const map = Object.fromEntries(data.map((d: any) => [d.key, d.value]));
      setForm((prev) => ({
        ...prev,
        announcement: map.announcement ?? "",
        instagram_url: map.instagram_url ?? "",
        facebook_url: map.facebook_url ?? "",
        whatsapp_url: map.whatsapp_url ?? "",
      }));
      return map;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const promises = Object.entries(form).map(([key, value]) =>
        supabase.from("site_settings").upsert({ key, value }),
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      toast.success("Marketing settings saved");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <form
        className="space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <h2 className="text-lg font-bold text-gray-900">Marketing & Links</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage your announcement bar and social media profiles.
          </p>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading settings...</div>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-gray-900">
              Announcement Bar
              <input
                value={form.announcement}
                onChange={(e) => setForm({ ...form, announcement: e.target.value })}
                placeholder="Free shipping on orders above ₹1499"
                className="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="block text-sm font-semibold text-gray-900">
              Instagram URL
              <input
                type="url"
                value={form.instagram_url}
                onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
                placeholder="https://instagram.com/zerahbaby"
                className="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="block text-sm font-semibold text-gray-900">
              Facebook URL
              <input
                type="url"
                value={form.facebook_url}
                onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
                placeholder="https://facebook.com/zerahbaby"
                className="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
            <label className="block text-sm font-semibold text-gray-900">
              WhatsApp URL
              <input
                type="url"
                value={form.whatsapp_url}
                onChange={(e) => setForm({ ...form, whatsapp_url: e.target.value })}
                placeholder="https://wa.me/91XXXXXXXXXX"
                className="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-gray-300 focus:ring-4 focus:ring-gray-50 transition-all shadow-sm"
              />
            </label>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-xl bg-[#8B2020] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#6b1818] disabled:opacity-50"
          >
            {save.isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
