//
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback, useRef, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LogOut,
  Plus,
  Minus,
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
  MessageSquareText,
  Search,
  Sun,
  Moon,
  Bell,
  AlertCircle,
  X,
  BarChart3,
  Settings2,
  CheckSquare,
  Square,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Archive,
  Check,
  MapPin,
  ExternalLink,
  Palette,
  Power,
  RotateCcw,
  Eye,
  Upload,
  Truck,
  FileText,
  Copy,
  Receipt,
} from "lucide-react";
import logo from "@/assets/zerah-logo-official.png";
import { BrandName } from "@/components/site/BrandName";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIsAdmin, useSession } from "@/lib/auth";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import { calculateStockValuation } from "@/lib/financial-reporting";
import type { ProductDraft } from "@/components/admin/ProductForm";
import { useSaveProduct } from "@/lib/admin-products";
import { useAllOrders, useCustomers, useProfile, orderStatuses } from "@/lib/orders";
import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import { InvoiceBox } from "@/components/site/Invoice";
import { useAllCoupons, useCreateCoupon, useDeleteCoupon, useToggleCoupon } from "@/lib/coupons";
import { useAllReviews, useUpdateReviewStatus, useDeleteReview } from "@/lib/reviews";
import { useDirectLabelPrint } from "@/lib/label-printer";
import { SmartSelectionSummary } from "@/components/admin/SmartSelectionSummary";
import {
  useTableSelection,
  getProductsSelectionMetrics,
  getCustomersSelectionMetrics,
  getCouponsSelectionMetrics,
} from "@/lib/table-selection";
import { safeLazy } from "@/lib/safe-lazy";
import {
  AdminDashboardSkeleton,
  POSTerminalSkeleton,
  AdminTableSkeleton,
} from "@/components/ui/Skeletons";
import {
  validateAndNormalizeInstagram,
  validateAndNormalizeFacebook,
  validateAndNormalizeWhatsApp,
  validateAndNormalizeAnnouncementLink,
} from "@/lib/marketing-links";

const HeroMediaManager = safeLazy(() =>
  import("@/components/admin/HeroMediaManager").then((m) => ({ default: m.HeroMediaManager })),
);
const MediaLibrary = safeLazy(() =>
  import("@/components/admin/MediaLibrary").then((m) => ({ default: m.MediaLibrary })),
);
const ProductForm = safeLazy(() =>
  import("@/components/admin/ProductForm").then((m) => ({ default: m.ProductForm })),
);
const PrintLabelsModal = safeLazy(() =>
  import("@/components/admin/PrintLabelsModal").then((m) => ({ default: m.PrintLabelsModal })),
);

import { BillingCenterTab } from "@/components/admin/BillingCenterTab";
const CategoriesTab = safeLazy(() =>
  import("@/components/admin/CategoriesManager").then((m) => ({ default: m.CategoriesTab })),
);
const SMSLogsTab = safeLazy(() =>
  import("@/components/admin/SMSLogsTab").then((m) => ({ default: m.SMSLogsTab })),
);
const QueriesTab = safeLazy(() =>
  import("@/components/admin/QueriesTab").then((m) => ({ default: m.QueriesTab })),
);
import { DashboardTab } from "@/components/admin/DashboardTab";
import { OnlineSalesTab } from "@/components/admin/OnlineSalesTab";
const OnlineReturnsTab = safeLazy(() =>
  import("@/components/admin/OnlineReturnsTab").then((m) => ({ default: m.OnlineReturnsTab })),
);
import { useAllOnlineReturns } from "@/lib/online-returns";
const AdminGlobalSearch = safeLazy(() =>
  import("@/components/admin/AdminGlobalSearch").then((m) => ({ default: m.AdminGlobalSearch })),
);
const BulkImportTab = safeLazy(() =>
  import("@/components/admin/BulkImportTab").then((m) => ({ default: m.BulkImportTab })),
);
const PagesPoliciesTab = safeLazy(() =>
  import("@/components/admin/PagesPoliciesTab").then((m) => ({ default: m.PagesPoliciesTab })),
);
const CustomerHistoryPanel = safeLazy(() =>
  import("@/components/admin/CustomerHistoryPanel").then((m) => ({
    default: m.CustomerHistoryPanel,
  })),
);
import { useTheme } from "@/lib/theme";
import { useAdminNotifications } from "@/lib/admin-notifications";
import { initGlobalBarcodeScanner, hasPendingScans } from "@/lib/barcode-scanner";

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
  | "returns"
  | "customers"
  | "categories"
  | "settings"
  | "admins"
  | "coupons"
  | "reviews"
  | "marketing"
  | "sms"
  | "queries"
  | "pages";

