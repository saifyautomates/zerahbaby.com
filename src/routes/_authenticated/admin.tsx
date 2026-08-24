//
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
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
} from "lucide-react";
import logo from "@/assets/zerah-logo.png";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useIsAdmin, useSession } from "@/lib/auth";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { useAllOrders, useCustomers, useProfile, orderStatuses } from "@/lib/orders";
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
import { AdminGlobalSearch } from "@/components/admin/AdminGlobalSearch";
import { useTheme } from "@/lib/theme";
import { useAdminNotifications } from "@/lib/admin-notifications";
import { initGlobalBarcodeScanner } from "@/lib/barcode-scanner";

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

  // Dynamic admin name and 2-letter initials
  const adminName = profile?.full_name || user?.email?.split("@")[0] || "Administrator";
  const initials = useMemo(() => {
    if (profile?.full_name) {
      const parts = profile.full_name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "AD";
  }, [profile, user]);

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

  const NAVIGATION: Array<{ key: Tab; label: string; icon: typeof BarChart3; badge?: string }> = [
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
                      active ? "bg-white text-primary" : "bg-rose-500 text-white"
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

            {/* Authenticated Admin Profile Monogram */}
            <div className="flex items-center gap-2.5 pl-3 border-l border-border">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8B2020] to-[#c0392b] text-white font-black text-[11px] shadow-xs select-none">
                {initials}
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
      </div>
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
  owner_notification_email: "Owner Sale Alert Email (Recipient)",
  owner_notify_offline_sales: "Enable Offline POS Sale Alerts (true/false)",
  owner_notify_online_sales: "Enable Online Order Alerts (true/false)",
};

function SettingsTab() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);

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
    <div className="max-w-2xl space-y-8">
      {/* ─── SALE NOTIFICATIONS CARD ──────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h3 className="font-display text-lg font-bold">Owner Sale Notifications</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive automatic email alerts on every offline POS sale &amp; online paid order via
              Resend.
            </p>
          </div>
          <button
            type="button"
            onClick={onSendTestNotification}
            disabled={testingEmail}
            className="rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
          >
            {testingEmail ? "Sending Test…" : "Send Test Email"}
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipient Email Address
            </span>
            <input
              type="email"
              value={current.owner_notification_email ?? ""}
              onChange={(e) => setValues({ ...current, owner_notification_email: e.target.value })}
              placeholder="e.g. owner@zerahkids.com"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer">
              <span className="text-sm font-medium">Offline POS Sale Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_offline_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_offline_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary"
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer">
              <span className="text-sm font-medium">Online Paid Order Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_online_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_online_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary"
              />
            </label>
          </div>
        </div>
      </div>

      {/* ─── GENERAL STORE SETTINGS ───────────────────────────── */}
      <div className="space-y-4">
        <h3 className="font-display text-lg font-bold">General Store Information</h3>
        {Object.keys(current)
          .filter((k) => !k.startsWith("owner_notify"))
          .map((key) => (
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
      </div>

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
