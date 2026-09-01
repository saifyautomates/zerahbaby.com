import {
  ArrowLeft,
  Package,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  Info,
  Trash2,
  Plus,
  Minus,
  Pencil,
  ExternalLink,
  Search,
  Check,
  X,
  Truck,
  Tag,
} from "lucide-react";
import { useState, useMemo, Suspense, lazy } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatPrice, imageFor, mapProduct, type Product } from "@/lib/store";
import type { ProductDraft } from "@/components/admin/ProductForm";
import { format } from "date-fns";
import { Link } from "@tanstack/react-router";
import { safeLazy } from "@/lib/safe-lazy";

const ProductForm = safeLazy(() =>
  import("@/components/admin/ProductForm").then((m) => ({ default: m.ProductForm })),
);

interface DrillDownOrderItem {
  product_id?: string;
  product_name?: string;
  name?: string;
  product_slug?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  image_url?: string | null;
}

interface DrillDownOrder {
  id: string;
  created_at: string;
  status?: string;
  total?: number;
  order_items?: DrillDownOrderItem[];
  profiles?: { full_name?: string; phone?: string; email?: string } | null;
  customer_name?: string;
  customer_phone?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  payment_status?: string;
  payment_method?: string;
}

interface DrillDownPOSItem {
  id?: string;
  product_id?: string | null;
  product_name?: string;
  name?: string;
  quantity?: number;
  qty?: number;
  price?: number;
}

interface DrillDownPOSSale {
  id: string;
  sale_number?: string;
  created_at: string;
  status?: string;
  total?: number;
  customer_name?: string;
  customer_phone?: string;
  offline_sale_items?: DrillDownPOSItem[];
}

interface DrillDownProduct {
  id: string;
  slug: string;
  name: string;
  category?: string;
  brand?: string;
  sku?: string | null;
  price?: number;
  image?: string;
  image_url?: string;
  product_images?: Array<{ public_url?: string; sort_order?: number; is_primary?: boolean }>;
  product_costs?: { buying_price?: number } | Array<{ buying_price?: number }> | null;
  stock?: number;
  low_stock_at?: number;
  is_active?: boolean;
}

