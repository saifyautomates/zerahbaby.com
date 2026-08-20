import { useMemo } from "react";
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
} from "recharts";
import { Banknote, ShoppingCart, TrendingUp, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function DashboardTab() {
  const { data: orders = [], isLoading } = useAllOrders(true);

  const {
    totalRevenue,
    totalOrders,
    avgOrderValue,
    chartData,
    topProducts,
    onlineSales,
    offlineSales,
  } = useMemo(() => {
    // 1. Basic Metrics
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Split Online vs Offline (POS)
    const offlineOrders = orders.filter((o) => o.notes?.includes("POS Order"));
    const onlineOrders = orders.filter((o) => !o.notes?.includes("POS Order"));

    const offlineSales = offlineOrders.reduce((sum, o) => sum + o.total, 0);
    const onlineSales = onlineOrders.reduce((sum, o) => sum + o.total, 0);

    // 2. Chart Data (Last 30 Days)
    const today = new Date();
    const last30Days = Array.from({ length: 30 }).map((_, i) => {
      const date = subDays(today, 29 - i);
      return { date, dateStr: format(date, "MMM dd"), online: 0, offline: 0, total: 0, visitors: 0 };
    });

    orders.forEach((o) => {
      const orderDate = parseISO(o.created_at);
      const dayData = last30Days.find((d) => isSameDay(d.date, orderDate));
      if (dayData) {
        dayData.total += o.total;
        if (o.notes?.includes("POS Order")) {
          dayData.offline += o.total;
        } else {
          dayData.online += o.total;
        }
      }
    });

    // 3. Top Products
    const productSales: Record<string, { name: string; qty: number; revenue: number }> = {};
    orders.forEach((o) => {
      o.order_items?.forEach((item) => {
        if (!productSales[item.product_slug]) {
          productSales[item.product_slug] = { name: item.name, qty: 0, revenue: 0 };
        }
        productSales[item.product_slug].qty += item.qty;
        productSales[item.product_slug].revenue += item.qty * item.price;
      });
    });

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    return {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      chartData: last30Days,
      topProducts,
      onlineSales,
      offlineSales,
    };
  }, [orders]);

  const { data: visitors = [], isLoading: isLoadingVisitors } = useQuery({
    queryKey: ["website_visitors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("website_visitors").select("*");
      if (error) throw error;
      return data;
    },
  });

  const visitorStats = useMemo(() => {
    const totalVisitors = visitors.length;
    
    // Group by location (City, State)
    const locationCounts: Record<string, number> = {};
    visitors.forEach((v) => {
      if (v.city && v.region) {
        const loc = `${v.city}, ${v.region}`;
        locationCounts[loc] = (locationCounts[loc] || 0) + 1;
      } else if (v.country) {
        locationCounts[v.country] = (locationCounts[v.country] || 0) + 1;
      }
    });

    const topLocations = Object.entries(locationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Merge visitor counts into chartData
    const chartWithVisitors = chartData.map(d => ({ ...d }));
    visitors.forEach((v) => {
      const visitDate = parseISO(v.created_at);
      const dayData = chartWithVisitors.find((d) => isSameDay(d.date, visitDate));
      if (dayData) {
        dayData.visitors += 1;
      }
    });

    return { totalVisitors, topLocations, chartWithVisitors };
  }, [visitors, chartData]);

  if (isLoading || isLoadingVisitors) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard data...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Banknote className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Total Revenue
              </p>
              <h3 className="text-2xl font-bold">{formatPrice(totalRevenue)}</h3>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <ShoppingCart className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Orders</p>
              <h3 className="font-display text-2xl font-bold text-foreground">
                {totalOrders}
              </h3>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
              <Users className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Visitors</p>
              <h3 className="font-display text-2xl font-bold text-foreground">
                {visitorStats.totalVisitors}
              </h3>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-muted-foreground">Online</span>
              <span className="font-bold">{formatPrice(onlineSales)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full"
                style={{ width: `${totalRevenue ? (onlineSales / totalRevenue) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-sm mt-2">
              <span className="font-semibold text-muted-foreground">Offline (POS)</span>
              <span className="font-bold">{formatPrice(offlineSales)}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-pink-500 h-2 rounded-full"
                style={{ width: `${totalRevenue ? (offlineSales / totalRevenue) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Sales Chart */}
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h2 className="mb-6 font-display text-lg font-semibold text-foreground">Sales Over Time (Last 30 Days)</h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visitorStats.chartWithVisitors} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="dateStr" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#888' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#888' }}
                  tickFormatter={(val) => `₹${val}`}
                />
                <Tooltip 
                  formatter={(value: number) => [`₹${value}`, undefined]}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" />
                <Line 
                  type="monotone" 
                  dataKey="online" 
                  name="Online Sales" 
                  stroke="#3b82f6" 
                  strokeWidth={3} 
                  dot={false}
                  activeDot={{ r: 6 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="offline" 
                  name="POS Sales" 
                  stroke="#f97316" 
                  strokeWidth={3} 
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Visitors Chart */}
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h2 className="mb-6 font-display text-lg font-semibold text-foreground">Visitors Over Time (Last 30 Days)</h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visitorStats.chartWithVisitors} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="dateStr" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#888' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#888' }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" />
                <Line 
                  type="monotone" 
                  dataKey="visitors" 
                  name="Unique Visitors" 
                  stroke="#10b981" 
                  strokeWidth={3} 
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Top Products */}
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h3 className="mb-6 font-display text-lg font-bold">Top Selling Products</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-3 font-medium">Product</th>
                  <th className="pb-3 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topProducts.map((p, i) => (
                  <tr key={p.name} className="transition-colors hover:bg-muted/50">
                    <td className="py-4">
                      <p className="font-semibold text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.qty} units sold</p>
                    </td>
                    <td className="py-4 text-right font-medium text-primary">
                      {formatPrice(p.revenue)}
                    </td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                      No sales data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Visitor Locations */}
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-display text-lg font-semibold text-foreground">Top Visitor Locations</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-3 font-medium">Location (City, State)</th>
                  <th className="pb-3 text-right font-medium">Visits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visitorStats.topLocations.map(([location, count]) => (
                  <tr key={location} className="transition-colors hover:bg-muted/50">
                    <td className="py-4 font-medium text-foreground">{location}</td>
                    <td className="py-4 text-right tabular-nums text-muted-foreground">
                      {count}
                    </td>
                  </tr>
                ))}
                {visitorStats.topLocations.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
                      No visitor data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
