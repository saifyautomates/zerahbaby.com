/**
 * OfflineAnalyticsTab — Enhanced POS analytics with payment method breakdown,
 * per-sale receipt printing, sale details expansion, and top products view.
 * Includes Customer Footfall analytics powered by the POS token system.
 */
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor, getProductUrl } from "@/lib/store";
import { toast } from "sonner";
import clothing from "@/assets/cat-clothing.jpg";
import { useOfflineReturnsList } from "@/lib/pos-returns";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { SmartSelectionSummary } from "@/components/admin/SmartSelectionSummary";
import { useTableSelection, getPOSSelectionMetrics } from "@/lib/table-selection";
import {
  getAllQueuedSales,
  deleteQueuedSale,
  clearAllQueuedSales,
  processOfflineSyncQueue,
  reconcileLocalQueueWithCloudSales,
  type OfflineQueueItem,
} from "@/lib/offline-sync-engine";
import {
  useCanonicalPOSSales,
  invalidateCanonicalReportingQueries,
  notifyPOSSaleChanged,
} from "@/lib/canonical-reporting";
import { isValidPOSSale, useReportingDateRange, type DatePreset } from "@/lib/financial-reporting";
import {
  BarChart3,
  Receipt,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Banknote,
  Smartphone,
  TrendingUp,
  Package,
  ExternalLink,
  Users,
  Clock,
  Ban,
  Trash2,
  Search,
  X,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Check,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type SaleItem = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  product_id?: string | null;
  product_slug?: string;
  mrp_snapshot?: number;
  barcode_snapshot?: string;
};

type Sale = {
  id: string;
  sale_number: string;
  idempotency_key?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  payment_method: string;
  created_at: string;
  /** Business transaction status ("completed", "cancelled", etc.) */
  status?: string | null;
  /** Transport sync status ("PENDING_SYNC", "SYNC_FAILED", "SYNCED", etc.) */
  sync_status?: string | null;
  transaction_status?: string | null;
  last_error?: string | null;
  /** Daily sequential walk-in token (1, 2, 3...). Resets each IST calendar day. */
  pos_token_number: number | null;
  /** IST calendar date string (YYYY-MM-DD) for this token. */
  pos_token_date: string | null;
  is_voided?: boolean | null;
  void_reason?: string | null;
  voided_at?: string | null;
  offline_sale_items?: SaleItem[];
};

/** Convert a UTC ISO timestamp to IST (UTC+5:30) and return hour 0-23 */
function utcToISTHour(utcISOString: string): number {
  const d = new Date(utcISOString);
  // IST = UTC + 5h30m = UTC + 330 minutes
  const istMs = d.getTime() + 330 * 60 * 1000;
  return new Date(istMs).getUTCHours();
}

