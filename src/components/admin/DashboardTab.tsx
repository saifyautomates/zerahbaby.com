import { useState, useMemo, useRef, useEffect } from "react";
import {
  format,
  subDays,
  subMonths,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import { useAllOrders, type Order } from "@/lib/orders";
import { formatPrice } from "@/lib/store";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Link } from "@tanstack/react-router";
import {
  TrendingUp,
  Package,
  Boxes,
  Users,
  AlertTriangle,
  ShoppingCart,
  Percent,
  Info,
  ChevronDown,
  MoreVertical,
  Calendar,
  Download,
  FileText,
  DollarSign,
  Trash2,
  Check,
  Eye,
  Activity,
  ShoppingBag,
  CheckCircle2,
  Heart,
  Search,
  X,
  RotateCcw,
  RefreshCw,
  Tag,
  Sparkles,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type OfflineSale } from "@/lib/pos";
import { initPerformanceMetrics } from "@/utils/performanceMetrics";
import { DashboardDrillDown } from "./DashboardDrillDown";
import { AdminDashboardSkeleton } from "@/components/ui/Skeletons";
import {
  calculateFinancialMetrics,
  getISTPeriodBounds,
  isValidPOSSale,
  isValidOnlineOrder,
  isValidReturn,
  useReportingDateRange,
  type DatePreset,
} from "@/lib/financial-reporting";
import { useCanonicalPOSSales } from "@/lib/canonical-reporting";

type WebsiteVisitor = {
  created_at: string;
  city: string | null;
  region: string | null;
  country: string | null;
  customer_name?: string | null;
};

type DateRangePreset = DatePreset;

const DATE_RANGE_OPTIONS: { key: DateRangePreset; label: string; subLabel: string }[] = [
  { key: "today", label: "Today", subLabel: "Today's activity" },
  { key: "yesterday", label: "Yesterday", subLabel: "Yesterday's activity" },
  { key: "7d", label: "Last 7 Days", subLabel: "Past 7 days" },
  { key: "30d", label: "Last 30 Days", subLabel: "Past 30 days" },
  { key: "this_month", label: "This Month", subLabel: "Month to date" },
  { key: "all", label: "All Time", subLabel: "Entire history" },
  { key: "custom", label: "Custom Range", subLabel: "Specific start & end" },
];

function calculateDelta(current: number, prev: number, periodLabel: string) {
  if (prev === 0) {
    if (current > 0) return { text: `↑ 100% vs ${periodLabel}`, isPositive: true };
    return { text: `0% vs ${periodLabel}`, isPositive: true };
  }
  const pct = ((current - prev) / prev) * 100;
  const rounded = Math.abs(Math.round(pct * 10) / 10);
  if (pct > 0) {
    return { text: `↑ ${rounded}% vs ${periodLabel}`, isPositive: true };
  }
  if (pct < 0) {
    return { text: `↓ ${rounded}% vs ${periodLabel}`, isPositive: false };
  }
  return { text: `0% vs ${periodLabel}`, isPositive: true };
}

