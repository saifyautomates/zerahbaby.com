import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import {
  Search,
  X,
  Package,
  ShoppingCart,
  Receipt,
  Users,
  Layers,
  ArrowRight,
  Sparkles,
  Command,
  LayoutDashboard,
  Settings,
  Tag,
  ShieldCheck,
  BarChart3,
  Sliders,
} from "lucide-react";

export interface SearchResultItem {
  id: string;
  category: "products" | "orders" | "pos" | "customers" | "navigation";
  title: string;
  subtitle: string;
  meta?: string;
  tab: string;
  actionPayload?: string;
}

const QUICK_NAV_ACTIONS: SearchResultItem[] = [
  {
    id: "nav-dashboard",
    category: "navigation",
    title: "Store Dashboard",
    subtitle: "Overview of revenue, sales, and store health",
    tab: "dashboard",
  },
  {
    id: "nav-billing",
    category: "navigation",
    title: "POS Billing Terminal",
    subtitle: "In-store point of sale and barcode billing",
    tab: "billing",
  },
  {
    id: "nav-products",
    category: "navigation",
    title: "Product Catalogue",
    subtitle: "Manage inventory, prices, variants, and barcodes",
    tab: "products",
  },
  {
    id: "nav-orders",
    category: "navigation",
    title: "Online Customer Orders",
    subtitle: "Manage customer order fulfillment and statuses",
    tab: "orders",
  },
  {
    id: "nav-customers",
    category: "navigation",
    title: "Customer Directory",
    subtitle: "View customer profiles and POS purchase history",
    tab: "customers",
  },
  {
    id: "nav-coupons",
    category: "navigation",
    title: "Discount Coupons",
    subtitle: "Manage promotional discount codes and limits",
    tab: "coupons",
  },
  {
    id: "nav-inventory",
    category: "navigation",
    title: "Inventory Management",
    subtitle: "Track product stock adjustments and logs",
    tab: "inventory",
  },
  {
    id: "nav-settings",
    category: "navigation",
    title: "Store Settings & Notifications",
    subtitle: "Configure store info and Resend owner alerts",
    tab: "settings",
  },
  {
    id: "nav-admins",
    category: "navigation",
    title: "Admin Access Controls",
    subtitle: "Manage store administrators and permissions",
    tab: "admins",
  },
];

interface AdminGlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string, payload?: string) => void;
}

