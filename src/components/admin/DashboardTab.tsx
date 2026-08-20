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
import { Banknote, ShoppingCart, TrendingUp } from "lucide-react";

export function DashboardTab() {
  const { data: orders = [], isLoading } = useAllOrders();

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
      return { date, dateStr: format(date, "MMM dd"), online: 0, offline: 0, total: 0 };
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

  if (isLoading) {
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
            <div className="flex size-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
              <ShoppingCart className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Total Orders
              </p>
              <h3 className="text-2xl font-bold">{totalOrders}</h3>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-green-500/10 text-green-600">
              <TrendingUp className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Avg Order Value
              </p>
              <h3 className="text-2xl font-bold">{formatPrice(avgOrderValue)}</h3>
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

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Sales Chart */}
        <div className="lg:col-span-2 rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h3 className="mb-6 font-display text-lg font-bold">Sales Overview (Last 30 Days)</h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="dateStr"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#6b7280" }}
                  tickFormatter={(val) => `₹${val / 1000}k`}
                />
                <Tooltip
                  formatter={(value: number) => [formatPrice(value), ""]}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "none",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  name="Total Sales"
                  dataKey="total"
                  stroke="#c64d7c"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 8 }}
                />
                <Line
                  type="monotone"
                  name="Online"
                  dataKey="online"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  name="Offline (POS)"
                  dataKey="offline"
                  stroke="#ec4899"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Products */}
        <div className="rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
          <h3 className="mb-6 font-display text-lg font-bold">Top Selling Products</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales data yet.</p>
          ) : (
            <ul className="space-y-4">
              {topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    #{i + 1}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="truncate text-sm font-bold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.qty} units sold</p>
                  </div>
                  <div className="text-right text-sm font-bold text-primary">
                    {formatPrice(p.revenue)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
