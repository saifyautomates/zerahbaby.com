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
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { type OfflineSale } from "@/lib/pos";
import { initPerformanceMetrics } from "@/utils/performanceMetrics";
import { DashboardDrillDown } from "./DashboardDrillDown";

type WebsiteVisitor = {
  created_at: string;
  city: string | null;
  region: string | null;
  country: string | null;
  customer_name?: string | null;
};

type DateRangePreset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all";

const DATE_RANGE_OPTIONS: { key: DateRangePreset; label: string; subLabel: string }[] = [
  { key: "today", label: "Today", subLabel: "Today's activity" },
  { key: "yesterday", label: "Yesterday", subLabel: "Yesterday's activity" },
  { key: "7d", label: "Last 7 Days", subLabel: "Past 7 days" },
  { key: "30d", label: "Last 30 Days", subLabel: "Past 30 days" },
  { key: "this_month", label: "This Month", subLabel: "Month to date" },
  { key: "all", label: "All Time", subLabel: "Entire history" },
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

  const [datePreset, setDatePresetState] = useState<DateRangePreset>(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const preset = urlParams.get("datePreset") as DateRangePreset | null;
      if (preset && ["today", "yesterday", "7d", "30d", "this_month", "all"].includes(preset)) {
        return preset;
      }
      const saved = localStorage.getItem("zerah_admin_date_preset") as DateRangePreset | null;
      if (saved && ["today", "yesterday", "7d", "30d", "this_month", "all"].includes(saved)) {
        return saved;
      }
    }
    return "7d";
  });

  const setDatePreset = (val: DateRangePreset) => {
    setDatePresetState(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("zerah_admin_date_preset", val);
      const url = new URL(window.location.href);
      url.searchParams.set("datePreset", val);
      window.history.replaceState({}, "", url.toString());
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
        queryClient.invalidateQueries({ queryKey: ["admin-analytics-events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_sales" }, () => {
        queryClient.invalidateQueries({ queryKey: ["offline-sales"] });
        queryClient.invalidateQueries({ queryKey: ["admin-offline-sales"] });
        queryClient.invalidateQueries({ queryKey: ["admin-analytics-events"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_sale_items" }, () => {
        queryClient.invalidateQueries({ queryKey: ["offline-sales"] });
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
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
  } = useQuery<OfflineSale[]>({
    queryKey: ["offline-sales"],
    staleTime: 1000 * 5,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("*, offline_sale_items(*)");
      if (error) throw error;
      return (data ?? []) as unknown as OfflineSale[];
    },
  });

  const posSales = useMemo(() => {
    return rawPosSales.filter((s) => s.status !== "cancelled");
  }, [rawPosSales]);

  const {
    data: visitors = [],
    isLoading: visitorsLoading,
    isError: visitorsError,
  } = useQuery<WebsiteVisitor[]>({
    queryKey: ["admin-visitor-analytics"],
    staleTime: 1000 * 15,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.from("website_visitors").select("*");
      if (error) throw error;
      const v = (data ?? []) as WebsiteVisitor[];
      return v.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
  });

  const {
    data: products = [],
    isLoading: productsLoading,
    isError: productsError,
  } = useQuery({
    queryKey: ["admin-products-count"],
    staleTime: 1000 * 10,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, price, stock, name, is_active, slug, category, product_costs(buying_price), product_images(public_url, is_primary, sort_order)",
        );
      if (error) throw error;
      return data ?? [];
    },
  });

  const isAnyLoading = ordersLoading || posLoading || visitorsLoading || productsLoading;
  const isAnyError = ordersError || posError || visitorsError || productsError;

  // Date Range Bounds & Comparison Windows
  const { dateRangeText, compareLabel, inCurrentPeriod, inPrevPeriod } = useMemo(() => {
    const now = new Date();
    let start: Date;
    let end: Date = endOfDay(now);
    let prevStart: Date;
    let prevEnd: Date;
    let text = "";
    let comp = "last period";

    switch (datePreset) {
      case "today":
        start = startOfDay(now);
        prevStart = startOfDay(subDays(now, 1));
        prevEnd = endOfDay(subDays(now, 1));
        text = `Today, ${format(now, "MMM dd, yyyy")}`;
        comp = "yesterday";
        break;
      case "yesterday":
        start = startOfDay(subDays(now, 1));
        end = endOfDay(subDays(now, 1));
        prevStart = startOfDay(subDays(now, 2));
        prevEnd = endOfDay(subDays(now, 2));
        text = `Yesterday, ${format(subDays(now, 1), "MMM dd, yyyy")}`;
        comp = "prev day";
        break;
      case "7d":
        start = startOfDay(subDays(now, 6));
        prevStart = startOfDay(subDays(now, 13));
        prevEnd = endOfDay(subDays(now, 7));
        text = `${format(subDays(now, 6), "MMM dd")} – ${format(now, "MMM dd, yyyy")}`;
        comp = "last 7 days";
        break;
      case "30d":
        start = startOfDay(subDays(now, 29));
        prevStart = startOfDay(subDays(now, 59));
        prevEnd = endOfDay(subDays(now, 30));
        text = `${format(subDays(now, 29), "MMM dd")} – ${format(now, "MMM dd, yyyy")}`;
        comp = "last 30 days";
        break;
      case "this_month":
        start = startOfMonth(now);
        prevStart = startOfMonth(subMonths(now, 1));
        prevEnd = endOfMonth(subMonths(now, 1));
        text = `${format(startOfMonth(now), "MMM dd")} – ${format(now, "MMM dd, yyyy")}`;
        comp = "last month";
        break;
      case "all":
      default:
        start = new Date(0);
        prevStart = new Date(0);
        prevEnd = new Date(0);
        text = `All Time (Since Launch)`;
        comp = "all time";
        break;
    }

    const inCurr = (dateStr: string | null | undefined) => {
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      return t >= start.getTime() && t <= end.getTime();
    };

    const inPrev = (dateStr: string | null | undefined) => {
      if (!dateStr || datePreset === "all") return false;
      const t = new Date(dateStr).getTime();
      return t >= prevStart.getTime() && t <= prevEnd.getTime();
    };

    return {
      dateRangeText: text,
      compareLabel: comp,
      inCurrentPeriod: inCurr,
      inPrevPeriod: inPrev,
    };
  }, [datePreset]);

  // Authoritative KPI Metrics Calculation
  const stats = useMemo(() => {
    // 1. Valid non-cancelled online orders (includes Placed, Confirmed, Shipped, Delivered, COD, Paid)
    const validOrders = orders.filter((o: Order) => {
      if (o.status === "cancelled") return false;
      if (o.payment_status === "failed" || o.payment_status === "refunded") return false;
      return true;
    });

    const validPosSales = posSales.filter((s) => s.status !== "cancelled");

    // Current period sales
    const currOrders = validOrders.filter((o) => inCurrentPeriod(o.created_at));
    const currPos = validPosSales.filter((s) => inCurrentPeriod(s.created_at));

    // Previous period sales (for comparative delta)
    const prevOrders = validOrders.filter((o) => inPrevPeriod(o.created_at));
    const prevPos = posSales.filter((s) => inPrevPeriod(s.created_at));

    // Current metrics
    const currOnlineRevenue = currOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const currPosRevenue = currPos.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const revenue = currOnlineRevenue + currPosRevenue;

    // Period Metrics (Net Profit)
    let currOnlineCogs = 0;
    currOrders.forEach((o) => {
      o.order_items?.forEach((item) => {
        const prod = products.find((p) => p.slug === item.product_slug);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs)
          ? costs[0]?.buying_price
          : (costs as { buying_price?: number } | null)?.buying_price;
        currOnlineCogs += Number(bp || 0) * Number(item.qty || 1);
      });
    });

    let currPosCogs = 0;
    currPos.forEach((s) => {
      s.offline_sale_items?.forEach((item) => {
        const prod = products.find((p) => p.id === item.product_id);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs)
          ? costs[0]?.buying_price
          : (costs as { buying_price?: number } | null)?.buying_price;
        currPosCogs += Number(bp || 0) * Number(item.qty || 1);
      });
    });

    const netProfit = revenue - (currOnlineCogs + currPosCogs);
    const ordersCount = currOrders.length + currPos.length;

    // Previous metrics
    const prevOnlineRevenue = prevOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const prevPosRevenue = prevPos.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const prevRevenue = prevOnlineRevenue + prevPosRevenue;
    const prevOrdersCount = prevOrders.length + prevPos.length;

    // Visitors
    const currVisitors = visitors.filter((v) => inCurrentPeriod(v.created_at)).length;
    const prevVisitors = visitors.filter((v) => inPrevPeriod(v.created_at)).length;

    // Low stock items (live catalog inventory <= 5)
    const lowStockItems = products.filter((p) => Number(p.stock ?? 0) <= 5);
    const lowStockCount = lowStockItems.length;
    const outOfStockCount = products.filter((p) => Number(p.stock ?? 0) <= 0).length;

    // Cash Outstanding: Active uncancelled COD orders and pending payments
    const pendingCodOrders = orders.filter(
      (o) =>
        o.status !== "cancelled" &&
        o.payment_status !== "paid" &&
        (o.payment_method === "cod" || o.payment_status === "pending"),
    );
    const cashOutstanding = pendingCodOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    // Overall catalog value & average order
    const totalCatalogValue = products.reduce(
      (sum, p) => sum + Number(p.price || 0) * Number(p.stock || 0),
      0,
    );
    const avgOrderValue = ordersCount > 0 ? revenue / ordersCount : 0;

    // Deltas
    const revenueDelta = calculateDelta(revenue, prevRevenue, compareLabel);
    const ordersDelta = calculateDelta(ordersCount, prevOrdersCount, compareLabel);
    const visitorsDelta = calculateDelta(currVisitors, prevVisitors, compareLabel);

    // Dynamic Chart Days (Last 7 or 9 segments)
    const today = new Date();
    const chartDays = Array.from({ length: 7 }).map((_, i) => {
      const d = subDays(today, 6 - i);
      const dayStart = startOfDay(d).getTime();
      const dayEnd = endOfDay(d).getTime();

      const dayOnline = validOrders
        .filter((o) => {
          const t = new Date(o.created_at).getTime();
          return t >= dayStart && t <= dayEnd;
        })
        .reduce((sum, o) => sum + Number(o.total || 0), 0);

      const dayPos = posSales
        .filter((s) => {
          const t = new Date(s.created_at).getTime();
          return t >= dayStart && t <= dayEnd;
        })
        .reduce((sum, s) => sum + Number(s.total || 0), 0);

      const dayVis = visitors.filter((v) => {
        const t = new Date(v.created_at).getTime();
        return t >= dayStart && t <= dayEnd;
      }).length;

      return {
        dateStr: format(d, "MMM dd"),
        online: dayOnline,
        offline: dayPos,
        visitors: dayVis,
      };
    });

    // All-time Metrics (Full Logic)
    let allTimeOnlineRevenue = 0;
    let allTimeOnlineCogs = 0;
    validOrders.forEach((o) => {
      const orderTotal = Number(o.total || 0);
      allTimeOnlineRevenue += orderTotal;
      o.order_items?.forEach((item) => {
        const prod = products.find((p) => p.slug === item.product_slug);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs)
          ? costs[0]?.buying_price
          : (costs as { buying_price?: number } | null)?.buying_price;
        const buyingPrice = Number(bp || 0);
        allTimeOnlineCogs += buyingPrice * Number(item.qty || 1);
      });
    });

    let allTimePosRevenue = 0;
    let allTimePosCogs = 0;
    posSales.forEach((s) => {
      const saleTotal = Number(s.total || 0);
      allTimePosRevenue += saleTotal;
      s.offline_sale_items?.forEach((item) => {
        const prod = products.find((p) => p.id === item.product_id);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs)
          ? costs[0]?.buying_price
          : (costs as { buying_price?: number } | null)?.buying_price;
        const buyingPrice = Number(bp || 0);
        allTimePosCogs += buyingPrice * Number(item.qty || 1);
      });
    });

    const totalRevenueAllTime = allTimeOnlineRevenue + allTimePosRevenue;
    const totalCogsAllTime = allTimeOnlineCogs + allTimePosCogs;
    const netProfitAllTime = totalRevenueAllTime - totalCogsAllTime;

    return {
      totalRevenueAllTime,
      netProfitAllTime,
      netProfit,
      revenue,
      ordersCount,
      visitorsCount: currVisitors,
      lowStockCount,
      outOfStockCount,
      cashOutstanding,
      pendingCodCount: pendingCodOrders.length,
      revenueDelta,
      ordersDelta,
      visitorsDelta,
      onlineSales: currOnlineRevenue,
      cashSales: currPosRevenue,
      totalCatalogValue,
      avgOrderValue,
      chartDays,
    };
  }, [orders, posSales, visitors, products, inCurrentPeriod, inPrevPeriod, compareLabel]);

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

  const { data: rawEvents = [] } = useQuery({
    queryKey: ["admin-analytics-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_events")
        .select("event_name, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data ?? [];
    },
  });

  // Recent Activity Feed
  const recentActivity = useMemo(() => {
    if (rawEvents.length === 0) {
      return [
        {
          title: "Store operational",
          time: "Live",
          icon: Check,
          color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50",
        },
      ];
    }
    return rawEvents.map((ev) => {
      let icon = Activity;
      let color = "text-blue-500 bg-blue-50 dark:bg-blue-950/50";
      let title = ev.event_name;

      const profile = (ev as { profiles?: { full_name?: string } | null }).profiles;
      const product = ev.products as { name?: string } | null;

      if (ev.event_name === "view_product" || ev.event_name === "product_view") {
        title = `${profile?.full_name || "A visitor"} viewed ${product?.name ? `"${product.name}"` : "a product"}`;
        icon = Eye;
        color = "text-purple-500 bg-purple-50 dark:bg-purple-950/50";
      } else if (ev.event_name === "add_to_cart") {
        title = `${profile?.full_name || "A visitor"} added ${product?.name ? `"${product.name}"` : "an item"} to bag`;
        icon = ShoppingCart;
        color = "text-amber-500 bg-amber-50 dark:bg-amber-950/50";
      } else if (ev.event_name === "buy_now") {
        title = `${profile?.full_name || "A visitor"} initiated Quick Buy for ${product?.name ? `"${product.name}"` : "an item"}`;
        icon = ShoppingBag;
        color = "text-rose-500 bg-rose-50 dark:bg-rose-950/50";
      } else if (ev.event_name === "checkout_started") {
        title = `${profile?.full_name || "A visitor"} started checkout`;
        icon = ShoppingBag;
        color = "text-indigo-500 bg-indigo-50 dark:bg-indigo-950/50";
      } else if (ev.event_name === "order_created") {
        title = `${profile?.full_name || "A customer"} placed an order`;
        icon = CheckCircle2;
        color = "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50";
      } else if (ev.event_name === "wishlist_add") {
        title = `${profile?.full_name || "A visitor"} saved ${product?.name ? `"${product.name}"` : "an item"} to wishlist`;
        icon = Heart;
        color = "text-pink-500 bg-pink-50 dark:bg-pink-950/50";
      } else if (ev.event_name === "wishlist_remove") {
        title = `${profile?.full_name || "A visitor"} removed ${product?.name ? `"${product.name}"` : "an item"} from wishlist`;
        icon = Heart;
        color = "text-gray-500 bg-gray-50 dark:bg-gray-950/50";
      } else {
        const readable = ev.event_name.replace(/_/g, " ");
        title = `${profile?.full_name || "A visitor"} ${readable}`;
      }

      return {
        title,
        time: format(new Date(ev.created_at), "MMM dd, hh:mm a"),
        icon,
        color,
      };
    });
  }, [rawEvents]);

  // CSV Report Generator
  const handleDownloadReport = () => {
    const allSales = [...orders, ...posSales];
    let csv = "Order / Sale ID,Date,Status,Total,Source,Customer\n";
    allSales.forEach((o) => {
      const isPOS = "sale_number" in o;
      const id = isPOS ? (o as OfflineSale).sale_number : (o as Order).id;
      const source = isPOS ? "Offline / POS" : "Online";
      const total = o.total || 0;
      const status = isPOS ? "completed" : (o as Order).status || "placed";
      const date = format(new Date(o.created_at), "yyyy-MM-dd HH:mm");
      const customer = isPOS
        ? (o as OfflineSale).customer_name || "Walk-in"
        : (o as Order).full_name || (o as Order).email || "Guest";
      csv += `"${id}","${date}","${status}",${total},"${source}","${customer}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zerah-sales-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
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
                      setDatePreset(opt.key);
                      setIsDateDropdownOpen(false);
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
            }}
            className="px-3 py-1.5 rounded-xl bg-destructive text-destructive-foreground font-bold hover:bg-destructive/90 transition cursor-pointer shrink-0 shadow-xs"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Top 5 Vibrant, Clickable, Fully-Responsive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {/* 1. Total Revenue Card (Emerald Green) */}
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
          aria-label={`Total Revenue: ${formatPrice(stats.revenue)}. Click to open Analytics.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-emerald-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Total Revenue</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.revenue)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {datePreset === "today" ? "Today's Sales" : "Period Sales"}
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

        {/* 2. Total Orders Card (Royal Blue) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setActiveDrillDown("orders")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setActiveDrillDown("orders");
            }
          }}
          aria-label={`Total Orders: ${stats.ordersCount}. Click to open Orders.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-blue-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">Total Orders</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : stats.ordersCount}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {datePreset === "today" ? "Today's Orders" : "Period Orders"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <FileText className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">{stats.ordersDelta.text}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveDrillDown("orders");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 3. Period Net Profit Card (Warm Amber) */}
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
          aria-label={`Net Profit: ${formatPrice(stats.netProfit)}. Click to open Profit Analysis.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">
                {datePreset === "today" ? "Today's Net Profit" : "Period Net Profit"}
              </p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : formatPrice(stats.netProfit)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {datePreset === "today" ? "Today's Earnings" : "Period Earnings"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <span className="text-3xl select-none">📈</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">Based on COGS</span>
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

      {/* Secondary 6-Item Metric Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6 rounded-2xl bg-card p-4 shadow-sm border border-border">
        <div
          className="flex items-center gap-3 p-2 cursor-pointer hover:bg-muted/50 rounded-xl transition-colors"
          onClick={() => setActiveDrillDown("stock")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">
              Total Stock Value
            </p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.totalCatalogValue)}
            </h4>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Period Revenue</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.revenue)}
            </h4>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">
              Avg Order Value
            </p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.avgOrderValue)}
            </h4>
          </div>
        </div>
        <div
          className="flex items-center gap-3 p-2 cursor-pointer transition hover:bg-muted/50 rounded-xl"
          onClick={() => setActiveDrillDown("active-catalog")}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Percent className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Active Catalog</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {stats.lowStockCount + stats.outOfStockCount > 0
                ? `${products.filter((p) => p.is_active).length} SKUs`
                : `${products.length} SKUs`}
            </h4>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Total Revenue</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.totalRevenueAllTime)}
            </h4>
          </div>
        </div>
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <DollarSign className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">Net Profit</p>
            <h4 className="text-sm font-bold text-foreground truncate">
              {formatPrice(stats.netProfitAllTime)}
            </h4>
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
                {formatPrice(stats.revenue)}
              </span>
              <span className="text-[10px] text-muted-foreground font-medium">Total</span>
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
              onClick={() => onNavigate?.("orders")}
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
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${act.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-medium text-foreground truncate">{act.title}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                    {act.time}
                  </span>
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
    </div>
  );
}
