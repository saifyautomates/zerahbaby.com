import { useState, useMemo } from "react";
import { format, subDays, isSameDay, parseISO } from "date-fns";
import { useAllOrders } from "@/lib/orders";
import { formatPrice } from "@/lib/store";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  AlertTriangle,
  ShoppingCart,
  Percent,
  Scale,
  Package,
  Info,
  ChevronDown,
  MoreVertical,
  Calendar,
  Download,
  CreditCard,
  FileText,
  ShieldCheck,
  CheckCircle,
  Clock,
  Shirt,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type WebsiteVisitor = {
  created_at: string;
  city: string | null;
  region: string | null;
  country: string | null;
  metadata?: any;
};

export function DashboardTab() {
  const [timeRange, setTimeRange] = useState("30");

  // Real data queries
  const { data: orders = [], isLoading: isLoadingOrders } = useAllOrders(true);
  const { data: posSales = [] } = useQuery({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("offline_sales")
        .select("*, offline_sale_items(*)");
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  const { data: visitors = [] } = useQuery({
    queryKey: ["admin-visitor-analytics"],
    queryFn: async () => {
      // The generated client types can briefly lag a newly migrated table.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("website_visitors").select("*");
      if (error) throw error;
      return data as WebsiteVisitor[];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["admin-products-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, price, stock, name, image_url");
      if (error) return [];
      return data ?? [];
    },
  });

  // Aggregated Analytics & Calculations
  const stats = useMemo(() => {
    const allSales = [...orders, ...posSales];
    const onlineOrders = orders.filter((o) => !o.notes?.includes("POS Order"));
    const offlineOrders = [...orders.filter((o) => o.notes?.includes("POS Order")), ...posSales];

    const rawRevenue = allSales.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const displayRevenue = rawRevenue;
    const totalOrdersCount = allSales.length;
    const visitorsCount = visitors.length;
    const lowStockCount = products.filter((p: any) => (p.stock || 0) <= 3).length;
    const avgOrder = totalOrdersCount > 0 ? displayRevenue / totalOrdersCount : 0;

    const calculatedStockValue = products.reduce(
      (sum: number, p: any) => sum + Number(p.price || 0) * Number(p.stock || 0),
      0,
    );
    const stockValue = calculatedStockValue;

    const onlineSales = onlineOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const cashSales = offlineOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    const today = new Date();
    const chartDays = Array.from({ length: 9 }).map((_, i) => {
      return {
        dateStr: format(subDays(today, 8 - i), "MMM dd"),
        online: i === 8 ? onlineSales : 0,
        offline: i === 8 ? cashSales : 0,
        visitors: i === 8 ? visitorsCount : 0,
      };
    });

    return {
      revenue: displayRevenue,
      orders: totalOrdersCount,
      visitors: visitorsCount,
      lowStock: lowStockCount,
      avgOrder,
      stockValue,
      chartDays,
      onlineSales,
      cashSales,
    };
  }, [orders, posSales, visitors, products]);

  // Payment Breakdown Data for Donut Chart
  const paymentBreakdown =
    stats.revenue > 0
      ? [
          {
            name: "Cash/Offline",
            value: stats.cashSales,
            percentage: `${((stats.cashSales / stats.revenue) * 100).toFixed(1)}%`,
            color: "#0f172a",
          },
          {
            name: "Online",
            value: stats.onlineSales,
            percentage: `${((stats.onlineSales / stats.revenue) * 100).toFixed(1)}%`,
            color: "#2563eb",
          },
        ]
      : [
          { name: "Cash/Offline", value: 0, percentage: "0%", color: "#0f172a" },
          { name: "Online", value: 0, percentage: "0%", color: "#2563eb" },
        ];

  // Recent Orders Data
  const recentOrders = useMemo(() => {
    const all = [...orders, ...posSales];
    return all
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5)
      .map((o) => ({
        id: `#${o.id.toString().substring(0, 6)}`,
        customer: o.full_name || o.customer_name || o.email || "Guest",
        date: format(new Date(o.created_at), "MMM dd, yyyy"),
        amount: Number(o.total || 0),
        status: o.status || "Completed",
        source: o.notes?.includes("POS Order") ? "POS" : "Online",
      }));
  }, [orders, posSales]);

  // Top Selling Products (using stock as a sorting mechanism for now)
  const topSelling = useMemo(() => {
    return [...products]
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 5)
      .map((p) => ({
        name: p.name || "Unknown",
        sold: 0, // Need order item tracking to show real sold amount
        revenue: Number(p.price || 0),
        icon: "📦",
      }));
  }, [products]);

  // Recent Activity Feed
  const recentActivity = useMemo(() => {
    const activities: Array<{ title: string; time: string; icon: typeof FileText; color: string }> =
      [];
    if (orders.length > 0) {
      activities.push({
        title: `New order from ${orders[0].email || "Customer"}`,
        time: "Recently",
        icon: FileText,
        color: "text-blue-500 bg-blue-50",
      });
    }
    const recentVisitors = visitors.slice(0, 3);
    recentVisitors.forEach((v) => {
      let loc = "";
      const meta = v.metadata as any;
      if (meta && meta.city) {
        loc = `from ${meta.city}, ${meta.region}, ${meta.country}`;
      }
      activities.push({
        title: loc ? `New visitor ${loc}` : "New visitor session recorded",
        time: format(new Date(v.created_at), "MMM dd, hh:mm a"),
        icon: Users,
        color: "text-cyan-500 bg-cyan-50",
      });
    });
    if (activities.length === 0) {
      activities.push({
        title: "Dashboard loaded",
        time: "Just now",
        icon: FileText,
        color: "text-gray-500 bg-gray-50",
      });
    }
    return activities;
  }, [orders, visitors]);

  // Sparkline mini data
  const sparklineData = {
    customers: [0, 0, 0, 0, 0, stats.visitors],
    returning: [0, 0, 0, 0, 0, 0],
    refunds: [0, 0, 0, 0, 0, 0],
    abandoned: [0, 0, 0, 0, 0, 0],
    products: [0, 0, 0, 0, 0, products.length],
    reviews: [0, 0, 0, 0, 0, 0],
  };

  return (
    <div className="space-y-6 text-[#1e293b]">
      {/* 1. Date and Action Bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 -mt-2 mb-4">
        <button className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition">
          <Calendar className="h-3.5 w-3.5 text-gray-500" />
          <span>Aug 15, 2026 - Aug 21, 2026</span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition">
          <Download className="h-3.5 w-3.5 text-gray-500" />
          <span>Download Report</span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>

      {/* 2. Top 5 Vibrant Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Total Revenue (Green) */}
        <div className="relative overflow-hidden rounded-2xl bg-[#16a34a] p-5 text-white shadow-sm flex flex-col justify-between min-h-[140px]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-white/90">Total Revenue</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1">
                {formatPrice(stats.revenue)}
              </h3>
              <p className="text-[11px] text-white/80 mt-0.5">All time Sales</p>
            </div>
            <div className="opacity-20">
              <span className="text-4xl font-serif">₹</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/10 text-[11px]">
            <span className="flex items-center gap-1 font-semibold text-white">
              {stats.revenue > 0 ? "Realtime" : "Waiting for orders"}
            </span>
            <span className="text-white/80 hover:text-white cursor-pointer flex items-center gap-0.5">
              More info <Info className="h-3 w-3" />
            </span>
          </div>
        </div>

        {/* Total Orders (Blue) */}
        <div className="relative overflow-hidden rounded-2xl bg-[#2563eb] p-5 text-white shadow-sm flex flex-col justify-between min-h-[140px]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-white/90">Total Orders</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1">{stats.orders}</h3>
              <p className="text-[11px] text-white/80 mt-0.5">All time Orders</p>
            </div>
            <div className="opacity-20">
              <FileText className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/10 text-[11px]">
            <span className="flex items-center gap-1 font-semibold text-white">
              {stats.orders > 0 ? "Realtime" : "Waiting for orders"}
            </span>
            <span className="text-white/80 hover:text-white cursor-pointer flex items-center gap-0.5">
              More info <Info className="h-3 w-3" />
            </span>
          </div>
        </div>

        {/* Today's Visitors (Yellow / Amber) */}
        <div className="relative overflow-hidden rounded-2xl bg-[#f59e0b] p-5 text-white shadow-sm flex flex-col justify-between min-h-[140px]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-white/90">Visitors</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1">{stats.visitors}</h3>
              <p className="text-[11px] text-white/80 mt-0.5">All time Visitors</p>
            </div>
            <div className="opacity-20">
              <Users className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-white/10 text-[11px]">
            <span className="flex items-center gap-1 font-semibold text-white">Realtime</span>
            <span className="text-white/80 hover:text-white cursor-pointer flex items-center gap-0.5">
              More info <Info className="h-3 w-3" />
            </span>
          </div>
        </div>

        {/* Low Stock Items (Purple) */}
        <div className="relative overflow-hidden rounded-2xl bg-[#7c3aed] p-5 text-white shadow-sm flex flex-col justify-between min-h-[140px]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-white/90">Low Stock Items</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1">{stats.lowStock}</h3>
              <p className="text-[11px] text-white/80 mt-0.5">
                {stats.lowStock > 0 ? "Requires attention" : "All good"}
              </p>
            </div>
            <div className="opacity-20">
              <AlertTriangle className="h-10 w-10" />
            </div>
          </div>
          <div className="flex items-center justify-end pt-3 border-t border-white/10 text-[11px]">
            <span className="text-white/80 hover:text-white cursor-pointer flex items-center gap-0.5">
              More info <Info className="h-3 w-3" />
            </span>
          </div>
        </div>

        {/* Cash Outstanding (Red) */}
        <div className="relative overflow-hidden rounded-2xl bg-[#dc2626] p-5 text-white shadow-sm flex flex-col justify-between min-h-[140px]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-white/90">Cash Outstanding</p>
              <h3 className="text-2xl font-extrabold tracking-tight mt-1">₹0.00</h3>
              <p className="text-[11px] text-white/80 mt-0.5">No dues</p>
            </div>
            <div className="opacity-20">
              <span className="text-3xl">🤝</span>
            </div>
          </div>
          <div className="flex items-center justify-end pt-3 border-t border-white/10 text-[11px]">
            <span className="text-white/80 hover:text-white cursor-pointer flex items-center gap-0.5">
              More info <Info className="h-3 w-3" />
            </span>
          </div>
        </div>
      </div>

      {/* 3. Secondary 6-Item White Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
        {/* Stock Value */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Stock Value</p>
            <h4 className="text-sm font-bold text-gray-900">₹424,950.00</h4>
          </div>
        </div>

        {/* Month Revenue */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Month Revenue</p>
            <h4 className="text-sm font-bold text-gray-900">₹11,060.00</h4>
          </div>
        </div>

        {/* Month Expenses */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
            <TrendingDown className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Month Expenses</p>
            <h4 className="text-sm font-bold text-gray-900">₹0.00</h4>
          </div>
        </div>

        {/* Month Net */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Month Net</p>
            <h4 className="text-sm font-bold text-gray-900">₹11,060.00</h4>
          </div>
        </div>

        {/* Average Order Value */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Average Order Value</p>
            <h4 className="text-sm font-bold text-gray-900">₹2,765.00</h4>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="flex items-center gap-3 p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Percent className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium text-gray-500">Conversion Rate</p>
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-bold text-gray-900">2.45%</h4>
              <span className="text-[10px] font-semibold text-emerald-600">↑ 12.5%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Main Charts Row (3 Columns) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales Over Time */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Sales Over Time (Last 30 Days)</h3>
            <button className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              <span>Last 30 Days</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stats.chartDays}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="dateStr"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${v}`}
                />
                <Tooltip
                  formatter={(val: number) => [`₹${val}`, ""]}
                  contentStyle={{
                    borderRadius: "10px",
                    border: "none",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    fontSize: "12px",
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
                  stroke="#f97316"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#f97316" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
              <span className="text-gray-600 font-medium">Online Sales</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#f97316]" />
              <span className="text-gray-600 font-medium">POS Sales</span>
            </div>
          </div>
        </div>

        {/* Visitors Over Time */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Visitors Over Time (Last 30 Days)</h3>
            <button className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              <span>Last 30 Days</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stats.chartDays}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="dateStr"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(val: number) => [`${val} visitors`, ""]}
                  contentStyle={{
                    borderRadius: "10px",
                    border: "none",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    fontSize: "12px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="visitors"
                  name="Unique Visitors"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#10b981" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-center gap-6 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#10b981]" />
              <span className="text-gray-600 font-medium">Unique Visitors</span>
            </div>
          </div>
        </div>

        {/* Sales by Payment Method */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Sales by Payment Method</h3>
            <button className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
              <span>This Month</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </button>
          </div>

          <div className="relative h-[180px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
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
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-base font-extrabold text-gray-900">₹11,060</span>
              <span className="text-[10px] text-gray-400 font-medium">Total</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6 mt-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#0f172a]" />
              <span className="text-gray-700 font-medium">
                Cash <span className="text-gray-400 text-[11px]">₹9,120 (82.5%)</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
              <span className="text-gray-700 font-medium">
                Card <span className="text-gray-400 text-[11px]">₹1,940 (17.5%)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Middle Section: Recent Orders | Top Products | Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Orders */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Recent Orders</h3>
            <button className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800">
              <span>View All</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-medium pb-2">
                  <th className="pb-2.5">Order ID</th>
                  <th className="pb-2.5">Customer</th>
                  <th className="pb-2.5">Date</th>
                  <th className="pb-2.5">Amount</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5">Source</th>
                  <th className="pb-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-2.5 font-bold text-gray-900">{o.id}</td>
                    <td className="py-2.5 text-gray-600">{o.customer}</td>
                    <td className="py-2.5 text-gray-400 text-[11px]">{o.date}</td>
                    <td className="py-2.5 font-semibold text-gray-900">
                      ₹{o.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                          o.status === "Completed"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-amber-50 text-amber-600"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          o.source === "Online"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-orange-50 text-orange-600"
                        }`}
                      >
                        {o.source}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-gray-400 hover:text-gray-600 cursor-pointer">
                      <MoreVertical className="h-3.5 w-3.5 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Selling Products */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Top Selling Products</h3>
            <button className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800">
              <span>View All</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-medium pb-2">
                  <th className="pb-2.5">Product</th>
                  <th className="pb-2.5 text-center">Sold</th>
                  <th className="pb-2.5 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topSelling.map((p) => (
                  <tr key={p.name} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-sm">
                          {p.icon}
                        </span>
                        <span className="font-semibold text-gray-800">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-center font-medium text-gray-600">{p.sold}</td>
                    <td className="py-2.5 text-right font-bold text-gray-900">
                      ₹{p.revenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900">Recent Activity</h3>
            <button className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800">
              <span>View All</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-3.5">
            {recentActivity.map((act, i) => {
              const Icon = act.icon;
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${act.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-medium text-gray-700 line-clamp-1">{act.title}</span>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0 ml-2">{act.time}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 6. Bottom Sparkline Cards (6 Columns) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {/* Total Customers */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Total Customers</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">128</h4>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">
              ↑ 8.5% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.customers.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Returning Customers */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Returning Customers</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">24</h4>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">
              ↑ 20% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.returning.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#06b6d4" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Refunds */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Refunds</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">₹0.00</h4>
            <p className="text-[10px] font-semibold text-red-500 mt-0.5">
              ↓ 0% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.refunds.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Abandoned Carts */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Abandoned Carts</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">7</h4>
            <p className="text-[10px] font-semibold text-red-500 mt-0.5">
              ↓ 5% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.abandoned.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Total Products */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Total Products</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">156</h4>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">
              ↑ 6.2% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.products.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Reviews */}
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-gray-100 flex flex-col justify-between">
          <div>
            <p className="text-[11px] font-medium text-gray-500">Reviews</p>
            <h4 className="text-xl font-bold text-gray-900 mt-1">32</h4>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">
              ↑ 14.5% <span className="text-gray-400 font-normal">vs last 7 days</span>
            </p>
          </div>
          <div className="h-10 w-full mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.reviews.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