function SalesChannelDrillDown({
  type,
  validOrders,
  validPosSales,
  products,
}: {
  type: "orders" | "revenue";
  validOrders: DrillDownOrder[];
  validPosSales: DrillDownPOSSale[];
  products: DrillDownProduct[];
}) {
  const [activeChannel, setActiveChannel] = useState<"all" | "online" | "offline">("all");
  const [search, setSearch] = useState("");

  const getProduct = (slugOrId: string) => {
    return products.find((p) => p.slug === slugOrId || p.id === slugOrId);
  };

  const getProductImage = (p: DrillDownProduct | undefined) => {
    if (!p) return null;
    let url: string | null = null;
    if (p.image) url = p.image;
    else if (p.image_url) url = p.image_url;
    else if (p.product_images && Array.isArray(p.product_images) && p.product_images.length > 0) {
      const sorted = [...p.product_images].sort(
        (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
      );
      const primary = sorted.find((img) => img.is_primary) || sorted[0];
      url = primary?.public_url || null;
    }
    return imageFor(p.category || "clothing", url);
  };

  const onlineOrders = useMemo(() => {
    return validOrders.map((o) => ({
      sale_id: o.id,
      date: o.created_at,
      id: `#${o.id.substring(0, 8).toUpperCase()}`,
      customer: o.full_name || o.email || "Guest",
      source: "Online" as const,
      total: o.total || 0,
    }));
  }, [validOrders]);

  const onlineRevenueItems = useMemo(() => {
    const items: Array<{
      sale_id: string;
      date: string;
      product: string;
      slug: string | null;
      image: string | null;
      source: "Online";
      qty: number;
      price: number;
      total: number;
    }> = [];
    validOrders.forEach((o) => {
      if (o.order_items && o.order_items.length > 0) {
        o.order_items.forEach((item) => {
          const p = products.find(
            (prod) => prod.id === item.product_id || prod.slug === item.product_slug,
          );
          const itemQty = item.qty || item.quantity || 1;
          const itemPrice = item.price || 0;
          items.push({
            sale_id: o.id,
            date: o.created_at,
            product: item.product_name || item.name || "Product",
            slug: p?.slug || item.product_slug || null,
            image: getProductImage(p) || item.image_url || null,
            source: "Online",
            qty: itemQty,
            price: itemPrice,
            total: itemPrice * itemQty || o.total || 0,
          });
        });
      } else {
        items.push({
          sale_id: o.id,
          date: o.created_at,
          product: `Online Order #${o.id.substring(0, 8).toUpperCase()}`,
          slug: null,
          image: null,
          source: "Online",
          qty: 1,
          price: o.total || 0,
          total: o.total || 0,
        });
      }
    });
    return items;
  }, [validOrders, products]);

  const offlineSales = useMemo(() => {
    return validPosSales.map((s) => ({
      sale_id: s.id,
      date: s.created_at,
      id: s.sale_number || s.id.substring(0, 8),
      customer: s.customer_name || "Walk-in Customer",
      source: "POS" as const,
      total: s.total || 0,
    }));
  }, [validPosSales]);

  const offlineRevenueItems = useMemo(() => {
    const items: Array<{
      sale_id: string;
      date: string;
      product: string;
      slug: string | null;
      image: string | null;
      source: "POS";
      qty: number;
      price: number;
      total: number;
    }> = [];
    validPosSales.forEach((s) => {
      if (s.offline_sale_items && s.offline_sale_items.length > 0) {
        s.offline_sale_items.forEach((item) => {
          const p = getProduct(item.product_id || "");
          const itemQty = item.qty || item.quantity || 1;
          const itemPrice = item.price || 0;
          items.push({
            sale_id: s.id,
            date: s.created_at,
            product: p ? p.name : item.name || item.product_name || "Product",
            slug: p?.slug || null,
            image: getProductImage(p),
            source: "POS",
            qty: itemQty,
            price: itemPrice,
            total: itemPrice * itemQty || s.total || 0,
          });
        });
      } else {
        items.push({
          sale_id: s.id,
          date: s.created_at,
          product: `POS Sale ${s.sale_number || s.id.substring(0, 8)}`,
          slug: null,
          image: null,
          source: "POS",
          qty: 1,
          price: s.total || 0,
          total: s.total || 0,
        });
      }
    });
    return items;
  }, [validPosSales, products]);

  const onlineOrdersTotal = onlineOrders.reduce((acc, i) => acc + i.total, 0);
  const offlineOrdersTotal = offlineSales.reduce((acc, i) => acc + i.total, 0);

  const onlineTotalRev = onlineOrdersTotal;
  const offlineTotalRev = offlineOrdersTotal;

  if (type === "orders") {
    let combined: Array<{
      sale_id: string;
      date: string;
      id: string;
      customer: string;
      source: "Online" | "POS";
      total: number;
    }> = [];
    if (activeChannel === "online") combined = onlineOrders;
    else if (activeChannel === "offline") combined = offlineSales;
    else combined = [...onlineOrders, ...offlineSales];

    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (search.trim()) {
      const q = search.toLowerCase();
      combined = combined.filter(
        (i) => i.id.toLowerCase().includes(q) || i.customer.toLowerCase().includes(q),
      );
    }

    return (
      <div className="space-y-5">
        {/* 2 Main Sections: 1. Online Sales & 2. Offline Sales */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setActiveChannel(activeChannel === "online" ? "all" : "online")}
            className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
              activeChannel === "online"
                ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-bold text-xl">
                  🌐
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">1. Online Sales (Website)</h4>
                  <p className="text-xs text-muted-foreground">{onlineOrders.length} Orders</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-primary">{formatPrice(onlineOrdersTotal)}</p>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Website Revenue
                </span>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveChannel(activeChannel === "offline" ? "all" : "offline")}
            className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
              activeChannel === "offline"
                ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-600/30 shadow-md"
                : "border-border bg-card hover:border-emerald-500/50 hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 font-bold text-xl">
                  🏪
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    2. Offline Sales (POS Store)
                  </h4>
                  <p className="text-xs text-muted-foreground">{offlineSales.length} Store Sales</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-black text-emerald-600">
                  {formatPrice(offlineOrdersTotal)}
                </p>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Store Revenue
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Segmented Channel Control Tabs & Search */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
          <div className="inline-flex rounded-xl bg-muted p-1 gap-1 border border-border/50">
            <button
              type="button"
              onClick={() => setActiveChannel("all")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeChannel === "all"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Sales ({onlineOrders.length + offlineSales.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveChannel("online")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeChannel === "online"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🌐 1. Online Sales ({onlineOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveChannel("offline")}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeChannel === "offline"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🏪 2. Offline POS Sales ({offlineSales.length})
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by order ID or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Orders Table */}
        <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
            <thead className="bg-muted text-xs uppercase text-foreground">
              <tr>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Order / Sale ID</th>
                <th className="px-6 py-3.5">Customer</th>
                <th className="px-6 py-3.5">Sales Section</th>
                <th className="px-6 py-3.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {combined.slice(0, 50).map((item, i) => (
                <tr key={i} className="bg-background hover:bg-muted/40 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    {format(new Date(item.date), "MMM d, h:mm a")}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-foreground">{item.id}</td>
                  <td className="px-6 py-4 font-medium text-foreground">{item.customer}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        item.source === "Online"
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border border-emerald-200"
                      }`}
                    >
                      {item.source === "Online" ? "🌐 1. Online Sales" : "🏪 2. Offline POS"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-black text-foreground">
                    {formatPrice(item.total)}
                  </td>
                </tr>
              ))}
              {combined.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    No orders in this section for the selected period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Revenue Drilldown
  let combinedRev: Array<{
    sale_id: string;
    date: string;
    product: string;
    slug: string | null;
    image: string | null;
    source: "Online" | "POS";
    qty: number;
    price: number;
    total: number;
  }> = [];
  if (activeChannel === "online") combinedRev = onlineRevenueItems;
  else if (activeChannel === "offline") combinedRev = offlineRevenueItems;
  else combinedRev = [...onlineRevenueItems, ...offlineRevenueItems];

  combinedRev.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (search.trim()) {
    const q = search.toLowerCase();
    combinedRev = combinedRev.filter((i) => i.product.toLowerCase().includes(q));
  }

  return (
    <div className="space-y-5">
      {/* 2 Main Sections: 1. Online Sales & 2. Offline Sales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => setActiveChannel(activeChannel === "online" ? "all" : "online")}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            activeChannel === "online"
              ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
              : "border-border bg-card hover:border-primary/50 hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary font-bold text-xl">
                🌐
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">1. Online Sales Revenue</h4>
                <p className="text-xs text-muted-foreground">
                  {onlineRevenueItems.length} Sold Items
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-primary">{formatPrice(onlineTotalRev)}</p>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Website Revenue
              </span>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveChannel(activeChannel === "offline" ? "all" : "offline")}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            activeChannel === "offline"
              ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-600/30 shadow-md"
              : "border-border bg-card hover:border-emerald-500/50 hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 font-bold text-xl">
                🏪
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">2. Offline Sales Revenue</h4>
                <p className="text-xs text-muted-foreground">
                  {offlineRevenueItems.length} Store Items
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-emerald-600">{formatPrice(offlineTotalRev)}</p>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Store Revenue
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* Segmented Channel Control Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <div className="inline-flex rounded-xl bg-muted p-1 gap-1 border border-border/50">
          <button
            type="button"
            onClick={() => setActiveChannel("all")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeChannel === "all"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Revenue ({onlineRevenueItems.length + offlineRevenueItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel("online")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeChannel === "online"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🌐 1. Online Sales ({onlineRevenueItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel("offline")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeChannel === "offline"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🏪 2. Offline POS ({offlineRevenueItems.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Revenue Table */}
      <div className="w-full overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
          <thead className="bg-muted text-xs uppercase text-foreground">
            <tr>
              <th className="px-6 py-3.5">Date</th>
              <th className="px-6 py-3.5">Product</th>
              <th className="px-6 py-3.5">Sales Section</th>
              <th className="px-6 py-3.5 text-right">Quantity</th>
              <th className="px-6 py-3.5 text-right">Total Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {combinedRev.slice(0, 50).map((item, i) => (
              <tr key={i} className="bg-background hover:bg-muted/40 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  {format(new Date(item.date), "MMM d, h:mm a")}
                </td>
                <td className="px-6 py-4">
                  {item.slug ? (
                    <Link
                      to="/product/$id"
                      params={{ id: item.slug }}
                      className="flex items-center gap-3 hover:text-primary transition-colors group"
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.product}
                          loading="lazy"
                          decoding="async"
                          className="w-9 h-9 rounded-md object-cover border group-hover:border-primary/50 transition-colors"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center border group-hover:border-primary/50 transition-colors">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                        {item.product}
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 text-foreground">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.product}
                          loading="lazy"
                          decoding="async"
                          className="w-9 h-9 rounded-md object-cover border"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center border">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <span className="font-medium">{item.product}</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                      item.source === "Online"
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border border-emerald-200"
                    }`}
                  >
                    {item.source === "Online" ? "🌐 1. Online Sales" : "🏪 2. Offline POS"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-bold text-foreground">{item.qty}</td>
                <td className="px-6 py-4 text-right font-black text-foreground">
                  {formatPrice(item.total)}
                </td>
              </tr>
            ))}
            {combinedRev.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                  No revenue items found in this section for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DashboardDrillDown({
  type,
  onBack,
  dateRangeText,
  orders,
  posSales,
  products,
}: {
  type: string;
  onBack: () => void;
  dateRangeText: string;
  orders: DrillDownOrder[];
  posSales: DrillDownPOSSale[];
  products: DrillDownProduct[];
}) {
  const {
    title,
    icon: Icon,
    colorClass,
    renderContent,
  } = useMemo(() => {
    const getProduct = (slugOrId: string) => {
      return products.find((p) => p.slug === slugOrId || p.id === slugOrId);
    };

    const getBuyingPrice = (p: DrillDownProduct | undefined) => {
      if (!p) return 0;
      const costs = p.product_costs;
      return Number((Array.isArray(costs) ? costs[0]?.buying_price : costs?.buying_price) || 0);
    };

    const getProductImage = (p: DrillDownProduct | undefined) => {
      if (!p) return null;
      let url: string | null = null;
      if (p.image) url = p.image;
      else if (p.image_url) url = p.image_url;
      else if (p.product_images && Array.isArray(p.product_images) && p.product_images.length > 0) {
        const sorted = [...p.product_images].sort(
          (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
        );
        const primary = sorted.find((img) => img.is_primary) || sorted[0];
        url = primary?.public_url || null;
      }
      return imageFor(p.category || "clothing", url);
    };

    const validOrders = orders.filter((o) => {
      if (o.status === "cancelled") return false;
      if (o.payment_status === "failed" || o.payment_status === "refunded") return false;
      return true;
    });

    const validPosSales = posSales.filter((s) => s.status !== "cancelled");

    if (type === "revenue") {
      return {
        title: "Total Revenue Details (Confirmed & Paid)",
        icon: TrendingUp,
        colorClass: "text-emerald-600 bg-emerald-50",
        renderContent: () => (
          <SalesChannelDrillDown
            type="revenue"
            validOrders={validOrders}
            validPosSales={validPosSales}
            products={products}
          />
        ),
      };
    }

    if (type === "orders") {
      return {
        title: "Total Orders Details (Confirmed & Paid)",
        icon: ShoppingCart,
        colorClass: "text-blue-600 bg-blue-50",
        renderContent: () => (
          <SalesChannelDrillDown
            type="orders"
            validOrders={validOrders}
            validPosSales={validPosSales}
            products={products}
          />
        ),
      };
    }

    if (type === "low_stock") {
      const lowStockItems = products.filter((p) => (p.stock ?? 0) <= (p.low_stock_at || 5));
      return {
        title: "Low Stock Items",
        icon: AlertTriangle,
        colorClass: "text-violet-600 bg-violet-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Product</th>
                  <th className="px-6 py-3">SKU</th>
                  <th className="px-6 py-3 text-right">Stock</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((p, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">
                      <Link
                        to="/product/$id"
                        params={{ id: p.slug }}
                        className="flex items-center gap-3 hover:text-primary transition-colors group"
                      >
                        {getProductImage(p) ? (
                          <img
                            src={getProductImage(p) || undefined}
                            alt={p.name}
                            loading="lazy"
                            decoding="async"
                            className="w-9 h-9 rounded-md object-cover border group-hover:border-primary/50 transition-colors"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center border group-hover:border-primary/50 transition-colors">
                            <Package className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {p.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">{p.sku}</td>
                    <td className="px-6 py-4 text-right font-bold text-red-600">{p.stock ?? 0}</td>
                    <td className="px-6 py-4">
                      {(p.stock ?? 0) <= 0 ? (
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-700">
                          Out of Stock
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700">
                          Low Stock
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {lowStockItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center">
                      All inventory is healthy.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "cash") {
      const pendingCodOrders = orders.filter(
        (o) =>
          o.status !== "cancelled" &&
          o.payment_status !== "paid" &&
          (o.payment_method === "cod" || o.payment_status === "pending"),
      );

      return {
        title: "Cash Outstanding (Pending COD)",
        icon: DollarSign,
        colorClass: "text-rose-600 bg-rose-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Order ID</th>
                  <th className="px-6 py-3">Customer Details</th>
                  <th className="px-6 py-3 text-right">Pending Amount</th>
                </tr>
              </thead>
              <tbody>
                {pendingCodOrders.map((o, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">{format(new Date(o.created_at), "MMM d, yyyy")}</td>
                    <td className="px-6 py-4 font-medium text-foreground">
                      #{o.id.substring(0, 8).toUpperCase()}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-foreground">{o.full_name || o.email}</p>
                      <p className="text-xs">{o.phone}</p>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-rose-600">
                      {formatPrice(o.total || 0)}
                    </td>
                  </tr>
                ))}
                {pendingCodOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center">
                      No pending cash outstanding.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "stock") {
      return {
        title: "Total Stock Value & Inventory Control",
        icon: Package,
        colorClass: "text-blue-600 bg-blue-50",
        renderContent: () => <StockDrillDownView products={products} />,
      };
    }

    if (type === "profit") {
      const allItems: Array<{
        date: string;
        product: string;
        slug?: string;
        image?: string | null;
        qty: number;
        rev: number;
        cogs: number;
        profit: number;
      }> = [];
      let totalProfit = 0;
      let totalRev = 0;
      let totalCogs = 0;

      validOrders.forEach((o) => {
        o.order_items?.forEach((item) => {
          const p = getProduct(item.product_slug || "");
          const bp = getBuyingPrice(p);
          const rev = (item.price || 0) * (item.qty || 1);
          const cogs = bp * (item.qty || 1);
          const profit = rev - cogs;
          totalRev += rev;
          totalCogs += cogs;
          totalProfit += profit;
          allItems.push({
            date: o.created_at,
            product: item.product_name || "Product",
            slug: item.product_slug,
            image: getProductImage(p),
            qty: item.qty || 1,
            rev,
            cogs,
            profit,
          });
        });
      });
      validPosSales.forEach((s) => {
        s.offline_sale_items?.forEach((item) => {
          const p = getProduct(item.product_id || "");
          const bp = getBuyingPrice(p);
          const rev = (item.price || 0) * (item.qty || 1);
          const cogs = bp * (item.qty || 1);
          const profit = rev - cogs;
          totalRev += rev;
          totalCogs += cogs;
          totalProfit += profit;
          allItems.push({
            date: s.created_at,
            product: p ? p.name : "Unknown",
            qty: item.qty || 1,
            rev,
            cogs,
            profit,
          });
        });
      });
      allItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        title: "Net Profit Analysis",
        icon: TrendingUp,
        colorClass: "text-amber-600 bg-amber-50",
        renderContent: () => (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-card border border-border shadow-sm">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Total Revenue
                </p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{formatPrice(totalRev)}</p>
              </div>
              <div className="p-4 rounded-xl bg-card border border-border shadow-sm">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Total Cost Price
                </p>
                <p className="text-2xl font-bold mt-1 text-rose-600">{formatPrice(totalCogs)}</p>
              </div>
              <div className="p-4 rounded-xl bg-card border border-border shadow-sm">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                  Net Profit
                </p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{formatPrice(totalProfit)}</p>
              </div>
            </div>
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground mt-4">
                <thead className="bg-muted text-xs uppercase text-foreground">
                  <tr>
                    <th className="px-6 py-3">Product</th>
                    <th className="px-6 py-3 text-right">Qty</th>
                    <th className="px-6 py-3 text-right">Revenue</th>
                    <th className="px-6 py-3 text-right">Cost Price</th>
                    <th className="px-6 py-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {allItems.map((item, i) => (
                    <tr key={i} className="border-b bg-background hover:bg-muted/50">
                      <td className="px-6 py-4">
                        {item.slug ? (
                          <Link
                            to="/product/$id"
                            params={{ id: item.slug }}
                            className="flex items-center gap-3 hover:text-primary transition-colors group"
                          >
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.product}
                                loading="lazy"
                                decoding="async"
                                className="w-9 h-9 rounded-md object-cover border group-hover:border-primary/50 transition-colors"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center border group-hover:border-primary/50 transition-colors">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                              {item.product}
                            </span>
                          </Link>
                        ) : (
                          <span className="font-medium text-foreground">{item.product}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">{item.qty}</td>
                      <td className="px-6 py-4 text-right text-emerald-600">
                        {formatPrice(item.rev)}
                      </td>
                      <td className="px-6 py-4 text-right text-rose-600">
                        {formatPrice(item.cogs)}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-amber-600">
                        {formatPrice(item.profit)}
                      </td>
                    </tr>
                  ))}
                  {allItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center">
                        No sales data for profit calculation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ),
      };
    }

    if (type === "active-catalog") {
      const activeItems = products.filter((p) => p.is_active);
      return {
        title: "Active Catalog",
        icon: Package,
        colorClass: "text-amber-600 bg-amber-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Product Image & Name</th>
                  <th className="px-6 py-3">SKU</th>
                  <th className="px-6 py-3 text-right">Price</th>
                  <th className="px-6 py-3 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((p, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        {getProductImage(p) ? (
                          <a
                            href={getProductImage(p) || undefined}
                            rel="noreferrer"
                            title="Click to enlarge"
                            className="shrink-0"
                          >
                            <img
                              src={getProductImage(p) || undefined}
                              alt={p.name}
                              loading="lazy"
                              decoding="async"
                              className="w-12 h-12 rounded-lg object-cover border cursor-zoom-in shadow-sm hover:scale-105 transition-transform"
                            />
                          </a>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center border shrink-0">
                            <Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link
                            to="/product/$id"
                            params={{ id: p.slug || p.id }}
                            className="font-medium text-foreground hover:text-primary transition-colors text-base"
                          >
                            {p.name}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {p.brand} &bull; {p.category}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{p.sku || "—"}</td>
                    <td className="px-6 py-4 text-right font-bold text-foreground text-sm">
                      {formatPrice(p.price || 0)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${(p.stock ?? 0) <= 0 ? "bg-red-100 text-red-700" : (p.stock ?? 0) <= (p.low_stock_at || 5) ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                      >
                        {p.stock ?? 0} in stock
                      </span>
                    </td>
                  </tr>
                ))}
                {activeItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-base">
                      No active products found in the catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "unpaid" || type === "incomplete") {
      const unpaidList = orders.filter(
        (o) =>
          o.status === "cancelled" ||
          o.payment_status === "failed" ||
          (o.payment_method?.toLowerCase() !== "cod" && o.payment_status !== "paid"),
      );

      return {
        title: "Unpaid & Incomplete Orders Audit",
        icon: AlertTriangle,
        colorClass: "text-amber-600 bg-amber-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Order ID</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Payment Method</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Attempted Total</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {unpaidList.map((o, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">{format(new Date(o.created_at), "MMM d, h:mm a")}</td>
                    <td className="px-6 py-4 font-mono font-medium text-foreground">
                      #{o.id.substring(0, 8).toUpperCase()}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-foreground">
                        {o.full_name || o.email || "Customer"}
                      </p>
                      <p className="text-xs text-muted-foreground">{o.phone}</p>
                    </td>
                    <td className="px-6 py-4 uppercase text-xs font-semibold">
                      {o.payment_method || "Online"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200">
                        {o.status === "cancelled"
                          ? "Cancelled"
                          : o.payment_status || "Unpaid / Abandoned"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-foreground">
                      {formatPrice(o.total || 0)}
                    </td>
                  </tr>
                ))}
                {unpaidList.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center">
                      No unpaid or cancelled orders found in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    return {
      title: "Details",
      icon: Info,
      colorClass: "text-slate-600 bg-slate-50",
      renderContent: () => (
        <div className="p-8 text-center text-muted-foreground">Unknown view type</div>
      ),
    };
  }, [type, orders, posSales, products]);

  return (
    <div className="animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-card border border-border shadow-sm hover:bg-muted transition-colors"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${colorClass}`}>
              <Icon className="size-4" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">Date Range: {dateRangeText}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">{renderContent()}</div>
      </div>
    </div>
  );
}

function StockDrillDownView({ products }: { products: DrillDownProduct[] }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "in_stock" | "low" | "out">("all");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [stockVal, setStockVal] = useState<number>(0);

  const updateStock = useMutation({
    mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
      const { error } = await supabase
        .from("products")
        .update({ stock: Math.max(0, stock) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock updated successfully");
      setEditingStockId(null);
      qc.invalidateQueries({ queryKey: ["admin-products-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product deleted");
      qc.invalidateQueries({ queryKey: ["admin-products-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveProduct = useMutation({
    mutationFn: async ({ draft, uuid }: { draft: ProductDraft; uuid?: string }) => {
      const row: Record<string, unknown> = {
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        brand: draft.brand.trim(),
        category: draft.category,
        price: Number(draft.price),
        mrp: Number(draft.mrp),
        age_group: draft.ageGroup,
        low_stock_at: Number(draft.lowStockAt),
        sku: draft.sku.trim(),
        barcode: draft.barcode.trim(),
        description: draft.description,
        highlights: draft.highlights
          .split("\n")
          .map((h) => h.trim())
          .filter(Boolean),
        is_featured: draft.isFeatured,
        is_active: draft.isActive,
        sort_order: Number(draft.sortOrder),
        recommendation_mode: draft.recommendationMode,
        stock: Number(draft.stock),
      };

      let productId = uuid;
      if (uuid) {
        const { error } = await supabase
          .from("products")
          .update(row as Database["public"]["Tables"]["products"]["Update"])
          .eq("id", uuid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(row as Database["public"]["Tables"]["products"]["Insert"])
          .select("id")
          .single();
        if (error) throw error;
        productId = data.id;
      }

      if (draft.buyingPrice !== undefined && productId) {
        await supabase
          .from("product_costs")
          .upsert({ product_id: productId, buying_price: Number(draft.buyingPrice) });
      }

      if (draft.deliveryFee !== undefined && productId) {
        const { data: currentSetting } = await supabase
          .from("site_settings")
          .select("value")
          .eq("key", "product_delivery_fees")
          .maybeSingle();

        let currentFees: Record<string, number> = {};
        if (currentSetting?.value) {
          try {
            currentFees = JSON.parse(currentSetting.value);
          } catch {
            currentFees = {};
          }
        }
        currentFees[productId] = draft.deliveryFee;
        currentFees[draft.slug] = draft.deliveryFee;
        await supabase.from("site_settings").upsert({
          key: "product_delivery_fees",
          value: JSON.stringify(currentFees),
        });
      }

      if (productId) {
        const allUrls = new Set<string>();
        if (draft.imageUrl.trim()) allUrls.add(draft.imageUrl.trim());
        draft.images.forEach((img) => {
          if (img.trim()) allUrls.add(img.trim());
        });

        const urlsArray = Array.from(allUrls);
        const { data: existing } = await supabase
          .from("product_images")
          .select("*")
          .eq("product_id", productId);

        const toDelete = (existing || []).filter((e) => !urlsArray.includes(e.public_url));
        for (const del of toDelete) {
          await supabase.from("product_images").delete().eq("id", del.id);
        }

        for (let i = 0; i < urlsArray.length; i++) {
          const url = urlsArray[i];
          const isPrimary = url === draft.imageUrl.trim() || (i === 0 && !draft.imageUrl.trim());
          const existingRow = (existing || []).find((e) => e.public_url === url);

          if (existingRow) {
            await supabase
              .from("product_images")
              .update({ is_primary: isPrimary, sort_order: i })
              .eq("id", existingRow.id);
          } else {
            await supabase.from("product_images").insert({
              product_id: productId,
              public_url: url,
              is_primary: isPrimary,
              sort_order: i,
            });
          }
        }
      }
    },
    onSuccess: () => {
      toast.success(isCreating ? "Product added" : "Product updated");
      setEditingProduct(null);
      setIsCreating(false);
      qc.invalidateQueries({ queryKey: ["admin-products-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalValue = products.reduce((sum, p) => sum + (p.price || 0) * (p.stock || 0), 0);
  const totalUnits = products.reduce((sum, p) => sum + (p.stock || 0), 0);
  const lowCount = products.filter(
    (p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.low_stock_at || 5),
  ).length;
  const outCount = products.filter((p) => (p.stock || 0) === 0).length;

  const filtered = products.filter((p) => {
    const stock = p.stock || 0;
    const lowAt = p.low_stock_at || 5;
    if (filter === "in_stock" && stock === 0) return false;
    if (filter === "low" && !(stock > 0 && stock <= lowAt)) return false;
    if (filter === "out" && stock !== 0) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        (p.slug || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getProductImage = (p: DrillDownProduct) => {
    let url: string | null = null;
    if (p.image) url = p.image;
    else if (p.image_url) url = p.image_url;
    else if (p.product_images && Array.isArray(p.product_images) && p.product_images.length > 0) {
      const sorted = [...p.product_images].sort(
        (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
      );
      const primary = sorted.find((img) => img.is_primary) || sorted[0];
      url = primary?.public_url || null;
    }
    return imageFor(p.category || "clothing", url);
  };

  const getBuyingPrice = (p: DrillDownProduct) => {
    const costs = p.product_costs;
    return Number((Array.isArray(costs) ? costs[0]?.buying_price : costs?.buying_price) || 0);
  };

  return (
    <div className="space-y-4 p-4">
      {/* Top Overview Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-background p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            Total Stock Value
          </p>
          <p className="mt-1 text-xl font-extrabold text-emerald-600">{formatPrice(totalValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-background p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            Total In-Stock Units
          </p>
          <p className="mt-1 text-xl font-extrabold text-foreground">{totalUnits} units</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold uppercase text-amber-800">Low Stock Items</p>
          <p className="mt-1 text-xl font-extrabold text-amber-600">{lowCount}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/50 p-3.5 shadow-2xs">
          <p className="text-[11px] font-semibold uppercase text-red-800">Out of Stock</p>
          <p className="mt-1 text-xl font-extrabold text-red-600">{outCount}</p>
        </div>
      </div>

      {/* Control Bar: Filters, Search, Add Product */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all", label: `All (${products.length})` },
              { key: "in_stock", label: `In Stock (${products.length - outCount})` },
              { key: "low", label: `Low Alert (${lowCount})` },
              { key: "out", label: `Out of Stock (${outCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                filter === item.key
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#8B2020] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#731a1a] transition cursor-pointer shrink-0"
          >
            <Plus className="size-3.5" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Selling Price</th>
              <th className="px-4 py-3">Buying Cost</th>
              <th className="px-4 py-3">Stock (Units)</th>
              <th className="px-4 py-3">Total Value</th>
              <th
                className="px-4 py-3"
                title="Jab stock is limit par ya isse kam bachega tab Low Stock alert aayega"
              >
                Alert (≤)
              </th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.map((p) => {
              const stock = p.stock || 0;
              const lowAt = p.low_stock_at || 5;
              const isOut = stock === 0;
              const isLow = stock > 0 && stock <= lowAt;
              const buyingPrice = getBuyingPrice(p);
              const totalVal = (p.price || 0) * stock;
              const isEditingThisStock = editingStockId === p.id;

              return (
                <tr key={p.id} className="hover:bg-muted/40 transition-colors">
                  {/* Product */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        to="/product/$id"
                        params={{ id: p.id || p.slug }}
                        className="relative block size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30"
                      >
                        <img
                          src={getProductImage(p) || undefined}
                          alt={p.name}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      </Link>
                      <div className="max-w-[200px]">
                        <Link
                          to="/product/$id"
                          params={{ id: p.id || p.slug }}
                          className="font-semibold text-foreground line-clamp-1 hover:text-primary transition"
                        >
                          {p.name}
                        </Link>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {p.sku || p.brand || p.id}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-semibold capitalize text-foreground">
                      {p.category || "General"}
                    </span>
                  </td>

                  {/* Price */}
                  <td className="px-4 py-3 font-semibold text-foreground">
                    {formatPrice(p.price || 0)}
                  </td>

                  {/* Cost */}
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      {formatPrice(buyingPrice)}
                    </div>
                    <div
                      className={`text-[10px] font-bold ${
                        (p.price || 0) - buyingPrice < 0 ? "text-destructive" : "text-emerald-600"
                      }`}
                    >
                      {buyingPrice > 0
                        ? `${((((p.price || 0) - buyingPrice) / buyingPrice) * 100).toFixed(1)}%`
                        : "100%"}
                    </div>
                  </td>

                  {/* Stock Quick +/- & Edit */}
                  <td className="px-4 py-3">
                    {isEditingThisStock ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          value={stockVal === 0 ? "" : stockVal}
                          placeholder="0"
                          autoFocus
                          onChange={(e) =>
                            setStockVal(
                              e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              updateStock.mutate({ id: p.id, stock: stockVal });
                            }
                          }}
                          className="w-16 rounded-md border border-primary bg-background px-2 py-1 text-xs font-bold outline-none"
                        />
                        <button
                          onClick={() => updateStock.mutate({ id: p.id, stock: stockVal })}
                          className="rounded-md bg-emerald-600 text-white p-1 hover:bg-emerald-700 transition cursor-pointer"
                          title="Save Stock"
                        >
                          <Check className="size-3" />
                        </button>
                        <button
                          onClick={() => setEditingStockId(null)}
                          className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted transition cursor-pointer"
                          title="Cancel"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateStock.mutate({ id: p.id, stock: Math.max(0, stock - 1) })
                          }
                          disabled={stock === 0 || updateStock.isPending}
                          title="Decrease Stock (-1)"
                          className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30 cursor-pointer"
                        >
                          <Minus className="size-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingStockId(p.id);
                            setStockVal(stock);
                          }}
                          title="Click to edit stock number"
                          className={`min-w-8 px-2 py-0.5 rounded-md text-xs font-bold text-center transition cursor-pointer ${
                            isOut
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : isLow
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : "bg-muted text-foreground border border-border hover:border-primary/50"
                          }`}
                        >
                          {stock}
                        </button>

                        <button
                          type="button"
                          onClick={() => updateStock.mutate({ id: p.id, stock: stock + 1 })}
                          disabled={updateStock.isPending}
                          title="Increase Stock (+1)"
                          className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Total Value */}
                  <td className="px-4 py-3 font-bold text-emerald-600">{formatPrice(totalVal)}</td>

                  {/* Low Stock Alert */}
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex rounded-md bg-muted/60 border border-border px-2 py-0.5 text-xs font-mono font-bold text-muted-foreground"
                      title={`Jab stock ${lowAt} ya isse kam hoga tab Low Stock alert dikhega`}
                    >
                      ≤ {lowAt}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {isOut ? (
                      <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">
                        Out of stock
                      </span>
                    ) : isLow ? (
                      <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600">
                        Low stock
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                        In stock
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to="/product/$id"
                        params={{ id: p.id || p.slug }}
                        title="View on store"
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>

                      <button
                        onClick={() => {
                          const mapped = mapProduct(p as never);
                          setEditingProduct(mapped);
                        }}
                        title="Edit product details"
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition cursor-pointer"
                      >
                        <Pencil className="size-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          if (confirm(`Delete "${p.name}"? This action cannot be undone.`)) {
                            deleteProduct.mutate(p.id);
                          }
                        }}
                        title="Delete product"
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition cursor-pointer"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                  No stock items match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Product Form Modal for Add / Edit */}
      {(isCreating || editingProduct) && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-background p-8 rounded-2xl animate-pulse">
                Loading product editor...
              </div>
            </div>
          }
        >
          <ProductForm
            product={editingProduct}
            saving={saveProduct.isPending}
            onCancel={() => {
              setIsCreating(false);
              setEditingProduct(null);
            }}
            onSave={(draft) =>
              saveProduct.mutate(editingProduct ? { draft, uuid: editingProduct.uuid } : { draft })
            }
          />
        </Suspense>
      )}
    </div>
  );
}
