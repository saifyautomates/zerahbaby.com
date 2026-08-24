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
import {
  TrendingUp,
  Users,
  AlertTriangle,
  ShoppingCart,
  Percent,
  Package,
  Info,
  ChevronDown,
  MoreVertical,
  Calendar,
  Download,
  FileText,
  DollarSign,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type WebsiteVisitor = {
  created_at: string;
  city: string | null;
  region: string | null;
  country: string | null;
};

type OfflineSale = {
  id: string;
  sale_number: string;
  customer_name: string;
  customer_phone: string;
  total: number;
  payment_method: string;
  created_at: string;
  notes?: string;
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
  const [datePreset, setDatePreset] = useState<DateRangePreset>("7d");
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

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

  // Authoritative Queries
  const { data: orders = [], isLoading: ordersLoading } = useAllOrders(true);
  const { data: posSales = [], isLoading: posLoading } = useQuery<OfflineSale[]>({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("*, offline_sale_items(*)");
      if (error) return [];
      return (data ?? []) as unknown as OfflineSale[];
    },
  });

  const { data: visitors = [], isLoading: visitorsLoading } = useQuery<WebsiteVisitor[]>({
    queryKey: ["admin-visitor-analytics"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (
              cols: string,
            ) => Promise<{ data: WebsiteVisitor[] | null; error: { message: string } | null }>;
          };
        }
      )
        .from("website_visitors")
        .select("*");
      if (error) return [];
      const v = (data ?? []) as WebsiteVisitor[];
      return v.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["admin-products-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, price, stock, name, image_url, is_active, slug, product_costs(buying_price)");
      if (error) return [];
      return data ?? [];
    },
  });

  const isAnyLoading = ordersLoading || posLoading || visitorsLoading || productsLoading;

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
    // 1. Valid paid / non-cancelled online orders
    const validOrders = orders.filter(
      (o: Order) =>
        o.status !== "cancelled" &&
        o.payment_status !== "failed" &&
        o.payment_status !== "refunded",
    );

    // Current period sales
    const currOrders = validOrders.filter((o) => inCurrentPeriod(o.created_at));
    const currPos = posSales.filter((s) => inCurrentPeriod(s.created_at));

    // Previous period sales (for comparative delta)
    const prevOrders = validOrders.filter((o) => inPrevPeriod(o.created_at));
    const prevPos = posSales.filter((s) => inPrevPeriod(s.created_at));

    // Current metrics
    const currOnlineRevenue = currOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const currPosRevenue = currPos.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const revenue = currOnlineRevenue + currPosRevenue;
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
    validOrders.forEach((o: any) => {
      const orderTotal = Number(o.total || 0);
      allTimeOnlineRevenue += orderTotal;
      o.order_items?.forEach((item: any) => {
        const prod = products.find((p: any) => p.slug === item.product_slug);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs) ? costs[0]?.buying_price : costs?.buying_price;
        const buyingPrice = Number(bp || 0);
        allTimeOnlineCogs += buyingPrice * Number(item.qty || 1);
      });
    });

    let allTimePosRevenue = 0;
    let allTimePosCogs = 0;
    posSales.forEach((s: any) => {
      const saleTotal = Number(s.total || 0);
      allTimePosRevenue += saleTotal;
      s.offline_sale_items?.forEach((item: any) => {
        const prod = products.find((p: any) => p.id === item.product_id);
        const costs = prod?.product_costs;
        const bp = Array.isArray(costs) ? costs[0]?.buying_price : costs?.buying_price;
        const buyingPrice = Number(bp || 0);
        allTimePosCogs += buyingPrice * Number(item.quantity || 1);
      });
    });

    const totalRevenueAllTime = allTimeOnlineRevenue + allTimePosRevenue;
    const totalCogsAllTime = allTimeOnlineCogs + allTimePosCogs;
    const netProfitAllTime = totalRevenueAllTime - totalCogsAllTime;

    return {
      totalRevenueAllTime,
      netProfitAllTime,
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
        { name: "POS / Offline", value: 0, color: "#0f172a" },
        { name: "Online Paid", value: 0, color: "#2563eb" },
      ];
    }
    return [
      { name: "POS / Offline", value: stats.cashSales, color: "#0f172a" },
      { name: "Online Paid", value: stats.onlineSales, color: "#2563eb" },
    ];
  }, [stats.revenue, stats.cashSales, stats.onlineSales]);

  // Recent Orders List
  const recentOrders = useMemo(() => {
    const onlineMapped = orders.map((o) => ({
      id: `#${o.id.toString().substring(0, 8).toUpperCase()}`,
      customer: o.full_name || o.email || "Customer",
      amount: Number(o.total || 0),
      status: o.status || "placed",
      source: "Online",
      created_at: o.created_at,
    }));

    const posMapped = posSales.map((s) => ({
      id: s.sale_number || `#${s.id.toString().substring(0, 8).toUpperCase()}`,
      customer: s.customer_name || "Walk-in Customer",
      amount: Number(s.total || 0),
      status: "completed",
      source: "POS",
      created_at: s.created_at,
    }));

    return [...onlineMapped, ...posMapped]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5);
  }, [orders, posSales]);

  // Top Selling / Critical Products
  const topProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 5)
      .map((p) => ({
        name: p.name || "Product",
        stock: Number(p.stock || 0),
        price: Number(p.price || 0),
      }));
  }, [products]);

  // Recent Activity Feed
  const recentActivity = useMemo(() => {
    const activities: Array<{ title: string; time: string; icon: typeof FileText; color: string }> =
      [];
    if (orders.length > 0) {
      activities.push({
        title: `Order from ${orders[0].full_name || orders[0].email || "Customer"}`,
        time: format(new Date(orders[0].created_at), "MMM dd, hh:mm a"),
        icon: FileText,
        color: "text-blue-500 bg-blue-50 dark:bg-blue-950/50",
      });
    }
    if (posSales.length > 0) {
      activities.push({
        title: `POS sale ${posSales[0].sale_number || "completed"} (${formatPrice(posSales[0].total)})`,
        time: format(new Date(posSales[0].created_at), "MMM dd, hh:mm a"),
        icon: ShoppingCart,
        color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50",
      });
    }
    visitors.slice(0, 2).forEach((v) => {
      const loc = [v.city, v.region, v.country].filter(Boolean).join(", ");
      activities.push({
        title: loc ? `Visitor from ${loc}` : "New visitor session",
        time: format(new Date(v.created_at), "MMM dd, hh:mm a"),
        icon: Users,
        color: "text-amber-500 bg-amber-50 dark:bg-amber-950/50",
      });
    });
    if (activities.length === 0) {
      activities.push({
        title: "Store operational",
        time: "Live",
        icon: Check,
        color: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/50",
      });
    }
    return activities;
  }, [orders, posSales, visitors]);

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

  return (
    <div className="space-y-6 text-foreground animate-in fade-in duration-150">
      {/* Date Range Selector and Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-1 mb-4">
        <div>
          <h2 className="text-lg font-black tracking-tight text-foreground font-display">
            Executive Performance Overview
          </h2>
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

      {/* Top 5 Vibrant, Clickable, Fully-Responsive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {/* 1. Total Revenue Card (Emerald Green) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate?.("analytics")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("analytics");
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
                onNavigate?.("analytics");
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
          onClick={() => onNavigate?.("orders")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("orders");
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
                onNavigate?.("orders");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 3. Today's / Period Visitors Card (Warm Amber) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate?.("analytics")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("analytics");
            }
          }}
          aria-label={`Visitors: ${stats.visitorsCount}. Click to open Visitor Analytics.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        >
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white/90">
                {datePreset === "today" ? "Today's Visitors" : "Store Visitors"}
              </p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1 truncate">
                {isAnyLoading ? "..." : stats.visitorsCount}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5 truncate">
                {datePreset === "today" ? "Today's Traffic" : "Period Traffic"}
              </p>
            </div>
            <div className="opacity-20 transition-transform group-hover:scale-110 shrink-0 ml-2">
              <Users className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/15 text-[11px] mt-3">
            <span className="font-semibold text-white truncate mr-2">
              {stats.visitorsDelta.text}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.("analytics");
              }}
              className="text-white/80 hover:text-white flex items-center gap-0.5 font-medium shrink-0 group-hover:underline cursor-pointer"
            >
              More info <Info className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </div>

        {/* 4. Low Stock Items Card (Deep Violet) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onNavigate?.("inventory")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("inventory");
            }
          }}
          aria-label={`Low Stock Items: ${stats.lowStockCount}. Click to open Inventory.`}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-violet-700 p-5 text-white shadow-sm hover:shadow-lg hover:shadow-violet-600/20 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[140px] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
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
                onNavigate?.("inventory");
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
          onClick={() => onNavigate?.("orders")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("orders");
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
                onNavigate?.("orders");
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
        <div className="flex items-center gap-3 p-2">
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
        <div className="flex items-center gap-3 p-2">
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
                  formatter={(val: number) => [`₹${val}`, ""]}
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
                  formatter={(val: number) => [`${val} visitors`, ""]}
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
                  formatter={(val: number) => [formatPrice(val), ""]}
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
              <span className="h-2.5 w-2.5 rounded-sm bg-[#0f172a]" />
              <span className="text-muted-foreground font-medium">
                POS:{" "}
                <span className="text-foreground font-bold">{formatPrice(stats.cashSales)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
              <span className="text-muted-foreground font-medium">
                Online:{" "}
                <span className="text-foreground font-bold">{formatPrice(stats.onlineSales)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle Section: Recent Orders | Top Products | Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Orders List */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Recent Orders</h3>
            <button
              type="button"
              onClick={() => onNavigate?.("orders")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>View All</span>
              <ChevronDown className="h-3 w-3 rotate-270" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-medium">
                  <th className="pb-2.5">Order ID</th>
                  <th className="pb-2.5">Customer</th>
                  <th className="pb-2.5">Amount</th>
                  <th className="pb-2.5">Source</th>
                  <th className="pb-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                      No orders recorded yet.
                    </td>
                  </tr>
                ) : (
                  recentOrders.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => onNavigate?.("orders")}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 font-bold text-foreground">{o.id}</td>
                      <td className="py-2.5 text-muted-foreground truncate max-w-[100px]">
                        {o.customer}
                      </td>
                      <td className="py-2.5 font-semibold text-foreground">
                        {formatPrice(o.amount)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            o.source === "Online"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {o.source}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">
                        <MoreVertical className="h-3.5 w-3.5 inline" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Watchlist */}
        <div className="rounded-2xl bg-card p-5 shadow-sm border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground">Low Stock Watchlist</h3>
            <button
              type="button"
              onClick={() => onNavigate?.("inventory")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <span>Inventory</span>
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
                      onClick={() => onNavigate?.("inventory")}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5">
                        <span className="font-semibold text-foreground line-clamp-1">{p.name}</span>
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
          <div className="flex items-center gap-1.5 rounded-md bg-indigo-500/10 px-2 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            <Users className="h-3.5 w-3.5" />
            <span>{stats.visitorsCount} this period</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-medium">
                <th className="pb-2.5">Date & Time</th>
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
                        {format(new Date(v.created_at), "MMM dd, hh:mm a")}
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
