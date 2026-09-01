/**
 * CustomerHistoryPanel — Offline Billing Customer Hub
 * Lists all walk-in and registered customers from offline sales,
 * with real-time search, stats, purchase histories, and one-click receipt/invoice reprinting.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor } from "@/lib/store";
import { ThermalReceipt } from "@/components/admin/ThermalReceipt";
import { A4Invoice } from "@/components/admin/A4Invoice";
import clothing from "@/assets/cat-clothing.jpg";
import {
  Search,
  User,
  Users,
  Phone,
  Receipt,
  ChevronDown,
  ChevronRight,
  Printer,
  ShoppingBag,
  Calendar,
  ArrowLeft,
  DollarSign,
  TrendingUp,
  FileText,
  Clock,
  Sparkles,
} from "lucide-react";

type SaleItem = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  product_id?: string | null;
  product_slug?: string;
  variant_info?: string;
  mrp_snapshot?: number;
  barcode_snapshot?: string;
};

type OfflineSaleRecord = {
  id: string;
  sale_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_id: string | null;
  payment_method: string;
  notes: string | null;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  pos_token_number: number | null;
  pos_token_date: string | null;
  status: string;
  created_at: string;
  offline_sale_items?: SaleItem[];
};

export interface AggregatedCustomer {
  key: string;
  id?: string;
  name: string;
  phone: string;
  email: string;
  total_purchases: number;
  total_spend: number;
  last_visit: string;
  last_sale_number: string;
  sales: OfflineSaleRecord[];
}

export function CustomerHistoryPanel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"all" | "phone" | "walk_in" | "vip">("all");
  const [selectedCustomer, setSelectedCustomer] = useState<AggregatedCustomer | null>(null);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [thermalReceiptSale, setThermalReceiptSale] = useState<OfflineSaleRecord | null>(null);
  const [a4InvoiceSale, setA4InvoiceSale] = useState<OfflineSaleRecord | null>(null);

  /* ── 1. Fetch All Offline Sales ── */
  const { data: rawSales = [], isLoading: salesLoading } = useQuery({
    queryKey: ["offline-sales-customers-hub"],
    queryFn: async (): Promise<OfflineSaleRecord[]> => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OfflineSaleRecord[];
    },
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  /* ── 2. Fetch Products for Image Thumbnails ── */
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products-lookup-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, slug, name, sku, category, product_images(public_url, is_primary)");
      if (error) return [];
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const productMap = useMemo(() => {
    const map = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.id) map.set(p.id, p);
      if (p.sku) map.set(p.sku.toLowerCase().trim(), p);
      if (p.name) map.set(p.name.toLowerCase().trim(), p);
    }
    return map;
  }, [products]);

  const resolveItemImage = (item: SaleItem) => {
    const p =
      (item.product_id ? productMap.get(item.product_id) : undefined) ||
      (item.sku ? productMap.get(item.sku.toLowerCase().trim()) : undefined) ||
      (item.name ? productMap.get(item.name.toLowerCase().trim()) : undefined);
    return imageFor(
      (p && typeof p === "object" && "category" in p ? p.category : "") || "clothing",
      p && typeof p === "object" && "product_images" in p
        ? p.product_images?.[0]?.public_url
        : undefined,
    );
  };

  /* ── 3. Aggregate Sales into Customer Profiles ── */
  const allCustomers = useMemo<AggregatedCustomer[]>(() => {
    const map = new Map<string, AggregatedCustomer>();

    for (const sale of rawSales) {
      if (sale.status === "cancelled") continue;

      const phone = (sale.customer_phone || "").trim();
      const rawName = (sale.customer_name || "").trim();
      const name = rawName || (phone ? `Customer (${phone})` : "Walk-in Customer");
      const email = (sale.customer_email || "").trim();

      // Key by phone if present, otherwise group walk-ins by name
      const key = phone ? `phone:${phone}` : `name:${name}`;

      const existing = map.get(key);
      if (existing) {
        existing.total_purchases += 1;
        existing.total_spend += Number(sale.total || 0);
        existing.sales.push(sale);
        if (!existing.email && email) existing.email = email;
        if (existing.name === "Walk-in Customer" && name !== "Walk-in Customer") {
          existing.name = name;
        }
        if (new Date(sale.created_at) > new Date(existing.last_visit)) {
          existing.last_visit = sale.created_at;
          existing.last_sale_number = sale.sale_number;
        }
      } else {
        map.set(key, {
          key,
          id: sale.customer_id || undefined,
          name,
          phone,
          email,
          total_purchases: 1,
          total_spend: Number(sale.total || 0),
          last_visit: sale.created_at,
          last_sale_number: sale.sale_number,
          sales: [sale],
        });
      }
    }

    // Sort by latest visit descending
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.last_visit).getTime() - new Date(a.last_visit).getTime(),
    );
  }, [rawSales]);

  /* ── 4. Filter Customers ── */
  const filteredCustomers = useMemo(() => {
    return allCustomers.filter((c) => {
      // Category filter
      if (selectedFilter === "phone" && !c.phone) return false;
      if (selectedFilter === "walk_in" && (c.phone || c.name !== "Walk-in Customer")) return false;
      if (selectedFilter === "vip" && c.total_spend < 1000) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesPhone = c.phone.toLowerCase().includes(q);
        const matchesEmail = c.email.toLowerCase().includes(q);
        const matchesReceipt = c.sales.some((s) => s.sale_number.toLowerCase().includes(q));
        return matchesName || matchesPhone || matchesEmail || matchesReceipt;
      }
      return true;
    });
  }, [allCustomers, selectedFilter, searchQuery]);

  /* ── 5. Overall Summary Stats ── */
  const stats = useMemo(() => {
    const totalCustomersCount = allCustomers.length;
    const totalRevenue = allCustomers.reduce((sum, c) => sum + c.total_spend, 0);
    const withPhoneCount = allCustomers.filter((c) => !!c.phone).length;
    const avgSpend = totalCustomersCount > 0 ? totalRevenue / totalCustomersCount : 0;
    return { totalCustomersCount, totalRevenue, withPhoneCount, avgSpend };
  }, [allCustomers]);

  return (
    <div className="flex flex-col gap-6 p-1">
      {/* Thermal Receipt Modal */}
      {thermalReceiptSale && (
        <ThermalReceipt
          sale={{
            sale_number: thermalReceiptSale.sale_number,
            customer_name: thermalReceiptSale.customer_name || "Walk-in Customer",
            customer_phone: thermalReceiptSale.customer_phone || "",
            subtotal: thermalReceiptSale.subtotal,
            discount: thermalReceiptSale.discount,
            discount_type: thermalReceiptSale.discount_type,
            discount_value: thermalReceiptSale.discount_value,
            total: thermalReceiptSale.total,
            payment_method: thermalReceiptSale.payment_method,
            pos_token_number: thermalReceiptSale.pos_token_number,
          }}
          items={(thermalReceiptSale.offline_sale_items ?? []).map((i) => ({
            name: i.name,
            sku: i.sku,
            price: i.price,
            qty: i.qty,
          }))}
          saleDate={new Date(thermalReceiptSale.created_at)}
          onClose={() => setThermalReceiptSale(null)}
        />
      )}

      {/* A4 Invoice Modal */}
      {a4InvoiceSale && (
        <A4Invoice
          sale={{
            sale_number: a4InvoiceSale.sale_number,
            sale_date: new Date(a4InvoiceSale.created_at),
            customer_name: a4InvoiceSale.customer_name || "Walk-in Customer",
            customer_phone: a4InvoiceSale.customer_phone || "",
            customer_email: a4InvoiceSale.customer_email || "",
            payment_method: a4InvoiceSale.payment_method || "cash",
            subtotal: a4InvoiceSale.subtotal,
            discount: a4InvoiceSale.discount,
            discount_type: a4InvoiceSale.discount_type,
            discount_value: a4InvoiceSale.discount_value,
            total: a4InvoiceSale.total,
            notes: a4InvoiceSale.notes || "",
          }}
          items={(a4InvoiceSale.offline_sale_items ?? []).map((i) => ({
            name: i.name,
            sku: i.sku || "",
            price: i.price,
            qty: i.qty,
            subtotal: i.subtotal || i.price * i.qty,
            mrp: i.mrp_snapshot || i.price,
            variant_info: i.variant_info,
          }))}
          onClose={() => setA4InvoiceSale(null)}
        />
      )}

      {/* Top Stat Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Total Offline Customers</span>
            <Users className="size-4 text-primary" />
          </div>
          <p className="text-2xl font-black text-foreground mt-2">{stats.totalCustomersCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Across all offline POS sales</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">With Mobile / Profile</span>
            <Phone className="size-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-2">{stats.withPhoneCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">SMS & marketing eligible</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Total Offline Spend</span>
            <DollarSign className="size-4 text-primary" />
          </div>
          <p className="text-2xl font-black text-foreground mt-2">
            {formatPrice(stats.totalRevenue)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Cumulative walk-in revenue</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold">Avg. Spend / Customer</span>
            <TrendingUp className="size-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-black text-indigo-600 mt-2">
            {formatPrice(Math.round(stats.avgSpend))}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Offline basket value</p>
        </div>
      </div>

      {/* Main Content Area: Customer List vs Selected Detail */}
      {!selectedCustomer ? (
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          {/* Header Bar with Search & Filters */}
          <div className="p-4 sm:p-5 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by customer name, phone, or receipt #..."
                className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: "all", label: `All (${allCustomers.length})` },
                { id: "phone", label: `📱 With Phone (${stats.withPhoneCount})` },
                {
                  id: "walk_in",
                  label: `🚶 Walk-in (${allCustomers.length - stats.withPhoneCount})`,
                },
                { id: "vip", label: `⭐ High Spend (> ₹1k)` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedFilter(tab.id as "all" | "phone" | "walk_in" | "vip")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
                    selectedFilter === tab.id
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Customers Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Phone Number</th>
                  <th className="px-5 py-3.5 text-center">Visits / Orders</th>
                  <th className="px-5 py-3.5 text-right">Total Spent</th>
                  <th className="px-5 py-3.5">Last Visit</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {salesLoading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                      Loading offline billing customers…
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <Users className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                      <p className="text-sm font-bold text-foreground">No customers found</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {searchQuery
                          ? "Try searching for a different name or phone number."
                          : "Complete an offline sale in the POS terminal to see customers here."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust) => {
                    const isNamed = cust.name !== "Walk-in Customer";
                    return (
                      <tr
                        key={cust.key}
                        className="group hover:bg-muted/40 transition-colors cursor-pointer"
                        onClick={() => setSelectedCustomer(cust)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex size-9 shrink-0 items-center justify-center rounded-full font-bold text-xs ${
                                isNamed
                                  ? "bg-primary/10 text-primary border border-primary/20"
                                  : "bg-muted text-muted-foreground border border-border"
                              }`}
                            >
                              {isNamed ? (
                                cust.name.charAt(0).toUpperCase()
                              ) : (
                                <User className="size-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-foreground text-xs sm:text-sm truncate">
                                {cust.name}
                              </p>
                              {cust.email && (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {cust.email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5">
                          {cust.phone ? (
                            <span className="font-mono text-xs font-semibold text-foreground flex items-center gap-1">
                              <Phone className="size-3 text-muted-foreground" />
                              {cust.phone}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">
                              No mobile recorded
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                            <ShoppingBag className="size-3" />
                            {cust.total_purchases} {cust.total_purchases === 1 ? "order" : "orders"}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 text-right font-bold text-primary text-sm">
                          {formatPrice(cust.total_spend)}
                        </td>

                        <td className="px-5 py-3.5 text-xs text-muted-foreground">
                          <div className="flex flex-col gap-0.5">
                            <span>{new Date(cust.last_visit).toLocaleString("en-IN")}</span>
                            <span className="font-mono text-[10px] text-foreground font-semibold">
                              #{cust.last_sale_number}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomer(cust);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition cursor-pointer"
                          >
                            View History →
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Detailed Customer History View */
        <div className="flex flex-col gap-4">
          {/* Back Button & Customer Header Card */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <ArrowLeft className="size-4" /> Back to Customers List
              </button>
              <span className="text-xs text-muted-foreground">
                Customer Record: <strong className="text-foreground">{selectedCustomer.key}</strong>
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 flex-wrap pt-2 border-t border-border">
              <div className="flex items-center gap-3.5">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-black text-xl shadow-xs">
                  {selectedCustomer.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    {selectedCustomer.name}
                    {selectedCustomer.phone && (
                      <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Phone className="size-3" />
                        {selectedCustomer.phone}
                      </span>
                    )}
                  </h3>
                  {selectedCustomer.email && (
                    <p className="text-xs text-muted-foreground">{selectedCustomer.email}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-center sm:text-right">
                  <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
                    Total Purchases
                  </p>
                  <p className="text-lg font-black text-foreground">
                    {selectedCustomer.total_purchases}
                  </p>
                </div>
                <div className="text-center sm:text-right">
                  <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
                    Total Spend
                  </p>
                  <p className="text-lg font-black text-primary">
                    {formatPrice(selectedCustomer.total_spend)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Sales History List for Selected Customer */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="size-4 text-primary" />
                <h4 className="text-sm font-bold text-foreground">
                  Purchases & Invoices ({selectedCustomer.sales.length})
                </h4>
              </div>
              <span className="text-xs text-muted-foreground">
                Showing all historical POS walk-in receipts
              </span>
            </div>

            <div className="divide-y divide-border/60">
              {selectedCustomer.sales.map((sale) => {
                const isExpanded = expandedSale === sale.id;
                return (
                  <div key={sale.id} className="transition-colors hover:bg-muted/20">
                    <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                        className="size-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>

                      {/* Token badge if present */}
                      {sale.pos_token_number != null && (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-800 font-black text-xs border border-indigo-200">
                          {sale.pos_token_number}
                        </span>
                      )}

                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground">
                            {sale.sale_number}
                          </span>
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
                            {sale.payment_method}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Calendar className="size-3" />
                          {new Date(sale.created_at).toLocaleString("en-IN")}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="font-black text-primary text-base">
                          {formatPrice(sale.total)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {(sale.offline_sale_items ?? []).length} item
                          {(sale.offline_sale_items ?? []).length !== 1 ? "s" : ""}
                        </p>
                      </div>

                      {/* Action buttons: Thermal Receipt & A4 Invoice */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setThermalReceiptSale(sale)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
                        >
                          <Printer className="size-3.5 text-primary" /> Thermal
                        </button>
                        <button
                          type="button"
                          onClick={() => setA4InvoiceSale(sale)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-bold text-foreground hover:bg-muted transition cursor-pointer"
                        >
                          <FileText className="size-3.5 text-indigo-600" /> A4 Bill
                        </button>
                      </div>
                    </div>

                    {/* Expandable item details */}
                    {isExpanded && (
                      <div className="bg-muted/30 px-6 sm:px-12 py-3 border-t border-border/60">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground font-bold uppercase tracking-wider border-b border-border/40 pb-2">
                              <th className="text-left py-2">Item / Product</th>
                              <th className="text-left py-2">SKU</th>
                              <th className="text-right py-2">Unit Price</th>
                              <th className="text-right py-2">Qty</th>
                              <th className="text-right py-2">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {(sale.offline_sale_items ?? []).map((item) => {
                              const itemImg = resolveItemImage(item);
                              return (
                                <tr key={item.id} className="hover:bg-muted/50">
                                  <td className="py-2.5 pr-3">
                                    <div className="flex items-center gap-2.5">
                                      <img
                                        src={itemImg}
                                        alt={item.name}
                                        className="size-8 rounded-md object-cover border border-border bg-muted shrink-0"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).src = clothing;
                                        }}
                                      />
                                      <div>
                                        <p className="font-bold text-foreground">{item.name}</p>
                                        {item.variant_info && (
                                          <p className="text-[10px] text-muted-foreground">
                                            {item.variant_info}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-2.5 font-mono text-[11px] text-muted-foreground">
                                    {item.sku || "—"}
                                  </td>
                                  <td className="py-2.5 text-right font-medium text-muted-foreground">
                                    {formatPrice(item.price)}
                                  </td>
                                  <td className="py-2.5 text-right font-bold text-foreground">
                                    x{item.qty}
                                  </td>
                                  <td className="py-2.5 text-right font-bold text-primary">
                                    {formatPrice(item.subtotal || item.price * item.qty)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="border-t border-border text-xs">
                            <tr>
                              <td colSpan={4} className="pt-2 text-muted-foreground font-semibold">
                                Subtotal
                              </td>
                              <td className="pt-2 text-right text-foreground font-semibold">
                                {formatPrice(sale.subtotal)}
                              </td>
                            </tr>
                            {Number(sale.discount) > 0 && (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="py-0.5 text-emerald-600 dark:text-emerald-400 font-semibold"
                                >
                                  Discount Applied
                                </td>
                                <td className="py-0.5 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                                  −{formatPrice(Number(sale.discount))}
                                </td>
                              </tr>
                            )}
                            <tr className="font-bold text-sm">
                              <td colSpan={4} className="pt-1.5 text-foreground">
                                Grand Total Paid
                              </td>
                              <td className="pt-1.5 text-right text-primary">
                                {formatPrice(sale.total)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