export function DashboardTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [activeDrillDown, setActiveDrillDownState] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const dd = urlParams.get("drilldown");
      if (dd) return dd;
      const saved = localStorage.getItem("zerah_admin_dashboard_drilldown");
      if (saved) return saved;
    }
    return null;
  });

  const setActiveDrillDown = (val: string | null) => {
    setActiveDrillDownState(val);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (val) {
        localStorage.setItem("zerah_admin_dashboard_drilldown", val);
        url.searchParams.set("drilldown", val);
      } else {
        localStorage.removeItem("zerah_admin_dashboard_drilldown");
        url.searchParams.delete("drilldown");
      }
      window.history.replaceState({}, "", url.toString());
    }
  };

  const {
    preset: datePreset,
    startDate: customStart,
    endDate: customEnd,
    bounds: reportingBounds,
    setDateRange,
  } = useReportingDateRange();

  const { dateRangeText, compareLabel, inCurrentPeriod, inPrevPeriod } = reportingBounds;
  const [customStartInput, setCustomStartInput] = useState(customStart || "");
  const [customEndInput, setCustomEndInput] = useState(customEnd || "");

  const setDatePreset = (val: DateRangePreset) => {
    if (val === "custom") {
      const today = new Date();
      const istToday = new Date(today.getTime() + 330 * 60 * 1000);
      const todayStr = istToday.toISOString().split("T")[0];
      setDateRange("custom", customStartInput || todayStr, customEndInput || todayStr);
    } else {
      setDateRange(val);
    }
  };

  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [salesChannelFilter, setSalesChannelFilter] = useState<"all" | "online" | "pos">("all");
  const [salesSearchQuery, setSalesSearchQuery] = useState("");
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initPerformanceMetrics();
  }, []);

  // Close date dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setIsDateDropdownOpen(false);
      }
    };
    if (isDateDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDateDropdownOpen]);

  const queryClient = useQueryClient();

  // Supabase Realtime Omnichannel Live Sync Channel
  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_sales" }, () => {
        queryClient.invalidateQueries({ queryKey: ["offline-sales"] });
        queryClient.invalidateQueries({ queryKey: ["admin-offline-sales"] });
        queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_returns" }, () => {
        queryClient.invalidateQueries({ queryKey: ["offline-returns"] });
        queryClient.invalidateQueries({ queryKey: ["offline-sales"] });
        queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_sale_items" }, () => {
        queryClient.invalidateQueries({ queryKey: ["offline-sales"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "analytics_events" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-products-count"] });
        queryClient.invalidateQueries({ queryKey: ["admin-products"] });
        queryClient.invalidateQueries({ queryKey: ["products"] });
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "website_visitors" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-visitor-analytics"] });
          queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
        },
      )
      .subscribe();

    const handleLocalEvent = () => {
      queryClient.invalidateQueries({ queryKey: ["admin-unified-store-activities"] });
    };
    window.addEventListener("zerah-activity-event", handleLocalEvent);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("zerah-activity-event", handleLocalEvent);
    };
  }, [queryClient]);

  const clearVisitorsMutation = useMutation({
    mutationFn: async () => {
      const { error: rpcErr } = await supabase.rpc("clear_website_visitors" as never);
      if (rpcErr) {
        const { error: delErr } = await supabase
          .from("website_visitors")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (delErr) throw delErr;
      }
    },
    onSuccess: () => {
      toast.success("Visitor logs cleared successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-visitor-analytics"] });
    },
    onError: (e: Error) => {
      toast.error("Failed to clear visitor logs: " + e.message);
    },
  });

  // Authoritative Queries with Real-time synchronization
  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useAllOrders(true);

  const {
    data: rawPosSales = [],
    isLoading: posLoading,
    isError: posError,
    refetch: refetchPos,
  } = useCanonicalPOSSales();

  const {
    data: offlineReturns = [],
    isLoading: returnsLoading,
    isError: returnsError,
    refetch: refetchReturns,
  } = useQuery<
    Array<{
      id: string;
      refund_amount: number;
      created_at: string;
      status: string;
      refund_status: string;
    }>
  >({
    queryKey: ["offline-returns"],
    staleTime: 1000 * 60 * 3,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_returns")
        .select("id, refund_amount, created_at, status, refund_status")
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) {
        console.error("[dashboard] offline_returns query error:", error);
        throw error;
      }
      return (data ?? []) as never[];
    },
  });

  // Authoritative business accounting: strictly valid completed transactions only!
  const posSales = useMemo(() => {
    return rawPosSales.filter(isValidPOSSale);
  }, [rawPosSales]);

  const {
    data: visitors = [],
    isLoading: visitorsLoading,
    isError: visitorsError,
    refetch: refetchVisitors,
  } = useQuery<WebsiteVisitor[]>({
    queryKey: ["admin-visitor-analytics"],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("website_visitors")
        .select("id, created_at")
        .gte("created_at", subDays(new Date(), 60).toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) {
        console.error("[dashboard] website_visitors query error:", error);
        throw error;
      }
      return (data ?? []) as unknown as WebsiteVisitor[];
    },
  });

  const {
    data: products = [],
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ["admin-products-count"],
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, price, stock, name, is_active, slug, category, product_costs(buying_price), product_images(public_url, is_primary, sort_order)",
        );
      if (error) {
        console.error("[dashboard] products query error:", error);
        throw error;
      }
      return data ?? [];
    },
  });

  const isAnyLoading =
    ordersLoading || posLoading || visitorsLoading || productsLoading || returnsLoading;
  const isAnyError = ordersError || posError || visitorsError || productsError || returnsError;

  // Authoritative KPI Metrics Calculation via Centralized Financial Reporting Engine
  const stats = useMemo(() => {
    const currMetrics = calculateFinancialMetrics({
      orders,
      posSales,
      returns: offlineReturns,
      products,
      filterDate: inCurrentPeriod,
    });

    const prevMetrics = calculateFinancialMetrics({
      orders,
      posSales,
      returns: offlineReturns,
      products,
      filterDate: inPrevPeriod,
    });

    const allTimeMetrics = calculateFinancialMetrics({
      orders,
      posSales,
      returns: offlineReturns,
      products,
    });

    // Visitors
    const currVisitors = visitors.filter((v) => inCurrentPeriod(v.created_at)).length;
    const prevVisitors = visitors.filter((v) => inPrevPeriod(v.created_at)).length;

    // Low stock items (live catalog inventory <= 5)
    const lowStockItems = products.filter((p) => Number(p.stock ?? 0) <= 5);
    const lowStockCount = lowStockItems.length;
    const outOfStockCount = products.filter((p) => Number(p.stock ?? 0) <= 0).length;

    // Deltas
    const revenueDelta = calculateDelta(
      currMetrics.netRevenue,
      prevMetrics.netRevenue,
      compareLabel,
    );
    const ordersDelta = calculateDelta(
      currMetrics.totalTransactionsCount,
      prevMetrics.totalTransactionsCount,
      compareLabel,
    );
    const visitorsDelta = calculateDelta(currVisitors, prevVisitors, compareLabel);

    // Dynamic Chart Days (Last 7 segments)
    const today = new Date();
    const chartDays = Array.from({ length: 7 }).map((_, i) => {
      const d = subDays(today, 6 - i);
      const dayStart = startOfDay(d).getTime();
      const dayEnd = endOfDay(d).getTime();
      const inDay = (dateStr: string | null | undefined) => {
        if (!dateStr) return false;
        const t = new Date(dateStr).getTime();
        return t >= dayStart && t <= dayEnd;
      };

      const dayMetrics = calculateFinancialMetrics({
        orders,
        posSales,
        returns: offlineReturns,
        products,
        filterDate: inDay,
      });

      const dayVis = visitors.filter((v) => inDay(v.created_at)).length;

      return {
        dateStr: format(d, "MMM dd"),
        online: dayMetrics.onlineGrossRevenue,
        offline: dayMetrics.offlineGrossRevenue,
        visitors: dayVis,
      };
    });

    return {
      totalRevenueAllTime: allTimeMetrics.netRevenue,
      grossRevenueAllTime: allTimeMetrics.grossRevenue,
      returnsAllTime: allTimeMetrics.totalReturns,
      netProfitAllTime: allTimeMetrics.netProfit,
      revenue: currMetrics.netRevenue,
      grossRevenue: currMetrics.grossRevenue,
      totalReturns: currMetrics.totalReturns,
      netProfit: currMetrics.netProfit,
      totalCogs: currMetrics.totalCogs,
      ordersCount: currMetrics.totalTransactionsCount,
      visitorsCount: currVisitors,
      lowStockCount,
      outOfStockCount,
      cashOutstanding: currMetrics.cashOutstanding,
      pendingCodCount: currMetrics.pendingCodCount,
      revenueDelta,
      ordersDelta,
      visitorsDelta,
      onlineSales: currMetrics.onlineGrossRevenue,
      cashSales: currMetrics.offlineGrossRevenue,
      totalCatalogValue: currMetrics.totalCatalogValue,
      totalCatalogCost: currMetrics.totalCatalogCost,
      avgOrderValue: currMetrics.avgOrderValue,
      totalSales: currMetrics.totalSales,
      myCost: currMetrics.myCost,
      totalProfit: currMetrics.totalProfit,
      totalProducts: products.length,
      grossSales: currMetrics.grossSales,
      netSales: currMetrics.netSales,
      returnsExchangeCredit: currMetrics.returnsExchangeCredit,
      returnedItemsCount: currMetrics.returnedItemsCount,
      storeCreditOutstanding: currMetrics.storeCreditOutstanding,
      storeCreditUsedInSales: currMetrics.storeCreditUsedInSales,
      chartDays,
    };
  }, [
    orders,
    posSales,
    offlineReturns,
    visitors,
    products,
    inCurrentPeriod,
    inPrevPeriod,
    compareLabel,
  ]);

  // Payment Breakdown for Donut Chart
  const paymentBreakdown = useMemo(() => {
    const total = stats.revenue;
    if (total <= 0) {
      return [
        { name: "POS / Offline", value: 0, color: "#10b981" },
        { name: "Online Paid", value: 0, color: "#6366f1" },
      ];
    }
    return [
      { name: "POS / Offline", value: stats.cashSales, color: "#10b981" },
      { name: "Online Paid", value: stats.onlineSales, color: "#6366f1" },
    ];
  }, [stats.revenue, stats.cashSales, stats.onlineSales]);

  // Omnichannel Sales History Ledger (Combined Online + Offline POS)
  const allSalesHistory = useMemo(() => {
    const onlineMapped = orders.map((o) => ({
      key: `online-${o.id}`,
      id: `#${o.id.toString().substring(0, 8).toUpperCase()}`,
      rawId: o.id,
      customer: o.full_name || o.email || "Online Buyer",
      phone: o.phone || "",
      amount: Number(o.total || 0),
      payment_method: o.payment_method || "Online",
      status: o.status || "placed",
      source: "Online" as const,
      created_at: o.created_at,
      itemCount: o.order_items?.length || 1,
      itemsSummary:
        o.order_items
          ?.map((i) => i.name)
          .filter(Boolean)
          .join(", ") || "Order items",
    }));

    const posMapped = posSales.map((s) => ({
      key: `pos-${s.id}`,
      id: s.sale_number || `#${s.id.toString().substring(0, 8).toUpperCase()}`,
      rawId: s.id,
      customer: s.customer_name || "Walk-in Customer",
      phone: s.customer_phone || "",
      amount: Number(s.total || 0),
      payment_method: s.payment_method || "Cash",
      status: s.status || "completed",
      source: "POS" as const,
      created_at: s.created_at,
      itemCount: s.offline_sale_items?.length || 1,
      itemsSummary:
        s.offline_sale_items
          ?.map((i) => i.name || i.product_slug)
          .filter(Boolean)
          .join(", ") || "POS items",
    }));

    let combined = [...onlineMapped, ...posMapped].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );

    if (salesChannelFilter === "online") {
      combined = combined.filter((s) => s.source === "Online");
    } else if (salesChannelFilter === "pos") {
      combined = combined.filter((s) => s.source === "POS");
    }

    if (salesSearchQuery.trim()) {
      const q = salesSearchQuery.toLowerCase().trim();
      combined = combined.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.customer.toLowerCase().includes(q) ||
          s.phone.includes(q) ||
          s.payment_method.toLowerCase().includes(q) ||
          s.status.toLowerCase().includes(q) ||
          s.itemsSummary.toLowerCase().includes(q) ||
          s.amount.toString().includes(q),
      );
    }

    return combined;
  }, [orders, posSales, salesChannelFilter, salesSearchQuery]);

  // Recent Orders List (Top 5)
  const recentOrders = useMemo(() => {
    return allSalesHistory.slice(0, 5);
  }, [allSalesHistory]);

  // Top Selling / Critical Products
  const topProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 5)
      .map((p) => {
        const prodImages = p.product_images as
          Array<{ public_url?: string; is_primary?: boolean; sort_order?: number }> | undefined;
        return {
          name: p.name || "Product",
          slug: p.slug,
          image: prodImages?.[0]?.public_url || null,
          stock: Number(p.stock || 0),
          price: Number(p.price || 0),
        };
      });
  }, [products]);

  // Authoritative Unified Store Activity Feed (Online Orders, Store POS, Returns, Cart, Browsing)
  const [isRecentActivityModalOpen, setIsRecentActivityModalOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [activitySearch, setActivitySearch] = useState<string>("");

  const {
    data: unifiedActivities = [],
    isLoading: isActivitiesLoading,
    isRefetching: isActivitiesRefetching,
    refetch: refetchActivities,
  } = useQuery({
    queryKey: ["admin-unified-store-activities"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_unified_store_activities", {
        _limit: 200,
      });
      if (error) {
        console.warn("[DashboardTab] get_unified_store_activities:", error);
        return [];
      }
      return (data || []) as Array<{
        id: string;
        source: string;
        event_type: string;
        title: string;
        subtitle: string;
        product_name: string | null;
        product_slug: string | null;
        product_image: string | null;
        customer_name: string | null;
        amount: number;
        created_at: string;
        metadata: Record<string, any> | null;
      }>;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const parsedActivities = useMemo(() => {
    return unifiedActivities.map((act) => {
      let icon = Activity;
      let color = "text-blue-500 bg-blue-50 dark:bg-blue-950/50";
      let channelTag = "";

      if (act.event_type === "view") {
        icon = Eye;
        color = "text-purple-500 bg-purple-50 dark:bg-purple-950/50";
        channelTag = "View";
      } else if (act.event_type === "cart") {
        icon = ShoppingCart;
        color = "text-amber-500 bg-amber-50 dark:bg-amber-950/50";
        channelTag = "Cart";
      } else if (act.event_type === "checkout") {
        icon = ShoppingBag;
        color = "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/50";
        channelTag = "Checkout";
      } else if (act.event_type === "order") {
        icon = CheckCircle2;
        color = "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50";
        channelTag = act.source === "pos_sale" ? "Store POS" : "Online Order";
      } else if (act.event_type === "wishlist") {
        icon = Heart;
        color = "text-pink-500 bg-pink-50 dark:bg-pink-950/50";
        channelTag = "Wishlist";
      } else if (act.event_type === "return") {
        icon = RotateCcw;
        color = "text-blue-500 bg-blue-50 dark:bg-blue-950/50";
        channelTag = "Store Exchange";
      }

      return {
        id: act.id,
        source: act.source,
        typeKey: act.event_type,
        title: act.title,
        subtitle: act.subtitle,
        amount: Number(act.amount || 0),
        productName: act.product_name,
        productSlug: act.product_slug,
        productImage: act.product_image,
        customerName: act.customer_name,
        channelTag,
        time: format(new Date(act.created_at), "MMM dd, hh:mm a"),
        fullTime: format(new Date(act.created_at), "MMMM dd, yyyy 'at' hh:mm:ss a"),
        icon,
        color,
      };
    });
  }, [unifiedActivities]);

  // Widget preview on Dashboard (top 8 activities)
  const recentActivity = useMemo(() => {
    if (parsedActivities.length === 0) {
      return [
        {
          id: "operational",
          title: "Store operational",
          subtitle: "Waiting for store events",
          time: "Live",
          icon: Check,
          color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50",
          channelTag: "",
        },
      ];
    }
    return parsedActivities.slice(0, 8);
  }, [parsedActivities]);

  // Modal filtered activities
  const filteredActivities = useMemo(() => {
    return parsedActivities.filter((act) => {
      if (activityFilter !== "all" && act.typeKey !== activityFilter) return false;
      if (activitySearch.trim()) {
        const q = activitySearch.toLowerCase();
        return (
          act.title.toLowerCase().includes(q) ||
          act.subtitle.toLowerCase().includes(q) ||
          (act.productName && act.productName.toLowerCase().includes(q)) ||
          (act.customerName && act.customerName.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [parsedActivities, activityFilter, activitySearch]);

  // CSV Report Generator with full reconciliation (Sales & Returns) filtered by canonical date range
  const handleDownloadReport = () => {
    const allRecords: Array<{
      id: string;
      date: string;
      type: string;
      source: string;
      status: string;
      customer: string;
      total: number;
    }> = [];

    orders
      .filter((o) => isValidOnlineOrder(o) && inCurrentPeriod(o.created_at))
      .forEach((o) => {
        allRecords.push({
          id: `#${o.id.substring(0, 8).toUpperCase()}`,
          date: format(new Date(o.created_at), "yyyy-MM-dd HH:mm"),
          type: "Sale",
          source: "Online Store",
          status: o.status || "placed",
          customer: o.full_name || o.email || "Guest",
          total: o.total || 0,
        });
      });

    posSales
      .filter((s) => isValidPOSSale(s) && inCurrentPeriod(s.created_at))
      .forEach((s) => {
        allRecords.push({
          id: s.sale_number || s.id.substring(0, 8),
          date: format(new Date(s.created_at), "yyyy-MM-dd HH:mm"),
          type: "Sale",
          source: "POS Store",
          status: s.status || "completed",
          customer: s.customer_name || "Walk-in Customer",
          total: s.total || 0,
        });
      });

    offlineReturns
      .filter((r) => isValidReturn(r) && inCurrentPeriod(r.created_at))
      .forEach((r) => {
        const returnNumber =
          (r as { return_number?: string }).return_number || r.id.substring(0, 8);
        const customerName = (r as { customer_name?: string }).customer_name || "Customer Return";
        allRecords.push({
          id: returnNumber,
          date: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
          type: "Return / Refund",
          source: "POS Return",
          status: r.refund_status || "refunded",
          customer: customerName,
          total: -Number(r.refund_amount || 0),
        });
      });

    allRecords.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let csv = `Report: ZERAH BABY AND KIDS Financial Report\nPeriod: ${dateRangeText}\nGenerated: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}\n\n`;
    csv += "Transaction ID,Date,Record Type,Sales Channel,Status,Customer,Net Amount (INR)\n";
    allRecords.forEach((rec) => {
      csv += `"${rec.id}","${rec.date}","${rec.type}","${rec.source}","${rec.status}","${rec.customer}",${rec.total}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zerah-financial-report-${datePreset}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (activeDrillDown) {
    return (
      <DashboardDrillDown
        type={activeDrillDown}
        onBack={() => setActiveDrillDown(null)}
        dateRangeText={dateRangeText}
        orders={orders.filter((o) => inCurrentPeriod(o.created_at))}
        posSales={posSales.filter((s) => inCurrentPeriod(s.created_at))}
        offlineReturns={offlineReturns.filter((r) => inCurrentPeriod(r.created_at))}
        products={products}
      />
    );
  }

  return (
    <div className="space-y-6 text-foreground animate-in fade-in duration-150">
      {/* Date Range Selector and Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-1 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-black tracking-tight text-foreground font-display">
              Executive Performance Overview
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Live Synced</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Live store statistics synchronized across online e-commerce and offline POS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Interactive Date Range Dropdown */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              type="button"
              onClick={() => setIsDateDropdownOpen((prev) => !prev)}
              aria-expanded={isDateDropdownOpen}
              aria-label={`Selected date range: ${dateRangeText}`}
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
                  Select Period
                </div>
                {DATE_RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      if (opt.key === "custom") {
                        setDatePreset("custom");
                      } else {
                        setDatePreset(opt.key);
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

          {/* Download CSV Report Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadReport}
              title="Download CSV sales report"
              aria-label="Download CSV sales report"
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-xs hover:bg-muted transition cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">Download Report</span>
              <span className="sm:hidden">Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Query Error State Banner */}
      {isAnyError && (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 flex items-center justify-between gap-3 text-xs text-destructive">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="font-semibold">
              Some metrics could not be fetched due to a network or connection issue.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              refetchOrders();
              refetchPos();
              refetchReturns();
              refetchProducts();
              refetchVisitors();
            }}
            className="px-3 py-1.5 rounded-xl bg-destructive text-destructive-foreground font-bold hover:bg-destructive/90 transition cursor-pointer shrink-0 shadow-xs"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Top 5 Vibrant, Clickable, Fully-Responsive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {/* 1. Total Sales Card (Emerald Green) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("revenue")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("revenue");
            }
          }}
          aria-label={`Total Sales: ${formatPrice(stats.totalSales)}. Click to open Analytics.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-emerald-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Total Sales</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.totalSales)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {stats.ordersCount} {stats.ordersCount === 1 ? "sale" : "sales"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <span className="text-4xl font-serif leading-none select-none">₹</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">
              {stats.revenueDelta.text}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("revenue");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 2. My Cost Card (Royal Blue) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("profit")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("profit");
            }
          }}
          aria-label={`My Cost: ${formatPrice(stats.myCost)}. Click to view Cost details.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-blue-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">My Cost</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.myCost)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">Cost of sold items</p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <Package className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">Buying price total</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("profit");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 3. Total Profit Card (Warm Amber) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("profit")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("profit");
            }
          }}
          aria-label={`Total Profit: ${formatPrice(stats.totalProfit)}. Click to open Profit Analysis.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Total Profit</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.totalProfit)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">Sales − My Cost</p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <span className="text-3xl select-none">📈</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">Total profit earned</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("profit");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 4. Low Stock Card */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("low_stock")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("low_stock");
            }
          }}
          aria-label={`Low Stock Items: ${stats.lowStockCount}. Click to open Inventory.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-slate-800/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Low Stock Items</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : stats.lowStockCount}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {stats.lowStockCount > 0
                  ? `${stats.lowStockCount} items need reorder`
                  : "All inventory healthy"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <AlertTriangle className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">
              {stats.outOfStockCount > 0
                ? `${stats.outOfStockCount} out of stock`
                : "Stock alert (≤5)"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("low_stock");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 5. Cash Outstanding Card (Crimson Red) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("cash")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("cash");
            }
          }}
          aria-label={`Cash Outstanding: ${formatPrice(stats.cashOutstanding)}. Click to view pending COD orders.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 to-rose-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-rose-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Cash Outstanding</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.cashOutstanding)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {stats.pendingCodCount > 0
                  ? `${stats.pendingCodCount} orders pending COD`
                  : "No pending dues"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <span className="text-3xl select-none">💰</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">
              {stats.pendingCodCount > 0 ? "Pending collection" : "Zero balance due"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("cash");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>
      </div>

      {/* Secondary 6-Item Reconciled Metric Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6 rounded-2xl bg-card p-4 shadow-sm border border-border">
        {/* Strip Tile 1: Total Stock Value */}
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("stock")}
          title={`Total Potential Retail Sales: ${formatPrice(stats.totalCatalogValue)} (Store Buying Cost: ${formatPrice(stats.totalCatalogCost)})`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-medium text-muted-foreground truncate">Stock Value</p>
              <span className="text-[9px] font-bold px-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200">
                Retail
              </span>
            </div>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.totalCatalogValue)}
            </h4>
          </div>
        </div>

        {/* Strip Tile 2: Total Sales */}
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("revenue")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Total Sales</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.totalSales)}
            </h4>
          </div>
        </div>

        {/* Strip Tile 3: My Cost */}
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("profit")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">My Cost</p>
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">
              {formatPrice(stats.myCost)}
            </h4>
            <p className="text-[10px] text-muted-foreground truncate">Cost of sold items</p>
          </div>
        </div>

        {/* Strip Tile 4: Total Profit */}
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("profit")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Total Profit</p>
            <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
              {formatPrice(stats.totalProfit)}
            </h4>
            <p className="text-[10px] text-muted-foreground truncate">Sales − My Cost</p>
          </div>
        </div>

        {/* Strip Tile 5: Total Products Button */}
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => {
            if (onNavigate) {
              onNavigate("products");
            } else {
              setActiveDrillDown("stock");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (onNavigate) {
                onNavigate("products");
              } else {
                setActiveDrillDown("stock");
              }
            }
          }}
          aria-label={`Total Products: ${stats.totalProducts}. Click to view Products.`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Boxes className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Total Products</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {stats.totalProducts} Items
            </h4>
            <p className="text-[10px] text-muted-foreground truncate">Manage Catalog</p>
          </div>
        </div>

        {/* Strip Tile 6: Total Transactions */}
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("orders")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">
              Total Transactions
            </p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {stats.ordersCount} {stats.ordersCount === 1 ? "Sale" : "Sales"}
            </h4>
            <p className="text-[10px] text-muted-foreground truncate">Completed in period</p>
          </div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Trend Line Chart */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Sales Trend (Last 7 Days)</h3>
              <p className="text-[11px] text-muted-foreground">
                Online Orders vs Offline POS Sales
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.("analytics")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              Analytics <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stats.chartDays}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="dateStr"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${v}`}
                />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    formatPrice(Number(value) || 0),
                    String(name ?? ""),
                  ]}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    fontSize: "12px",
                    color: "var(--foreground)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="online"
                  name="Online Sales"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#2563eb" }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="offline"
                  name="POS Sales"
                  stroke="#16a34a"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#16a34a" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
              <span className="text-muted-foreground font-medium">Online Sales</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
              <span className="text-muted-foreground font-medium">POS Sales</span>
            </div>
          </div>
        </div>

        {/* Visitors Trend Line Chart */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Traffic Trend (Last 7 Days)</h3>
              <p className="text-[11px] text-muted-foreground">Unique Website Visitors</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.("analytics")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              Traffic <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stats.chartDays}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="dateStr"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(val: unknown, _name: unknown) => [
                    `${Number(val) || 0} visitors`,
                    String(_name ?? ""),
                  ]}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    fontSize: "12px",
                    color: "var(--foreground)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="visitors"
                  name="Unique Visitors"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#f59e0b" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
              <span className="text-muted-foreground font-medium">Unique Visitors</span>
            </div>
          </div>
        </div>

        {/* Payment Channels Breakdown */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Sales by Channel</h3>
              <p className="text-[11px] text-muted-foreground">Revenue share breakdown</p>
            </div>
          </div>
          <div className="relative h-[180px] w-full flex items-center justify-center">
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-base font-extrabold text-foreground">
                {formatPrice(stats.totalSales)}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium">Total Sales</span>
            </div>
            <ResponsiveContainer width="100%" height="100%" className="relative z-10">
              <PieChart>
                <Pie
                  data={paymentBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {paymentBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    formatPrice(Number(value) || 0),
                    String(name ?? ""),
                  ]}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "10px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
              <span className="text-muted-foreground font-medium">
                POS:{" "}
                <span className="text-foreground font-bold">{formatPrice(stats.cashSales)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />
              <span className="text-muted-foreground font-medium">
                Online:{" "}
                <span className="text-foreground font-bold">{formatPrice(stats.onlineSales)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Omnichannel Sales & Orders History Ledger */}
      <div className="rounded-2xl bg-card p-5 shadow-sm border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <ShoppingBag className="size-4 text-primary" />
              <span>Omnichannel Sales & Transactions History</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unified live transactions across Online Storefront and In-Store POS.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search orders, sales, customer..."
                value={salesSearchQuery}
                onChange={(e) => setSalesSearchQuery(e.target.value)}
                className="h-8 rounded-xl border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary w-48 sm:w-56"
              />
            </div>

            {/* Channel filter pills */}
            <div className="flex bg-muted/60 p-0.5 rounded-xl border border-border text-xs font-bold">
              <button
                type="button"
                onClick={() => setSalesChannelFilter("all")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  salesChannelFilter === "all"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({orders.length + posSales.length})
              </button>
              <button
                type="button"
                onClick={() => setSalesChannelFilter("online")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  salesChannelFilter === "online"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Online ({orders.length})
              </button>
              <button
                type="button"
                onClick={() => setSalesChannelFilter("pos")}
                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                  salesChannelFilter === "pos"
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                POS ({posSales.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => onNavigate?.("orders")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer ml-1"
            >
              <span>Manage Orders</span>
              <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-semibold">
                <th className="pb-3 pl-2">Order / Sale #</th>
                <th className="pb-3">Channel</th>
                <th className="pb-3">Date & Time</th>
                <th className="pb-3">Customer</th>
                <th className="pb-3">Items Summary</th>
                <th className="pb-3">Payment</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right pr-2">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {allSalesHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                    <ShoppingBag className="size-8 mx-auto mb-2 opacity-30" />
                    <p className="font-semibold">No sales recorded matching this filter.</p>
                    <p className="text-[11px] mt-0.5">
                      Sales made online or via Offline POS will immediately appear here in
                      real-time.
                    </p>
                  </td>
                </tr>
              ) : (
                allSalesHistory.slice(0, 15).map((s) => (
                  <tr
                    key={s.key}
                    onClick={() => {
                      if (s.source === "Online") onNavigate?.("orders");
                      else onNavigate?.("billing");
                    }}
                    className="hover:bg-muted/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 pl-2 font-bold text-foreground font-mono">{s.id}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          s.source === "Online"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {s.source === "Online" ? "Online Store" : "POS Register"}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground whitespace-nowrap">
                      {format(new Date(s.created_at), "MMM dd, yyyy • hh:mm a")}
                    </td>
                    <td className="py-3 font-medium text-foreground">
                      <div>
                        <p className="truncate max-w-[140px]">{s.customer}</p>
                        {s.phone && (
                          <p className="text-[10px] text-muted-foreground font-mono">{s.phone}</p>
                        )}
                      </div>
                    </td>
                    <td
                      className="py-3 text-muted-foreground max-w-[180px] truncate"
                      title={s.itemsSummary}
                    >
                      {s.itemsSummary}
                    </td>
                    <td className="py-3 font-semibold uppercase text-[11px] text-muted-foreground">
                      {s.payment_method}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          s.status === "delivered" || s.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                            : s.status === "shipped"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20"
                              : s.status === "cancelled"
                                ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 text-right pr-2 font-black text-foreground text-sm">
                      {formatPrice(s.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Middle Section: Low Stock Watchlist & Live Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Low Stock Watchlist */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Low Stock Watchlist</h3>
            <button
              type="button"
              onClick={() => onNavigate?.("products")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>Products</span>
              <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-medium">
                  <th className="pb-2.5">Product</th>
                  <th className="pb-2.5 text-center">Stock</th>
                  <th className="pb-2.5 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topProducts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                      All product inventory healthy.
                    </td>
                  </tr>
                ) : (
                  topProducts.map((p, idx) => (
                    <tr
                      key={idx}
                      onClick={() => onNavigate?.("products")}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5">
                        <Link
                          to="/product/$id"
                          params={{ id: p.slug }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 hover:text-primary transition-colors group"
                        >
                          {p.image ? (
                            <img
                              src={p.image}
                              alt={p.name}
                              loading="lazy"
                              decoding="async"
                              className="w-8 h-8 rounded object-cover border group-hover:border-primary/50 transition-colors"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center border group-hover:border-primary/50 transition-colors">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <span className="font-semibold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
                            {p.name}
                          </span>
                        </Link>
                      </td>
                      <td className="py-2.5 text-center font-bold">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] ${
                            p.stock <= 0
                              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 font-extrabold"
                              : p.stock <= 5
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold"
                                : "text-foreground"
                          }`}
                        >
                          {p.stock <= 0 ? "Out of stock" : `${p.stock} left`}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-bold text-foreground">
                        {formatPrice(p.price)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Recent Activity</h3>
            <button
              type="button"
              onClick={() => setIsRecentActivityModalOpen(true)}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>View All</span>
              <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
          <div className="space-y-3.5">
            {recentActivity.map((act, i) => {
              const Icon = act.icon;
              return (
                <div key={act.id || i} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${act.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{act.title}</p>
                      {act.subtitle && act.subtitle !== "Visitor" && (
                        <p className="text-[10px] text-muted-foreground truncate">{act.subtitle}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {act.channelTag && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border/50">
                        {act.channelTag}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{act.time}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Website Visitors Section */}
      <div className="mt-6 rounded-2xl bg-card p-5 shadow-sm border border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-foreground">Website Visitors</h3>
            <p className="text-[11px] text-muted-foreground">
              Total Recorded Visits:{" "}
              <span className="font-bold text-foreground">{visitors.length}</span>
            </p>
          </div>
          {visitors.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Are you sure you want to permanently wipe all recorded/fake visitor logs?",
                  )
                ) {
                  clearVisitorsMutation.mutate();
                }
              }}
              disabled={clearVisitorsMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20 transition cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{clearVisitorsMutation.isPending ? "Clearing..." : "Clear Fake/All Logs"}</span>
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-medium">
                <th className="pb-2.5">Visitor</th>
                <th className="pb-2.5">Location</th>
                <th className="pb-2.5">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visitors.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-xs text-muted-foreground">
                    No visitor data available.
                  </td>
                </tr>
              ) : (
                visitors.slice(0, 10).map((v, idx) => {
                  const location = [v.city, v.region, v.country].filter(Boolean).join(", ");
                  return (
                    <tr key={idx} className="hover:bg-muted/50 transition-colors">
                      <td className="py-2.5 font-medium text-foreground">
                        <div className="flex flex-col gap-0.5">
                          <span>{v.customer_name ? v.customer_name : "Anonymous Visitor"}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(v.created_at), "MMM dd, hh:mm a")}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {location || "Unknown Location"}
                      </td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                          Direct
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Recent Activity Modal */}
      {isRecentActivityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl bg-card border border-border shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Activity className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">Recent Activity</h3>
                    <span className="rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-xs font-bold text-primary">
                      {filteredActivities.length} logs
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Live real-time feed of visitor browsing, cart additions, checkouts, orders, and
                    in-store sales
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refetchActivities()}
                  className="flex size-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                  title="Refresh Live Feed"
                >
                  <RefreshCw
                    className={`size-4 ${isActivitiesRefetching ? "animate-spin text-primary" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecentActivityModalOpen(false)}
                  className="flex size-8 items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Controls: Search & Filters */}
            <div className="p-4 border-b border-border bg-background flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search by product, customer, or event..."
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-muted/40 border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                {[
                  { id: "all", label: "All" },
                  { id: "view", label: "👁️ Product Views" },
                  { id: "cart", label: "🛒 Cart" },
                  { id: "checkout", label: "🛍️ Checkout" },
                  { id: "order", label: "📦 Orders & Sales" },
                  { id: "wishlist", label: "❤️ Wishlist" },
                  { id: "return", label: "🔄 Returns" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActivityFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                      activityFilter === f.id
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Activity List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {isActivitiesLoading ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Loading recent activities...
                </div>
              ) : filteredActivities.length === 0 ? (
                <div className="py-12 text-center">
                  <Activity className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-bold text-foreground">No activities found</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Try adjusting your search query or filter settings.
                  </p>
                </div>
              ) : (
                filteredActivities.map((act) => {
                  const Icon = act.icon;
                  return (
                    <div
                      key={act.id}
                      className="flex items-center justify-between p-3 rounded-2xl bg-muted/20 border border-border/60 hover:bg-muted/40 transition gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${act.color}`}
                        >
                          <Icon className="size-4" />
                        </div>
                        {act.productImage && (
                          <img
                            src={act.productImage}
                            alt=""
                            className="size-9 rounded-lg object-cover border border-border shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {act.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {act.subtitle && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                {act.subtitle}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground/60">•</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {act.fullTime}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {act.channelTag && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                            {act.channelTag}
                          </span>
                        )}
                        {act.amount > 0 && (
                          <span className="text-xs font-bold text-foreground bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
                            ₹{Math.round(act.amount).toLocaleString("en-IN")}
                          </span>
                        )}
                        {act.productSlug && (
                          <Link
                            to="/product/$id"
                            params={{ id: act.productSlug }}
                            target="_blank"
                            className="text-xs font-medium text-primary hover:underline ml-1"
                          >
                            View Product →
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-3 bg-muted/20">
              <span className="text-xs text-muted-foreground">
                Showing {filteredActivities.length} of {parsedActivities.length} recent activity
                logs
              </span>
              <button
                type="button"
                onClick={() => setIsRecentActivityModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-muted hover:bg-muted/80 text-xs font-bold text-foreground transition cursor-pointer"
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
