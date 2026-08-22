/**
 * OfflineAnalyticsTab — Enhanced POS analytics with payment method breakdown,
 * per-sale receipt printing, sale details expansion, and top products view.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import {
  BarChart3,
  Receipt,
  Printer,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Banknote,
  Smartphone,
  TrendingUp,
  Package,
} from "lucide-react";

type SaleItem = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  mrp_snapshot?: number;
  barcode_snapshot?: string;
};

type Sale = {
  id: string;
  sale_number: string;
  customer_name: string;
  customer_phone: string;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  payment_method: string;
  created_at: string;
  offline_sale_items?: SaleItem[];
};

export function OfflineAnalyticsTab() {
  const [expandedSale, setExpandedSale] = useState<string | null>(null);

  const { data: sales, isLoading } = useQuery({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Sale[];
    },
  });

  // Stats
  const totalRevenue = (sales ?? []).reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalSalesCount = (sales ?? []).length;
  const cashSales = (sales ?? []).filter((s) => s.payment_method === "cash");
  const upiSales = (sales ?? []).filter((s) => s.payment_method === "upi");
  const cardSales = (sales ?? []).filter((s) => s.payment_method === "card");
  const otherSales = (sales ?? []).filter(
    (s) => !["cash", "upi", "card"].includes(s.payment_method),
  );

  const cashTotal = cashSales.reduce((s, o) => s + Number(o.total), 0);
  const upiTotal = upiSales.reduce((s, o) => s + Number(o.total), 0);
  const cardTotal = cardSales.reduce((s, o) => s + Number(o.total), 0);
  const otherTotal = otherSales.reduce((s, o) => s + Number(o.total), 0);
  const totalDiscount = (sales ?? []).reduce(
    (sum, sale) => sum + Number(sale.discount ?? 0),
    0,
  );

  // Top products
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of sales ?? []) {
      for (const item of sale.offline_sale_items ?? []) {
        const key = item.sku || item.name;
        const cur = map.get(key) ?? { name: item.name, qty: 0, revenue: 0 };
        map.set(key, {
          name: item.name,
          qty: cur.qty + item.qty,
          revenue: cur.revenue + Number(item.subtotal),
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [sales]);

  // Today's stats
  const today = new Date().toISOString().split("T")[0];
  const todaySales = (sales ?? []).filter(
    (s) => s.created_at.split("T")[0] === today,
  );
  const todayRevenue = todaySales.reduce((s, o) => s + Number(o.total), 0);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <TrendingUp className="size-4" /> Today's Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">
            {todaySales.length}
          </p>
          <p className="mt-1 text-sm font-semibold text-[#8B2020]">
            {formatPrice(todayRevenue)}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Receipt className="size-4" /> Total POS Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-gray-900">
            {totalSalesCount}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <BarChart3 className="size-4" /> Total Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#8B2020]">
            {formatPrice(totalRevenue)}
          </p>
          {totalDiscount > 0 && (
            <p className="mt-1 text-xs text-green-700">
              Discounts given: {formatPrice(totalDiscount)}
            </p>
          )}
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <CreditCard className="size-4" /> Payment Breakdown
          </p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-700">
                <Banknote className="size-3.5" /> Cash
              </span>
              <span className="font-bold">
                {cashSales.length}{" "}
                <span className="text-gray-400 font-normal text-xs">
                  ({formatPrice(cashTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-700">
                <Smartphone className="size-3.5" /> UPI
              </span>
              <span className="font-bold">
                {upiSales.length}{" "}
                <span className="text-gray-400 font-normal text-xs">
                  ({formatPrice(upiTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-gray-700">
                <CreditCard className="size-3.5" /> Card
              </span>
              <span className="font-bold">
                {cardSales.length}{" "}
                <span className="text-gray-400 font-normal text-xs">
                  ({formatPrice(cardTotal)})
                </span>
              </span>
            </div>
            {otherSales.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-gray-700">Other</span>
                <span className="font-bold">
                  {otherSales.length}{" "}
                  <span className="text-gray-400 font-normal text-xs">
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
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2 mb-4">
            <Package className="size-4" /> Top Products (POS)
          </h3>
          <div className="space-y-2">
            {topProducts.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8B2020] text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {p.name}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500">
                    {p.qty} sold
                  </span>
                  <span className="font-bold text-[#8B2020]">
                    {formatPrice(p.revenue)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sales Table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-5 py-4 w-8"></th>
              <th className="px-5 py-4">Receipt No</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Customer</th>
              <th className="px-5 py-4">Payment</th>
              <th className="px-5 py-4">Discount</th>
              <th className="px-5 py-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(sales ?? []).map((sale) => {
              const isExpanded = expandedSale === sale.id;
              return (
                <tr key={sale.id} className="group">
                  <td colSpan={7} className="p-0">
                    <div
                      className="flex items-center cursor-pointer transition-colors hover:bg-gray-50/50 px-5 py-4"
                      onClick={() =>
                        setExpandedSale(isExpanded ? null : sale.id)
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-gray-400 mr-3 shrink-0" />
                      ) : (
                        <ChevronRight className="size-4 text-gray-400 mr-3 shrink-0" />
                      )}
                      <span className="font-bold text-gray-900 w-36 shrink-0">
                        {sale.sale_number}
                      </span>
                      <span className="text-gray-500 font-medium w-44 shrink-0">
                        {new Date(sale.created_at).toLocaleString("en-IN")}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold text-gray-900">
                          {sale.customer_name || "Guest"}
                        </span>
                        {sale.customer_phone && (
                          <span className="text-xs text-gray-500 ml-2">
                            {sale.customer_phone}
                          </span>
                        )}
                      </span>
                      <span className="w-20 shrink-0">
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 border border-gray-200">
                          {sale.payment_method}
                        </span>
                      </span>
                      <span className="w-28 shrink-0 text-sm">
                        {Number(sale.discount) > 0 ? (
                          <span className="text-green-700 font-medium">
                            −{formatPrice(Number(sale.discount))}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </span>
                      <span className="w-28 text-right font-bold text-[#8B2020] shrink-0">
                        {formatPrice(Number(sale.total))}
                      </span>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 bg-gray-50/50 px-8 py-4">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 font-bold uppercase tracking-wider">
                              <th className="py-1 text-left">Item</th>
                              <th className="py-1 text-left">SKU</th>
                              <th className="py-1 text-right">Price</th>
                              <th className="py-1 text-right">Qty</th>
                              <th className="py-1 text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(sale.offline_sale_items ?? []).map(
                              (item: SaleItem) => (
                                <tr
                                  key={item.id}
                                  className="border-t border-gray-200"
                                >
                                  <td className="py-1.5 font-semibold text-gray-900">
                                    {item.name}
                                  </td>
                                  <td className="py-1.5 font-mono text-gray-600">
                                    {item.sku}
                                  </td>
                                  <td className="py-1.5 text-right text-gray-700">
                                    {formatPrice(Number(item.price))}
                                  </td>
                                  <td className="py-1.5 text-right font-semibold">
                                    {item.qty}
                                  </td>
                                  <td className="py-1.5 text-right font-bold text-gray-900">
                                    {formatPrice(Number(item.subtotal))}
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-xs text-gray-500 space-y-0.5">
                            <p>
                              Subtotal: {formatPrice(Number(sale.subtotal))}
                            </p>
                            {Number(sale.discount) > 0 && (
                              <p className="text-green-700">
                                Discount ({sale.discount_type === "percentage" ? `${sale.discount_value}%` : sale.discount_type === "fixed" ? `₹${sale.discount_value}` : ""}): −{formatPrice(Number(sale.discount))}
                              </p>
                            )}
                            <p className="font-bold text-gray-900">
                              Total: {formatPrice(Number(sale.total))}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && (sales ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-16 text-center text-sm font-medium text-gray-500"
                >
                  No POS sales yet.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center">
                  <div className="flex justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
