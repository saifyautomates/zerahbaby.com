/**
 * CustomerHistoryPanel — Customer lookup by phone/name, full purchase history,
 * and one-click invoice reprint.
 *
 * - Search by mobile or name
 * - Shows all past invoices with totals
 * - Expandable invoice details (items, payment method, discount)
 * - Reprint: renders ThermalReceipt from historical data (no new DB writes)
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import { ThermalReceipt } from "@/components/admin/ThermalReceipt";
import {
  Search,
  User,
  Phone,
  Receipt,
  ChevronDown,
  ChevronRight,
  Printer,
  ShoppingBag,
  Calendar,
} from "lucide-react";

type SaleItem = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  mrp_snapshot?: number;
  mrp?: number;
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

type Customer = {
  id: string;
  name: string;
  phone: string;
  total_purchases: number;
  total_spend: number;
};

export function CustomerHistoryPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);

  /* ── Customer search ── */
  const { data: customers = [], isLoading: searchLoading } = useQuery({
    queryKey: ["pos-customer-search", searchQuery],
    queryFn: async (): Promise<Customer[]> => {
      if (!searchQuery.trim() || searchQuery.trim().length < 2) return [];
      const { data } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: Customer[] | null; error: unknown }>
      )("search_pos_customers", { _query: searchQuery.trim() });
      return (data ?? []) as Customer[];
    },
    enabled: searchQuery.trim().length >= 2,
  });

  /* ── Customer sales history ── */
  const { data: sales = [], isLoading: salesLoading } = useQuery({
    queryKey: ["customer-sales", selectedCustomer?.id],
    queryFn: async (): Promise<Sale[]> => {
      if (!selectedCustomer) return [];
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (q: string) => {
              eq: (
                col: string,
                val: string,
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => Promise<{ data: Sale[] | null; error: unknown }>;
              };
            };
          };
        }
      )
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .eq("customer_phone", selectedCustomer.phone)
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as Sale[];
    },
    enabled: !!selectedCustomer,
  });

  const handleSelectCustomer = (c: Customer) => {
    setSelectedCustomer(c);
    setSearchQuery(c.name);
    setExpandedSale(null);
  };

  const handleReprint = (sale: Sale) => {
    setReprintSale(sale);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Reprint modal */}
      {reprintSale && (
        <ThermalReceipt
          sale={{
            sale_number: reprintSale.sale_number,
            customer_name: reprintSale.customer_name,
            customer_phone: reprintSale.customer_phone,
            subtotal: reprintSale.subtotal,
            discount: reprintSale.discount,
            discount_type: reprintSale.discount_type,
            discount_value: reprintSale.discount_value,
            total: reprintSale.total,
            payment_method: reprintSale.payment_method,
          }}
          items={(reprintSale.offline_sale_items ?? []).map((i) => ({
            name: i.name,
            sku: i.sku,
            price: i.price,
            mrp: i.mrp,
            qty: i.qty,
          }))}
          saleDate={new Date(reprintSale.created_at)}
          onClose={() => setReprintSale(null)}
        />
      )}

      {/* Search bar */}
      <div className="rounded-2xl border border-gray-100 bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <User className="h-4 w-4 text-[#8B2020]" />
          Customer Lookup
        </h3>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedCustomer(null);
            }}
            placeholder="Search by name or mobile number…"
            className="w-full rounded-xl border border-border bg-muted pl-9 pr-4 py-2 text-sm text-foreground outline-none focus:border-[#8B2020]/30 focus:bg-card focus:ring-2 focus:ring-[#8B2020]/10 transition-all"
          />
        </div>

        {/* Results dropdown */}
        {searchQuery.trim().length >= 2 && !selectedCustomer && (
          <div className="mt-2 rounded-xl border border-gray-100 overflow-hidden shadow-sm">
            {searchLoading && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
            {!searchLoading && customers.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-400">No customers found</div>
            )}
            {customers.map((c) => (
              <button
                key={c.id}
                onClick={() => handleSelectCustomer(c)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors border-b border-gray-50 last:border-0"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#8B2020]/10 text-[#8B2020] font-bold text-sm shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <p>{c.total_purchases} purchases</p>
                  <p className="font-semibold text-muted-foreground">
                    {formatPrice(c.total_spend)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected customer summary */}
      {selectedCustomer && (
        <div className="rounded-2xl border border-[#8B2020]/20 bg-[#8B2020]/5 p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#8B2020] text-white font-black text-lg">
                {selectedCustomer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-foreground">{selectedCustomer.name}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {selectedCustomer.phone}
                </div>
              </div>
            </div>
            <div className="flex gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Purchases</p>
                <p className="font-black text-lg text-foreground">
                  {selectedCustomer.total_purchases}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Spent</p>
                <p className="font-black text-lg text-[#8B2020]">
                  {formatPrice(selectedCustomer.total_spend)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purchase history */}
      {selectedCustomer && (
        <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#8B2020]" />
              Purchase History
            </h3>
            {salesLoading && <span className="text-xs text-gray-400">Loading…</span>}
          </div>

          {sales.length === 0 && !salesLoading && (
            <div className="px-5 py-10 text-center">
              <ShoppingBag className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No purchases found</p>
            </div>
          )}

          <div className="divide-y divide-gray-50">
            {sales.map((sale) => (
              <div key={sale.id}>
                {/* Sale row */}
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <button
                    onClick={() => setExpandedSale(expandedSale === sale.id ? null : sale.id)}
                    className="shrink-0 text-gray-400 hover:text-muted-foreground"
                  >
                    {expandedSale === sale.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{sale.sale_number}</span>
                      <span className="text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
                        {sale.payment_method}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(sale.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-black text-foreground">{formatPrice(sale.total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {(sale.offline_sale_items ?? []).length} item
                      {(sale.offline_sale_items ?? []).length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  <button
                    onClick={() => handleReprint(sale)}
                    className="shrink-0 flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Printer className="h-3 w-3" />
                    Reprint
                  </button>
                </div>

                {/* Expanded items */}
                {expandedSale === sale.id && (
                  <div className="bg-muted px-12 pb-4 pt-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 uppercase tracking-wider">
                          <th className="text-left py-1 font-semibold">Item</th>
                          <th className="text-right py-1 font-semibold">Qty</th>
                          <th className="text-right py-1 font-semibold">Price</th>
                          <th className="text-right py-1 font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(sale.offline_sale_items ?? []).map((item) => (
                          <tr key={item.id}>
                            <td className="py-1.5 text-foreground font-medium pr-2">{item.name}</td>
                            <td className="py-1.5 text-right text-muted-foreground">{item.qty}</td>
                            <td className="py-1.5 text-right text-muted-foreground">
                              {formatPrice(item.price)}
                            </td>
                            <td className="py-1.5 text-right font-semibold text-foreground">
                              {formatPrice(item.subtotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-border">
                        <tr>
                          <td colSpan={3} className="pt-2 text-muted-foreground">
                            Subtotal
                          </td>
                          <td className="pt-2 text-right text-foreground">
                            {formatPrice(sale.subtotal)}
                          </td>
                        </tr>
                        {sale.discount > 0 && (
                          <tr>
                            <td colSpan={3} className="text-green-700">
                              Discount
                            </td>
                            <td className="text-right text-green-700 font-semibold">
                              −{formatPrice(sale.discount)}
                            </td>
                          </tr>
                        )}
                        <tr className="font-bold">
                          <td colSpan={3} className="pt-1 text-foreground">
                            Total
                          </td>
                          <td className="pt-1 text-right text-foreground">
                            {formatPrice(sale.total)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
