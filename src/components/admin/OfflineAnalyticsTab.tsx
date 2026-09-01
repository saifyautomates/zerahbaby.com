/**
 * OfflineAnalyticsTab — Enhanced POS analytics with payment method breakdown,
 * per-sale receipt printing, sale details expansion, and top products view.
 * Includes Customer Footfall analytics powered by the POS token system.
 */
import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor, getProductUrl } from "@/lib/store";
import { toast } from "sonner";
import clothing from "@/assets/cat-clothing.jpg";
import {
  BarChart3,
  Receipt,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Banknote,
  Smartphone,
  TrendingUp,
  Package,
  ExternalLink,
  Users,
  Clock,
  Ban,
  Trash2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

type SaleItem = {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  product_id?: string | null;
  product_slug?: string;
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
  /** Void/cancelled status for POS sales */
  status?: string | null;
  /** Daily sequential walk-in token (1, 2, 3...). Resets each IST calendar day. */
  pos_token_number: number | null;
  /** IST calendar date string (YYYY-MM-DD) for this token. */
  pos_token_date: string | null;
  offline_sale_items?: SaleItem[];
};

/** Convert a UTC ISO timestamp to IST (UTC+5:30) and return hour 0-23 */
function utcToISTHour(utcISOString: string): number {
  const d = new Date(utcISOString);
  // IST = UTC + 5h30m = UTC + 330 minutes
  const istMs = d.getTime() + 330 * 60 * 1000;
  return new Date(istMs).getUTCHours();
}

/** Get the IST date string (YYYY-MM-DD) for a UTC ISO timestamp */
function utcToISTDate(utcISOString: string): string {
  const d = new Date(utcISOString);
  const istMs = d.getTime() + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Current IST date string (YYYY-MM-DD) */
function todayIST(): string {
  return utcToISTDate(new Date().toISOString());
}

export function OfflineAnalyticsTab() {
  const qc = useQueryClient();
  const [expandedSale, setExpandedSale] = useState<string | null>(null);

  const deleteSaleMutation = useMutation({
    mutationFn: async (saleId: string) => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      )("admin_void_offline_sale", {
        _sale_id: saleId,
      });
      if (error) throw error;

      const { error: delError } = await supabase.from("offline_sales").delete().eq("id", saleId);
      if (delError) throw delError;

      return data;
    },
    onSuccess: () => {
      toast.success("Sale deleted and stock restored successfully!");
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["admin-dashboard-stats"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete sale");
    },
  });

  // Fetch all products for dynamic image & slug resolution
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id, slug, name, sku, barcode, brand, category, price, stock, product_images(public_url, is_primary, sort_order)",
        );
      if (error) return [];
      return data ?? [];
    },
  });

  // Fast product lookup map
  const productLookup = useMemo(() => {
    const byId = new Map<string, (typeof products)[0]>();
    const bySku = new Map<string, (typeof products)[0]>();
    const byName = new Map<string, (typeof products)[0]>();
    for (const p of products) {
      if (p.id) byId.set(p.id, p);
      if (p.sku) bySku.set(p.sku.toLowerCase().trim(), p);
      if (p.name) byName.set(p.name.toLowerCase().trim(), p);
    }
    return { byId, bySku, byName };
  }, [products]);

  const resolveProduct = (item: {
    product_id?: string | null;
    product_slug?: string;
    sku?: string;
    name?: string;
  }) => {
    if (item.product_id && productLookup.byId.has(item.product_id)) {
      return productLookup.byId.get(item.product_id);
    }
    if (item.sku && productLookup.bySku.has(item.sku.toLowerCase().trim())) {
      return productLookup.bySku.get(item.sku.toLowerCase().trim());
    }
    if (item.name && productLookup.byName.has(item.name.toLowerCase().trim())) {
      return productLookup.byName.get(item.name.toLowerCase().trim());
    }
    return null;
  };

  const { data: sales, isLoading } = useQuery({
    queryKey: ["offline-sales"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (q: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: Sale[] | null; error: unknown }>;
            };
          };
        }
      )
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Sale[];
    },
  });

  const activeSales = useMemo(
    () => (sales ?? []).filter((s) => (s as { status?: string }).status !== "cancelled"),
    [sales],
  );

  // ──────────── Customer Footfall Analytics ────────────
  const today = todayIST();

  /** Sales for today (IST) */
  const todaySales = useMemo(
    () => activeSales.filter((s) => utcToISTDate(s.created_at) === today),
    [activeSales, today],
  );

  /** Average customers per active-sales-day */
  const avgCustomersPerDay = useMemo(() => {
    if (activeSales.length === 0) return 0;
    const uniqueDays = new Set(activeSales.map((s) => utcToISTDate(s.created_at)));
    return Math.round((activeSales.length / uniqueDays.size) * 10) / 10;
  }, [activeSales]);

  /** Hourly footfall for today (IST) — 24 buckets */
  const hourlyFootfall = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
      customers: 0,
    }));
    for (const s of todaySales) {
      const h = utcToISTHour(s.created_at);
      buckets[h].customers += 1;
    }
    return buckets;
  }, [todaySales]);

  const peakHour = useMemo(
    () =>
      hourlyFootfall.reduce(
        (best, b) => (b.customers > best.customers ? b : best),
        hourlyFootfall[0],
      ),
    [hourlyFootfall],
  );

  // Stats
  const totalRevenue = activeSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const totalSalesCount = activeSales.length;
  const cashSales = activeSales.filter((s) => s.payment_method === "cash");
  const upiSales = activeSales.filter((s) => s.payment_method === "upi");
  const cardSales = activeSales.filter((s) => s.payment_method === "card");
  const otherSales = activeSales.filter((s) => !["cash", "upi", "card"].includes(s.payment_method));

  const cashTotal = cashSales.reduce((s, o) => s + Number(o.total), 0);
  const upiTotal = upiSales.reduce((s, o) => s + Number(o.total), 0);
  const cardTotal = cardSales.reduce((s, o) => s + Number(o.total), 0);
  const otherTotal = otherSales.reduce((s, o) => s + Number(o.total), 0);
  const totalDiscount = activeSales.reduce((sum, sale) => sum + Number(sale.discount ?? 0), 0);

  // Today's revenue
  const todayRevenue = todaySales.reduce((s, o) => s + Number(o.total), 0);

  // Top products with rich metadata
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        sku: string;
        product_id?: string | null;
        product_slug?: string;
        qty: number;
        revenue: number;
      }
    >();
    for (const sale of sales ?? []) {
      for (const item of sale.offline_sale_items ?? []) {
        const key = item.sku || item.name;
        const cur = map.get(key) ?? {
          name: item.name,
          sku: item.sku || "",
          product_id: item.product_id,
          product_slug: item.product_slug,
          qty: 0,
          revenue: 0,
        };
        map.set(key, {
          name: item.name,
          sku: item.sku || cur.sku,
          product_id: item.product_id || cur.product_id,
          product_slug: item.product_slug || cur.product_slug,
          qty: cur.qty + item.qty,
          revenue: cur.revenue + Number(item.subtotal),
        });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [sales]);

  const handleClearDummyData = async () => {
    if (!window.confirm("Are you sure you want to completely WIPE all offline sales history?"))
      return;
    try {
      // 1. Delete all offline sales (automatically cascades to offline_sale_items)
      await supabase
        .from("offline_sales")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      // Clean up orphaned products (archived)
      await supabase.from("products").delete().eq("is_active", false);
      alert("Successfully wiped dummy sales.");
      window.location.reload();
    } catch (e) {
      alert("Error: " + (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={handleClearDummyData}
          className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md text-sm font-semibold transition-colors"
        >
          Nuke Dummy Sales History
        </button>
      </div>

      {/* ══════════════════════════════════════════════════
          CUSTOMER FOOTFALL ANALYTICS
          Powered by the POS Token System (IST timezone)
          ══════════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-border/60">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Customer Footfall — Today (IST)
          </h3>
        </div>

        {/* Footfall Summary Cards */}
        <div className="grid grid-cols-3 divide-x divide-border/60">
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Customers Today
            </p>
            <p className="text-4xl font-black text-primary leading-none">{todaySales.length}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              {todaySales.length === 1 ? "walk-in today" : "walk-ins today"}
            </p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Avg Customers / Day
            </p>
            <p className="text-4xl font-black text-foreground leading-none">{avgCustomersPerDay}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              across active sales days
            </p>
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Peak Hour Today
            </p>
            {peakHour.customers > 0 ? (
              <>
                <p className="text-4xl font-black text-amber-600 leading-none">
                  {peakHour.label.toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">
                  {peakHour.customers} {peakHour.customers === 1 ? "customer" : "customers"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">No sales yet</p>
            )}
          </div>
        </div>

        {/* Hourly Footfall Chart */}
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 mb-3 mt-2">
            <Clock className="size-3.5 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Hourly Footfall (IST)
            </p>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={hourlyFootfall} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                tickLine={false}
                axisLine={false}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { label: string; customers: number };
                  return (
                    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-xs">
                      <p className="font-bold text-foreground">{d.label.toUpperCase()}</p>
                      <p className="text-muted-foreground">
                        {d.customers} {d.customers === 1 ? "customer" : "customers"}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="customers" radius={[3, 3, 0, 0]} maxBarSize={20}>
                {hourlyFootfall.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={
                      entry.customers === peakHour.customers && entry.customers > 0
                        ? "hsl(239, 84%, 67%)"
                        : "hsl(239, 84%, 80%)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-600" /> Today's Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {todaySales.length}
          </p>
          <p className="mt-1 text-sm font-semibold text-primary">{formatPrice(todayRevenue)}</p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Receipt className="size-4 text-blue-600" /> Total POS Sales
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
            {totalSalesCount}
          </p>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BarChart3 className="size-4 text-emerald-600" /> Total Revenue
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-primary">
            {formatPrice(totalRevenue)}
          </p>
          {totalDiscount > 0 && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              Discounts given: {formatPrice(totalDiscount)}
            </p>
          )}
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-md">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CreditCard className="size-4 text-amber-600" /> Payment Breakdown
          </p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <Banknote className="size-3.5 text-emerald-600" /> Cash
              </span>
              <span className="font-bold text-foreground">
                {cashSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(cashTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <Smartphone className="size-3.5 text-indigo-600" /> UPI
              </span>
              <span className="font-bold text-foreground">
                {upiSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(upiTotal)})
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground/80">
                <CreditCard className="size-3.5 text-blue-600" /> Card
              </span>
              <span className="font-bold text-foreground">
                {cardSales.length}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  ({formatPrice(cardTotal)})
                </span>
              </span>
            </div>
            {otherSales.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-foreground/80">Other</span>
                <span className="font-bold text-foreground">
                  {otherSales.length}{" "}
                  <span className="text-muted-foreground font-normal text-xs">
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
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Package className="size-4 text-primary" /> Top Products (POS)
            </h3>
            <span className="text-[11px] text-muted-foreground font-medium">
              Click any product to open in store
            </span>
          </div>
          <div className="space-y-2.5">
            {topProducts.map((p, i) => {
              const matchedProduct = resolveProduct(p);
              const imgUrl = imageFor(
                matchedProduct?.category || "clothing",
                (matchedProduct as { product_images?: { public_url: string }[] })
                  ?.product_images?.[0]?.public_url,
              );
              const slug = matchedProduct?.slug || p.product_slug || p.sku;

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => slug && (window.location.href = getProductUrl(slug))}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && slug) {
                      e.preventDefault();
                      window.location.href = getProductUrl(slug);
                    }
                  }}
                  title={`Open "${p.name}" in store`}
                  className="group flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 hover:bg-muted/60 p-3 transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-black text-[11px] border border-primary/20">
                      {i + 1}
                    </span>
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xs group-hover:border-primary/40 transition">
                      <img
                        src={imgUrl}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = clothing;
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        <ExternalLink className="size-3 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {p.sku
                          ? `SKU: ${p.sku}`
                          : matchedProduct?.category
                            ? `Category: ${matchedProduct.category}`
                            : "In-store product"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0 pl-3">
                    <span className="text-xs font-semibold text-muted-foreground bg-background px-2.5 py-1 rounded-lg border border-border/80">
                      {p.qty} sold
                    </span>
                    <span className="font-extrabold text-foreground text-sm">
                      {formatPrice(p.revenue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sales Table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-5 py-4 w-8"></th>
              <th className="px-5 py-4">Token</th>
              <th className="px-5 py-4">Receipt No</th>
              <th className="px-5 py-4">Date (IST)</th>
              <th className="px-5 py-4 min-w-[220px]">Items / Products</th>
              <th className="px-5 py-4">Customer</th>
              <th className="px-5 py-4">Payment</th>
              <th className="px-5 py-4">Discount</th>
              <th className="px-5 py-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {(sales ?? []).map((sale) => {
              const isExpanded = expandedSale === sale.id;
              return (
                <React.Fragment key={sale.id}>
                  <tr
                    className={`group cursor-pointer transition-colors hover:bg-muted/40 ${sale.status === "cancelled" ? "opacity-50 grayscale bg-muted/20" : ""}`}
                    onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                  >
                    <td className="px-5 py-4 w-8">
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                    </td>
                    {/* Token badge */}
                    <td className="px-5 py-4">
                      {sale.pos_token_number != null ? (
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-800 font-black text-sm border border-indigo-200">
                          {sale.pos_token_number}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-bold text-foreground font-mono">
                      {sale.sale_number}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground font-medium text-xs">
                      {new Date(sale.created_at).toLocaleString("en-IN")}
                    </td>
                    {/* Product thumbnails & names */}
                    <td className="px-5 py-4 whitespace-normal">
                      <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[280px]">
                        {(sale.offline_sale_items ?? []).map((item: SaleItem, i: number) => {
                          const prod = resolveProduct(item);
                          const itemImg = imageFor(
                            prod?.category || "clothing",
                            (prod as { product_images?: { public_url: string }[] })
                              ?.product_images?.[0]?.public_url,
                          );
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <img
                                src={itemImg}
                                alt={item.name}
                                loading="lazy"
                                decoding="async"
                                className="size-8 rounded-md object-cover border border-border shrink-0 bg-muted"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = clothing;
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <p
                                  className="font-bold text-foreground truncate text-xs leading-tight"
                                  title={item.name}
                                >
                                  {item.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  <span className="font-semibold text-primary">x{item.qty}</span> •{" "}
                                  {formatPrice(item.price)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        {(!sale.offline_sale_items || sale.offline_sale_items.length === 0) && (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="font-semibold text-foreground">
                        {sale.customer_name || "Guest"}
                      </span>
                      {sale.customer_phone && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {sale.customer_phone}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
                        {sale.payment_method}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm">
                      {Number(sale.discount) > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          −{formatPrice(Number(sale.discount))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-primary">
                      {formatPrice(Number(sale.total))}
                    </td>
                  </tr>
                  {/* Expanded Details */}
                  {isExpanded && (
                    <tr className="bg-muted/10">
                      <td colSpan={9} className="p-0">
                        <div className="border-t border-border px-8 py-4">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground font-bold uppercase tracking-wider">
                                <th className="py-2 text-left">Product</th>
                                <th className="py-2 text-left">SKU</th>
                                <th className="py-2 text-right">Price</th>
                                <th className="py-2 text-right">Qty</th>
                                <th className="py-2 text-right">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                              {(sale.offline_sale_items ?? []).map((item: SaleItem) => {
                                const prod = resolveProduct(item);
                                const itemImg = imageFor(
                                  prod?.category || "clothing",
                                  (prod as { product_images?: { public_url: string }[] })
                                    ?.product_images?.[0]?.public_url,
                                );
                                const slug = prod?.slug || item.product_slug || item.sku;

                                return (
                                  <tr
                                    key={item.id || item.product_id || item.sku}
                                    className="hover:bg-muted/30 transition-colors"
                                  >
                                    <td className="py-2.5 font-semibold text-foreground">
                                      <div
                                        className="flex items-center gap-2.5 cursor-pointer group/item"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (slug) window.location.href = getProductUrl(slug);
                                        }}
                                        title={`Open "${item.name}" in store`}
                                      >
                                        <div className="size-9 rounded-lg border border-border bg-card overflow-hidden shrink-0">
                                          <img
                                            src={itemImg}
                                            alt={item.name}
                                            loading="lazy"
                                            decoding="async"
                                            className="h-full w-full object-cover group-hover/item:scale-105 transition"
                                            onError={(e) => {
                                              (e.target as HTMLImageElement).src = clothing;
                                            }}
                                          />
                                        </div>
                                        <div>
                                          <p className="font-bold text-xs text-foreground group-hover/item:text-primary transition-colors flex items-center gap-1">
                                            <span>{item.name}</span>
                                          </p>
                                          <p className="text-[10px] text-muted-foreground font-mono">
                                            {item.sku}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2.5 font-mono text-xs text-muted-foreground">
                                      {item.sku || "—"}
                                    </td>
                                    <td className="py-2.5 text-right font-medium text-foreground">
                                      {formatPrice(Number(item.price))}
                                    </td>
                                    <td className="py-2.5 text-right font-bold text-foreground">
                                      {item.qty}
                                    </td>
                                    <td className="py-2.5 text-right font-extrabold text-foreground">
                                      {formatPrice(
                                        Number(item.subtotal || Number(item.price) * item.qty),
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          <div className="mt-3 flex items-center justify-between">
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              <p>Subtotal: {formatPrice(Number(sale.subtotal))}</p>
                              {Number(sale.discount) > 0 && (
                                <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                  Discount (
                                  {sale.discount_type === "percentage"
                                    ? `${sale.discount_value}%`
                                    : sale.discount_type === "fixed"
                                      ? `₹${sale.discount_value}`
                                      : ""}
                                  ): −{formatPrice(Number(sale.discount))}
                                </p>
                              )}
                              <p className="font-bold text-foreground text-sm">
                                Total: {formatPrice(Number(sale.total))}
                              </p>
                            </div>

                            {sale.status !== "cancelled" && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Are you sure you want to delete this POS sale? This will permanently delete the transaction and restore stock for all items.",
                                    )
                                  ) {
                                    deleteSaleMutation.mutate(sale.id);
                                  }
                                }}
                                disabled={deleteSaleMutation.isPending}
                                className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </button>
                            )}
                            {sale.status === "cancelled" && (
                              <div className="flex items-center gap-1.5 text-sm font-bold text-destructive px-4 py-2 bg-destructive/5 rounded-xl border border-destructive/20">
                                <Trash2 className="size-4" />
                                Deleted
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {!isLoading && (sales ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                >
                  No POS sales yet.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center">
                  <div className="flex justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
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
