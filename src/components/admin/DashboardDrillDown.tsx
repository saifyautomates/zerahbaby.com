import {
  ArrowLeft,
  Package,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  Info,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice, imageFor } from "@/lib/store";
import { format } from "date-fns";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";

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
  orders: any[];
  posSales: any[];
  products: any[];
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

    const getBuyingPrice = (p: any) => {
      if (!p) return 0;
      const costs = p.product_costs;
      return Number((Array.isArray(costs) ? costs[0]?.buying_price : costs?.buying_price) || 0);
    };

    const getProductImage = (p: any) => {
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

    const handleDeleteRecord = async (id: string, source: "Online" | "POS") => {
      if (!window.confirm(`Are you sure you want to delete this ${source} record?`)) return;
      try {
        if (source === "POS") {
          const { error } = await supabase
            .from("offline_sales")
            .update({ status: "cancelled" })
            .eq("id", id);
          if (error) throw error;
        } else {
          // Hard delete for online cancelled orders using our new RPC
          await supabase.rpc("delete_cancelled_order", { _order_id: id });
        }
        window.location.reload();
      } catch (e: any) {
        console.error("Delete failed:", e);
        alert(e.message || "Failed to delete record from Supabase.");
      }
    };

    if (type === "revenue") {
      const allItems: any[] = [];
      orders.forEach((o) => {
        o.order_items?.forEach((item: any) => {
          const p = products.find((prod) => prod.id === item.product_id);
          allItems.push({
            sale_id: o.id,
            date: o.created_at,
            product: item.product_name,
            slug: p?.slug || null,
            image: getProductImage(p),
            source: "Online",
            qty: item.qty || 1,
            price: item.price || 0,
            total: (item.price || 0) * (item.qty || 1),
          });
        });
      });
      posSales.forEach((s) => {
        s.offline_sale_items?.forEach((item: any) => {
          const p = getProduct(item.product_id);
          allItems.push({
            sale_id: s.id,
            date: s.created_at,
            product: p ? p.name : "Unknown",
            slug: p?.slug || null,
            image: getProductImage(p),
            source: "POS",
            qty: item.quantity || 1,
            price: item.price || 0,
            total: (item.price || 0) * (item.quantity || 1),
          });
        });
      });
      allItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        title: "Total Revenue Details",
        icon: TrendingUp,
        colorClass: "text-emerald-600 bg-emerald-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Product</th>
                  <th className="px-6 py-3">Source</th>
                  <th className="px-6 py-3 text-right">Qty</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">{format(new Date(item.date), "MMM d, h:mm a")}</td>
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
                        className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${item.source === "Online" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-800"}`}
                      >
                        {item.source}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">{item.qty}</td>
                    <td className="px-6 py-4 text-right font-bold">{formatPrice(item.total)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteRecord(item.sale_id, item.source)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete this record"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {allItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center">
                      No sales in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "orders") {
      const allOrders = [
        ...orders.map((o) => ({
          sale_id: o.id,
          date: o.created_at,
          id: `#${o.id.substring(0, 8).toUpperCase()}`,
          customer: o.full_name || o.email || "Guest",
          source: "Online",
          total: o.total || 0,
        })),
        ...posSales.map((s) => ({
          sale_id: s.id,
          date: s.created_at,
          id: s.sale_number,
          customer: s.customer_name || "Walk-in",
          source: "POS",
          total: s.total || 0,
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        title: "Total Orders Details",
        icon: ShoppingCart,
        colorClass: "text-blue-600 bg-blue-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Order ID</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Source</th>
                  <th className="px-6 py-3 text-right">Total</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.map((item, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">{format(new Date(item.date), "MMM d, h:mm a")}</td>
                    <td className="px-6 py-4 font-medium text-foreground">{item.id}</td>
                    <td className="px-6 py-4">{item.customer}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${item.source === "Online" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-800"}`}
                      >
                        {item.source}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold">{formatPrice(item.total)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() =>
                          handleDeleteRecord(item.sale_id, item.source as "Online" | "POS")
                        }
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete this order"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {allOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center">
                      No orders in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "low_stock") {
      const lowStockItems = products.filter((p) => p.stock <= (p.low_stock_at || 5));
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
                    <td className="px-6 py-4 text-right font-bold text-red-600">{p.stock}</td>
                    <td className="px-6 py-4">
                      {p.stock <= 0 ? (
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
      const inStockItems = products.filter((p) => p.stock > 0);
      return {
        title: "Total Stock Value",
        icon: Package,
        colorClass: "text-blue-600 bg-blue-50",
        renderContent: () => (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm text-muted-foreground">
              <thead className="bg-muted text-xs uppercase text-foreground">
                <tr>
                  <th className="px-6 py-3">Product</th>
                  <th className="px-6 py-3 text-right">Selling Price</th>
                  <th className="px-6 py-3 text-right">In Stock</th>
                  <th className="px-6 py-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody>
                {inStockItems.map((p, i) => (
                  <tr key={i} className="border-b bg-background hover:bg-muted/50">
                    <td className="px-6 py-4">
                      <Link
                        to="/product/$id"
                        params={{ id: p.id || p.slug }}
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
                    <td className="px-6 py-4 text-right">{formatPrice(p.price || 0)}</td>
                    <td className="px-6 py-4 text-right font-bold">{p.stock}</td>
                    <td className="px-6 py-4 text-right font-bold text-emerald-600">
                      {formatPrice((p.price || 0) * p.stock)}
                    </td>
                  </tr>
                ))}
                {inStockItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center">
                      No active stock available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ),
      };
    }

    if (type === "profit") {
      const allItems: any[] = [];
      let totalProfit = 0;
      let totalRev = 0;
      let totalCogs = 0;

      orders.forEach((o) => {
        o.order_items?.forEach((item: any) => {
          const p = getProduct(item.product_slug);
          const bp = getBuyingPrice(p);
          const rev = (item.price || 0) * (item.qty || 1);
          const cogs = bp * (item.qty || 1);
          const profit = rev - cogs;
          totalRev += rev;
          totalCogs += cogs;
          totalProfit += profit;
          allItems.push({
            date: o.created_at,
            product: item.product_name,
            slug: item.product_slug,
            image: getProductImage(p),
            qty: item.qty || 1,
            rev,
            cogs,
            profit,
          });
        });
      });
      posSales.forEach((s) => {
        s.offline_sale_items?.forEach((item: any) => {
          const p = getProduct(item.product_id);
          const bp = getBuyingPrice(p);
          const rev = (item.price || 0) * (item.quantity || 1);
          const cogs = bp * (item.quantity || 1);
          const profit = rev - cogs;
          totalRev += rev;
          totalCogs += cogs;
          totalProfit += profit;
          allItems.push({
            date: s.created_at,
            product: p ? p.name : "Unknown",
            qty: item.quantity || 1,
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
                  Total COGS
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
                    <th className="px-6 py-3 text-right">COGS</th>
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
                            target="_blank"
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
                    <td className="px-6 py-4 font-mono text-sm">{p.sku}</td>
                    <td className="px-6 py-4 text-right font-bold text-foreground text-sm">
                      {formatPrice(p.price)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${p.stock <= 0 ? "bg-red-100 text-red-700" : p.stock <= (p.low_stock_at || 5) ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                      >
                        {p.stock} in stock
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
