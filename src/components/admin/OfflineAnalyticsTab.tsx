/**
 * OfflineAnalyticsTab — Enhanced POS analytics with payment method breakdown,
 * per-sale receipt printing, sale details expansion, and top products view.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor } from "@/lib/store";
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

  // Fetch all products for dynamic image & slug resolution
  const { data: products = [] } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, slug, name, sku, barcode, brand, category, price, stock, image_url");
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
  const totalDiscount = (sales ?? []).reduce((sum, sale) => sum + Number(sale.discount ?? 0), 0);

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

  // Today's stats
  const today = new Date().toISOString().split("T")[0];
  const todaySales = (sales ?? []).filter((s) => s.created_at.split("T")[0] === today);
  const todayRevenue = todaySales.reduce((s, o) => s + Number(o.total), 0);

  return (
    <div className="space-y-6">
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
                matchedProduct?.image_url,
              );
              const slug = matchedProduct?.slug || p.product_slug || p.sku;

              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => slug && window.open(`/product/${slug}`, "_blank")}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && slug) {
                      e.preventDefault();
                      window.open(`/product/${slug}`, "_blank");
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
              <th className="px-5 py-4">Receipt No</th>
              <th className="px-5 py-4">Date</th>
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
                <tr key={sale.id} className="group">
                  <td colSpan={7} className="p-0">
                    <div
                      className="flex items-center cursor-pointer transition-colors hover:bg-muted/40 px-5 py-4"
                      onClick={() => setExpandedSale(isExpanded ? null : sale.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground mr-3 shrink-0" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground mr-3 shrink-0" />
                      )}
                      <span className="font-bold text-foreground w-36 shrink-0 font-mono">
                        {sale.sale_number}
                      </span>
                      <span className="text-muted-foreground font-medium w-44 shrink-0 text-xs">
                        {new Date(sale.created_at).toLocaleString("en-IN")}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold text-foreground">
                          {sale.customer_name || "Guest"}
                        </span>
                        {sale.customer_phone && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {sale.customer_phone}
                          </span>
                        )}
                      </span>
                      <span className="w-20 shrink-0">
                        <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
                          {sale.payment_method}
                        </span>
                      </span>
                      <span className="w-28 shrink-0 text-sm">
                        {Number(sale.discount) > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            −{formatPrice(Number(sale.discount))}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                      <span className="w-28 text-right font-bold text-primary shrink-0">
                        {formatPrice(Number(sale.total))}
                      </span>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t border-border bg-muted/20 px-8 py-4">
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
                                prod?.image_url,
                              );
                              const slug = prod?.slug || item.product_slug || item.sku;

                              return (
                                <tr key={item.id} className="hover:bg-muted/30 transition">
                                  <td className="py-2.5 font-semibold text-foreground">
                                    <div
                                      className="flex items-center gap-2.5 cursor-pointer group/item"
                                      onClick={() => {
                                        if (slug) window.open(`/product/${slug}`, "_blank");
                                      }}
                                      title={`Open "${item.name}" in store`}
                                    >
                                      <div className="size-9 rounded-lg border border-border bg-card overflow-hidden shrink-0">
                                        <img
                                          src={itemImg}
                                          alt={item.name}
                                          className="h-full w-full object-cover group-hover/item:scale-105 transition"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = clothing;
                                          }}
                                        />
                                      </div>
                                      <div>
                                        <p className="font-bold text-xs text-foreground group-hover/item:text-primary transition-colors flex items-center gap-1">
                                          <span>{item.name}</span>
                                          <ExternalLink className="size-2.5 opacity-0 group-hover/item:opacity-100 transition-opacity" />
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
                                    {formatPrice(Number(item.subtotal))}
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
                  className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                >
                  No POS sales yet.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center">
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