const VALID_TABS: Tab[] = [
  "dashboard",
  "billing",
  "products",
  "hero",
  "media",
  "orders",
  "returns",
  "customers",
  "categories",
  "settings",
  "admins",
  "coupons",
  "reviews",
  "marketing",
  "sms",
  "queries",
  "pages",
];

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: sessionLoading } = useSession();
  const {
    data: isAdmin,
    isLoading: roleLoading,
    isPending: rolePending,
    refetch: refetchRole,
  } = useIsAdmin(user?.id);
  const { data: profile } = useProfile(user?.id);

  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const searchTab = urlParams.get("tab") as Tab | null;
      if (searchTab && VALID_TABS.includes(searchTab)) return searchTab;

      const hash = window.location.hash.replace("#", "") as Tab;
      if (hash && VALID_TABS.includes(hash)) return hash;
    }
    // Default to Dashboard on /admin or /admin/
    return "dashboard";
  });

  const setTab = useCallback((newTab: Tab) => {
    setTabState(newTab);
    if (typeof window !== "undefined") {
      localStorage.setItem("zerah_admin_active_tab", newTab);
      const url = new URL(window.location.href);
      if (newTab === "dashboard") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", newTab);
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("zerah_admin_active_tab", tab);
      const url = new URL(window.location.href);
      const currentParam = url.searchParams.get("tab");
      if (tab === "dashboard" && !currentParam) {
        return;
      }
      if (currentParam !== tab) {
        if (tab === "dashboard") {
          url.searchParams.delete("tab");
        } else {
          url.searchParams.set("tab", tab);
        }
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [tab]);

  // Global hardware barcode scanner routing across the entire admin dashboard:
  // If a hardware barcode is scanned while on ANY admin view (dashboard, orders, products, etc.),
  // safely navigate to the "billing" tab (which routes to POS Terminal) and automatically add the scanned product.
  useEffect(() => {
    const unbind = initGlobalBarcodeScanner((_code) => {
      if (tab !== "billing") {
        setTab("billing");
      }
    });
    return unbind;
  }, [tab, setTab]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { theme, isDark, toggleTheme } = useTheme();
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
  } = useAdminNotifications();

  // Detect OS for shortcut badge
  const isMac = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  }, []);
  const shortcutLabel = isMac ? "⌘K" : "Ctrl K";

  // Dynamic admin name
  const adminName = "Sameer";

  // Global shortcut (Ctrl+K / Cmd+K) to toggle Search
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // Close notifications on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    if (isNotifOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isNotifOpen]);

  // Close mobile menu or notifications on ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMobileMenuOpen(false);
        setIsNotifOpen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Global hardware barcode scanner logic: instantly switches to POS from any admin page
  useEffect(() => {
    if (hasPendingScans() && tab !== "billing") {
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      setTab("billing");
    }

    const unbind = initGlobalBarcodeScanner((_code) => {
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      if (tab !== "billing") {
        setTab("billing");
      }
    });
    return unbind;
  }, [tab, setTab]);

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

  // Real data for Orders badge - Lightweight queries with staleTime
  const { data: onlineOrdersSummary = [] } = useQuery({
    queryKey: ["admin-orders-badge-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, status, payment_method, payment_status")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 1000 * 60 * 3, // 3 minutes cache
  });

  const { data: posSales = [] } = useQuery({
    queryKey: ["offline-sales-badge-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("created_at, status")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return data ?? [];
    },
    staleTime: 1000 * 60 * 3, // 3 minutes cache
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
    const newOnline = onlineOrdersSummary.filter((o) => {
      const t = new Date(o.created_at).getTime();
      const isPaidOrCod = o.payment_method?.toLowerCase() === "cod" || o.payment_status === "paid";
      return (
        t > lastViewedOrdersTime &&
        o.status !== "cancelled" &&
        isPaidOrCod &&
        (o.status === "placed" || o.status === "processing" || o.status === "pending")
      );
    }).length;
    const newOffline = posSales.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t > lastViewedOrdersTime && (o as { status?: string }).status !== "cancelled";
    }).length;
    return newOnline + newOffline;
  }, [onlineOrdersSummary, posSales, lastViewedOrdersTime]);

  const { data: newQueriesCount = 0 } = useQuery({
    queryKey: ["admin-new-queries-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 15_000,
  });

  const { data: adminOnlineReturns = [] } = useAllOnlineReturns(isAdmin ?? false);
  const pendingReturnsCount = useMemo(() => {
    return adminOnlineReturns.filter(
      (r) => r.return_status === "REQUESTED" || r.return_status === "QC_PENDING"
    ).length;
  }, [adminOnlineReturns]);

  if (sessionLoading || (user && isAdmin === undefined && (roleLoading || rolePending))) {
    return (
      <div className="flex h-screen bg-background overflow-hidden animate-pulse">
        {/* Sidebar skeleton */}
        <div className="hidden lg:flex w-64 flex-col border-r border-border/60 bg-card p-4 space-y-4 shrink-0">
          <div className="flex items-center gap-3 border-b border-border/60 pb-4">
            <div className="size-10 rounded-2xl bg-muted/70" />
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-28 rounded-md bg-muted/70" />
              <div className="h-3 w-16 rounded-md bg-muted/50" />
            </div>
          </div>
          <div className="space-y-2 pt-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 w-full rounded-xl bg-muted/40" />
            ))}
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="h-16 border-b border-border/60 bg-card px-6 flex items-center justify-between shrink-0">
            <div className="h-5 w-36 rounded-lg bg-muted/60" />
            <div className="flex gap-2">
              <div className="size-8 rounded-full bg-muted/60" />
              <div className="size-8 rounded-full bg-muted/60" />
            </div>
          </div>
          <div className="flex-1 p-6 overflow-y-auto">
            <AdminDashboardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
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

  const NAVIGATION: Array<{ key: Tab; label: string; icon: typeof BarChart3; badge?: string }> = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "billing", label: "Offline Billing", icon: Settings2 },
    {
      key: "orders",
      label: "Online Orders",
      icon: ShoppingBag,
      badge: unseenOrdersCount > 0 ? unseenOrdersCount.toString() : undefined,
    },
    {
      key: "returns",
      label: "Online Returns",
      icon: RotateCcw,
      badge: pendingReturnsCount > 0 ? pendingReturnsCount.toString() : undefined,
    },
    { key: "products", label: "Products", icon: Package },
    { key: "categories", label: "Categories", icon: Layers },
    { key: "customers", label: "Customers", icon: Users },
    { key: "coupons", label: "Coupons", icon: Tag },
    { key: "reviews", label: "Reviews", icon: Star },
    { key: "hero", label: "Hero Media", icon: Images },
    { key: "media", label: "Media Library", icon: FolderOpen },
    { key: "sms", label: "SMS Logs", icon: MessageSquare },
    {
      key: "queries",
      label: "Queries",
      icon: MessageSquareText,
      badge: newQueriesCount > 0 ? newQueriesCount.toString() : undefined,
    },
    { key: "marketing", label: "Marketing", icon: Megaphone },
    { key: "pages", label: "Pages & Policies", icon: FileText },
    { key: "settings", label: "Settings", icon: Settings },
    { key: "admins", label: "Admins", icon: Shield },
  ];

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground antialiased selection:bg-primary/20">
      {/* ─── GLOBAL COMMAND PALETTE SEARCH MODAL ─────────────── */}
      <AdminGlobalSearch
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={(targetTab) => setTab(targetTab as Tab)}
      />
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-border bg-card/60 backdrop-blur-md lg:flex">
        {/* Brand Header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <Link
            to="/"
            className="flex items-center gap-3 hover:opacity-80 transition cursor-pointer group"
            title="Go to Zérah Baby & Kids Home"
          >
            <img
              loading="lazy"
              decoding="async"
              src={logo}
              alt="Zérah Baby & Kids"
              className="size-9 object-contain drop-shadow-sm group-hover:scale-105 transition-transform"
            />
            <BrandName size="sm" />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAVIGATION.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-xs font-bold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 transition-transform ${active ? "scale-110" : "group-hover:scale-110"}`}
                />
                <span className="flex-1 text-left">{item.label}</span>
                {item.key === "orders" && unreadCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                      active ? "bg-card text-primary" : "bg-rose-500 text-white"
                    }`}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom user action */}
        <div className="border-t border-border p-3">
          <Link
            to="/"
            className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            <Store className="h-4 w-4" />
            <span>View live store</span>
          </Link>
          <button
            onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/" }))}
            className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-destructive hover:bg-destructive/10 transition"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="relative flex w-72 flex-col bg-card border-r border-border p-4 shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <Link
                to="/"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center gap-2.5 hover:opacity-80 transition cursor-pointer"
                title="Go to Zérah Baby & Kids Home"
              >
                <img
                  loading="lazy"
                  decoding="async"
                  src={logo}
                  alt="Zérah Baby & Kids"
                  className="h-8 w-auto object-contain drop-shadow-sm"
                />
                <BrandName size="sm" />
              </Link>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-xl p-1.5 text-muted-foreground hover:bg-muted transition"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-4 flex-1 overflow-y-auto space-y-1">
              {NAVIGATION.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setTab(item.key);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-border pt-4 space-y-1">
              <Link
                to="/"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted"
              >
                <Store className="h-4 w-4" />
                <span>View live store</span>
              </Link>
              <button
                onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/" }))}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Navbar with explicit z-30 stacking context */}
        <header className="relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted lg:hidden cursor-pointer"
              aria-label="Open sidebar menu"
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
              <h1 className="text-xl font-extrabold text-foreground tracking-tight capitalize">
                {NAVIGATION.find((t) => t.key === tab)?.label || "Dashboard"}
              </h1>
              <p className="text-[11px] text-muted-foreground font-medium">
                {tab === "dashboard"
                  ? "Overview of your store performance"
                  : tab === "orders"
                    ? "Manage online store orders, shipping, and fulfillment"
                    : tab === "billing"
                      ? "POS billing, receipt generation, and offline sales"
                      : `Manage ${tab} and settings`}
              </p>
            </div>
          </div>

          {/* Right: Functional Search, Theme Toggle, Notification Bell, User Monogram */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Mobile Search Button */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              aria-label="Global search"
              className="flex h-8 w-8 sm:hidden items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted transition cursor-pointer"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Desktop Search Input Trigger */}
            <div
              onClick={() => setIsSearchOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsSearchOpen(true);
                }
              }}
              aria-label="Global search (Ctrl+K or Cmd+K)"
              className="relative hidden sm:flex items-center w-56 md:w-64 rounded-xl border border-border bg-muted/40 pl-8 pr-14 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:bg-card cursor-pointer transition-all shadow-xs"
            >
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">Search anything…</span>
              <kbd className="absolute right-2 top-1.5 rounded border border-border bg-card px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-xs">
                {shortcutLabel}
              </kbd>
            </div>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Toggle theme: currently ${isDark ? "Dark" : "Light"}`}
              title={`Switch to ${isDark ? "Light" : "Dark"} mode`}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted transition shadow-xs cursor-pointer"
            >
              {isDark ? (
                <Moon className="h-4 w-4 text-indigo-400" />
              ) : (
                <Sun className="h-4 w-4 text-amber-500" />
              )}
            </button>

            {/* Notification Bell with Live Dynamic Count & Dropdown */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setIsNotifOpen((prev) => !prev)}
                aria-label={`Notifications (${unreadCount} unread)`}
                title="Notifications"
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground hover:bg-muted transition shadow-xs cursor-pointer ${
                  isNotifOpen ? "ring-2 ring-primary/20 border-primary" : ""
                }`}
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-600 text-[9px] font-extrabold text-white shadow-xs animate-in zoom-in">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown Popover */}
              {isNotifOpen && (
                <div
                  role="region"
                  aria-label="Notification Center"
                  className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-11 z-50 sm:w-[400px] max-w-[420px] overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-150"
                >
                  <div className="flex items-center justify-between border-b border-border p-4 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-foreground">Notifications</h4>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                          {unreadCount} unread
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                        >
                          Mark read
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          onClick={clearAllNotifications}
                          className="text-xs font-semibold text-rose-500 hover:text-rose-600 hover:underline cursor-pointer flex items-center gap-1"
                          title="Clear all notifications"
                        >
                          <Trash2 className="size-3" /> Clear all
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-[min(440px,calc(100vh-140px))] overflow-y-auto p-2 divide-y divide-border/30">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center">
                        <Bell className="mx-auto size-6 text-muted-foreground/40" />
                        <p className="mt-2 text-xs font-semibold text-foreground">All caught up!</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          No recent alerts or pending order actions.
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {notifications.map((notif) => (
                          <li
                            key={notif.id}
                            className="group relative flex items-center gap-1 rounded-2xl transition hover:bg-muted/40 p-1"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                markAsRead(notif.id);
                                if (notif.tab === "billing" && notif.filter) {
                                  localStorage.setItem("zerah_admin_active_subtab", notif.filter);
                                  const url = new URL(window.location.href);
                                  url.searchParams.set("tab", "billing");
                                  url.searchParams.set("subtab", notif.filter);
                                  window.history.replaceState({}, "", url.toString());
                                } else if (notif.tab) {
                                  const url = new URL(window.location.href);
                                  url.searchParams.set("tab", notif.tab);
                                  if (notif.filter) {
                                    url.searchParams.set("status", notif.filter);
                                  }
                                  window.history.replaceState({}, "", url.toString());
                                }
                                setTab(notif.tab as Tab);
                                setIsNotifOpen(false);
                              }}
                              className={`flex flex-1 items-start gap-3 rounded-2xl p-2.5 text-left transition cursor-pointer ${
                                notif.read
                                  ? "opacity-60 hover:opacity-100"
                                  : "bg-muted/40 hover:bg-muted"
                              }`}
                            >
                              <div
                                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${
                                  notif.priority === "high"
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                                }`}
                              >
                                <AlertCircle className="size-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <p className="truncate text-xs font-bold text-foreground">
                                    {notif.title}
                                  </p>
                                  <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                                    {new Date(notif.timestamp).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 break-words">
                                  {notif.message}
                                </p>
                              </div>
                              {!notif.read && (
                                <span className="size-2 rounded-full bg-primary shrink-0 mt-1.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notif.id);
                              }}
                              title="Delete notification"
                              className="p-2 text-muted-foreground/50 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition cursor-pointer shrink-0"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Authenticated Admin Profile Brand Logo & Name */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-border">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-xs overflow-hidden select-none p-1">
                <img
                  loading="lazy"
                  decoding="async"
                  src={logo}
                  alt="Zerah Baby & Kids"
                  className="h-full w-auto object-contain"
                />
              </div>
              <div className="hidden md:block text-left leading-tight">
                <p className="text-xs font-bold text-foreground truncate max-w-32">{adminName}</p>
                <p className="text-[10px] font-medium text-muted-foreground">Administrator</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-[1600px]">
            <ComponentErrorBoundary
              fallbackTitle="Module Loading Exception"
              onReset={() => window.location.reload()}
            >
              <Suspense
                fallback={
                  tab === "dashboard" ? (
                    <AdminDashboardSkeleton />
                  ) : tab === "billing" ? (
                    <POSTerminalSkeleton />
                  ) : (
                    <AdminTableSkeleton />
                  )
                }
              >
                {tab === "dashboard" && (
                  <DashboardTab onNavigate={setTab as (tab: string) => void} />
                )}
                {tab === "billing" && <BillingCenterTab />}
                {tab === "products" && <ProductsTab />}
                {tab === "hero" && <HeroMediaManager />}
                {tab === "media" && <MediaLibrary />}
                {tab === "orders" && <OnlineSalesTab />}
                {tab === "returns" && <OnlineReturnsTab />}
                {tab === "customers" && <CustomersTab />}
                {tab === "categories" && <CategoriesTab />}
                {tab === "marketing" && <MarketingTab />}
                {tab === "pages" && <PagesPoliciesTab />}
                {tab === "settings" && <SettingsTab />}
                {tab === "sms" && <SMSLogsTab />}
                {tab === "queries" && <QueriesTab onOpenOrder={(_ord) => setTab("orders")} />}
                {tab === "admins" && <AdminsTab currentEmail={user?.email ?? ""} />}
                {tab === "coupons" && <CouponsTab />}
                {tab === "reviews" && <ReviewsTab />}
              </Suspense>
            </ComponentErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Products ---------------- */

function ProductsTab() {
  const qc = useQueryClient();
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [printingLabels, setPrintingLabels] = useState(false);
  const [channelTab, setChannelTab] = useState<
    "all" | "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY" | "archived"
  >("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "in_stock" | "low_stock" | "out_of_stock" | "archived"
  >("all");
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [stockVal, setStockVal] = useState<number>(0);
  const { printLabel, isPrinting } = useDirectLabelPrint();

  // Selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteAllConfirmInput, setDeleteAllConfirmInput] = useState("");

  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products"],
    staleTime: 1000 * 60 * 5, // 5 minutes caching for instant tab switching
    queryFn: async () => {
      const [productsRes, costsRes, settingsRes] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, slug, sku, barcode, price, mrp, stock, category, brand, is_active, sales_channel, sort_order, created_at, product_images(public_url, is_primary, sort_order)",
          )
          .order("sort_order"),
        Promise.resolve(supabase.from("product_costs").select("product_id, buying_price")).catch(
          () => ({ data: [] as { product_id: string; buying_price: number }[], error: null }),
        ),
        supabase
          .from("site_settings")
          .select("value")
          .eq("key", "product_delivery_fees")
          .maybeSingle(),
      ]);

      if (productsRes.error) throw productsRes.error;

      const costMap = new Map<string, number>(
        (
          (costsRes as { data?: { product_id: string; buying_price: number }[] | null })?.data || []
        ).map((c) => [c.product_id, Number(c.buying_price || 0)]),
      );
      let deliveryFees: Record<string, number> = {};
      if (settingsRes.data?.value) {
        try {
          deliveryFees = JSON.parse(settingsRes.data.value);
        } catch {
          deliveryFees = {};
        }
      }

      return (productsRes.data || []).map((r) => {
        const prod = mapProduct(r as never);
        prod.buyingPrice = Number(costMap.get(prod.uuid) ?? 0);
        if (deliveryFees[prod.uuid] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.uuid];
        } else if (deliveryFees[prod.id] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.id];
        }
        return prod;
      });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["inventory-products"] });
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["admin-search-products"] });
    qc.invalidateQueries({ queryKey: ["product-relations"] });
    qc.invalidateQueries({ queryKey: ["admin-products-count"] });
  };

  const updateStock = useMutation({
    mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
      const cleanStock = Math.max(0, stock);
      const { error: prodErr } = await supabase
        .from("products")
        .update({ stock: cleanStock })
        .eq("id", id);
      if (prodErr) throw prodErr;

      // Also atomically sync variant stock to prevent drift
      await (supabase as any)
        .from("product_variants")
        .update({ stock: cleanStock })
        .eq("product_id", id);
    },
    onSuccess: () => {
      toast.success("Stock updated successfully");
      setEditingStockId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDeliveryFeeQuick = useMutation({
    mutationFn: async ({ uuid, slug, fee }: { uuid: string; slug: string; fee: number }) => {
      const { data: currentSettings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle();
      let feeMap: Record<string, number> = {};
      if (currentSettings?.value) {
        try {
          feeMap = JSON.parse(currentSettings.value);
        } catch {
          feeMap = {};
        }
      }
      feeMap[uuid] = fee;
      feeMap[slug] = fee;
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
          { onConflict: "key" },
        );
      if (error) throw error;
    },
    onSuccess: (_, { fee }) => {
      toast.success(`Delivery fee updated to ${fee === 0 ? "Free (₹0)" : `₹${fee}`}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDeliveryFeeBulk = useMutation({
    mutationFn: async ({ ids, fee }: { ids: string[]; fee: number }) => {
      const { data: currentSettings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle();
      let feeMap: Record<string, number> = {};
      if (currentSettings?.value) {
        try {
          feeMap = JSON.parse(currentSettings.value);
        } catch {
          feeMap = {};
        }
      }
      ids.forEach((id) => {
        feeMap[id] = fee;
        const prod = (data || []).find((p) => p.uuid === id || p.id === id);
        if (prod) {
          feeMap[prod.uuid] = fee;
          feeMap[prod.id] = fee;
        }
      });
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
          { onConflict: "key" },
        );
      if (error) throw error;
    },
    onSuccess: (_, { fee }) => {
      toast.success(
        `Delivery fee set to ${fee === 0 ? "Free (₹0)" : `₹${fee}`} for selected products`,
      );
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProductMutation = useSaveProduct();
  const save = {
    isPending: saveProductMutation.isPending,
    mutate: (payload: { draft: ProductDraft; uuid?: string }) => {
      saveProductMutation.mutate(payload, {
        onSuccess: () => {
          setEditing(null);
          setCreating(false);
          invalidate();
        },
      });
    },
  };

  // Archive (set is_active=false)
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

  // Hard-delete single product
  const remove = useMutation({
    mutationFn: async (uuid: string) => {
      // Try atomic RPC first
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; deleted?: number; archived?: number } | null;
          error: unknown;
        }>
      )("admin_delete_products", {
        _product_ids: [uuid],
      });

      if (!rpcErr && rpcRes) {
        return rpcRes;
      }

      // Fallback
      const { error } = await supabase.from("products").delete().eq("id", uuid);
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      toast.success("Product deleted successfully");
      invalidate();
    },
    onError: (e: Error) => {
      if (e.message.includes("historical transactions")) {
        toast.error("Cannot delete — product has sales history. Archiving instead.", {
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

  // Batch delete selected products
  const deleteSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return { success: true, deleted: 0, archived: 0 };
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; deleted?: number; archived?: number } | null;
          error: unknown;
        }>
      )("admin_delete_products", {
        _product_ids: ids,
      });

      if (rpcErr) {
        // Fallback: delete client-side in chunks
        for (const id of ids) {
          await supabase.from("product_images").delete().eq("product_id", id);
          await supabase.from("product_costs").delete().eq("product_id", id);
          await supabase.from("products").delete().eq("id", id);
        }
        return { success: true, deleted: ids.length, archived: 0 };
      }
      return rpcRes;
    },
    onSuccess: (res: { deleted?: number; archived?: number } | null) => {
      const deleted = res?.deleted ?? selectedIds.size;
      const archived = res?.archived ?? 0;
      let msg = `Deleted ${deleted} product${deleted !== 1 ? "s" : ""}`;
      if (archived > 0) {
        msg += ` (${archived} archived due to sales history)`;
      }
      toast.success(msg);
      setSelectedIds(new Set());
      setShowDeleteSelectedModal(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(`Failed to delete selected products: ${e.message}`),
  });

  // Delete all products
  const deleteAll = useMutation({
    mutationFn: async () => {
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { deleted?: number; archived?: number; count?: number } | null;
          error: unknown;
        }>
      )("admin_delete_all_products", {
        _force: true,
      });

      if (rpcErr) {
        // Fallback: delete all in batches
        const allIds = (data ?? []).map((p) => p.uuid);
        for (const id of allIds) {
          await supabase.from("product_images").delete().eq("product_id", id);
          await supabase.from("product_costs").delete().eq("product_id", id);
          await supabase.from("products").delete().eq("id", id);
        }
        return { success: true, count: allIds.length, archived: 0 };
      }
      return rpcRes;
    },
    onSuccess: (res: { deleted?: number; count?: number } | null) => {
      const count = res?.deleted ?? data?.length ?? 0;
      toast.success(`All ${count} products deleted successfully`);
      setSelectedIds(new Set());
      setShowDeleteAllModal(false);
      setDeleteAllConfirmInput("");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Failed to delete all products: ${e.message}`),
  });

  // Batch Archive Selected
  const archiveSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ is_active: false }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Archived ${selectedIds.size} product(s)`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Batch Restore Selected
  const restoreSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ is_active: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Restored ${selectedIds.size} product(s) to store`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Batch Set Stock to 10
  const setStockTenSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ stock: 10 }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Set stock to 10 for ${selectedIds.size} product(s)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeProducts = useMemo(() => (data ?? []).filter((p) => p.isActive), [data]);
  const archivedProducts = useMemo(() => (data ?? []).filter((p) => !p.isActive), [data]);

  const activeCount = activeProducts.length;
  const archivedCount = archivedProducts.length;

  // Authoritative shared stock valuation
  const valuation = useMemo(() => {
    return calculateStockValuation(activeProducts);
  }, [activeProducts]);

  const totalStockUnits = valuation.totalUnits;
  const totalStockValue = valuation.retailValue;
  const totalStockCost = valuation.costValue;
  const inStockCount = valuation.inStockCount;
  const lowStockCount = valuation.lowStockCount;
  const outOfStockCount = valuation.outOfStockCount;
  const offlineOnlyCount = activeProducts.filter((p) => p.salesChannel === "OFFLINE_ONLY").length;
  const onlineAndOfflineCount = activeProducts.filter(
    (p) => p.salesChannel !== "OFFLINE_ONLY",
  ).length;

  const list = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    return (data ?? []).filter((p) => {
      const searchBlob = [p.name, p.brand, p.category, p.id, p.uuid, p.sku, p.barcode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !q || searchBlob.includes(q);
      const matchesCat = categoryFilter === "all" || p.category === categoryFilter;

      // When in "archived" tab, show ONLY archived products
      if (channelTab === "archived") {
        return matchesSearch && matchesCat && !p.isActive;
      }

      // In all other tabs ("all", "ONLINE_AND_OFFLINE", "OFFLINE_ONLY"), NEVER show archived products
      if (!p.isActive) return false;

      let matchesStatus = true;
      if (statusFilter === "in_stock") matchesStatus = (p.stock || 0) > 0;
      else if (statusFilter === "low_stock")
        matchesStatus = (p.stock || 0) > 0 && (p.stock || 0) <= (p.lowStockAt || 5);
      else if (statusFilter === "out_of_stock") matchesStatus = (p.stock || 0) === 0;

      const pChannel = p.salesChannel ?? "ONLINE_AND_OFFLINE";
      const matchesChannel =
        channelTab === "all"
          ? true
          : channelTab === "OFFLINE_ONLY"
            ? pChannel === "OFFLINE_ONLY"
            : pChannel !== "OFFLINE_ONLY";

      return matchesSearch && matchesCat && matchesStatus && matchesChannel;
    });
  }, [data, search, categoryFilter, statusFilter, channelTab]);

  // Handle header checkbox indeterminate state
  const isAllSelected = list.length > 0 && list.every((p) => selectedIds.has(p.uuid));
  const isSomeSelected = list.some((p) => selectedIds.has(p.uuid)) && !isAllSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSet = new Set(selectedIds);
      list.forEach((p) => newSet.add(p.uuid));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      list.forEach((p) => newSet.delete(p.uuid));
      setSelectedIds(newSet);
    }
  };

  const toggleSelectProduct = (uuid: string, e?: React.MouseEvent) => {
    const newSet = new Set(selectedIds);

    // Shift-click range selection
    if (e?.shiftKey && lastSelectedId && lastSelectedId !== uuid) {
      const currentIndex = list.findIndex((p) => p.uuid === uuid);
      const lastIndex = list.findIndex((p) => p.uuid === lastSelectedId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const shouldSelect = !selectedIds.has(uuid);

        for (let i = start; i <= end; i++) {
          if (shouldSelect) {
            newSet.add(list[i].uuid);
          } else {
            newSet.delete(list[i].uuid);
          }
        }
        setSelectedIds(newSet);
        setLastSelectedId(uuid);
        return;
      }
    }

    if (newSet.has(uuid)) {
      newSet.delete(uuid);
    } else {
      newSet.add(uuid);
    }
    setSelectedIds(newSet);
    setLastSelectedId(uuid);
  };

  const selectedProducts = useMemo(
    () => list.filter((p) => selectedIds.has(p.uuid)),
    [list, selectedIds],
  );

  const productSelectionMetrics = useMemo(
    () => getProductsSelectionMetrics(selectedProducts),
    [selectedProducts],
  );

  if (showBulkImport) {
    return (
      <Suspense
        fallback={
          <div className="p-8 text-center text-muted-foreground animate-pulse">
            Loading bulk import…
          </div>
        }
      >
        <BulkImportTab onBack={() => setShowBulkImport(false)} />
      </Suspense>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Overview Summary (Unified Products & Inventory) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-2xs">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Active Catalog</p>
          <p className="mt-1 text-lg font-extrabold text-foreground">{activeCount} items</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3.5 shadow-2xs">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">
            Total In-Stock Units
          </p>
          <p className="mt-1 text-lg font-extrabold text-blue-600">{totalStockUnits} units</p>
        </div>
        <div
          className="rounded-2xl border border-border bg-card p-3.5 shadow-2xs"
          title={`Total Potential Retail Sales: ${formatPrice(totalStockValue)} (Store Buying Cost: ${formatPrice(totalStockCost)})`}
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-[11px] font-bold uppercase text-muted-foreground truncate">
              Total Stock Value
            </p>
            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 shrink-0">
              Retail
            </span>
          </div>
          <p className="mt-1 text-lg font-extrabold text-emerald-600">
            {formatPrice(totalStockValue)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Store Cost: {formatPrice(totalStockCost)}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3.5 shadow-2xs">
          <p className="text-[11px] font-bold uppercase text-amber-800">Low Stock Alert</p>
          <p className="mt-1 text-lg font-extrabold text-amber-600">{lowStockCount}</p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-3.5 shadow-2xs col-span-2 sm:col-span-1">
          <p className="text-[11px] font-bold uppercase text-red-800">Out of Stock</p>
          <p className="mt-1 text-lg font-extrabold text-red-600">{outOfStockCount}</p>
        </div>
      </div>
      {/* Channel Segmented Control */}
      <div className="flex p-1 bg-muted/30 rounded-2xl border border-border w-fit max-w-full overflow-x-auto mx-auto sm:mx-0 gap-1">
        <button
          onClick={() => setChannelTab("all")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            channelTab === "all"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
        >
          <Layers className="size-3.5" />
          <span>All Products ({activeCount})</span>
        </button>
        <button
          onClick={() => setChannelTab("ONLINE_AND_OFFLINE")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            channelTab === "ONLINE_AND_OFFLINE"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
        >
          <Package className="size-3.5" />
          <span>Online &amp; Offline Store ({onlineAndOfflineCount})</span>
        </button>
        <button
          onClick={() => setChannelTab("OFFLINE_ONLY")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            channelTab === "OFFLINE_ONLY"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
        >
          <Store className="size-3.5" />
          <span>Only Offline (POS) ({offlineOnlyCount})</span>
        </button>
        <button
          onClick={() => setChannelTab("archived")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            channelTab === "archived"
              ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
          }`}
        >
          <Archive className="size-3.5" />
          <span>Archived Products ({archivedCount})</span>
        </button>
      </div>

      {/* Archive Notice Banner */}
      {channelTab === "archived" && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs">
          <div className="flex items-center gap-2.5">
            <Archive className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-extrabold text-foreground">
                Archived Products Section ({archivedCount} items)
              </span>
              <p className="text-muted-foreground mt-0.5">
                These products have historical sales or transactions and are hidden from your active
                store and POS catalog. You can restore them anytime using the Restore button.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top action & search bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-72 max-w-xs">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products, SKU, barcode…"
              aria-label="Search products"
              className="w-full rounded-xl border border-border bg-card px-4 py-2 pl-9 text-sm text-foreground outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-xs"
            />
            <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">🔍</span>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-border transition-all shadow-xs cursor-pointer"
          >
            <option value="all">All Categories</option>
            <option value="clothing">Clothing & Fashion</option>
            <option value="toys">Toys & Games</option>
            <option value="care">Nursery & Care</option>
            <option value="gear">Travel Gear & Strollers</option>
            <option value="feeding">Feeding & Nursing</option>
            <option value="diapering">Diapering & Potty</option>
            <option value="bath">Bath & Healthcare</option>
            <option value="footwear">Footwear & Shoes</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as
                  "all" | "active" | "in_stock" | "low_stock" | "out_of_stock" | "archived",
              )
            }
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-border transition-all shadow-xs cursor-pointer"
          >
            <option value="all">
              {channelTab === "archived"
                ? `All Archived (${archivedCount})`
                : `All Status (${activeCount})`}
            </option>
            <option value="in_stock">In Stock ({inStockCount})</option>
            <option value="low_stock">Low Stock (≤ alert) ({lowStockCount})</option>
            <option value="out_of_stock">Out of Stock ({outOfStockCount})</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Delete All Products Button */}
          <button
            onClick={() => setShowDeleteAllModal(true)}
            disabled={!data || data.length === 0}
            title="Delete all products from store catalog"
            className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-bold text-red-700 shadow-2xs transition hover:bg-red-100 hover:text-red-800 active:scale-95 cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            <span>Delete All</span>
          </button>

          {/* Print Labels Dropdown */}
          <div className="inline-flex rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (selectedIds.size === 0) {
                  // If no products are selected, clicking Print Labels opens the Print Setup Modal
                  setPrintingLabels(true);
                } else {
                  // If products are selected, print labels for selected products
                  printLabel(selectedProducts);
                }
              }}
              disabled={isPrinting}
              title={
                selectedIds.size > 0
                  ? `Print labels for ${selectedIds.size} selected products`
                  : "Open Product Label Printer (Preview, Quantities & Format)"
              }
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-3.5 text-muted-foreground" />
              <span>
                {selectedIds.size > 0 ? `Print Selected (${selectedIds.size})` : "Print Labels"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPrintingLabels(true)}
              title="Advanced Print (Custom quantities, layout, discounts)"
              className="px-2.5 py-2 text-xs border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>

          {/* Bulk Import button */}
          <button
            onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2 text-xs font-bold text-primary shadow-xs transition hover:bg-primary/10 active:scale-95 cursor-pointer"
            title="Import or update products in bulk from a CSV or Excel file"
          >
            <Upload className="size-3.5" /> Bulk Import
          </button>

          {/* Add product button */}
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#8B2020] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#7a1c1c] active:scale-95 cursor-pointer"
          >
            <Plus className="size-4" /> Add product
          </button>
        </div>
      </div>

      {/* Smart Selection Summary & Bulk Action Toolbar */}
      <SmartSelectionSummary
        selectedCount={selectedProducts.length}
        selectedLabel="Selected Products"
        metrics={productSelectionMetrics}
        onClear={() => setSelectedIds(new Set())}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Print labels for selected */}
            <button
              onClick={() => printLabel(selectedProducts)}
              disabled={isPrinting}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition cursor-pointer"
            >
              <Printer className="size-3.5" />
              <span>Print Labels</span>
            </button>

            {/* Set stock to 10 */}
            <button
              onClick={() => setStockTenSelected.mutate(Array.from(selectedIds))}
              disabled={setStockTenSelected.isPending}
              title="Quickly set stock to 10 for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition cursor-pointer"
            >
              <Check className="size-3.5" />
              <span>Set Stock 10</span>
            </button>

            {/* Set delivery to Free (₹0) */}
            <button
              onClick={() => setDeliveryFeeBulk.mutate({ ids: Array.from(selectedIds), fee: 0 })}
              disabled={setDeliveryFeeBulk.isPending}
              title="Set Delivery to Free (₹0) for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition cursor-pointer"
            >
              <Truck className="size-3.5" />
              <span>Free Delivery</span>
            </button>

            {/* Archive selected */}
            <button
              onClick={() => archiveSelected.mutate(Array.from(selectedIds))}
              disabled={archiveSelected.isPending}
              className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 shadow-2xs hover:bg-amber-100 transition cursor-pointer"
            >
              <Archive className="size-3.5" />
              <span>Archive</span>
            </button>

            {/* Delete Selected */}
            <button
              onClick={() => setShowDeleteSelectedModal(true)}
              className="flex items-center gap-1.5 rounded-xl bg-destructive px-2.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700 transition cursor-pointer"
            >
              <Trash2 className="size-3.5" />
              <span>Delete</span>
            </button>
          </div>
        }
      />

      {isLoading ? (
        <AdminTableSkeleton rows={8} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="w-10 px-4 py-4">
                  <div className="flex items-center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      aria-label="Select all products"
                      className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                    />
                  </div>
                </th>
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">Category</th>
                <th className="px-5 py-4">SKU / Barcode</th>
                <th className="px-5 py-4">Pricing & Profit</th>
                <th className="px-5 py-4">Delivery</th>
                <th className="px-5 py-4">Stock</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {list.map((p) => {
                const isSelected = selectedIds.has(p.uuid);
                return (
                  <tr
                    key={p.uuid}
                    className={`group transition-all ${
                      isSelected
                        ? "bg-[#8B2020]/10 border-l-4 border-l-[#8B2020] font-medium"
                        : "hover:bg-muted/50"
                    } ${!p.isActive ? "opacity-60" : ""}`}
                  >
                    <td className="w-10 px-4 py-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => toggleSelectProduct(p.uuid, e)}
                          onChange={() => {}} // handled in onClick for shift-key support
                          aria-label={`Select ${p.name}`}
                          className="size-4.5 rounded cursor-pointer accent-[#8B2020]"
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3.5">
                        <Link
                          to="/product/$id"
                          params={{ id: p.id || p.uuid }}
                          className="relative group/thumb block size-12 shrink-0 overflow-hidden rounded-xl border border-border/80 bg-muted/40 shadow-2xs transition-transform hover:scale-105"
                          title="Open product on storefront (new tab)"
                        >
                          <img
                            src={p.image}
                            alt={p.name}
                            loading="lazy"
                            width={48}
                            height={48}
                            className="size-full object-cover transition-opacity duration-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = imageFor(p.category, null, p);
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/thumb:opacity-100 text-white">
                            <ExternalLink className="size-3.5" />
                          </span>
                        </Link>
                        <div className="max-w-[280px]">
                          <Link
                            to="/product/$id"
                            params={{ id: p.id || p.uuid }}
                            className="font-semibold text-foreground line-clamp-1 hover:text-primary transition-colors flex items-center gap-1 group/name"
                            title={`Open ${p.name} on storefront`}
                          >
                            <span>{p.name}</span>
                            <ExternalLink className="size-3 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                          </Link>
                          <p className="text-xs font-medium text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            <span>{p.brand}</span>
                            <span className="opacity-50">•</span>
                            <span>{p.id}</span>
                            <span className="opacity-50">•</span>
                            {p.salesChannel === "OFFLINE_ONLY" ? (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] uppercase font-extrabold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded shadow-2xs"
                                title="This product is only available in the offline POS system"
                              >
                                <Store className="size-2.5" /> Only Offline (POS)
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] uppercase font-extrabold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 rounded shadow-2xs"
                                title="Available online and in-store POS"
                              >
                                <Package className="size-2.5" /> Online & Offline
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-foreground">
                        {p.category}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-mono text-xs font-semibold text-foreground">{p.sku}</p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {p.barcode}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-between min-w-[120px]">
                        <div>
                          <p className="font-semibold text-foreground" title="Selling Price">
                            {formatPrice(p.price)}
                          </p>
                          <p
                            className="text-[10px] text-muted-foreground mt-0.5"
                            title="Buying Price"
                          >
                            Cost: {formatPrice(p.buyingPrice || 0)}
                          </p>
                        </div>
                        <div className="text-right pl-3">
                          <p
                            className={`text-xs font-bold ${
                              p.price - (p.buyingPrice || 0) < 0
                                ? "text-destructive"
                                : "text-emerald-600"
                            }`}
                          >
                            {formatPrice(Math.abs(p.price - (p.buyingPrice || 0)))}
                          </p>
                          <p
                            className={`text-[10px] font-medium ${
                              p.price - (p.buyingPrice || 0) < 0
                                ? "text-destructive"
                                : "text-emerald-500"
                            }`}
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
                      {p.salesChannel === "OFFLINE_ONLY" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground bg-muted/50 border border-border/50 px-2.5 py-1 rounded-full text-xs font-semibold italic">
                          — In-Store Only —
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const newFee = (p.deliveryFee ?? 79) === 0 ? 79 : 0;
                            setDeliveryFeeQuick.mutate({ uuid: p.uuid, slug: p.id, fee: newFee });
                          }}
                          disabled={setDeliveryFeeQuick.isPending}
                          title="Click to toggle between Free (₹0) and ₹79"
                          className="inline-flex items-center gap-1.5 transition hover:scale-105 cursor-pointer"
                        >
                          {(p.deliveryFee ?? 79) === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs">
                              <Truck className="size-3" /> Free (₹0)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-foreground bg-muted border border-border px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs">
                              <Truck className="size-3 text-muted-foreground" /> ₹
                              {p.deliveryFee ?? 79}
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {editingStockId === p.uuid ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            value={stockVal === 0 ? "" : stockVal}
                            placeholder="0"
                            autoFocus
                            onChange={(e) =>
                              setStockVal(
                                e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                updateStock.mutate({ id: p.uuid, stock: stockVal });
                              }
                            }}
                            className="w-16 rounded-md border border-primary bg-background px-2 py-1 text-xs font-bold outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateStock.mutate({ id: p.uuid, stock: stockVal })}
                            className="rounded-md bg-emerald-600 text-white p-1 hover:bg-emerald-700 transition cursor-pointer"
                            title="Save Stock"
                          >
                            <Check className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStockId(null)}
                            className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted transition cursor-pointer"
                            title="Cancel"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateStock.mutate({ id: p.uuid, stock: Math.max(0, p.stock - 1) })
                            }
                            disabled={p.stock === 0 || updateStock.isPending}
                            title="Decrease Stock (-1)"
                            className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30 cursor-pointer"
                          >
                            <Minus className="size-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingStockId(p.uuid);
                              setStockVal(p.stock);
                            }}
                            title="Click to edit stock number"
                            className={`min-w-8 px-2 py-0.5 rounded-md text-xs font-bold text-center transition cursor-pointer ${
                              p.stock === 0
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : p.stock <= (p.lowStockAt || 5)
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-muted text-foreground border border-border hover:border-primary/50"
                            }`}
                          >
                            {p.stock}
                          </button>

                          <button
                            type="button"
                            onClick={() => updateStock.mutate({ id: p.uuid, stock: p.stock + 1 })}
                            disabled={updateStock.isPending}
                            title="Increase Stock (+1)"
                            className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>Val: {formatPrice((p.price || 0) * (p.stock || 0))}</span>
                        <span className="opacity-40">•</span>
                        <span title="Low stock alert trigger">≤{p.lowStockAt || 5}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          p.isActive
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-muted text-muted-foreground border border-border"
                        }`}
                      >
                        {p.isActive ? "Live" : "Archived"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => printLabel(p)}
                          disabled={isPrinting}
                          aria-label={`Print label for ${p.name}`}
                          title="Print Barcode Label (1-Click Direct Thermal Print)"
                          className="rounded-lg border border-red-200/80 bg-red-50/70 p-2 text-[#8B2020] shadow-2xs transition-all hover:bg-red-100 hover:scale-105 cursor-pointer disabled:opacity-40"
                        >
                          <Printer className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          title="Edit Product Details"
                          className="rounded-lg border border-slate-200/80 bg-slate-50 p-2 text-slate-700 shadow-2xs transition-all hover:bg-slate-100 hover:text-slate-900 hover:scale-105 cursor-pointer"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const duplicated: Product = {
                              ...p,
                              uuid: "",
                              id: "",
                              name: `Copy of ${p.name}`,
                              sku: "",
                              barcode: "",
                              stock: p.stock,
                            };
                            setEditing(duplicated);
                            setCreating(true);
                          }}
                          aria-label={`Duplicate ${p.name}`}
                          title="Duplicate Product (Clone with new SKU & Barcode)"
                          className="rounded-lg border border-blue-200/80 bg-blue-50/70 p-2 text-blue-700 shadow-2xs transition-all hover:bg-blue-100 hover:scale-105 cursor-pointer"
                        >
                          <Copy className="size-4" />
                        </button>
                        {!p.isActive ? (
                          <button
                            type="button"
                            onClick={() => restore.mutate(p.uuid)}
                            disabled={restore.isPending}
                            aria-label={`Restore ${p.name}`}
                            title="Restore product to active store catalog"
                            className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs font-bold text-emerald-800 shadow-2xs transition-all hover:bg-emerald-100 hover:scale-105 cursor-pointer disabled:opacity-40"
                          >
                            <RotateCcw className="size-3.5" />
                            <span>Restore</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Archive "${p.name}"? It will be hidden from the store but kept in records.`,
                                )
                              )
                                archive.mutate(p.uuid);
                            }}
                            aria-label={`Archive ${p.name}`}
                            title="Archive product (hide from store)"
                            className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-2 text-amber-700 shadow-2xs transition-all hover:bg-amber-100 hover:scale-105 cursor-pointer"
                          >
                            <Package className="size-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Permanently delete "${p.name}"? This cannot be undone.\n\nNote: Products with sales history cannot be deleted.`,
                              )
                            )
                              remove.mutate(p.uuid);
                          }}
                          aria-label={`Delete ${p.name}`}
                          title="Delete product permanently"
                          className="rounded-lg border border-rose-200/80 bg-rose-50/70 p-2 text-rose-700 shadow-2xs transition-all hover:bg-rose-100 hover:scale-105 cursor-pointer"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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

      {/* Delete Selected Confirmation Modal */}
      {showDeleteSelectedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">
                  Delete {selectedIds.size} Selected Products
                </h3>
                <p className="text-xs text-muted-foreground">Confirm custom product removal</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete these{" "}
              <strong className="text-foreground">{selectedIds.size}</strong> selected products?
            </p>
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
              <strong>Notice:</strong> Any product with previous sales transactions will be
              automatically <em>archived</em> instead of permanently removed to preserve invoice and
              financial audit records.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeleteSelectedModal(false)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSelected.mutate(Array.from(selectedIds))}
                disabled={deleteSelected.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>
                  {deleteSelected.isPending ? "Deleting..." : `Delete ${selectedIds.size} Products`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Products Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Delete All Products</h3>
                <p className="text-xs text-muted-foreground">Permanent catalog purge</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              This will permanently delete all{" "}
              <strong className="text-foreground">{data?.length ?? 0} products</strong> currently in
              the store catalog.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Type <span className="font-mono font-bold text-foreground">DELETE ALL</span> to
                confirm:
              </label>
              <input
                value={deleteAllConfirmInput}
                onChange={(e) => setDeleteAllConfirmInput(e.target.value)}
                placeholder="DELETE ALL"
                className="w-full rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-sm font-mono text-foreground outline-none focus:border-destructive"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setDeleteAllConfirmInput("");
                }}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAll.mutate()}
                disabled={deleteAll.isPending || deleteAllConfirmInput !== "DELETE ALL"}
                className="flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                <span>{deleteAll.isPending ? "Purging..." : "Confirm Delete All"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <Suspense
          fallback={
            <div className="p-12 text-center text-muted-foreground animate-pulse border bg-card rounded-2xl shadow-xl">
              Loading product editor...
            </div>
          }
        >
          <ProductForm
            product={editing}
            defaultSalesChannel={channelTab === "all" ? undefined : channelTab}
            saving={save.isPending}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSave={(draft) => save.mutate(editing ? { draft, uuid: editing.uuid } : { draft })}
          />
        </Suspense>
      )}

      {printingLabels && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-background p-8 rounded-xl animate-pulse">Loading printer...</div>
            </div>
          }
        >
          <PrintLabelsModal
            products={
              selectedIds.size > 0 ? selectedProducts : list.length > 0 ? list : (data ?? [])
            }
            onClose={() => setPrintingLabels(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

// Imported at the top

/* ---------------- Settings ---------------- */

const SETTING_LABELS: Record<string, string> = {
  brand_name: "Brand name",
  hero_title: "Home hero title",
  hero_subtitle: "Home hero subtitle",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  store_address: "Store address",
  store_hours: "Opening hours",
  maps_url: "Google Maps link",
  owner_notification_email: "Owner Sale Alert Email (Recipient)",
  owner_notify_offline_sales: "Enable Offline POS Sale Alerts (true/false)",
  owner_notify_online_sales: "Enable Online Order Alerts (true/false)",
  // The feature toggles won't be rendered in the text list, so they don't strictly need labels here, but good for completeness
  feature_hover_swap: "Hover Image Swap",
  feature_promo_badges: "Floating Promo Badges",
  feature_size_guide: "Size Guide Drawer",
  feature_image_magnifier: "Image Magnifier (Zoom)",
  feature_urgency_badges: "Urgency & Social Proof Badges",
  feature_swatches: "Interactive Visual Swatches",
  feature_sticky_cart: "Sticky 'Add to Cart' Bar",
  urgency_dispatch_cutoff_hour: "Dispatch Cutoff Hour",
  free_delivery_enabled: "Enable Free Delivery Threshold (true/false)",
  free_delivery_threshold: "Free Delivery Threshold Amount (₹)",
  standard_shipping_charge: "Standard Shipping Charge (₹)",
  free_delivery_message: "Free Delivery Cart Message",
  enable_cod: "Enable Cash on Delivery (true/false)",
  enable_open_box: "Enable Open Box Delivery (true/false)",
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  brand_name: "Yahan se website ka main naam (logo text) aur footer text change hoga.",
  hero_title: "Homepage par aane wala sabse bada main title yahan se change hota hai.",
  hero_subtitle:
    "Homepage ke main title ke theek niche wala chhota text (subtitle) yahan se badle.",
  contact_email: "Website ke footer aur contact page me dikhne wala aapka Email ID.",
  contact_phone: "Website ke footer aur contact page me dikhne wala Phone/Mobile number.",
  store_address: "Website ke footer aur contact page me dikhne wala dukan ka pata (address).",
  store_hours: "Dukaan khulne aur band hone ka samay (yeh Footer me dikhta hai).",
  maps_url: "Footer me location icon par click karne se jo Google Maps open hoga, uska link.",
  free_delivery_enabled:
    "True likhne par free delivery threshold on ho jayega, false par band ho jayega.",
  free_delivery_threshold:
    "Is amount ke upar ka order hone par customer ko shipping charge nahi lagega.",
  standard_shipping_charge:
    "Agar order free delivery threshold se kam hai, toh yeh charge lagega (e.g. 79).",
  free_delivery_message:
    "Cart me progress bar ke liye message. Use {amount} as placeholder. (e.g. Add ₹{amount} more for FREE DELIVERY 🎉)",
  enable_cod: "True likhne par Cash on Delivery payment option on ho jayega, false par disable.",
  enable_open_box: "True likhne par Checkout me Open Box Delivery option dikhega, false par nahi.",
};
const DEFAULT_SETTINGS: Record<string, string> = {
  brand_name: "Zerah Baby And Kid's",
  announcement: "Free delivery on orders above ₹999 · Easy 7-day returns",
  enable_cod: "true",
  enable_open_box: "true",
  hero_title: "Everything little ones need, in one happy place",
  hero_subtitle:
    "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
  contact_email: "hello@zerahkids.com",
  contact_phone: "9057074777, 9667571712",
  store_address:
    "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India",
  store_hours: "Open daily · 10:30 AM – 10:00 PM",
  maps_url: "https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA",
  instagram_url: "https://www.instagram.com/zerah_kids/",
  facebook_url: "",
  whatsapp_url: "",
  feature_hover_swap: "true",
  feature_promo_badges: "true",
  feature_size_guide: "true",
  feature_image_magnifier: "true",
  feature_urgency_badges: "true",
  feature_swatches: "true",
  feature_sticky_cart: "true",
  urgency_dispatch_cutoff_hour: "14",
  free_delivery_enabled: "true",
  free_delivery_threshold: "999",
  standard_shipping_charge: "79",
  free_delivery_message: "Add ₹{amount} more for FREE DELIVERY 🎉",
};

function SettingsTab() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    staleTime: 1000 * 60 * 5, // 5 minutes caching
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("key, value")
        .order("key");
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, string>;
    },
  });

  const current = useMemo(() => {
    return { ...DEFAULT_SETTINGS, ...(data ?? {}), ...(values ?? {}) };
  }, [data, values]);

  const save = useMutation({
    mutationFn: async () => {
      const fullMerged = { ...current };
      if (fullMerged.announcement !== undefined) {
        fullMerged.announcement_enabled = fullMerged.announcement.trim() ? "true" : "false";
      }
      const rows = Object.entries(fullMerged).map(([key, value]) => ({ key, value }));
      const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All store settings saved & published successfully!");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save settings"),
  });

  async function onSendTestNotification() {
    setTestingEmail(true);
    try {
      const targetEmail =
        current.owner_notification_email || current.contact_email || "hello@zerahkids.com";
      const { data, error } = await supabase.functions.invoke("send-owner-sale-notification", {
        body: { type: "test", recipient: targetEmail },
      });
      if (error) throw error;
      if (data && !data.success && data.error) {
        throw new Error(data.error);
      }
      toast.success(`Test email sent to ${targetEmail}!`);
    } catch (err: unknown) {
      toast.error(`Test email failed: ${(err as Error).message}`);
    } finally {
      setTestingEmail(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      {/* ─── SALE NOTIFICATIONS CARD ──────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground">
              Owner Sale Notifications
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive automatic email alerts on every offline POS sale &amp; online paid order via
              Resend.
            </p>
          </div>
          <button
            type="button"
            onClick={onSendTestNotification}
            disabled={testingEmail}
            className="inline-flex items-center justify-center rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50 cursor-pointer"
          >
            {testingEmail ? "Sending Test…" : "Send Test Email"}
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipient Email Address
            </span>
            <input
              type="email"
              value={current.owner_notification_email ?? ""}
              onChange={(e) => setValues({ ...current, owner_notification_email: e.target.value })}
              placeholder="e.g. owner@zerahkids.com"
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <span className="text-sm font-medium text-foreground">Offline POS Sale Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_offline_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_offline_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <span className="text-sm font-medium text-foreground">Online Paid Order Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_online_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_online_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>

      {/* ─── PRINT SETTINGS ─────────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
              🖨️ Print Settings
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure invoice printer, HPRT HT300 thermal label printer, and label dimensions. All
              settings persist across POS sessions.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-6">
          {/* ── PROFILE A: Invoice (A4) ── */}
          <div className="rounded-2xl border border-border bg-muted/10 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#8B2020]">
                Profile 1 — Invoice (A4)
              </span>
              <span className="text-[10px] bg-[#8B2020]/10 text-[#8B2020] border border-[#8B2020]/20 rounded-full px-2 py-0.5 font-semibold">
                Normal A4 Printer
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Printer Name (reference only)
                </span>
                <input
                  type="text"
                  value={current["print_invoice_printer_name"] ?? "Default A4 Printer"}
                  onChange={(e) =>
                    setValues({ ...current, print_invoice_printer_name: e.target.value })
                  }
                  placeholder="e.g. HP LaserJet M1005"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Invoice Copies
                </span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={current["print_invoice_copies"] ?? "1"}
                  onChange={(e) => setValues({ ...current, print_invoice_copies: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
                />
              </label>
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <div>
                <span className="block text-sm font-bold text-foreground">
                  Auto-Print After POS Sale
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Automatically triggers thermal receipt print when a sale is completed.
                </span>
              </div>
              <input
                type="checkbox"
                checked={current["print_invoice_auto_print"] !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    print_invoice_auto_print: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer ml-4 shrink-0"
              />
            </label>

            {/* Test Invoice Button */}
            <button
              type="button"
              onClick={() => {
                const iframe = document.createElement("iframe");
                iframe.style.cssText =
                  "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden;";
                document.body.appendChild(iframe);
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) {
                  doc.open();
                  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Test Invoice Print</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}@page{size:A4 portrait;margin:15mm 12mm;}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#000;padding:20px;}
.header{border-bottom:3px solid #8B2020;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between;}
.brand{font-size:20px;font-weight:900;color:#8B2020;}table{width:100%;border-collapse:collapse;}
thead tr{background:#8B2020;color:#fff;}th,td{padding:7px 8px;border-bottom:1px solid #eee;}
.footer{border-top:2px solid #8B2020;padding-top:10px;margin-top:20px;font-size:10px;color:#666;}
</style></head><body>
<div class="header"><div><div class="brand" style="display:flex;align-items:center;gap:12px;"><img loading="lazy" decoding="async" src="\${window.location.origin}/logo.png" style="width:60px;height:auto;" alt="Zerah"/><div>ZÉRAH BABY &amp; KIDS</div></div><div style="font-size:10px;color:#666;">Test Invoice Print — Calibration Sheet</div></div>
<div style="text-align:right;"><div style="font-size:14px;font-weight:800;color:#8B2020;">TEST INVOICE</div><div>INV-TEST-001</div></div></div>
<table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
<tbody><tr><td>Test Product A</td><td>2</td><td>₹499</td><td>₹998</td></tr>
<tr><td style="background:#faf8f8;">Test Product B</td><td>1</td><td>₹299</td><td>₹299</td></tr></tbody></table>
<div style="text-align:right;margin-top:12px;"><div>Subtotal: ₹1,297</div><div style="font-size:15px;font-weight:900;color:#8B2020;">TOTAL: ₹1,297</div></div>
<div class="footer">TEST PRINT — No business data was created · Zérah Baby &amp; Kids</div>
</body></html>`);
                  doc.close();
                  iframe.onload = () => {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    setTimeout(() => document.body.removeChild(iframe), 2000);
                  };
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-[#8B2020]/30 bg-[#8B2020]/5 px-4 py-2 text-xs font-bold text-[#8B2020] hover:bg-[#8B2020]/10 transition cursor-pointer"
            >
              🖨️ Test Invoice Printer
            </button>
          </div>

          {/* ── PROFILE B: Thermal Barcode Label (HPRT HT300) ── */}
          <div className="rounded-2xl border border-border bg-muted/10 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                Profile 2 — Thermal Barcode Label
              </span>
              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-semibold">
                HPRT HT300
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Thermal Printer Name
                </span>
                <input
                  type="text"
                  value={current["print_thermal_printer_name"] ?? "HPRT HT300"}
                  onChange={(e) =>
                    setValues({ ...current, print_thermal_printer_name: e.target.value })
                  }
                  placeholder="e.g. HPRT HT300"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  DPI (203 for HPRT HT300)
                </span>
                <input
                  type="number"
                  min={72}
                  max={600}
                  value={current["print_label_dpi"] ?? "203"}
                  onChange={(e) => setValues({ ...current, print_label_dpi: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
                />
              </label>
            </div>

            {/* Label Dimensions */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Label Size (mm) — Max 108mm width for HPRT HT300
              </span>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() =>
                    setValues({
                      ...current,
                      print_label_width_mm: "50",
                      print_label_height_mm: "25",
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition ${
                    (current["print_label_width_mm"] ?? "50") === "50" &&
                    (current["print_label_height_mm"] ?? "25") === "25"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  50 × 25 mm (default)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setValues({
                      ...current,
                      print_label_width_mm: "60",
                      print_label_height_mm: "30",
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition ${
                    (current["print_label_width_mm"] ?? "50") === "60" &&
                    (current["print_label_height_mm"] ?? "25") === "30"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  60 × 30 mm
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setValues({
                      ...current,
                      print_label_width_mm: "80",
                      print_label_height_mm: "40",
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition ${
                    (current["print_label_width_mm"] ?? "50") === "80" &&
                    (current["print_label_height_mm"] ?? "25") === "40"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  80 × 40 mm
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Width (mm)</span>
                  <input
                    type="number"
                    min={20}
                    max={108}
                    value={current["print_label_width_mm"] ?? "50"}
                    onChange={(e) =>
                      setValues({ ...current, print_label_width_mm: e.target.value })
                    }
                    className="w-20 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary shadow-2xs"
                  />
                </label>
                <span className="text-muted-foreground font-bold">×</span>
                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">Height (mm)</span>
                  <input
                    type="number"
                    min={10}
                    max={297}
                    value={current["print_label_height_mm"] ?? "25"}
                    onChange={(e) =>
                      setValues({ ...current, print_label_height_mm: e.target.value })
                    }
                    className="w-20 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary shadow-2xs"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Label Copies
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={current["print_label_copies"] ?? "1"}
                  onChange={(e) => setValues({ ...current, print_label_copies: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Label Type
                </span>
                <select
                  value={current["print_label_type"] ?? "full"}
                  onChange={(e) => setValues({ ...current, print_label_type: e.target.value })}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs cursor-pointer"
                >
                  <option value="full">Full (Name + SKU + Price + Barcode)</option>
                  <option value="barcode-only">Barcode Only (Store + Name + Barcode)</option>
                </select>
              </label>
            </div>

            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <span className="text-sm font-medium text-foreground">Show Discount % on Labels</span>
              <input
                type="checkbox"
                checked={current["print_label_show_discount"] === "true"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    print_label_show_discount: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer"
              />
            </label>

            {/* Test Thermal Label Button */}
            <button
              type="button"
              onClick={() => {
                const wMm = parseFloat(current["print_label_width_mm"] ?? "50") || 50;
                const hMm = parseFloat(current["print_label_height_mm"] ?? "25") || 25;
                const iframe = document.createElement("iframe");
                iframe.style.cssText =
                  "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;";
                document.body.appendChild(iframe);
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc) {
                  doc.open();
                  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Test Label Print</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}@page{size:${wMm}mm ${hMm}mm;margin:1mm;}
body{font-family:'Courier New',monospace;font-size:8px;width:${wMm - 2}mm;background:#fff;color:#000;}
.box{border:1px solid #000;padding:2mm;width:100%;height:${hMm - 2}mm;display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center;}
.cross{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;}
</style></head><body>
<div class="box">
<div style="font-weight:900;font-size:10px;">ZÉRAH BABY &amp; KIDS</div>
<div>TEST LABEL · ${wMm}×${hMm}mm</div>
<div style="border:1px solid #000;padding:3px 6px;font-family:monospace;font-size:14px;font-weight:900;letter-spacing:2px;">||| ||| |||</div>
<div style="font-size:7px;">SKU: TEST-001 · Scan to verify</div>
<div style="font-size:7px;color:#555;">Calibration sheet — no business data</div>
</div>
</body></html>`);
                  doc.close();
                  iframe.onload = () => {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    setTimeout(() => document.body.removeChild(iframe), 2000);
                  };
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition cursor-pointer"
            >
              🏷️ Test Thermal Label Printer
            </button>
          </div>

          {/* ── QZ Tray Status ── */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚡</span>
              <div>
                <h4 className="font-bold text-sm text-amber-900">
                  Direct Printing (TSPL/ZPL Native Commands)
                </h4>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  For native direct printing to the HPRT HT300 without the Windows print dialog,
                  install <strong>QZ Tray</strong> on the Windows machine running the POS. When QZ
                  Tray is active, this system automatically uses TSPL commands instead of browser
                  printing.
                </p>
                <a
                  href="https://qz.io/download/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 text-xs font-bold text-amber-700 underline hover:text-amber-900"
                >
                  Download QZ Tray →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── MAINTENANCE MODE ─────────────────────────────────── */}

      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-destructive">Maintenance Mode</h3>
            <p className="text-xs text-muted-foreground">
              When enabled, the entire storefront is blocked with a friendly maintenance screen.
              (Admins can still access the site).
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center ml-4 shrink-0">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={current.maintenance_mode === "true"}
              onChange={(e) =>
                setValues({
                  ...current,
                  maintenance_mode: e.target.checked ? "true" : "false",
                })
              }
            />
            <div className="peer h-7 w-12 rounded-full bg-muted border border-border after:absolute after:left-[2px] after:top-[2px] after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow-md after:transition-all after:content-[''] peer-checked:bg-destructive peer-checked:after:translate-x-5 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-destructive"></div>
          </label>
        </div>
      </div>

      {/* ─── PREMIUM STORE FEATURES ───────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="border-b border-border pb-4">
          <h3 className="font-display text-lg font-bold text-foreground">
            Storefront Interactive Features
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Turn advanced storefront features ON or OFF globally with instant live effect.
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            {
              key: "feature_hover_swap",
              label: "Hover Image Swap",
              desc: "Swap to 2nd image on hover (Product Card)",
            },
            {
              key: "feature_promo_badges",
              label: "Floating Promo Badges",
              desc: "Show 'BUY 3 @1199' & '% OFF' tags",
            },
            {
              key: "feature_size_guide",
              label: "Size Guide Drawer",
              desc: "Slide-out measurement chart on product pages",
            },
            {
              key: "feature_image_magnifier",
              label: "Image Magnifier",
              desc: "Native hover-zoom on main product images",
            },
            {
              key: "feature_urgency_badges",
              label: "Urgency Badges",
              desc: "Live viewer count, low stock tags & dispatch timer",
            },
            {
              key: "feature_swatches",
              label: "Visual Swatches",
              desc: "'More in this style' interactive circles",
            },
            {
              key: "feature_sticky_cart",
              label: "Sticky Cart Bar",
              desc: "Persistent Add to Bag bar on scroll",
            },
          ].map((feat) => (
            <label
              key={feat.key}
              className="flex items-center justify-between rounded-2xl border border-border bg-muted/10 p-4 cursor-pointer hover:bg-muted/20 transition"
            >
              <div>
                <span className="block text-sm font-bold text-foreground">{feat.label}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{feat.desc}</span>
              </div>
              <input
                type="checkbox"
                checked={current[feat.key] !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    [feat.key]: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary ml-4 shrink-0 cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-border">
          <label className="block max-w-sm space-y-1.5">
            <span className="text-sm font-bold text-foreground">
              Dispatch Cutoff Hour (Same-Day Dispatch Timer)
            </span>
            <p className="text-xs text-muted-foreground">
              What hour (24h format, e.g. 14 = 2:00 PM) does same-day order dispatch close?
            </p>
            <input
              type="number"
              min="0"
              max="23"
              value={current.urgency_dispatch_cutoff_hour ?? "14"}
              onChange={(e) =>
                setValues({ ...current, urgency_dispatch_cutoff_hour: e.target.value })
              }
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
            />
          </label>
        </div>
      </div>

      {/* ─── GENERAL STORE SETTINGS & TEXT CONTROL ───────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="border-b border-border pb-4">
          <h3 className="font-display text-lg font-bold text-foreground">
            Storefront Text &amp; Branding Content
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update the textual branding and details across your storefront. All updates sync in real
            time.
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6">
            {Object.keys(SETTING_LABELS)
              .filter(
                (k) =>
                  !k.startsWith("owner_") && !k.startsWith("feature_") && !k.startsWith("urgency_"),
              )
              .map((key) => (
                <div
                  key={key}
                  className="space-y-2 border-b border-border/40 pb-5 last:border-0 last:pb-0"
                >
                  <label className="block space-y-1">
                    <span className="text-sm font-bold text-foreground">
                      {SETTING_LABELS[key] ?? key}
                    </span>
                    {SETTING_DESCRIPTIONS[key] && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-bold text-primary/80">
                          Kya change hoga? (Effect):
                        </span>{" "}
                        {SETTING_DESCRIPTIONS[key]}
                      </p>
                    )}
                    <textarea
                      rows={key.includes("subtitle") || key === "announcement" ? 2 : 1}
                      value={
                        current[key] !== undefined ? current[key] : (DEFAULT_SETTINGS[key] ?? "")
                      }
                      onChange={(e) => setValues({ ...current, [key]: e.target.value })}
                      className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
                    />
                  </label>
                </div>
              ))}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {save.isPending ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Saving All Settings...
              </>
            ) : (
              <>
                <Check className="size-4" /> Save &amp; Publish All Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Admins ---------------- */

function AdminsTab({ currentEmail }: { currentEmail: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-list"],
    staleTime: 1000 * 60 * 5,
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
  const [activeSection, setActiveSection] = useState<"online" | "offline">("online");
  const { data: customers, isLoading } = useCustomers(true);
  const { data: orders } = useAllOrders(true);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<
    Database["public"]["Tables"]["profiles"]["Row"] | null
  >(null);
  const [viewPhoto, setViewPhoto] = useState<{ url: string; title: string } | null>(null);

  // Sync Offline Customers & Sales Data
  const { data: offlineSales = [] } = useQuery({
    queryKey: ["offline-sales-customers-badge"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("id, total, customer_phone, customer_name, status");
      if (error) return [];
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const offlineStats = useMemo(() => {
    const set = new Set<string>();
    let totalSpend = 0;
    for (const s of offlineSales) {
      if (s.status === "cancelled") continue;
      const key = s.customer_phone?.trim() || s.customer_name?.trim() || "Walk-in";
      set.add(key);
      totalSpend += Number(s.total || 0);
    }
    return { count: set.size, totalSpend };
  }, [offlineSales]);

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; spend: number; lastOrderDate: string | null }>();
    for (const o of orders ?? []) {
      const cur = map.get(o.user_id) ?? { count: 0, spend: 0, lastOrderDate: null };
      map.set(o.user_id, {
        count: cur.count + 1,
        spend: cur.spend + (o.status === "cancelled" ? 0 : Number(o.total)),
        lastOrderDate: cur.lastOrderDate || o.created_at,
      });
    }
    return map;
  }, [orders]);

  const onlineSpend = useMemo(() => {
    return (orders ?? []).reduce(
      (sum, o) => sum + (o.status === "cancelled" ? 0 : Number(o.total || 0)),
      0,
    );
  }, [orders]);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        (c.full_name && c.full_name.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q)),
    );
  }, [customers, search]);

  const customerSelection = useTableSelection({ items: filtered });
  const customerMetrics = useMemo(() => {
    const selectedWithStats = customerSelection.selectedItems.map((c) => {
      const s = stats.get(c.id) ?? { count: 0, spend: 0 };
      return {
        id: c.id,
        total_purchases: s.count,
        total_spend: s.spend,
      };
    });
    return getCustomersSelectionMetrics(selectedWithStats);
  }, [customerSelection.selectedItems, stats]);

  return (
    <div className="space-y-6">
      {/* 2-Section Header & Channel Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-1.5 bg-muted/40 rounded-2xl border border-border">
        <div className="flex items-center gap-1.5 bg-background p-1 rounded-xl border border-border/80 shadow-2xs overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveSection("online")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeSection === "online"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Users className="size-4" />
            <span>Online Customers</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                activeSection === "online"
                  ? "bg-white/20 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {customers?.length || 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection("offline")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeSection === "offline"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Receipt className="size-4" />
            <span>Offline POS Customers</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                activeSection === "offline"
                  ? "bg-white/20 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {offlineStats.count}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-4 px-3 text-xs text-muted-foreground">
          <div>
            <span className="text-[11px] block font-medium">Total Combined Spend:</span>
            <strong className="text-foreground text-sm font-black">
              {formatPrice(onlineSpend + offlineStats.totalSpend)}
            </strong>
          </div>
        </div>
      </div>

      {/* Render Active Section */}
      {activeSection === "offline" ? (
        <Suspense
          fallback={
            <div className="p-8 text-center text-xs text-muted-foreground">
              Loading offline customers hub…
            </div>
          }
        >
          <CustomerHistoryPanel />
        </Suspense>
      ) : (
        <div className="space-y-4">
          {/* Header & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-bold">Online Storefront Customers</h3>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {filtered.length} {filtered.length === 1 ? "customer" : "customers"}
              </span>
            </div>

            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, email, city…"
                className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-4 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>

          {/* Sticky Smart Selection Summary */}
          <SmartSelectionSummary
            selectedCount={customerSelection.selectedCount}
            selectedLabel="Selected Customers"
            metrics={customerMetrics}
            onClear={customerSelection.clearSelection}
          />

          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="w-10 px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={customerSelection.isAllVisibleSelected(filtered)}
                        ref={(el) => {
                          if (el) el.indeterminate = customerSelection.isIndeterminate(filtered);
                        }}
                        onChange={() => customerSelection.toggleAllVisible(filtered)}
                        aria-label="Select all customers"
                        className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                      />
                    </th>
                    <th className="px-5 py-3.5">Customer &amp; Profile (DP)</th>
                    <th className="px-5 py-3.5">Contact Details</th>
                    <th className="px-5 py-3.5">Delivery Address</th>
                    <th className="px-5 py-3.5">Joined Date</th>
                    <th className="px-5 py-3.5 text-right">Orders / Spend</th>
                    <th className="px-5 py-3.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => {
                    const isSelected = customerSelection.isSelected(c.id);
                    const s = stats.get(c.id) ?? { count: 0, spend: 0, lastOrderDate: null };
                    const initials = c.full_name
                      ? c.full_name
                          .split(" ")
                          .map((n: string) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()
                      : c.email?.[0]?.toUpperCase() || "C";

                    return (
                      <tr
                        key={c.id}
                        className={`group transition-colors align-middle ${
                          isSelected ? "bg-primary/5 font-medium" : "hover:bg-muted/40"
                        }`}
                      >
                        <td className="w-10 px-4 py-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => customerSelection.toggle(c.id)}
                            aria-label={`Select customer ${c.full_name || c.email}`}
                            className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                          />
                        </td>
                        {/* DP & Name */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              onClick={() => {
                                if (c.avatar_url) {
                                  setViewPhoto({
                                    url: c.avatar_url,
                                    title: c.full_name || "Customer DP",
                                  });
                                } else {
                                  setSelectedCustomer(c);
                                }
                              }}
                              className={`size-11 rounded-full border border-border bg-muted overflow-hidden shrink-0 flex items-center justify-center shadow-2xs group/dp transition-transform ${
                                c.avatar_url
                                  ? "cursor-pointer hover:scale-105 hover:ring-2 hover:ring-primary/40"
                                  : "cursor-pointer"
                              }`}
                              title={
                                c.avatar_url
                                  ? "Click to view full customer photo"
                                  : "Click to view profile info"
                              }
                            >
                              {c.avatar_url ? (
                                <div className="relative size-full">
                                  <img
                                    loading="lazy"
                                    decoding="async"
                                    src={c.avatar_url}
                                    alt={c.full_name || "Customer avatar"}
                                    className="size-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/dp:opacity-100 flex items-center justify-center transition-opacity text-white">
                                    <Eye className="size-4" />
                                  </div>
                                </div>
                              ) : (
                                <div className="size-full bg-gradient-to-tr from-primary/20 via-primary/10 to-amber-100 flex items-center justify-center font-display text-sm font-bold text-primary">
                                  {initials}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <span className="font-bold text-foreground block truncate">
                                {c.full_name || "Guest Customer"}
                              </span>
                              <span className="text-[11px] text-muted-foreground font-mono truncate block">
                                ID: {c.id.slice(0, 8)}…
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-5 py-4 text-xs">
                          <span className="font-semibold text-foreground block">
                            {c.email || "No email"}
                          </span>
                          {c.phone ? (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-muted-foreground font-mono">{c.phone}</span>
                              <a
                                href={`https://wa.me/${c.phone.replace(/[^0-9]/g, "")}`}
                                className="inline-flex items-center gap-1 rounded bg-[#25D366]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#128C7E] hover:bg-[#25D366]/20 transition-colors"
                                title="Chat on WhatsApp"
                              >
                                WA
                              </a>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">No phone</span>
                          )}
                        </td>

                        {/* Address */}
                        <td className="px-5 py-4 text-xs max-w-xs">
                          {c.address || c.city || c.state ? (
                            <div className="space-y-0.5">
                              <p className="text-foreground line-clamp-1">{c.address || "—"}</p>
                              <p className="text-muted-foreground text-[11px]">
                                {[c.city, c.state, c.pincode].filter(Boolean).join(", ")}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-[11px] italic">
                              No address provided
                            </span>
                          )}
                        </td>

                        {/* Joined */}
                        <td className="px-5 py-4 text-xs text-muted-foreground font-medium whitespace-nowrap">
                          {new Date(c.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>

                        {/* Orders / Spend */}
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <span className="font-bold text-foreground block">
                            {formatPrice(s.spend)}
                          </span>
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {s.count} {s.count === 1 ? "order" : "orders"}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="px-5 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomer(c)}
                            className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted hover:text-primary transition-all cursor-pointer shadow-2xs"
                          >
                            View Full Info
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                      >
                        No customers found matching "{search}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Customer Profile Details Modal */}
      {selectedCustomer && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 animate-in fade-in duration-150"
          onClick={() => setSelectedCustomer(null)}
        >
          <div
            className="flex flex-col w-full max-w-lg max-h-[90vh] rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header with Banner & DP */}
            <div className="relative bg-gradient-to-tr from-primary/20 via-primary/10 to-amber-100 p-6 pb-4">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                aria-label="Close modal"
                className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer shadow-2xs"
              >
                <X className="size-4" />
              </button>

              <div className="flex items-center gap-4 pt-2">
                <div
                  onClick={() => {
                    if (selectedCustomer.avatar_url) {
                      setViewPhoto({
                        url: selectedCustomer.avatar_url,
                        title: selectedCustomer.full_name || "Customer DP",
                      });
                    }
                  }}
                  className={`size-20 rounded-full border-4 border-card bg-muted overflow-hidden shadow-premium-md shrink-0 flex items-center justify-center relative group/modal-dp ${
                    selectedCustomer.avatar_url
                      ? "cursor-pointer hover:ring-4 hover:ring-primary/40 transition-all"
                      : ""
                  }`}
                  title={selectedCustomer.avatar_url ? "Click to view full photo" : ""}
                >
                  {selectedCustomer.avatar_url ? (
                    <>
                      <img
                        loading="lazy"
                        decoding="async"
                        src={selectedCustomer.avatar_url}
                        alt={selectedCustomer.full_name || "Customer avatar"}
                        className="size-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/modal-dp:opacity-100 flex flex-col items-center justify-center transition-opacity text-white text-[10px] font-bold gap-0.5">
                        <Eye className="size-4" />
                        <span>Enlarge</span>
                      </div>
                    </>
                  ) : (
                    <div className="size-full bg-primary/20 flex items-center justify-center font-display text-2xl font-bold text-primary">
                      {selectedCustomer.full_name
                        ? selectedCustomer.full_name
                            .split(" ")
                            .map((n: string) => n[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()
                        : "C"}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-foreground">
                    {selectedCustomer.full_name || "Guest Customer"}
                  </h3>
                  <p className="text-xs text-muted-foreground">{selectedCustomer.email}</p>
                  <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {selectedCustomer.role || "Customer"}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-4 border border-border/60">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Phone Number
                  </span>
                  <span className="font-semibold text-foreground">
                    {selectedCustomer.phone || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Member Since
                  </span>
                  <span className="font-semibold text-foreground">
                    {new Date(selectedCustomer.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>

              {/* Full Address */}
              <div className="rounded-2xl border border-border/80 p-4 space-y-2">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <MapPin className="size-4 text-primary" /> Delivery &amp; Billing Address
                </span>
                {selectedCustomer.address || selectedCustomer.city ? (
                  <div className="text-xs space-y-1 text-muted-foreground pl-5.5">
                    <p className="text-foreground font-medium">
                      {selectedCustomer.address || "Street address not specified"}
                    </p>
                    <p>
                      <strong>City:</strong> {selectedCustomer.city || "—"}
                    </p>
                    <p>
                      <strong>State:</strong> {selectedCustomer.state || "—"}
                    </p>
                    <p>
                      <strong>Pincode:</strong> {selectedCustomer.pincode || "—"}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic pl-5.5">
                    Customer has not added a delivery address yet.
                  </p>
                )}
              </div>

              {/* Order Stats */}
              <div className="rounded-2xl bg-primary/5 p-4 border border-primary/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary block">
                    Lifetime Orders
                  </span>
                  <span className="text-lg font-bold text-foreground">
                    {stats.get(selectedCustomer.id)?.count || 0} orders
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary block">
                    Total Spend
                  </span>
                  <span className="text-lg font-black text-primary">
                    {formatPrice(stats.get(selectedCustomer.id)?.spend || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-border p-4 bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="rounded-xl border border-border bg-background px-5 py-2 text-xs font-bold hover:bg-muted transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer DP Full Photo Lightbox Portal */}
      {viewPhoto &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-150"
            onClick={() => setViewPhoto(null)}
          >
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3 bg-black/50 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 text-white">
                <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm border border-primary/30">
                  DP
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{viewPhoto.title}</p>
                  <p className="text-[10px] text-white/70">Customer Profile Picture</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={viewPhoto.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md hover:bg-white/25 transition-colors cursor-pointer border border-white/20"
                >
                  <ExternalLink className="size-3.5" /> Full Size / Open Original
                </a>
                <button
                  type="button"
                  onClick={() => setViewPhoto(null)}
                  className="grid size-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md hover:bg-white/25 transition-colors cursor-pointer border border-white/20"
                  aria-label="Close photo"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            <div
              className="relative max-w-3xl max-h-[80vh] overflow-hidden rounded-3xl border border-white/20 bg-card/10 shadow-2xl flex items-center justify-center p-2"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                loading="lazy"
                decoding="async"
                src={viewPhoto.url}
                alt={viewPhoto.title}
                className="max-h-[75vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
              />
            </div>
          </div>,
          document.body,
        )}
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
  const [selectedUsageCoupon, setSelectedUsageCoupon] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: "",
    discount_type: "percentage" as const,
    discount_value: 10,
    minimum_order_value: 0,
    maximum_discount: 0,
    usage_limit: 0,
    per_user_limit: 1,
    starts_at: null as string | null,
    expires_at: null as string | null,
    active: true,
  });

  const couponSelection = useTableSelection({ items: coupons ?? [] });
  const couponMetrics = useMemo(
    () => getCouponsSelectionMetrics(couponSelection.selectedItems),
    [couponSelection.selectedItems],
  );

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Discount Coupons</h2>
          <p className="text-xs text-muted-foreground">
            Create percentage discounts and track customer redemptions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 cursor-pointer"
        >
          <Plus className="size-4" /> Add new coupon
        </button>
      </div>

      {/* Simplified Creation Form */}
      {showForm && (
        <form
          className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-5 animate-in fade-in duration-200"
          onSubmit={(e) => {
            e.preventDefault();
            createCoupon.mutate(
              {
                ...form,
                discount_type: "percentage",
                maximum_discount: 0,
                usage_limit: 0,
              },
              {
                onSuccess: () => {
                  setShowForm(false);
                  setForm({
                    code: "",
                    discount_type: "percentage",
                    discount_value: 10,
                    minimum_order_value: 0,
                    maximum_discount: 0,
                    usage_limit: 0,
                    per_user_limit: 1,
                    starts_at: null,
                    expires_at: null,
                    active: true,
                  });
                  toast.success("Coupon created successfully!");
                },
              },
            );
          }}
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Tag className="size-4 text-primary" /> Create Percentage Coupon
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-muted-foreground hover:text-foreground text-xs font-bold"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* Field 1: Coupon Code */}
            <label className="block space-y-1.5 text-xs font-bold text-foreground">
              <span>Coupon Code</span>
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().trim() })}
                placeholder="e.g. FESTIVE25"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs font-mono font-bold tracking-wider outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </label>

            {/* Field 2: Discount Percentage */}
            <label className="block space-y-1.5 text-xs font-bold text-foreground">
              <span>Discount (% Off)</span>
              <div className="relative">
                <input
                  type="number"
                  required
                  min={1}
                  max={100}
                  value={form.discount_value}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      discount_value: Math.max(1, Math.min(100, Number(e.target.value))),
                    })
                  }
                  className="w-full rounded-xl border border-border bg-background pl-3.5 pr-8 py-2.5 text-xs font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                  %
                </span>
              </div>
            </label>

            {/* Field 3: Minimum Order Amount */}
            <label className="block space-y-1.5 text-xs font-bold text-foreground">
              <span>Minimum Order Amount (₹)</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                  ₹
                </span>
                <input
                  type="number"
                  min={0}
                  value={form.minimum_order_value}
                  onChange={(e) =>
                    setForm({ ...form, minimum_order_value: Math.max(0, Number(e.target.value)) })
                  }
                  placeholder="0 = No Minimum"
                  className="w-full rounded-xl border border-border bg-background pl-7 pr-3.5 py-2.5 text-xs font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={createCoupon.isPending || !form.code}
              className="rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
            >
              {createCoupon.isPending ? "Creating..." : "Save Coupon"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-border bg-card px-5 py-2.5 text-xs font-bold text-muted-foreground shadow-sm transition hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Sticky Smart Selection Summary */}
      <SmartSelectionSummary
        selectedCount={couponSelection.selectedCount}
        selectedLabel="Selected Coupons"
        metrics={couponMetrics}
        onClear={couponSelection.clearSelection}
      />

      {/* Coupons Table */}
      <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-xs">
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead className="bg-muted/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="w-10 px-4 py-4">
                <input
                  type="checkbox"
                  checked={couponSelection.isAllVisibleSelected(coupons ?? [])}
                  ref={(el) => {
                    if (el) el.indeterminate = couponSelection.isIndeterminate(coupons ?? []);
                  }}
                  onChange={() => couponSelection.toggleAllVisible(coupons ?? [])}
                  aria-label="Select all coupons"
                  className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                />
              </th>
              <th className="px-5 py-4">Code</th>
              <th className="px-5 py-4">Discount</th>
              <th className="px-5 py-4">Min Order</th>
              <th className="px-5 py-4">Customer Usage</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {(coupons ?? []).map((c) => {
              const isSelected = couponSelection.isSelected(c.id);
              return (
                <tr
                  key={c.id}
                  className={`group transition-colors ${
                    isSelected ? "bg-primary/5 font-medium" : "hover:bg-muted/30"
                  }`}
                >
                  <td className="w-10 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => couponSelection.toggle(c.id)}
                      aria-label={`Select coupon ${c.code}`}
                      className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                    />
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-mono font-bold text-foreground text-xs bg-muted/60 px-2.5 py-1 rounded-lg border border-border/60">
                      {c.code}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-bold text-emerald-600 dark:text-emerald-400">
                    {c.discount_type === "percentage"
                      ? `${c.discount_value}% OFF`
                      : formatPrice(c.discount_value)}
                  </td>
                  <td className="px-5 py-4 font-medium text-foreground">
                    {c.minimum_order_value > 0 ? (
                      formatPrice(c.minimum_order_value)
                    ) : (
                      <span className="text-muted-foreground font-normal">No Min Order</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setSelectedUsageCoupon(c.code)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition cursor-pointer"
                      title="Click to view who used this coupon"
                    >
                      <Users className="size-3.5" />
                      <span>{c.usage_count} customer(s)</span>
                      <Eye className="size-3 ml-0.5" />
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => toggleCoupon.mutate({ id: c.id, active: !c.active })}
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                        c.active
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25"
                          : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
                      }`}
                    >
                      {c.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedUsageCoupon(c.code)}
                        className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-xs transition-all hover:border-primary/40 hover:text-primary hover:bg-primary/5 cursor-pointer"
                        title="View customers who redeemed this coupon"
                      >
                        <Eye className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete coupon ${c.code}?`)) {
                            deleteCoupon.mutate(c.id);
                          }
                        }}
                        className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-xs transition-all hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                        title="Delete coupon"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && (coupons ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-12 text-center text-xs font-medium text-muted-foreground"
                >
                  No coupons created yet. Click "Add new coupon" above to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Customer Usage Breakdown Modal */}
      {selectedUsageCoupon && (
        <CouponUsageModal
          couponCode={selectedUsageCoupon}
          onClose={() => setSelectedUsageCoupon(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Coupon Usage Breakdown Modal ---------------- */

function CouponUsageModal({ couponCode, onClose }: { couponCode: string; onClose: () => void }) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["admin-coupon-usage-orders", couponCode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("coupon_code", couponCode)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalSavings = orders.reduce((sum, o) => sum + (o.discount || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="size-10 grid place-items-center rounded-2xl bg-primary/10 text-primary">
              <Tag className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                Coupon Usage:{" "}
                <span className="font-mono text-primary font-black">{couponCode}</span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Customers who redeemed this coupon code
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Usage Summary Cards */}
        <div className="grid grid-cols-3 gap-3 p-5 bg-muted/10 border-b border-border">
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Total Uses
            </p>
            <p className="text-lg font-black text-foreground mt-0.5">{totalOrders}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Revenue Sales
            </p>
            <p className="text-lg font-black text-primary mt-0.5">{formatPrice(totalRevenue)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Total Savings
            </p>
            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              {formatPrice(totalSavings)}
            </p>
          </div>
        </div>

        {/* Customer List */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <Users className="size-8 mx-auto text-muted-foreground/40" />
              <p className="text-xs font-bold text-foreground">
                No customers have redeemed this coupon yet.
              </p>
              <p className="text-[11px]">
                When customers place orders using {couponCode}, their details will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Order Total</th>
                    <th className="px-4 py-3 text-right">Discount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {orders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-muted/40 transition">
                      <td className="px-4 py-3">
                        <p className="font-bold text-foreground">
                          {ord.full_name || "Guest Customer"}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {ord.customer_phone || ord.phone || ord.email || "N/A"}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-primary">
                        {ord.order_number || ord.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(ord.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">
                        {formatPrice(ord.total || 0)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        - {formatPrice(ord.discount || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-muted/20 text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-card border border-border text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
          >
            Close
          </button>
        </div>
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
          <li key={review.id} className="rounded-2xl border border-gray-100 bg-card p-5 shadow-2xs">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`size-4 ${
                          i < review.rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-gray-200"
                        }`}
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
                  {review.verified_purchase ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                      ✓ Certified Buyer
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unverified</span>
                  )}
                  {review.user_name && (
                    <span className="text-xs font-bold text-muted-foreground">
                      by {review.user_name}
                      {review.user_phone ? ` (${review.user_phone})` : ""}
                    </span>
                  )}
                </div>
                {review.products && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Product:{" "}
                    <span className="font-semibold text-foreground">{review.products.name}</span>
                  </p>
                )}
                {review.title && (
                  <p className="mt-2 text-sm font-semibold text-foreground">{review.title}</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                  {review.comment}
                </p>

                {/* Photo Attachments */}
                {review.images && review.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-2">
                    {review.images.map((imgUrl: string, idx: number) => (
                      <a
                        key={idx}
                        href={imgUrl}
                        className="group relative size-14 rounded-xl overflow-hidden border border-border hover:border-[#8B2020] transition hover:scale-105"
                      >
                        <img
                          loading="lazy"
                          decoding="async"
                          src={imgUrl}
                          alt={`Review photo ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}

                <p className="mt-2 text-xs text-gray-400">
                  {new Date(review.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {review.status !== "approved" && (
                  <button
                    onClick={() => updateStatus.mutate({ id: review.id, status: "approved" })}
                    className="rounded-xl bg-[#388E3C] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-green-700 cursor-pointer shadow-2xs"
                  >
                    Approve
                  </button>
                )}
                {review.status !== "rejected" && (
                  <button
                    onClick={() => updateStatus.mutate({ id: review.id, status: "rejected" })}
                    className="rounded-xl border border-border px-3.5 py-1.5 text-xs font-semibold hover:bg-muted transition cursor-pointer"
                  >
                    Reject
                  </button>
                )}
                <button
                  onClick={() => {
                    if (window.confirm("Delete this review permanently?")) {
                      deleteReview.mutate(review.id);
                    }
                  }}
                  className="rounded-xl border border-red-200 text-red-600 px-3.5 py-1.5 text-xs font-semibold hover:bg-red-50 transition cursor-pointer"
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

/* ---------------- Marketing & Promotions ---------------- */

const ANNOUNCEMENT_PRESETS = [
  {
    label: "⭐ Original Zérah Signature (Classic)",
    tag: "Original Default",
    text: "Free delivery on orders above ₹999 · Easy 7-day returns",
    bgColor: "#8B2020",
    textColor: "#FFFFFF",
  },
  {
    label: "🚚 Pan-India Express Delivery",
    tag: "Free Shipping",
    text: "✨ FREE Pan-India delivery on orders above ₹999 · COD Available ✨",
    bgColor: "#8B2020",
    textColor: "#FFFFFF",
  },
  {
    label: "🎉 Festive Mega Sale (20% OFF)",
    tag: "Festive Offer",
    text: "🎉 FESTIVE SALE: Flat 20% OFF on all Baby & Kids wear! Use code: FESTIVE20 🎉",
    bgColor: "#7C2D12",
    textColor: "#FEF08A",
  },
  {
    label: "🍼 New Arrivals Collection",
    tag: "New In Store",
    text: "🍼 NEW ARRIVALS: Organic Cotton Baby Essentials & Strollers now in stock! 🛍️",
    bgColor: "#064E3B",
    textColor: "#ECFDF5",
  },
  {
    label: "🧸 Toy Carnival (Buy 2 Get 1)",
    tag: "Special Deal",
    text: "🧸 TOY CARNIVAL: Buy 2 Get 1 FREE on all Toys & Educational Games! 🌙",
    bgColor: "#1E1B4B",
    textColor: "#E0E7FF",
  },
  {
    label: "⚡ 24-Hour Flash Sale",
    tag: "Limited Time",
    text: "⚡ 24-HOUR FLASH SALE: Extra 15% OFF on all orders placed today! ⚡",
    bgColor: "#9D174D",
    textColor: "#FFF1F2",
  },
];

const ANNOUNCEMENT_COLOR_PALETTES = [
  { name: "Brand Burgundy", bg: "#8B2020", text: "#FFFFFF" },
  { name: "Deep Navy", bg: "#0F172A", text: "#FFFFFF" },
  { name: "Forest Emerald", bg: "#064E3B", text: "#ECFDF5" },
  { name: "Warm Amber", bg: "#92400E", text: "#FEF3C7" },
  { name: "Royal Purple", bg: "#581C87", text: "#FAF5FF" },
  { name: "Rose Pink", bg: "#9D174D", text: "#FDF2F8" },
  { name: "Dark Slate", bg: "#18181B", text: "#F4F4F5" },
];

function MarketingTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    announcement: "",
    announcement_enabled: true,
    announcement_bg: "#8B2020",
    announcement_text_color: "#FFFFFF",
    announcement_link: "",
    instagram_url: "",
    facebook_url: "",
    whatsapp_url: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const { data: settings = {}, isLoading } = useQuery({
    queryKey: ["site_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("key, value");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    },
  });

  useEffect(() => {
    if (!isLoading && settings && !hasLoaded) {
      setForm({
        announcement:
          settings["announcement"] ?? "Free delivery on orders above ₹999 · Easy 7-day returns",
        announcement_enabled: settings["announcement_enabled"] !== "false",
        announcement_bg: settings["announcement_bg"] || "#8B2020",
        announcement_text_color: settings["announcement_text_color"] || "#FFFFFF",
        announcement_link: settings["announcement_link"] || "",
        instagram_url: settings["instagram_url"] ?? "https://www.instagram.com/zerah_kids/",
        facebook_url: settings["facebook_url"] ?? "",
        whatsapp_url: settings["whatsapp_url"] ?? "",
      });
      setHasLoaded(true);
    }
  }, [settings, isLoading, hasLoaded]);

  // Real-time validations and canonical normalizations
  const igValidation = useMemo(
    () => validateAndNormalizeInstagram(form.instagram_url),
    [form.instagram_url],
  );
  const fbValidation = useMemo(
    () => validateAndNormalizeFacebook(form.facebook_url),
    [form.facebook_url],
  );
  const waValidation = useMemo(
    () => validateAndNormalizeWhatsApp(form.whatsapp_url),
    [form.whatsapp_url],
  );
  const targetLinkValidation = useMemo(
    () => validateAndNormalizeAnnouncementLink(form.announcement_link),
    [form.announcement_link],
  );

  const save = useMutation({
    mutationFn: async () => {
      const newErrors: Record<string, string> = {};

      if (form.instagram_url.trim() && !igValidation.isValid) {
        newErrors.instagram_url = igValidation.error || "Invalid Instagram URL or handle";
      }
      if (form.facebook_url.trim() && !fbValidation.isValid) {
        newErrors.facebook_url = fbValidation.error || "Invalid Facebook Page URL or handle";
      }
      if (form.whatsapp_url.trim() && !waValidation.isValid) {
        newErrors.whatsapp_url =
          waValidation.error || "Invalid WhatsApp direct link or mobile number";
      }
      if (form.announcement_link.trim() && !targetLinkValidation.isValid) {
        newErrors.announcement_link = targetLinkValidation.error || "Invalid target link format";
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        const firstErr = Object.values(newErrors)[0];
        throw new Error(`Validation Error: ${firstErr}`);
      }

      setErrors({});

      const isAnnounceEmpty = !form.announcement.trim();
      const rows = [
        { key: "announcement", value: form.announcement.trim() },
        {
          key: "announcement_enabled",
          value: isAnnounceEmpty || !form.announcement_enabled ? "false" : "true",
        },
        { key: "announcement_bg", value: form.announcement_bg },
        { key: "announcement_text_color", value: form.announcement_text_color },
        { key: "announcement_link", value: targetLinkValidation.normalizedUrl },
        { key: "instagram_url", value: igValidation.normalizedUrl },
        { key: "facebook_url", value: fbValidation.normalizedUrl },
        { key: "whatsapp_url", value: waValidation.normalizedUrl },
      ];

      const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;

      return {
        instagram_url: igValidation.normalizedUrl,
        facebook_url: fbValidation.normalizedUrl,
        whatsapp_url: waValidation.normalizedUrl,
        announcement_link: targetLinkValidation.normalizedUrl,
      };
    },
    onSuccess: (normalized) => {
      setForm((prev) => ({
        ...prev,
        ...normalized,
      }));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 5000);
      toast.success("Marketing, Announcement & Social settings saved & published to live store!");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.refetchQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to save settings. Please resolve validation errors.");
    },
  });

  const handleApplyPreset = (preset: (typeof ANNOUNCEMENT_PRESETS)[0]) => {
    setForm((prev) => ({
      ...prev,
      announcement: preset.text,
      announcement_bg: preset.bgColor,
      announcement_text_color: preset.textColor,
      announcement_enabled: true,
    }));
    toast.info(`Loaded template: "${preset.label}"`);
  };

  const handleClearAnnouncement = () => {
    setForm((prev) => ({
      ...prev,
      announcement: "",
      announcement_enabled: false,
    }));
    toast.warning("Announcement cleared. Click Save to publish changes.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <form
        className="space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {/* Header Title & Top Quick Action */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
          <div>
            <h2 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <Megaphone className="size-7 text-primary" />
              Marketing &amp; Promotions
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your top announcement bar, live color styling, and social media channels in one
              authoritative place.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <Check className="size-3.5" /> Published to Store
              </span>
            )}

            <button
              type="submit"
              disabled={save.isPending || isLoading}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer self-start sm:self-auto"
            >
              {save.isPending ? (
                <>
                  <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Saving &amp; Publishing...
                </>
              ) : (
                <>
                  <Check className="size-4" /> Save &amp; Publish All
                </>
              )}
            </button>
          </div>
        </div>

        {/* Validation Errors Summary Alert */}
        {Object.keys(errors).length > 0 && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 p-4 text-rose-800 dark:text-rose-200">
            <div className="flex items-center gap-2 font-bold text-sm">
              <AlertCircle className="size-4 text-rose-600 dark:text-rose-400" />
              Please fix the following validation errors before publishing:
            </div>
            <ul className="mt-2 list-disc list-inside space-y-1 text-xs">
              {Object.entries(errors).map(([key, msg]) => (
                <li key={key} className="font-medium">
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ─── SECTION 1: TOP ANNOUNCEMENT BANNER ─────────────────── */}
        <div className="space-y-6 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
            <div>
              <h3 className="font-display text-lg font-bold text-foreground flex items-center gap-2">
                <Sparkles className="size-4 text-primary" /> Top Announcement Header Banner
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Appears at the very top of the website on both mobile &amp; desktop.
              </p>
            </div>

            {/* Global Banner Switch */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted-foreground">
                {form.announcement_enabled && form.announcement.trim()
                  ? "Active on Website"
                  : "Turned OFF"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.announcement_enabled}
                onClick={() =>
                  setForm((f) => ({ ...f, announcement_enabled: !f.announcement_enabled }))
                }
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                  form.announcement_enabled && form.announcement.trim() ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    form.announcement_enabled && form.announcement.trim()
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Live Preview Card */}
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Eye className="size-3.5 text-primary" /> Real-time Live Preview
            </span>

            <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
              {form.announcement_enabled && form.announcement.trim() ? (
                <div
                  className="px-4 py-2.5 text-center transition-all duration-300"
                  style={{
                    backgroundColor: form.announcement_bg,
                    color: form.announcement_text_color,
                  }}
                >
                  <div className="flex items-center justify-center gap-2 font-display text-xs sm:text-sm font-semibold tracking-wide">
                    <Sparkles className="size-3.5 shrink-0 opacity-80" />
                    <span>{form.announcement}</span>
                    <Sparkles className="size-3.5 shrink-0 opacity-80" />
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground bg-muted/20">
                  <p className="font-semibold text-foreground">Header is currently turned OFF</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The top bar is completely collapsed (0px height). No blank space is taken on the
                    website.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Message Text Input */}
          <div className="space-y-2">
            <label
              htmlFor="mkt-announcement-text"
              className="block text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Announcement Message
            </label>
            <textarea
              id="mkt-announcement-text"
              rows={2}
              value={form.announcement}
              onChange={(e) => {
                setForm({ ...form, announcement: e.target.value });
                if (errors.announcement) {
                  setErrors((prev) => ({ ...prev, announcement: "" }));
                }
              }}
              placeholder="e.g. Free delivery on orders above ₹999 · Easy 7-day returns"
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs placeholder:text-muted-foreground/60"
            />
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Note:</span> Agar aap ise khali chhod
              denge, toh header bar automatically collapse ho jayegi. Emojis (🎉, ✨, 🍼, 🧸)
              supported hain!
            </p>
          </div>

          {/* Optional Target Link */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="mkt-announcement-link"
                className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                <ExternalLink className="size-3.5" /> Target Page Link (Optional Clickable Action)
              </label>
              {targetLinkValidation.isValid && targetLinkValidation.normalizedUrl && (
                <a
                  href={targetLinkValidation.normalizedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                >
                  Test Link <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <input
              id="mkt-announcement-link"
              type="text"
              value={form.announcement_link}
              onChange={(e) => {
                setForm({ ...form, announcement_link: e.target.value });
                if (errors.announcement_link) {
                  setErrors((prev) => ({ ...prev, announcement_link: "" }));
                }
              }}
              placeholder="e.g. /shop or /product/123 or https://..."
              className={`w-full rounded-xl border px-4 py-2.5 text-sm font-medium outline-none transition focus:ring-2 shadow-2xs ${
                form.announcement_link.trim() && !targetLinkValidation.isValid
                  ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/30"
                  : "border-border bg-background focus:border-primary focus:ring-primary/20"
              }`}
            />
            {form.announcement_link.trim() && !targetLinkValidation.isValid && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                {targetLinkValidation.error}
              </p>
            )}
          </div>

          {/* Color Palettes & Pickers */}
          <div className="space-y-4 border-t border-border/60 pt-5">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Palette className="size-3.5 text-primary" /> Header Color Styling
            </label>

            {/* One-Click Presets */}
            <div className="flex flex-wrap gap-2">
              {ANNOUNCEMENT_COLOR_PALETTES.map((palette) => {
                const isSelected =
                  form.announcement_bg === palette.bg &&
                  form.announcement_text_color === palette.text;
                return (
                  <button
                    key={palette.name}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        announcement_bg: palette.bg,
                        announcement_text_color: palette.text,
                      }))
                    }
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/20 shadow-xs bg-card"
                        : "border-border hover:border-border/80 bg-muted/30"
                    }`}
                  >
                    <span
                      className="size-4 rounded-full border border-black/10 shadow-2xs shrink-0"
                      style={{ backgroundColor: palette.bg }}
                    />
                    <span>{palette.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom Color Pickers */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
              <div className="space-y-1.5">
                <label
                  htmlFor="mkt-bg-color"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Custom Background Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="mkt-bg-color"
                    type="color"
                    value={form.announcement_bg}
                    onChange={(e) => setForm({ ...form, announcement_bg: e.target.value })}
                    className="size-10 cursor-pointer rounded-xl border border-border bg-transparent p-1"
                  />
                  <input
                    type="text"
                    value={form.announcement_bg}
                    onChange={(e) => setForm({ ...form, announcement_bg: e.target.value })}
                    className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono uppercase outline-none focus:border-primary shadow-2xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="mkt-text-color"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Custom Text Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="mkt-text-color"
                    type="color"
                    value={form.announcement_text_color}
                    onChange={(e) => setForm({ ...form, announcement_text_color: e.target.value })}
                    className="size-10 cursor-pointer rounded-xl border border-border bg-transparent p-1"
                  />
                  <input
                    type="text"
                    value={form.announcement_text_color}
                    onChange={(e) => setForm({ ...form, announcement_text_color: e.target.value })}
                    className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono uppercase outline-none focus:border-primary shadow-2xs"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Ready Templates */}
          <div className="space-y-3 border-t border-border/60 pt-5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Ready-made Announcement Templates
            </span>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {ANNOUNCEMENT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="group flex flex-col items-start rounded-2xl border border-border bg-muted/20 p-3.5 text-left transition hover:bg-muted/50 hover:border-primary/50 hover:shadow-xs cursor-pointer relative"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      {preset.label}
                    </span>
                    <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[9px] font-bold text-primary">
                      {preset.tag}
                    </span>
                  </div>
                  <span className="mt-1.5 text-[11px] text-muted-foreground line-clamp-1">
                    {preset.text}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-border/60 pt-4">
            <button
              type="button"
              onClick={handleClearAnnouncement}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <RotateCcw className="size-3.5" /> Clear Announcement
            </button>
          </div>
        </div>

        {/* ─── SECTION 2: SOCIAL PROFILES & CHAT LINKS ───────────────── */}
        <div className="space-y-6 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="border-b border-border/60 pb-4">
            <h3 className="font-display text-lg font-bold text-foreground">
              Social Media Channels &amp; Customer Chat
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect your official profiles to the website's footer and contact touchpoints.
            </p>
          </div>

          <div className="space-y-6">
            {/* Instagram */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mkt-instagram"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Instagram Profile URL or Handle
                </label>
                {igValidation.isValid && igValidation.normalizedUrl && (
                  <a
                    href={igValidation.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    Test Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Destination:</span> Footer aur
                Contact page par Instagram button ka link. Accepts username (e.g.{" "}
                <code>@zerah_kids</code>) ya direct link (e.g.{" "}
                <code>https://www.instagram.com/zerah_kids/</code>).
              </p>
              <input
                id="mkt-instagram"
                type="text"
                value={form.instagram_url}
                onChange={(e) => {
                  setForm({ ...form, instagram_url: e.target.value });
                  if (errors.instagram_url) {
                    setErrors((prev) => ({ ...prev, instagram_url: "" }));
                  }
                }}
                placeholder="https://www.instagram.com/zerah_kids/ or @zerah_kids"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm font-medium outline-none transition focus:ring-2 shadow-2xs ${
                  form.instagram_url.trim() && !igValidation.isValid
                    ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/30"
                    : "border-border bg-background focus:border-primary focus:ring-primary/20"
                }`}
              />
              {form.instagram_url.trim() && !igValidation.isValid ? (
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {igValidation.error}
                </p>
              ) : igValidation.normalizedUrl ? (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="font-semibold text-foreground">Normalized Target:</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded-md font-mono">
                    {igValidation.normalizedUrl}
                  </code>
                </p>
              ) : null}
            </div>

            {/* Facebook */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mkt-facebook"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Facebook Page URL or Username
                </label>
                {fbValidation.isValid && fbValidation.normalizedUrl && (
                  <a
                    href={fbValidation.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    Test Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Destination:</span> Footer aur
                Contact page par Facebook button ka link. Accepts page username (e.g.{" "}
                <code>zerahbaby</code>) ya direct link (e.g.{" "}
                <code>https://facebook.com/zerahbaby</code>).
              </p>
              <input
                id="mkt-facebook"
                type="text"
                value={form.facebook_url}
                onChange={(e) => {
                  setForm({ ...form, facebook_url: e.target.value });
                  if (errors.facebook_url) {
                    setErrors((prev) => ({ ...prev, facebook_url: "" }));
                  }
                }}
                placeholder="https://facebook.com/zerahbaby or zerahbaby"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm font-medium outline-none transition focus:ring-2 shadow-2xs ${
                  form.facebook_url.trim() && !fbValidation.isValid
                    ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/30"
                    : "border-border bg-background focus:border-primary focus:ring-primary/20"
                }`}
              />
              {form.facebook_url.trim() && !fbValidation.isValid ? (
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {fbValidation.error}
                </p>
              ) : fbValidation.normalizedUrl ? (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="font-semibold text-foreground">Normalized Target:</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded-md font-mono">
                    {fbValidation.normalizedUrl}
                  </code>
                </p>
              ) : null}
            </div>

            {/* WhatsApp */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mkt-whatsapp"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  WhatsApp Direct Chat Link or Phone Number
                </label>
                {waValidation.isValid && waValidation.normalizedUrl && (
                  <a
                    href={waValidation.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Test Chat Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Destination:</span> Customer
                WhatsApp direct chat trigger. Accepts 10-digit mobile number (e.g.{" "}
                <code>9057074777</code>) ya official WhatsApp link (e.g.{" "}
                <code>https://wa.me/919057074777</code>).
              </p>
              <input
                id="mkt-whatsapp"
                type="text"
                value={form.whatsapp_url}
                onChange={(e) => {
                  setForm({ ...form, whatsapp_url: e.target.value });
                  if (errors.whatsapp_url) {
                    setErrors((prev) => ({ ...prev, whatsapp_url: "" }));
                  }
                }}
                placeholder="9057074777 or https://wa.me/919057074777"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm font-medium outline-none transition focus:ring-2 shadow-2xs ${
                  form.whatsapp_url.trim() && !waValidation.isValid
                    ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/30"
                    : "border-border bg-background focus:border-primary focus:ring-primary/20"
                }`}
              />
              {form.whatsapp_url.trim() && !waValidation.isValid ? (
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {waValidation.error}
                </p>
              ) : waValidation.normalizedUrl ? (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="font-semibold text-foreground">Normalized Target:</span>
                  <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded-md font-mono text-emerald-700 dark:text-emerald-400">
                    {waValidation.normalizedUrl}
                  </code>
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Unified Bottom Submit Button */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <div>
            {saveSuccess ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 px-4 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <Check className="size-4" /> Published to live storefront
              </span>
            ) : Object.keys(errors).length > 0 ? (
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertCircle className="size-4" /> Please fix validation errors before saving
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={save.isPending || isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-8 py-3.5 text-base font-bold text-primary-foreground shadow-lg transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {save.isPending ? (
              <>
                <div className="size-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Saving &amp; Publishing...
              </>
            ) : (
              <>
                <Check className="size-5" /> Save &amp; Publish All Marketing Settings
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