export function AdminGlobalSearch({ isOpen, onClose, onNavigate }: AdminGlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Fetch admin products
  const { data: products = [] } = useQuery({
    queryKey: ["admin-search-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, slug, price, sku, barcode, stock")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) return [];
      return data ?? [];
    },
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Fetch admin online orders
  const { data: orders = [] } = useQuery({
    queryKey: ["admin-search-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, full_name, email, phone, city, total, status, invoice_no")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return data ?? [];
    },
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Fetch POS offline sales
  const { data: posSales = [] } = useQuery({
    queryKey: ["admin-search-pos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offline_sales")
        .select("id, sale_number, customer_name, customer_phone, total, payment_method, created_at")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) return [];
      return data ?? [];
    },
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Fetch POS customers
  const { data: customers = [] } = useQuery({
    queryKey: ["admin-search-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_customers")
        .select("id, name, phone, email, total_spend, total_purchases")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) return [];
      return data ?? [];
    },
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Filter & match items
  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();

    if (!q) {
      // Return default quick actions when query is empty
      return QUICK_NAV_ACTIONS;
    }

    const matched: SearchResultItem[] = [];

    // 1. Products
    for (const p of products) {
      const matchName = p.name?.toLowerCase().includes(q);
      const matchSku = p.sku?.toLowerCase().includes(q);
      const matchBarcode = p.barcode?.toLowerCase().includes(q);
      const matchSlug = p.slug?.toLowerCase().includes(q);

      if (matchName || matchSku || matchBarcode || matchSlug) {
        matched.push({
          id: `product-${p.id}`,
          category: "products",
          title: p.name,
          subtitle: `SKU: ${p.sku || "N/A"} • Stock: ${p.stock} • Barcode: ${p.barcode || "N/A"}`,
          meta: formatPrice(Number(p.price)),
          tab: "products",
          actionPayload: p.id,
        });
      }
    }

    // 2. Orders
    for (const o of orders) {
      const shortId = o.id.slice(0, 8).toUpperCase();
      const matchId = o.id.toLowerCase().includes(q) || shortId.toLowerCase().includes(q);
      const matchNum = o.order_number?.toLowerCase().includes(q);
      const matchName = o.full_name?.toLowerCase().includes(q);
      const matchEmail = o.email?.toLowerCase().includes(q);
      const matchPhone = o.phone?.toLowerCase().includes(q);
      const matchInv = o.invoice_no?.toLowerCase().includes(q);

      if (matchId || matchNum || matchName || matchEmail || matchPhone || matchInv) {
        matched.push({
          id: `order-${o.id}`,
          category: "orders",
          title: `Order #${shortId} — ${o.full_name || "Guest"}`,
          subtitle: `${o.email || o.phone || "No contact"} • Status: ${o.status.toUpperCase()} ${o.city ? `• ${o.city}` : ""}`,
          meta: formatPrice(Number(o.total)),
          tab: "orders",
          actionPayload: o.id,
        });
      }
    }

    // 3. POS Sales
    for (const s of posSales) {
      const matchSaleNo = s.sale_number?.toLowerCase().includes(q);
      const matchCust = s.customer_name?.toLowerCase().includes(q);
      const matchPhone = s.customer_phone?.toLowerCase().includes(q);

      if (matchSaleNo || matchCust || matchPhone) {
        matched.push({
          id: `pos-${s.id}`,
          category: "pos",
          title: `POS Sale ${s.sale_number} — ${s.customer_name || "Walk-in"}`,
          subtitle: `Payment: ${s.payment_method?.toUpperCase()} • ${s.customer_phone || "In-store"}`,
          meta: formatPrice(Number(s.total)),
          tab: "billing",
          actionPayload: s.id,
        });
      }
    }

    // 4. Customers
    for (const c of customers) {
      const matchName = c.name?.toLowerCase().includes(q);
      const matchPhone = c.phone?.toLowerCase().includes(q);
      const matchEmail = c.email?.toLowerCase().includes(q);

      if (matchName || matchPhone || matchEmail) {
        matched.push({
          id: `customer-${c.id}`,
          category: "customers",
          title: c.name,
          subtitle: `${c.phone || "No phone"} • ${c.email || "No email"} • ${c.total_purchases || 0} purchases`,
          meta: formatPrice(Number(c.total_spend || 0)),
          tab: "customers",
          actionPayload: c.id,
        });
      }
    }

    // 5. Navigation Actions
    for (const act of QUICK_NAV_ACTIONS) {
      if (act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q)) {
        matched.push(act);
      }
    }

    return matched.slice(0, 30);
  }, [query, products, orders, posSales, customers]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Handle keyboard events (ArrowUp, ArrowDown, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelect = (item: SearchResultItem) => {
    onNavigate(item.tab, item.actionPayload);
    onClose();
  };

  if (!isOpen) return null;

  const categoryIcons: Record<string, typeof Package> = {
    products: Package,
    orders: ShoppingCart,
    pos: Receipt,
    customers: Users,
    navigation: Sparkles,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 sm:pt-24 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-border px-4 py-3.5">
          <Search className="size-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search orders, products, SKUs, customers, POS sales..."
            aria-label="Admin global search"
            className="ml-3 w-full bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted transition"
              aria-label="Clear search query"
            >
              <X className="size-4" />
            </button>
          )}
          <kbd className="ml-2 hidden sm:inline-flex items-center rounded border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ESC to close
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 divide-y divide-border/30">
          {results.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-semibold text-foreground">No matches found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try searching for an order number, customer name, product SKU, or barcode.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((item, index) => {
                const IconComponent = categoryIcons[item.category] || Sparkles;
                const isSelected = index === selectedIndex;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left transition-colors ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition ${
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <IconComponent className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-xs font-bold leading-tight ${
                              isSelected ? "text-primary-foreground" : "text-foreground"
                            }`}
                          >
                            {item.title}
                          </p>
                          <p
                            className={`truncate text-[11px] mt-0.5 ${
                              isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                            }`}
                          >
                            {item.subtitle}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pl-3 shrink-0">
                        {item.meta && (
                          <span
                            className={`text-xs font-bold ${
                              isSelected ? "text-primary-foreground" : "text-foreground font-mono"
                            }`}
                          >
                            {item.meta}
                          </span>
                        )}
                        <ArrowRight
                          className={`size-3.5 transition-transform ${
                            isSelected ? "translate-x-0.5 opacity-100" : "opacity-0"
                          }`}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer Hint Bar */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono text-[9px]">
                ↑
              </kbd>{" "}
              <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono text-[9px]">
                ↓
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9px]">
                Enter
              </kbd>{" "}
              Select
            </span>
          </div>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
