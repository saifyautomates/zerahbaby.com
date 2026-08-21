import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import { BarChart3, Receipt } from "lucide-react";

export function OfflineAnalyticsTab() {
  const { data: sales, isLoading } = useQuery({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const totalRevenue = (sales ?? []).reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalSalesCount = (sales ?? []).length;
  const cashSales = (sales ?? []).filter((s) => s.payment_method === "cash").length;
  const upiSales = (sales ?? []).filter((s) => s.payment_method === "upi").length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
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
            <BarChart3 className="size-4" /> POS Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#8B2020]">
            {formatPrice(totalRevenue)}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:shadow-md hover:border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Receipt className="size-4" /> Payment Split
          </p>
          <p className="mt-2 text-lg font-extrabold tracking-tight text-gray-900 flex flex-col">
            <span>Cash: {cashSales}</span>
            <span className="text-gray-600">Online/UPI: {upiSales}</span>
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
            <tr>
              <th className="px-5 py-4">Receipt No</th>
              <th className="px-5 py-4">Date</th>
              <th className="px-5 py-4">Customer</th>
              <th className="px-5 py-4">Payment</th>
              <th className="px-5 py-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(sales ?? []).map((sale) => (
              <tr key={sale.id} className="group transition-colors hover:bg-gray-50/50">
                <td className="px-5 py-4 font-bold text-gray-900">{sale.sale_number}</td>
                <td className="px-5 py-4 text-gray-500 font-medium">
                  {new Date(sale.created_at).toLocaleString("en-IN")}
                </td>
                <td className="px-5 py-4">
                  <p className="font-semibold text-gray-900">{sale.customer_name || "Guest"}</p>
                  <p className="text-xs font-medium text-gray-500 mt-0.5">{sale.customer_phone}</p>
                </td>
                <td className="px-5 py-4">
                  <span className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 border border-gray-200">
                    {sale.payment_method}
                  </span>
                </td>
                <td className="px-5 py-4 text-right font-bold text-[#8B2020]">
                  {formatPrice(Number(sale.total))}
                </td>
              </tr>
            ))}
            {!isLoading && (sales ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center text-sm font-medium text-gray-500">
                  No POS sales yet.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center">
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