/** Get the IST date string (YYYY-MM-DD) for a UTC ISO timestamp */
function utcToISTDate(utcISOString: string): string {
  const d = new Date(utcISOString);
  const istMs = d.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Current IST date string (YYYY-MM-DD) */
function todayIST(): string {
  return utcToISTDate(new Date().toISOString());
}

const DATE_RANGE_OPTIONS: { key: DatePreset; label: string; subLabel: string }[] = [
  { key: "today", label: "Today", subLabel: "Today's activity" },
  { key: "yesterday", label: "Yesterday", subLabel: "Yesterday's activity" },
  { key: "7d", label: "Last 7 Days", subLabel: "Past 7 days" },
  { key: "30d", label: "Last 30 Days", subLabel: "Past 30 days" },
  { key: "this_month", label: "This Month", subLabel: "Month to date" },
  { key: "all", label: "All Time", subLabel: "Entire history" },
  { key: "custom", label: "Custom Range", subLabel: "Specific start & end" },
];

export function OfflineAnalyticsTab() {
  const qc = useQueryClient();
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [saleToVoid, setSaleToVoid] = useState<{
    id: string;
    sale_number: string;
    isDraft?: boolean;
  } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [restoreStock, setRestoreStock] = useState(true);

  const {
    preset: datePreset,
    startDate: customStart,
    endDate: customEnd,
    bounds: reportingBounds,
    setDateRange,
  } = useReportingDateRange();

  const { dateRangeText, inCurrentPeriod } = reportingBounds;
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [customStartInput, setCustomStartInput] = useState(customStart || "");
  const [customEndInput, setCustomEndInput] = useState(customEnd || "");
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(event.target as Node)) {
        setIsDateDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const voidSaleMutation = useMutation({
    mutationFn: async ({
      saleId,
      reason,
      restoreStock: shouldRestore,
    }: {
      saleId: string;
      reason: string;
      restoreStock: boolean;
    }) => {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saleId);

      // Handle locally queued offline sales (IDs like "off_1788364533124_nme6c")
      if (!isUuid || saleId.startsWith("off_")) {
        await deleteQueuedSale(saleId);
        return { success: true, message: "Queued offline draft discarded." };
      }

      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; message?: string; sale_number?: string } | null;
          error: { message: string } | null;
        }>
      )("admin_void_offline_sale", {
        _sale_id: saleId,
        _reason: reason.trim() || "Administrative void",
        _restore_stock: shouldRestore,
      });

      if (error) {
        throw new Error(error.message || "Failed to void POS sale");
      }

      return data;
    },
    onSuccess: (res) => {
      toast.success(res?.message || "Sale voided successfully. Audit trail preserved.");
      invalidateCanonicalReportingQueries(qc);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to void sale");
    },
  });

  // Fetch all products for dynamic image & slug resolution
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products-lookup"],
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, slug, name, sku, barcode, brand, category, price, stock, product_images(public_url, is_primary, sort_order)",
        );
      if (error) return [];
      return data ?? [];
    },
  });

  // Fast product lookup map
  const productLookup = useMemo(() => {
    const byId = new Map<string, (typeof products)[0]>();
    const bySku = new Map<string, (typeof products)[0]>();
    const byName = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.id) byId.set(p.id, p);
      if (p.sku) bySku.set(p.sku.toLowerCase().trim(), p);
      if (p.name) byName.set(p.name.toLowerCase().trim(), p);
    }
    return { byId, bySku, byName };
  }, [products]);

  const resolveProduct = (item: {
    product_id?: string | null;
    product_slug?: string;
    sku?: string;
    name?: string;
  }) => {
    if (item.product_id && productLookup.byId.has(item.product_id)) {
      return productLookup.byId.get(item.product_id);
    }
    if (item.sku && productLookup.bySku.has(item.sku.toLowerCase().trim())) {
      return productLookup.bySku.get(item.sku.toLowerCase().trim());
    }
    if (item.name && productLookup.byName.has(item.name.toLowerCase().trim())) {
      return productLookup.byName.get(item.name.toLowerCase().trim());
    }
    return null;
  };

  const { data: sales, isLoading, refetch: refetchSales } = useCanonicalPOSSales();

  const [searchQuery, setSearchQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "cash" | "upi" | "card">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "all">(50);

  // Auto-reset page when filtering or searching
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, paymentFilter]);

  // Authoritative business accounting: strictly completed transactions only!
  const activeSales = useMemo(
    () => (sales ?? []).filter(isValidPOSSale) as unknown as Sale[],
    [sales],
  );

  // Local transactions pending or failed cloud synchronization
  const uncommittedSales = useMemo(
    () => (sales ?? []).filter((s) => s.status === "sync_pending" || s.status === "sync_failed"),
    [sales],
  );

  const filteredSales = useMemo(() => {
    if (!sales) return [];
    let list = sales;

    // Strict date range filter based on canonical reporting bounds
    list = list.filter((s) => inCurrentPeriod(s.created_at));

    if (paymentFilter !== "all") {
      list = list.filter((s) => s.payment_method === paymentFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;

    return list.filter((s) => {
      const matchesSaleNumber = (s.sale_number || "").toLowerCase().includes(q);
      const matchesCustomerName = (s.customer_name || "").toLowerCase().includes(q);
      const matchesCustomerPhone = (s.customer_phone || "").toLowerCase().includes(q);
      const matchesCustomerEmail = (s.customer_email || "").toLowerCase().includes(q);
      const matchesToken = s.pos_token_number != null && String(s.pos_token_number).includes(q);
      const matchesItem = (s.offline_sale_items ?? []).some(
        (item: SaleItem) =>
          (item.name || "").toLowerCase().includes(q) || (item.sku || "").toLowerCase().includes(q),
      );

      return (
        matchesSaleNumber ||
        matchesCustomerName ||
        matchesCustomerPhone ||
        matchesCustomerEmail ||
        matchesToken ||
        matchesItem
      );
    });
  }, [sales, searchQuery, paymentFilter, inCurrentPeriod]);

  const salesSelection = useTableSelection({ items: filteredSales });
  const salesMetrics = useMemo(
    () => getPOSSelectionMetrics(salesSelection.selectedItems as any),
    [salesSelection.selectedItems],
  );

  const totalPages =
    pageSize === "all" ? 1 : Math.ceil(filteredSales.length / (pageSize as number)) || 1;
  const visibleSales = useMemo(() => {
    if (pageSize === "all") return filteredSales;
    const size = pageSize as number;
    const start = (currentPage - 1) * size;
    return filteredSales.slice(start, start + size);
  }, [filteredSales, currentPage, pageSize]);
  const today = todayIST();

  /** Sales for today (IST) */
  const todaySales = useMemo(
    () => activeSales.filter((s) => utcToISTDate(s.created_at) === today),
    [activeSales, today],
  );

  /** Average customers per active-sales-day */
  const avgCustomersPerDay = useMemo(() => {
    if (activeSales.length === 0) return 0;
    const uniqueDays = new Set(activeSales.map((s) => utcToISTDate(s.created_at)));
    return Math.round((activeSales.length / uniqueDays.size) * 10) / 10;
  }, [activeSales]);

  /** Hourly footfall for today (IST) — 24 buckets */
  const hourlyFootfall = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
      customers: 0,
    }));
    for (const s of todaySales) {
      const h = utcToISTHour(s.created_at);
      buckets[h].customers += 1;
    }
    return buckets;
  }, [todaySales]);

  const peakHour = useMemo(
    () =>
      hourlyFootfall.reduce(
        (best, b) => (b.customers > best.customers ? b : best),
        hourlyFootfall[0],
      ),
    [hourlyFootfall],
  );

  const { data: returnsList = [] } = useOfflineReturnsList();

  // Returns calculations
  const totalReturnsAmount = useMemo(
    () => returnsList.reduce((sum, r) => sum + Number(r.refund_amount || 0), 0),
    [returnsList],
  );
  const todayReturnsAmount = useMemo(
    () =>
      returnsList
        .filter((r) => utcToISTDate(r.created_at) === today)
        .reduce((sum, r) => sum + Number(r.refund_amount || 0), 0),
    [returnsList, today],
  );

  // Canonical Period POS Sales (synchronized with active reporting date range)
  const periodActiveSales = useMemo(
    () => activeSales.filter((s) => inCurrentPeriod(s.created_at)),
    [activeSales, inCurrentPeriod],
  );

  const totalSalesRevenue = periodActiveSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const grossRevenue = totalSalesRevenue;
  const totalSalesCount = periodActiveSales.length;
  const cashSales = periodActiveSales.filter((s) => s.payment_method === "cash");
  const upiSales = periodActiveSales.filter((s) => s.payment_method === "upi");
  const cardSales = periodActiveSales.filter((s) => s.payment_method === "card");
  const otherSales = periodActiveSales.filter(
    (s) => !["cash", "upi", "card"].includes(s.payment_method),
  );

  const cashTotal = cashSales.reduce((s, o) => s + Number(o.total), 0);
  const upiTotal = upiSales.reduce((s, o) => s + Number(o.total), 0);
  const cardTotal = cardSales.reduce((s, o) => s + Number(o.total), 0);
  const otherTotal = otherSales.reduce((s, o) => s + Number(o.total), 0);
  const totalDiscount = periodActiveSales.reduce(
    (sum, sale) => sum + Number(sale.discount ?? 0),
    0,
  );

  // Today's revenue
  const todaySalesRevenue = todaySales.reduce((s, o) => s + Number(o.total), 0);
  const todayRevenue = todaySalesRevenue;

  // Top products with rich metadata (period synchronized)
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        sku: string;
        product_id?: string | null;
        product_slug?: string;
        qty: number;
        revenue: number;
      }
    >();
    for (const sale of (activeSales ?? []).filter((s) => inCurrentPeriod(s.created_at))) {
      for (const item of sale.offline_sale_items ?? []) {
        const key = item.sku || item.name;
        const cur = map.get(key) ?? {
          name: item.name,
          sku: item.sku || "",
          product_id: item.product_id,
          product_slug: item.product_slug,
          qty: 0,
          revenue: 0,
        };
        map.set(key, {
          name: item.name,
          sku: item.sku || cur.sku,
          product_id: item.product_id || cur.product_id,
          product_slug: item.product_slug || cur.product_slug || undefined,
          qty: cur.qty + item.qty,
          revenue: cur.revenue + Number(item.subtotal),
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [activeSales, inCurrentPeriod]);

  const handleClearDummyData = async () => {
    if (
      !window.confirm(
        "Are you sure you want to completely WIPE all offline sales history? This action cannot be undone.",
      )
    )
      return;
    try {
      // 1. Clear local offline queue, cart, and IndexedDB stores
      if (typeof window !== "undefined") {
        await clearAllQueuedSales();
      }

      // 2. Try RPC first
      const { error: rpcErr } = await (supabase.rpc as any)("admin_nuke_all_sales");
      if (rpcErr) {
        // Fallback to direct DELETE
        await supabase
          .from("offline_sale_items")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await supabase
          .from("offline_sales")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        await supabase
          .from("pos_customers")
          .update({ total_purchases: 0, total_spend: 0 })
          .neq("id", "00000000-0000-0000-0000-000000000000");
      }

      toast.success("Successfully wiped all sales history.");
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      toast.error("Error: " + (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Synchronized Reporting Date Range Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-1 mb-1">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-black tracking-tight text-foreground font-display">
              POS Store Register & Sales Ledger
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>IST Synchronized</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Authoritative physical walk-in sales ledger synchronized with active reporting period (
            {dateRangeText}).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Synchronized Date Range Dropdown */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDateDropdownOpen((prev) => !prev)}
              aria-expanded={isDateDropdownOpen}
              aria-label={`Selected reporting period: ${dateRangeText}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition cursor-pointer"
            >
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate max-w-[200px] sm:max-w-none">{dateRangeText}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                  isDateDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isDateDropdownOpen && (
              <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-xl animate-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
                  Reporting Period
                </div>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      if (opt.key === "custom") {
                        setDateRange("custom", customStartInput, customEndInput);
                      } else {
                        setDateRange(opt.key);
                        setIsDateDropdownOpen(false);
                      }
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition text-left ${
                      datePreset === opt.key
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <div>
                      <p>{opt.label}</p>
                      <p
                        className={`text-[10px] ${
                          datePreset === opt.key
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {opt.subLabel}
                      </p>
                    </div>
                    {datePreset === opt.key && <Check className="h-3.5 w-3.5 shrink-0 ml-2" />}
                  </button>
                ))}

                {datePreset === "custom" && (
                  <div className="p-2.5 border-t border-border mt-1.5 space-y-2 bg-muted/30 rounded-xl">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      Custom IST Window
                    </p>
                    <div className="space-y-1.5">
                      <div>
                        <label className="text-[10px] text-muted-foreground block font-medium">
                          Start Date
                        </label>
                        <input
                          type="date"
                          value={customStartInput}
                          onChange={(e) => setCustomStartInput(e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded-lg border border-border bg-background text-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block font-medium">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={customEndInput}
                          onChange={(e) => setCustomEndInput(e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded-lg border border-border bg-background text-foreground"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (customStartInput && customEndInput) {
                            setDateRange("custom", customStartInput, customEndInput);
                            setIsDateDropdownOpen(false);
                          }
                        }}
                        disabled={!customStartInput || !customEndInput}
                        className="w-full mt-1 py-1.5 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        Apply Range
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleClearDummyData}
            className="px-3 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/25 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Clear Test Sales
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          CUSTOMER FOOTFALL ANALYTICS
          Powered by the POS Token System (IST timezone)
          ══════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-border/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Customer Footfall — Today (IST)
          </h3>
        </div>

        {/* Footfall Summary Cards */}
        <div className="grid grid-cols-3 divide-x divide-border/60">
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Customers Today
            </p>
            <p className="text-4xl font-black text-primary leading-none">{todaySales.length}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {todaySales.length === 1 ? "walk-in today" : "walk-ins today"}
            </p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Avg Customers / Day
            </p>
            <p className="text-4xl font-black text-foreground leading-none">{avgCustomersPerDay}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              across active sales days
            </p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Peak Hour Today
            </p>
            {peakHour.customers > 0 ? (
              <>
                <p className="text-4xl font-black text-amber-600 leading-none">
                  {peakHour.label.toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">
                  {peakHour.customers} {peakHour.customers === 1 ? "customer" : "customers"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">No sales yet</p>
            )}
          </div>
        </div>

        {/* Hourly Footfall Chart */}
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 mb-3 mt-2">
            <Clock className="size-3.5 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Hourly Footfall (IST)
            </p>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={hourlyFootfall} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { label: string; customers: number };
                  return (
                    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-xs">
                      <p className="font-bold text-foreground">{d.label.toUpperCase()}</p>
                      <p className="text-muted-foreground">
                        {d.customers} {d.customers === 1 ? "customer" : "customers"}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="customers" radius={[3, 3, 0, 0]} maxBarSize={20}>
                {hourlyFootfall.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={
                      entry.customers === peakHour.customers && entry.customers > 0
                        ? "hsl(239, 84%, 67%)"
                        : "hsl(239, 84%, 80%)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-600" /> Today's Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {todaySales.length}
          </p>
          <p className="mt-1 text-sm font-semibold text-primary">{formatPrice(todayRevenue)}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Receipt className="size-4 text-blue-600" /> Total POS Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {totalSalesCount}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BarChart3 className="size-4 text-emerald-600" /> Total Sales Value
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-primary">
            {formatPrice(totalSalesRevenue)}
          </p>
          <div className="mt-1 space-y-0.5 text-xs">
            {totalReturnsAmount > 0 && (
              <p className="text-amber-600 dark:text-amber-400 font-semibold">
                Returns Issued: {formatPrice(totalReturnsAmount)}
              </p>
            )}
            {totalDiscount > 0 && (
              <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                Discounts given: {formatPrice(totalDiscount)}
              </p>
            )}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CreditCard className="size-4 text-amber-600" /> Payment Breakdown
          </p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <Banknote className="size-3.5 text-emerald-600" /> Cash
              </span>
              <span className="font-bold text-foreground">
                {cashSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(cashTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <Smartphone className="size-3.5 text-indigo-600" /> UPI
              </span>
              <span className="font-bold text-foreground">
                {upiSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(upiTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <CreditCard className="size-3.5 text-blue-600" /> Card
              </span>
              <span className="font-bold text-foreground">
                {cardSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(cardTotal)})
                </span>
              </span>
            </div>
            {otherSales.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-foreground/80">Other</span>
                <span className="font-bold text-foreground">
                  {otherSales.length}{" "}
                  <span className="text-muted-foreground font-normal text-xs">
                    ({formatPrice(otherTotal)})
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Products */}
      {topProducts.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Package className="size-4 text-primary" /> Top Products (POS)
            </h3>
            <span className="text-[11px] text-muted-foreground font-medium">
              Click any product to open in store
            </span>
          </div>
          <div className="space-y-2.5">
            {topProducts.map((p, i) => {
              const matchedProduct = resolveProduct(p);
              const imgUrl = imageFor(
                matchedProduct?.category || "clothing",
                (matchedProduct as { product_images?: { public_url: string }[] })
                  ?.product_images?.[0]?.public_url,
              );
              const slug = matchedProduct?.slug || p.product_slug || p.sku;

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => slug && (window.location.href = getProductUrl(slug))}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && slug) {
                      e.preventDefault();
                      window.location.href = getProductUrl(slug);
                    }
                  }}
                  title={`Open "${p.name}" in store`}
                  className="group flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 hover:bg-muted/60 p-3 transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px] border border-primary/20">
                      {i + 1}
                    </span>
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xs group-hover:border-primary/40 transition">
                      <img
                        src={imgUrl}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = clothing;
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        <ExternalLink className="size-3 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {p.sku
                          ? `SKU: ${p.sku}`
                          : matchedProduct?.category
                            ? `Category: ${matchedProduct.category}`
                            : "In-store product"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0 pl-3">
                    <span className="text-xs font-semibold text-muted-foreground bg-background px-2.5 py-1 rounded-lg border border-border/80">
                      {p.qty} sold
                    </span>
                    <span className="font-extrabold text-foreground text-sm">
                      {formatPrice(p.revenue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sales Table with Live Search */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        {/* Table Search & Filter Bar */}
        <div className="p-4 sm:p-5 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by receipt # (e.g. POS-2609), customer name, phone, or product..."
              className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                title="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: "all", label: `All (${sales?.length || 0})` },
              { id: "cash", label: `💵 Cash (${cashSales.length})` },
              { id: "upi", label: `📱 UPI (${upiSales.length})` },
              { id: "card", label: `💳 Card (${cardSales.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPaymentFilter(tab.id as "all" | "cash" | "upi" | "card")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                  paymentFilter === tab.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Uncommitted Local Sales Banner */}
        {uncommittedSales.length > 0 && (
          <div className="mx-6 mt-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="font-semibold text-sm">
                  {uncommittedSales.length} Offline Sale{uncommittedSales.length > 1 ? "s" : ""}{" "}
                  Pending Cloud Sync
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Local offline sales (
                  {formatPrice(uncommittedSales.reduce((s, x) => s + x.total, 0))}) are segregated
                  from official accounting totals until committed to the cloud.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  if (confirm("Discard all pending offline drafts? This cannot be undone.")) {
                    await clearAllQueuedSales();
                    toast.success("All pending offline drafts discarded.");
                    invalidateCanonicalReportingQueries(qc);
                    notifyPOSSaleChanged();
                    refetchSales();
                  }
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 font-medium text-xs transition cursor-pointer whitespace-nowrap shadow-xs"
              >
                <Trash2 className="size-3.5" />
                Discard All
              </button>
              <button
                type="button"
                onClick={async () => {
                  toast.info("Retrying all offline sales sync...");
                  await processOfflineSyncQueue({ forceRetry: true });
                  refetchSales();
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs transition cursor-pointer shadow-xs whitespace-nowrap"
              >
                <RefreshCw className="size-3.5" />
                Sync All Now
              </button>
            </div>
          </div>
        )}

        {/* Sticky Smart Selection Summary */}
        <SmartSelectionSummary
          selectedCount={salesSelection.selectedCount}
          selectedLabel="Selected Sales"
          metrics={salesMetrics}
          onClear={salesSelection.clearSelection}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="w-10 px-4 py-4">
                  <input
                    type="checkbox"
                    checked={salesSelection.isAllVisibleSelected(visibleSales)}
                    ref={(el) => {
                      if (el) el.indeterminate = salesSelection.isIndeterminate(visibleSales);
                    }}
                    onChange={() => salesSelection.toggleAllVisible(visibleSales)}
                    aria-label="Select all sales"
                    className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                  />
                </th>
                <th className="px-5 py-4 w-8"></th>
                <th className="px-5 py-4">Token</th>
                <th className="px-5 py-4">Receipt No</th>
                <th className="px-5 py-4">Date (IST)</th>
                <th className="px-5 py-4 min-w-[220px]">Items / Products</th>
                <th className="px-5 py-4">Customer</th>
                <th className="px-5 py-4">Payment</th>
                <th className="px-5 py-4">Discount</th>
                <th className="px-5 py-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleSales.map((sale) => {
                const isSelected = salesSelection.isSelected(sale.id);
                const isExpanded = expandedSale === sale.id;
                return (
                  <React.Fragment key={sale.id}>
                    <tr
                      className={`group cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/5 font-medium"
                          : sale.status === "cancelled" ||
                              sale.status === "voided" ||
                              sale.is_voided
                            ? "opacity-60 bg-muted/20 hover:bg-muted/30"
                            : "hover:bg-muted/40"
                      }`}
                      onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                    >
                      <td className="w-10 px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => salesSelection.toggle(sale.id)}
                          aria-label={`Select sale ${sale.sale_number}`}
                          className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                        />
                      </td>
                      <td className="px-5 py-4 w-8">
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </td>
                      {/* Token badge */}
                      <td className="px-5 py-4">
                        {sale.pos_token_number != null ? (
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-800 font-black text-sm border border-indigo-200">
                            {sale.pos_token_number}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-bold text-foreground font-mono">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{sale.sale_number}</span>
                          {sale.return_status === "returned" && (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30"
                              title="Original sale has been 100% returned"
                            >
                              Returned
                            </span>
                          )}
                          {sale.return_status === "partially_returned" && (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                              title="Items in this sale have been partially returned"
                            >
                              Partially Returned
                            </span>
                          )}
                          {(sale.status === "voided" || sale.is_voided) && (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                              title={
                                sale.void_reason
                                  ? `Void reason: ${sale.void_reason}`
                                  : "Voided transaction"
                              }
                            >
                              🚫 Voided
                            </span>
                          )}
                          {sale.status === "cancelled" && !sale.is_voided && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-muted text-muted-foreground border border-border">
                              Cancelled
                            </span>
                          )}
                          {sale.status === "sync_pending" && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 animate-pulse">
                              ⚡ Offline Queued
                            </span>
                          )}
                          {sale.status === "sync_failed" && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  toast.info("Retrying offline sync to cloud...");
                                  await processOfflineSyncQueue({ forceRetry: true });
                                  refetchSales();
                                }}
                                className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 hover:bg-red-500/25 transition cursor-pointer flex items-center gap-1"
                                title={
                                  sale.last_error
                                    ? `Validation Error: ${sale.last_error}. Click to retry cloud sync.`
                                    : "Click to retry cloud upload"
                                }
                              >
                                <RefreshCw className="size-2.5" />
                                Retry Sync
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm("Discard this unsynced draft permanently?")) {
                                    await deleteQueuedSale(sale.id);
                                    toast.success("Local draft discarded");
                                    invalidateCanonicalReportingQueries(qc);
                                    notifyPOSSaleChanged();
                                    refetchSales();
                                  }
                                }}
                                className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition cursor-pointer"
                                title="Discard invalid local draft"
                              >
                                Discard
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground font-medium text-xs">
                        {new Date(sale.created_at).toLocaleString("en-IN")}
                      </td>
                      {/* Product thumbnails & names */}
                      <td className="px-5 py-4 whitespace-normal">
                        <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[280px]">
                          {(sale.offline_sale_items ?? []).map((item: SaleItem, i: number) => {
                            const prod = resolveProduct(item);
                            const itemImg = imageFor(
                              prod?.category || "clothing",
                              (prod as { product_images?: { public_url: string }[] })
                                ?.product_images?.[0]?.public_url,
                            );
                            return (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <img
                                  src={itemImg}
                                  alt={item.name}
                                  loading="lazy"
                                  decoding="async"
                                  className="size-8 rounded-md object-cover border border-border shrink-0 bg-muted"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = clothing;
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <p
                                    className="font-bold text-foreground truncate text-xs leading-tight"
                                    title={item.name}
                                  >
                                    {item.name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    <span className="font-semibold text-primary">x{item.qty}</span>{" "}
                                    • {formatPrice(item.price)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                          {(!sale.offline_sale_items || sale.offline_sale_items.length === 0) && (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-semibold text-foreground">
                          {sale.customer_name || "Guest"}
                        </span>
                        {sale.customer_phone && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {sale.customer_phone}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
                            {sale.payment_method}
                          </span>
                          {Number(
                            (sale as unknown as Record<string, unknown>).store_credit_used || 0,
                          ) > 0 && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 whitespace-nowrap">
                                Credit:{" "}
                                {formatPrice(
                                  Number(
                                    (sale as unknown as Record<string, unknown>).store_credit_used,
                                  ),
                                )}
                              </span>
                              {Number(sale.total) >
                                Number(
                                  (sale as unknown as Record<string, unknown>).store_credit_used,
                                ) && (
                                <span className="text-[9px] font-semibold text-muted-foreground">
                                  Paid:{" "}
                                  {formatPrice(
                                    Number(sale.total) -
                                      Number(
                                        (sale as unknown as Record<string, unknown>)
                                          .store_credit_used,
                                      ),
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        {Number(sale.discount) > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            −{formatPrice(Number(sale.discount))}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right font-bold text-primary">
                        {formatPrice(Number(sale.total))}
                      </td>
                    </tr>
                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={10} className="p-0">
                          <div className="border-t border-border px-8 py-4">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-muted-foreground font-bold uppercase tracking-wider">
                                  <th className="py-2 text-left">Product</th>
                                  <th className="py-2 text-left">SKU</th>
                                  <th className="py-2 text-right">Price</th>
                                  <th className="py-2 text-right">Qty</th>
                                  <th className="py-2 text-right">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {(sale.offline_sale_items ?? []).map((item: SaleItem) => {
                                  const prod = resolveProduct(item);
                                  const itemImg = imageFor(
                                    prod?.category || "clothing",
                                    (prod as { product_images?: { public_url: string }[] })
                                      ?.product_images?.[0]?.public_url,
                                  );
                                  const slug = prod?.slug || item.product_slug || item.sku;

                                  return (
                                    <tr
                                      key={item.id || item.product_id || item.sku}
                                      className="hover:bg-muted/30 transition-colors"
                                    >
                                      <td className="py-2.5 font-semibold text-foreground">
                                        <div
                                          className="flex items-center gap-2.5 cursor-pointer group/item"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (slug) window.location.href = getProductUrl(slug);
                                          }}
                                          title={`Open "${item.name}" in store`}
                                        >
                                          <div className="size-9 rounded-lg border border-border bg-card overflow-hidden shrink-0">
                                            <img
                                              src={itemImg}
                                              alt={item.name}
                                              loading="lazy"
                                              decoding="async"
                                              className="h-full w-full object-cover group-hover/item:scale-105 transition"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).src = clothing;
                                              }}
                                            />
                                          </div>
                                          <div>
                                            <p className="font-bold text-xs text-foreground group-hover/item:text-primary transition-colors flex items-center gap-1">
                                              <span>{item.name}</span>
                                            </p>
                                            <p className="text-[10px] text-muted-foreground font-mono">
                                              {item.sku}
                                            </p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2.5 font-mono text-xs text-muted-foreground">
                                        {item.sku || "—"}
                                      </td>
                                      <td className="py-2.5 text-right font-medium text-foreground">
                                        {formatPrice(Number(item.price))}
                                      </td>
                                      <td className="py-2.5 text-right font-bold text-foreground">
                                        {item.qty}
                                      </td>
                                      <td className="py-2.5 text-right font-extrabold text-foreground">
                                        {formatPrice(
                                          Number(item.subtotal || Number(item.price) * item.qty),
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>

                            <div className="mt-3 flex items-center justify-between">
                              <div className="text-xs text-muted-foreground space-y-1">
                                <p>Subtotal: {formatPrice(Number(sale.subtotal))}</p>
                                {Number(sale.discount) > 0 && (
                                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    Discount (
                                    {sale.discount_type === "percentage"
                                      ? `${sale.discount_value}%`
                                      : sale.discount_type === "fixed"
                                        ? `₹${sale.discount_value}`
                                        : ""}
                                    ): −{formatPrice(Number(sale.discount))}
                                  </p>
                                )}
                                <p className="font-bold text-foreground text-sm">
                                  Sale Total: {formatPrice(Number(sale.total))}
                                </p>
                                {Number(
                                  (sale as unknown as Record<string, unknown>).store_credit_used ||
                                    0,
                                ) > 0 && (
                                  <div className="pt-1.5 border-t border-border/60 text-xs space-y-0.5">
                                    <p className="text-emerald-700 dark:text-emerald-300 font-bold">
                                      Exchange Credit Applied:{" "}
                                      {formatPrice(
                                        Number(
                                          (sale as unknown as Record<string, unknown>)
                                            .store_credit_used,
                                        ),
                                      )}
                                    </p>
                                    <p className="text-foreground font-semibold">
                                      Additional Payment Due/Settled ({sale.payment_method}):{" "}
                                      {formatPrice(
                                        Math.max(
                                          0,
                                          Number(sale.total) -
                                            Number(
                                              (sale as unknown as Record<string, unknown>)
                                                .store_credit_used,
                                            ),
                                        ),
                                      )}
                                    </p>
                                    <p className="text-muted-foreground text-[11px]">
                                      Total Settled: {formatPrice(Number(sale.total))}
                                    </p>
                                  </div>
                                )}
                                {sale.return_status && sale.return_status !== "none" && (
                                  <div className="pt-1.5 border-t border-purple-200 dark:border-purple-800/40 text-xs text-purple-700 dark:text-purple-300 font-bold">
                                    Return Status:{" "}
                                    {sale.return_status === "returned"
                                      ? "100% Returned"
                                      : "Partially Returned"}{" "}
                                    ({sale.returned_units || 0} units,{" "}
                                    {formatPrice(Number(sale.returned_amount || 0))})
                                  </div>
                                )}
                              </div>

                              {sale.status !== "cancelled" &&
                                sale.status !== "voided" &&
                                !sale.is_voided && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSaleToVoid({
                                        id: sale.id,
                                        sale_number: sale.sale_number,
                                        isDraft:
                                          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                                            sale.id,
                                          ) || sale.id.startsWith("off_"),
                                      });
                                      setVoidReason("");
                                      setRestoreStock(true);
                                    }}
                                    disabled={voidSaleMutation.isPending}
                                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-2 text-sm font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-500/15 transition-colors disabled:opacity-50 cursor-pointer"
                                    title="Administrative void / reversal of completed sale"
                                  >
                                    <RotateCcw className="size-4" />
                                    Void Sale
                                  </button>
                                )}
                              {(sale.status === "cancelled" ||
                                sale.status === "voided" ||
                                sale.is_voided) && (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 px-3 py-1.5 bg-rose-500/10 rounded-xl border border-rose-500/20">
                                    <RotateCcw className="size-3.5" />
                                    Voided
                                  </div>
                                  {sale.void_reason && (
                                    <p className="text-[11px] text-muted-foreground italic max-w-xs text-right">
                                      Audit: {sale.void_reason}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!isLoading && filteredSales.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                  >
                    {searchQuery || paymentFilter !== "all"
                      ? `No POS sales found matching the current search / filter.`
                      : "No POS sales yet."}
                  </td>
                </tr>
              )}
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-5 py-4">
                      <div className="h-4 w-24 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-12 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-32 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-16 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-20 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-20 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-20 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-4 w-16 rounded bg-muted/60" />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="h-8 w-20 rounded-xl bg-muted/60 mx-auto" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination & Counter Toolbar */}
        {!isLoading && filteredSales.length > 0 && (
          <div className="p-4 border-t border-border bg-muted/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
              <span>
                Showing{" "}
                <strong className="text-foreground">
                  {pageSize === "all" ? 1 : (currentPage - 1) * (pageSize as number) + 1}
                </strong>{" "}
                to{" "}
                <strong className="text-foreground">
                  {pageSize === "all"
                    ? filteredSales.length
                    : Math.min(currentPage * (pageSize as number), filteredSales.length)}
                </strong>{" "}
                of <strong className="text-foreground">{filteredSales.length}</strong> total POS
                sales
              </span>
              <div className="flex items-center gap-1.5 ml-2">
                <span>Per page:</span>
                {[50, 100, 200, "all"].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      setPageSize(sz as number | "all");
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-1 rounded text-xs font-bold transition cursor-pointer ${
                      pageSize === sz
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sz === "all" ? "All" : sz}
                  </button>
                ))}
              </div>
            </div>

            {pageSize !== "all" && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-medium transition cursor-pointer"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 font-bold text-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-medium transition cursor-pointer"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {saleToVoid && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
          onClick={() => setSaleToVoid(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="size-10 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                  <RotateCcw className="size-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground">
                    Void POS Sale #{saleToVoid.sale_number}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Administrative reversal & audit preservation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaleToVoid(null)}
                className="p-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <p className="font-bold flex items-center gap-1.5 mb-1 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                Historical Record Preservation
              </p>
              A completed POS sale is a permanent financial record. Voiding this transaction will
              cancel the invoice and exclude it from revenue reporting while preserving the
              historical audit trail. <strong>The sale will not be erased.</strong>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-foreground mb-1.5">
                  Audit Reason <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cashier ring-up mistake / Accidental duplicate / Customer cancelled"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                  autoFocus
                />
                {/* Quick chip suggestions */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    "Accidental duplicate punch",
                    "Cashier item ring-up error",
                    "Customer cancelled at counter",
                    "POS payment failed / voided",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setVoidReason(chip)}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-border/70">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={restoreStock}
                    onChange={(e) => setRestoreStock(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-foreground">
                      Compensating Inventory Restock
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Return physical items back to product inventory. (Uncheck if goods were
                      damaged, discarded, or retained by customer).
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setSaleToVoid(null)}
                disabled={voidSaleMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-border bg-background text-foreground hover:bg-muted transition cursor-pointer"
              >
                Keep Active Sale
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!voidReason.trim()) {
                    toast.error("Please provide an audit reason for voiding this sale");
                    return;
                  }
                  await voidSaleMutation.mutateAsync({
                    saleId: saleToVoid.id,
                    reason: voidReason.trim(),
                    restoreStock,
                  });
                  setSaleToVoid(null);
                }}
                disabled={voidSaleMutation.isPending || !voidReason.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 transition disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {voidSaleMutation.isPending && (
                  <div className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                <span>Confirm Void & Reversal</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
