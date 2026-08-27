//
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, Suspense, lazy } from "react";
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
} from "lucide-react";
import logo from "@/assets/zerah-logo.png";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIsAdmin, useSession } from "@/lib/auth";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { syncFirstCryCatalogToSupabase, FIRSTCRY_100_PRODUCTS } from "@/lib/firstcry-catalog";
import { useAllOrders, useCustomers, useProfile, orderStatuses } from "@/lib/orders";
import { InvoiceBox } from "@/components/site/Invoice";
import { useAllCoupons, useCreateCoupon, useDeleteCoupon, useToggleCoupon } from "@/lib/coupons";
import { useAllReviews, useUpdateReviewStatus, useDeleteReview } from "@/lib/reviews";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { useDirectLabelPrint } from "@/lib/label-printer";

const HeroMediaManager = lazy(() =>
  import("@/components/admin/HeroMediaManager").then((m) => ({ default: m.HeroMediaManager })),
);
const MediaLibrary = lazy(() =>
  import("@/components/admin/MediaLibrary").then((m) => ({ default: m.MediaLibrary })),
);

const BillingCenterTab = lazy(() =>
  import("@/components/admin/BillingCenterTab").then((m) => ({ default: m.BillingCenterTab })),
);
const CategoriesTab = lazy(() =>
  import("@/components/admin/CategoriesManager").then((m) => ({ default: m.CategoriesTab })),
);
const SMSLogsTab = lazy(() =>
  import("@/components/admin/SMSLogsTab").then((m) => ({ default: m.SMSLogsTab })),
);
const DashboardTab = lazy(() =>
  import("@/components/admin/DashboardTab").then((m) => ({ default: m.DashboardTab })),
);
const OnlineSalesTab = lazy(() =>
  import("@/components/admin/OnlineSalesTab").then((m) => ({ default: m.OnlineSalesTab })),
);
const AdminGlobalSearch = lazy(() =>
  import("@/components/admin/AdminGlobalSearch").then((m) => ({ default: m.AdminGlobalSearch })),
);
const BulkImportTab = lazy(() =>
  import("@/components/admin/BulkImportTab").then((m) => ({ default: m.BulkImportTab })),
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
  | "customers"
  | "categories"
  | "settings"
  | "admins"
  | "coupons"
  | "reviews"
  | "inventory"
  | "marketing"
  | "sms";

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useSession();
  const { data: isAdmin, isLoading: roleLoading, refetch: refetchRole } = useIsAdmin(user?.id);
  const { data: profile } = useProfile(user?.id);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const { theme, isDark, toggleTheme } = useTheme();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useAdminNotifications();

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
      setTab("billing");
    }

    const unbind = initGlobalBarcodeScanner((_code) => {
      if (tab !== "billing") {
        setTab("billing");
      }
    });
    return unbind;
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

  const NAVIGATION: Array<{ key: Tab; label: string; icon: typeof BarChart3; badge?: string }> = [
    { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    { key: "billing", label: "Offline Billing", icon: Settings2 },
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
    { key: "sms", label: "SMS Logs", icon: MessageSquare },
    { key: "marketing", label: "Marketing", icon: Megaphone },
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
        <div className="flex h-16 items-center gap-3 border-b border-border px-6">
          <img src={logo} alt="Zérah Baby &amp; Kids" className="h-8 w-auto object-contain" />
          <div className="leading-tight">
            <span className="font-display text-sm font-black tracking-wide text-foreground">
              Zérah Baby &amp; Kids
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Administration
            </span>
          </div>
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
              <div className="flex items-center gap-2.5">
                <img src={logo} alt="Zérah Baby &amp; Kids" className="h-7 w-auto object-contain" />
                <span className="font-display text-sm font-black text-foreground">Admin Menu</span>
              </div>
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
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllAsRead}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        Mark all as read
                      </button>
                    )}
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
                          <li key={notif.id}>
                            <button
                              type="button"
                              onClick={() => {
                                markAsRead(notif.id);
                                setTab(notif.tab as Tab);
                                setIsNotifOpen(false);
                              }}
                              className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left transition cursor-pointer ${
                                notif.read
                                  ? "opacity-60 hover:opacity-100 hover:bg-muted/40"
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
                <img src={logo} alt="Zerah Baby & Kids" className="h-full w-full object-contain" />
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
            <Suspense
              fallback={
                <div className="p-8 text-center text-muted-foreground animate-pulse">
                  Loading module...
                </div>
              }
            >
              {tab === "dashboard" && <DashboardTab onNavigate={setTab as (tab: string) => void} />}
              {tab === "billing" && <BillingCenterTab />}
              {tab === "products" && <ProductsTab />}
              {tab === "hero" && <HeroMediaManager />}
              {tab === "media" && <MediaLibrary />}
              {tab === "orders" && <OnlineSalesTab />}
              {tab === "customers" && <CustomersTab />}
              {tab === "categories" && <CategoriesTab />}
              {tab === "inventory" && <InventoryTab />}
              {tab === "marketing" && <MarketingTab />}
              {tab === "settings" && <SettingsTab />}
              {tab === "sms" && <SMSLogsTab />}
              {tab === "admins" && <AdminsTab currentEmail={user?.email ?? ""} />}
              {tab === "coupons" && <CouponsTab />}
              {tab === "reviews" && <ReviewsTab />}
            </Suspense>
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
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived" | "low_stock">(
    "all",
  );
  const { printLabel, isPrinting } = useDirectLabelPrint();

  // Selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteAllConfirmInput, setDeleteAllConfirmInput] = useState("");
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const [productsRes, costsRes] = await Promise.all([
        supabase.from("products").select("*").order("sort_order"),
        supabase.from("product_costs").select("product_id, buying_price"),
      ]);

      if (productsRes.error) throw productsRes.error;

      const costMap = new Map((costsRes.data || []).map((c) => [c.product_id, c.buying_price]));

      return (productsRes.data || []).map((r) => {
        const prod = mapProduct(r as never);
        prod.buyingPrice = costMap.get(prod.uuid) || 0;
        return prod;
      });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["inventory-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
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
        age_group: draft.ageGroup,
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

      if (!uuid) {
        row.rating = 0;
        row.reviews = 0;
      }

      const hasStockChanged = uuid ? Number(draft.stock) !== editing?.stock : true;
      if (hasStockChanged) {
        row.stock = Number(draft.stock);
      }

      // Save product
      let productId = uuid;
      if (uuid) {
        const { error } = await supabase
          .from("products")
          .update(row as Database["public"]["Tables"]["products"]["Update"])
          .eq("id", uuid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(row as Database["public"]["Tables"]["products"]["Insert"])
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

        // Sync product_images
        const allUrls = new Set<string>();
        if (draft.imageUrl.trim()) allUrls.add(draft.imageUrl.trim());
        draft.images.forEach((img) => {
          if (img.trim()) allUrls.add(img.trim());
        });

        const urlsArray = Array.from(allUrls);
        const { data: existing } = await supabase
          .from("product_images")
          .select("*")
          .eq("product_id", productId);

        const toDelete = (existing || []).filter((e) => !urlsArray.includes(e.public_url));
        for (const del of toDelete) {
          await supabase.from("product_images").delete().eq("id", del.id);
          if (del.storage_path) {
            await supabase.rpc("delete_storage_object", {
              bucket: "product-images",
              object_path: del.storage_path,
            });
          }
        }

        for (let i = 0; i < urlsArray.length; i++) {
          const url = urlsArray[i];
          const isPrimary = url === draft.imageUrl.trim() || (i === 0 && !draft.imageUrl.trim());
          const existingRow = (existing || []).find((e) => e.public_url === url);

          if (existingRow) {
            await supabase
              .from("product_images")
              .update({ is_primary: isPrimary, sort_order: i })
              .eq("id", existingRow.id);
          } else {
            let storagePath = "";
            if (url.includes("product-images/")) {
              storagePath = url.split("product-images/")[1];
            }
            await supabase.from("product_images").insert({
              product_id: productId,
              public_url: url,
              storage_path: storagePath,
              alt_text: draft.name,
              is_primary: isPrimary,
              sort_order: i,
            });
          }
        }
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

  // Sync 100 FirstCry Catalog
  const handleSyncFirstCryCatalog = async () => {
    if (isSyncingCatalog) return;
    setIsSyncingCatalog(true);
    setSyncProgress({ current: 0, total: 100, message: "Starting FirstCry sync..." });

    const toastId = toast.loading("Syncing 100 FirstCry baby & kids catalog (10 stock each)...");

    try {
      const res = await syncFirstCryCatalogToSupabase((cur, tot, msg) => {
        setSyncProgress({ current: cur, total: tot, message: msg });
        toast.loading(`Syncing FirstCry Catalog (${cur}/${tot})...`, { id: toastId });
      });

      if (res.success) {
        toast.success(`Successfully synced ${res.count} FirstCry products (10 stock each)!`, {
          id: toastId,
          duration: 5000,
        });
        invalidate();
      } else {
        toast.error(`Sync encountered an error: ${res.error}`, { id: toastId });
      }
    } catch (err: unknown) {
      toast.error(`Sync failed: ${(err as Error).message || String(err)}`, { id: toastId });
    } finally {
      setIsSyncingCatalog(false);
      setSyncProgress(null);
    }
  };

  const list = useMemo(() => {
    return (data ?? []).filter((p) => {
      const matchesSearch = (p.name + p.brand + p.category + p.id + p.sku + p.barcode)
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesCat = categoryFilter === "all" || p.category === categoryFilter;

      let matchesStatus = true;
      if (statusFilter === "active") matchesStatus = p.isActive;
      else if (statusFilter === "archived") matchesStatus = !p.isActive;
      else if (statusFilter === "low_stock") matchesStatus = p.stock <= p.lowStockAt;

      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [data, search, categoryFilter, statusFilter]);

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
    () => (data ?? []).filter((p) => selectedIds.has(p.uuid)),
    [data, selectedIds],
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
              setStatusFilter(e.target.value as "all" | "active" | "archived" | "low_stock")
            }
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-border transition-all shadow-xs cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Live Only</option>
            <option value="archived">Archived Only</option>
            <option value="low_stock">Low Stock (≤3)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sync 100 FirstCry Catalog Button */}
          <button
            onClick={handleSyncFirstCryCatalog}
            disabled={isSyncingCatalog}
            title="Populate or restore 100 curated FirstCry products with 10 stock each"
            className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/80 px-3.5 py-2 text-xs font-bold text-amber-900 shadow-2xs transition hover:bg-amber-100/90 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Sparkles
              className={`size-3.5 text-amber-700 ${isSyncingCatalog ? "animate-spin" : ""}`}
            />
            <span>{isSyncingCatalog ? "Syncing (100)..." : "Sync 100 FirstCry (10 Stock)"}</span>
          </button>

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
              onClick={() => printLabel(selectedIds.size > 0 ? selectedProducts : list)}
              disabled={
                isPrinting ||
                (selectedIds.size > 0 ? selectedProducts.length === 0 : list.length === 0)
              }
              title={
                selectedIds.size > 0
                  ? `Print labels for ${selectedIds.size} selected`
                  : "Print labels directly for visible products (1-Click)"
              }
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-3.5 text-muted-foreground" />
              <span>
                {selectedIds.size > 0 ? `Print Selected (${selectedIds.size})` : "Print Labels"}
              </span>
            </button>
            <button
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

      {/* Floating / Sticky Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-card p-3 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 pl-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#8B2020] text-[11px] font-bold text-white">
              {selectedIds.size}
            </span>
            <p className="text-xs font-bold text-foreground">
              {selectedIds.size} of {data?.length ?? 0} products selected
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Print labels for selected */}
            <button
              onClick={() => printLabel(selectedProducts)}
              disabled={isPrinting}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition cursor-pointer"
            >
              <Printer className="size-3.5" />
              <span>Print Labels</span>
            </button>

            {/* Set stock to 10 */}
            <button
              onClick={() => setStockTenSelected.mutate(Array.from(selectedIds))}
              disabled={setStockTenSelected.isPending}
              title="Quickly set stock to 10 for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition cursor-pointer"
            >
              <Check className="size-3.5" />
              <span>Set Stock to 10</span>
            </button>

            {/* Archive selected */}
            <button
              onClick={() => archiveSelected.mutate(Array.from(selectedIds))}
              disabled={archiveSelected.isPending}
              className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-2xs hover:bg-amber-100 transition cursor-pointer"
            >
              <Archive className="size-3.5" />
              <span>Archive</span>
            </button>

            {/* Restore selected */}
            <button
              onClick={() => restoreSelected.mutate(Array.from(selectedIds))}
              disabled={restoreSelected.isPending}
              className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-2xs hover:bg-blue-100 transition cursor-pointer"
            >
              <Package className="size-3.5" />
              <span>Restore</span>
            </button>

            {/* Delete Selected (Custom deletion) */}
            <button
              onClick={() => setShowDeleteSelectedModal(true)}
              className="flex items-center gap-1.5 rounded-xl bg-destructive px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700 transition cursor-pointer"
            >
              <Trash2 className="size-3.5" />
              <span>Delete Selected ({selectedIds.size})</span>
            </button>

            {/* Clear Selection */}
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              className="rounded-xl border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
        </div>
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
                    className={`group transition-colors ${
                      isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
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
                          className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3.5">
                        <img
                          src={p.image}
                          alt=""
                          loading="lazy"
                          width={48}
                          height={48}
                          className="size-12 shrink-0 rounded-xl border border-border/80 object-cover shadow-2xs transition-transform group-hover:scale-105"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.opacity = "0";
                          }}
                        />
                        <div className="max-w-[280px]">
                          <p className="font-semibold text-foreground line-clamp-1" title={p.name}>
                            {p.name}
                          </p>
                          <p className="text-xs font-medium text-muted-foreground mt-0.5">
                            {p.brand} <span className="opacity-50">•</span> {p.id}
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
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          p.stock === 0
                            ? "bg-red-50 text-red-600 border border-red-100"
                            : p.stock <= p.lowStockAt
                              ? "bg-amber-50 text-amber-600 border border-amber-100"
                              : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        }`}
                      >
                        {p.stock === 0 ? "Out of stock" : `${p.stock} in stock`}
                      </span>
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
                      <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={() => printLabel(p)}
                          disabled={isPrinting}
                          aria-label={`Print label for ${p.name}`}
                          title="Print Label (1-Click Direct Print)"
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-2xs transition-all hover:border-[#8B2020] hover:text-[#8B2020] hover:bg-red-50/50 cursor-pointer disabled:opacity-50"
                        >
                          <Printer className="size-4" />
                        </button>
                        <button
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          title="Edit"
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-border hover:text-foreground hover:bg-muted"
                        >
                          <Pencil className="size-4" />
                        </button>
                        {!p.isActive ? (
                          <button
                            onClick={() => restore.mutate(p.uuid)}
                            aria-label={`Restore ${p.name}`}
                            title="Restore to store"
                            className="rounded-lg border border-emerald-200 bg-card p-2 text-emerald-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50"
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
                            className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-amber-200 hover:text-amber-700 hover:bg-amber-50"
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
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-red-200 hover:text-red-700 hover:bg-red-50"
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
};
const DEFAULT_SETTINGS: Record<string, string> = {
  brand_name: "Zerah Baby And Kid's",
  announcement: "Free delivery on orders above ₹999 · Easy 7-day returns",
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
};

function SettingsTab() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);

  const { data, isLoading } = useQuery({
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
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<
    Database["public"]["Tables"]["profiles"]["Row"] | null
  >(null);

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

  return (
    <div className="space-y-4">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-lg font-bold">Registered Customers</h3>
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

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
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
                  <tr key={c.id} className="group transition-colors hover:bg-muted/40 align-middle">
                    {/* DP & Name */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="size-11 rounded-full border border-border bg-muted overflow-hidden shrink-0 flex items-center justify-center shadow-2xs">
                          {c.avatar_url ? (
                            <img
                              src={c.avatar_url}
                              alt={c.full_name || "Customer avatar"}
                              className="size-full object-cover"
                            />
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
                            target="_blank"
                            rel="noopener noreferrer"
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
                <div className="size-20 rounded-full border-4 border-card bg-muted overflow-hidden shadow-premium-md shrink-0 flex items-center justify-center">
                  {selectedCustomer.avatar_url ? (
                    <img
                      src={selectedCustomer.avatar_url}
                      alt={selectedCustomer.full_name || "Customer avatar"}
                      className="size-full object-cover"
                    />
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
        <p className="text-sm font-medium text-muted-foreground">
          {(coupons ?? []).length} coupon(s)
        </p>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-xl bg-[#8B2020] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a1c1c]"
        >
          <Plus className="size-4" /> Add coupon
        </button>
      </div>

      {showForm && (
        <form
          className="space-y-4 rounded-2xl border border-gray-100 bg-card p-6 shadow-sm"
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
            <label className="text-sm font-semibold text-foreground">
              Code
              <input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WELCOME10"
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-foreground">
              Type
              <select
                value={form.discount_type}
                onChange={(e) =>
                  setForm({ ...form, discount_type: e.target.value as "percentage" | "fixed" })
                }
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-foreground">
              Value
              <input
                type="number"
                required
                min={1}
                value={form.discount_value}
                onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-foreground">
              Min order value (â‚¹)
              <input
                type="number"
                min={0}
                value={form.minimum_order_value}
                onChange={(e) => setForm({ ...form, minimum_order_value: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-foreground">
              Max discount (â‚¹, 0=unlimited)
              <input
                type="number"
                min={0}
                value={form.maximum_discount}
                onChange={(e) => setForm({ ...form, maximum_discount: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
              />
            </label>
            <label className="text-sm font-semibold text-foreground">
              Usage limit (0=unlimited)
              <input
                type="number"
                min={0}
                value={form.usage_limit}
                onChange={(e) => setForm({ ...form, usage_limit: Number(e.target.value) })}
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-sm"
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
              className="rounded-xl border border-border bg-card px-6 py-2.5 text-sm font-semibold text-muted-foreground shadow-sm transition hover:bg-muted"
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

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-card shadow-sm">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-gray-100">
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
              <tr key={c.id} className="group transition-colors hover:bg-muted/50">
                <td className="px-5 py-4 font-mono font-bold text-foreground">{c.code}</td>
                <td className="px-5 py-4 font-medium text-muted-foreground">
                  {c.discount_type === "percentage"
                    ? `${c.discount_value}%`
                    : `â‚¹${c.discount_value}`}
                  {c.maximum_discount > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      (max â‚¹{c.maximum_discount})
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-muted-foreground">â‚¹{c.minimum_order_value}</td>
                <td className="px-5 py-4 font-medium text-muted-foreground">
                  {c.usage_count}
                  {c.usage_limit > 0 ? <span className="text-gray-400">/{c.usage_limit}</span> : ""}
                </td>
                <td className="px-5 py-4">
                  <button
                    onClick={() => toggleCoupon.mutate({ id: c.id, active: !c.active })}
                    className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${c.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100" : "bg-muted text-muted-foreground border border-border hover:bg-muted"}`}
                  >
                    {c.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-5 py-4 text-right">
                  <button
                    onClick={() => deleteCoupon.mutate(c.id)}
                    className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-red-200 hover:text-red-700 hover:bg-red-50"
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
                  className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
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
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative size-14 rounded-xl overflow-hidden border border-border hover:border-[#8B2020] transition hover:scale-105"
                      >
                        <img
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

/* ---------------- Inventory ---------------- */
function InventoryTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["inventory-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, slug, name, brand, category, stock, low_stock_at, sku, is_active, product_images(public_url, is_primary, sort_order)",
        )
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
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total SKUs
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">{totalSKUs}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Low Stock
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-amber-600">{lowStock}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f === "low" ? "Low Stock" : f === "out" ? "Out of Stock" : "All"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-muted-foreground">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 font-semibold tracking-wider w-16">Image</th>
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
                    onImageClick={(url) => setSelectedImage(url)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt="Product Preview"
            className="max-h-[80vh] w-auto rounded-xl shadow-2xl object-contain bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function InventoryRow({
  product,
  onSave,
  onImageClick,
}: {
  product: {
    id: string;
    slug: string;
    name: string;
    brand: string;
    category: string;
    stock: number;
    low_stock_at: number;
    sku: string | null;
    is_active: boolean;
    product_images?: Array<{ public_url: string; is_primary?: boolean; sort_order?: number }>;
  };
  onSave: (val: number) => void;
  onImageClick?: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(product.stock);

  const isOut = product.stock === 0;
  const isLow = product.stock > 0 && product.stock <= product.low_stock_at;

  return (
    <tr className="hover:bg-muted/50 transition-colors">
      <td className="px-6 py-4">
        {product.product_images?.[0]?.public_url ? (
          <button
            onClick={() =>
              onImageClick?.(imageFor(product.category, product.product_images?.[0]?.public_url))
            }
            className="hover:opacity-80 transition-opacity"
          >
            <img
              src={imageFor(product.category, product.product_images?.[0]?.public_url)}
              alt={product.name}
              className="size-10 rounded-lg object-cover border border-border"
            />
          </button>
        ) : (
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground border border-border">
            <Package className="size-5" />
          </div>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="font-semibold text-foreground">{product.name}</div>
        <div className="text-xs text-gray-400">{product.brand}</div>
      </td>
      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{product.sku}</td>
      <td className="px-6 py-4 text-muted-foreground">{product.category}</td>
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
              className="w-16 rounded border border-border px-2 py-1 text-sm outline-none focus:border-[#8B2020] focus:ring-1 focus:ring-[#8B2020]"
            />
            <button
              onClick={() => {
                onSave(val);
                setEditing(false);
              }}
              className="rounded bg-muted p-1 text-green-600 hover:bg-green-100"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={`font-semibold hover:underline ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-foreground"}`}
          >
            {product.stock}
          </button>
        )}
      </td>
      <td className="px-6 py-4 text-muted-foreground">{product.low_stock_at}</td>
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

  const save = useMutation({
    mutationFn: async () => {
      const isAnnounceEmpty = !form.announcement.trim();
      const rows = [
        { key: "announcement", value: form.announcement.trim() },
        {
          key: "announcement_enabled",
          value: isAnnounceEmpty || !form.announcement_enabled ? "false" : "true",
        },
        { key: "announcement_bg", value: form.announcement_bg },
        { key: "announcement_text_color", value: form.announcement_text_color },
        { key: "announcement_link", value: form.announcement_link.trim() },
        { key: "instagram_url", value: form.instagram_url.trim() },
        { key: "facebook_url", value: form.facebook_url.trim() },
        { key: "whatsapp_url", value: form.whatsapp_url.trim() },
      ];

      const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marketing, Announcement & Social settings saved successfully!");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save settings"),
  });

  const normalizeUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    if (trimmed.startsWith("wa.me/")) return `https://${trimmed}`;
    if (/^\+?[0-9]{10,14}$/.test(trimmed.replace(/[\s-]/g, ""))) {
      const cleanNum = trimmed.replace(/[^0-9]/g, "");
      const fullNum = cleanNum.length === 10 ? `91${cleanNum}` : cleanNum;
      return `https://wa.me/${fullNum}`;
    }
    return `https://${trimmed}`;
  };

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
        {/* Header Title */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
          <div>
            <h2 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              <Megaphone className="size-7 text-primary" />
              Marketing &amp; Promotions
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your top announcement bar, live color styling, and social media channels in one
              place.
            </p>
          </div>

          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            {save.isPending ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Saving...
              </>
            ) : (
              <>
                <Check className="size-4" /> Save &amp; Publish All
              </>
            )}
          </button>
        </div>

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
              onChange={(e) => setForm({ ...form, announcement: e.target.value })}
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
            <label
              htmlFor="mkt-announcement-link"
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              <ExternalLink className="size-3.5" /> Target Page Link (Optional Clickable Action)
            </label>
            <input
              id="mkt-announcement-link"
              type="text"
              value={form.announcement_link}
              onChange={(e) => setForm({ ...form, announcement_link: e.target.value })}
              placeholder="e.g. /shop or /product/123 or https://..."
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
            />
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
                  Instagram Profile URL
                </label>
                {form.instagram_url && (
                  <a
                    href={normalizeUrl(form.instagram_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    Test Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Kya change hoga:</span> Footer aur
                Contact page par Instagram icon ka destination link.
              </p>
              <input
                id="mkt-instagram"
                type="text"
                value={form.instagram_url}
                onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
                placeholder="https://www.instagram.com/zerah_kids/"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
              />
            </div>

            {/* Facebook */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mkt-facebook"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Facebook Page URL
                </label>
                {form.facebook_url && (
                  <a
                    href={normalizeUrl(form.facebook_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                  >
                    Test Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Kya change hoga:</span> Footer aur
                Contact page par Facebook icon ka destination link.
              </p>
              <input
                id="mkt-facebook"
                type="text"
                value={form.facebook_url}
                onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
                placeholder="https://facebook.com/zerahbaby"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
              />
            </div>

            {/* WhatsApp */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="mkt-whatsapp"
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  WhatsApp Direct Chat Link or Phone
                </label>
                {form.whatsapp_url && (
                  <a
                    href={normalizeUrl(form.whatsapp_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Test Chat Link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Kya change hoga:</span> Footer me
                WhatsApp icon aur floating chat button ka link (e.g. `https://wa.me/919057074777` ya
                direct phone number `9057074777`).
              </p>
              <input
                id="mkt-whatsapp"
                type="text"
                value={form.whatsapp_url}
                onChange={(e) => setForm({ ...form, whatsapp_url: e.target.value })}
                placeholder="https://wa.me/919057074777 or 9057074777"
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
              />
            </div>
          </div>
        </div>

        {/* Unified Bottom Submit Button */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-8 py-3.5 text-base font-bold text-primary-foreground shadow-lg transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
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
