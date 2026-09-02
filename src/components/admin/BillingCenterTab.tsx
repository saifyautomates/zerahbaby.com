import { useState, useMemo, useEffect, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct, type Product, formatPrice } from "@/lib/store";
import { POSTab } from "./POSTab";
import { POSReturnsTab } from "./POSReturnsTab";
import { OfflineAnalyticsTab } from "./OfflineAnalyticsTab";
import { CustomerHistoryPanel } from "./CustomerHistoryPanel";
import { useDirectLabelPrint } from "@/lib/label-printer";
import { initGlobalBarcodeScanner, hasPendingScans } from "@/lib/barcode-scanner";
import {
  Scan,
  Printer,
  Receipt,
  Users,
  Search,
  CheckSquare,
  Square,
  RotateCcw,
} from "lucide-react";

import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";

type BillingTab = "pos" | "returns" | "labels" | "sales" | "customers";

export function BillingCenterTab({ initialSubTab = "pos" }: { initialSubTab?: BillingTab }) {
  const [activeTab, setActiveTabState] = useState<BillingTab>(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      let sub = urlParams.get("subtab") as string | null;
      if (sub === "terminal") sub = "pos";
      if (sub === "analytics" || sub === "history") sub = "sales";
      if (sub && ["pos", "returns", "labels", "sales", "customers"].includes(sub))
        return sub as BillingTab;
      let saved = localStorage.getItem("zerah_admin_active_subtab") as string | null;
      if (saved === "terminal") saved = "pos";
      if (saved === "analytics" || saved === "history") saved = "sales";
      if (saved && ["pos", "returns", "labels", "sales", "customers"].includes(saved))
        return saved as BillingTab;
    }
    return initialSubTab;
  });

  const setActiveTab = (tab: BillingTab) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      localStorage.setItem("zerah_admin_active_subtab", tab);
      const url = new URL(window.location.href);
      url.searchParams.set("subtab", tab);
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Global hardware barcode scanner logic:
  // When in Returns tab, DO NOT switch to POS! Returns has its own dedicated return scanner!
  useEffect(() => {
    if (activeTab === "returns") {
      return;
    }

    if (hasPendingScans() && activeTab !== "pos") {
      setActiveTab("pos");
    }

    const unbind = initGlobalBarcodeScanner((_code) => {
      if (activeTab !== "pos") {
        setActiveTab("pos");
      }
    });
    return unbind;
  }, [activeTab]);

  return (
    <div className="flex flex-col min-h-full bg-card rounded-2xl border border-border shadow-sm">
      {/* Header & Sub-navigation — World-Class Segmented Bar */}
      <div className="shrink-0 flex items-center justify-between border-b border-border/80 px-4 sm:px-6 py-3 bg-muted/30">
        <div className="flex items-center gap-1.5 p-1 bg-background rounded-xl border border-border/60 shadow-2xs overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab("pos")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeTab === "pos"
                ? "bg-primary text-primary-foreground shadow-premium-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Scan className="size-4" /> POS Terminal
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("returns")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeTab === "returns"
                ? "bg-rose-600 text-white shadow-premium-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <RotateCcw className="size-4" /> Returns
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("labels")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeTab === "labels"
                ? "bg-primary text-primary-foreground shadow-premium-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Printer className="size-4" /> 1-Click Labels
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sales")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeTab === "sales"
                ? "bg-primary text-primary-foreground shadow-premium-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Receipt className="size-4" /> Sales History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("customers")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all shrink-0 cursor-pointer ${
              activeTab === "customers"
                ? "bg-primary text-primary-foreground shadow-premium-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Users className="size-4" /> Customers
          </button>
        </div>
      </div>

      {/* Content Area — Natural smooth scrollable layout */}
      <div className="flex-1 flex flex-col p-4 sm:p-6 bg-muted/10">
        <div
          key={activeTab}
          className="flex-1 animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col"
        >
          <ComponentErrorBoundary fallbackTitle="Sub-tab Loading Exception">
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground animate-pulse font-medium text-sm">
                  Loading module...
                </div>
              }
            >
              {activeTab === "pos" && <POSTab />}
              {activeTab === "returns" && <POSReturnsTab />}
              {activeTab === "labels" && <LabelPrintingSubTab />}
              {activeTab === "sales" && <OfflineAnalyticsTab />}
              {activeTab === "customers" && <CustomerHistoryPanel />}
            </Suspense>
          </ComponentErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function LabelPrintingSubTab() {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [printingLabels, setPrintingLabels] = useState(false);
  const { printLabel, isPrinting } = useDirectLabelPrint();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, product_images(public_url, is_primary, sort_order)")
        .order("sort_order");
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  const list = useMemo(
    () =>
      products.filter((p) =>
        (p.name + p.brand + p.category + p.sku + (p.barcode || ""))
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [products, search],
  );

  const toggleAll = () => {
    if (selectedIds.size === list.length && list.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(list.map((p) => p.uuid)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectedProducts = useMemo(() => {
    return products.filter((p) => selectedIds.has(p.uuid));
  }, [products, selectedIds]);

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden shadow-sm">
      <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-card">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products to print..."
            className="w-full rounded-xl border border-border bg-muted pl-9 pr-4 py-2 text-sm outline-none focus:border-[#8B2020] transition-colors shadow-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground underline cursor-pointer"
            >
              Clear selection
            </button>
          )}
          <span
            className={`text-sm font-bold px-3 py-1 rounded-full border transition-all ${
              selectedIds.size > 0
                ? "bg-[#8B2020]/10 text-[#8B2020] border-[#8B2020]/30"
                : "text-muted-foreground border-transparent"
            }`}
          >
            ✓ {selectedIds.size} of {list.length} selected
          </span>
          <button
            type="button"
            onClick={() => printLabel(selectedProducts)}
            disabled={selectedIds.size === 0 || isPrinting}
            title="Instant 1-Click Direct Automatic Print"
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-premium-sm transition-all duration-300 hover:bg-primary/90 hover:shadow-premium-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Printer className="size-4" />
            <span>
              {isPrinting
                ? "Printing…"
                : `Print ${selectedIds.size > 1 ? `${selectedIds.size} Labels` : "Selected"}`}
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-muted/30">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground sticky top-0 border-b border-border z-10 shadow-xs">
            <tr>
              <th className="px-4 py-3.5 w-14 text-center">
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === list.length && list.length > 0}
                    onChange={toggleAll}
                    aria-label="Select all products"
                    className="size-4.5 rounded cursor-pointer accent-[#8B2020]"
                  />
                </div>
              </th>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3">SKU / Barcode</th>
              <th className="px-5 py-3">Price</th>
              <th className="px-5 py-3 text-center">Stock</th>
              <th className="px-5 py-3 text-right">Quick Print</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <div className="flex justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">
                  No products found.
                </td>
              </tr>
            )}
            {list.map((p) => {
              const isSelected = selectedIds.has(p.uuid);
              return (
                <tr
                  key={p.uuid}
                  onClick={() => toggleOne(p.uuid)}
                  className={`cursor-pointer transition-all ${
                    isSelected
                      ? "bg-[#8B2020]/10 border-l-4 border-l-[#8B2020] font-medium"
                      : "hover:bg-muted/70"
                  }`}
                >
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(p.uuid)}
                        className="size-5 rounded cursor-pointer accent-[#8B2020]"
                      />
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={p.image}
                        alt=""
                        loading="lazy"
                        className="size-10 rounded-lg border border-gray-100 object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0";
                        }}
                      />
                      <div>
                        <p className="font-semibold text-foreground leading-tight">{p.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.brand} {p.category && `• ${p.category}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-mono text-xs font-semibold text-foreground">
                      {p.sku || "—"}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {p.barcode || "—"}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-semibold">{formatPrice(p.price)}</p>
                    {p.mrp > p.price && (
                      <p className="text-[10px] text-gray-400 line-through">{formatPrice(p.mrp)}</p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        p.stock === 0
                          ? "bg-red-50 text-red-600 border border-red-100"
                          : p.stock <= 5
                            ? "bg-amber-50 text-amber-600 border border-amber-100"
                            : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      }`}
                    >
                      {p.stock === 0 ? "OOS" : p.stock}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        printLabel(p);
                      }}
                      disabled={isPrinting}
                      title={`1-Click Instant Print for ${p.name}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary hover:text-primary-foreground px-3 py-1.5 text-xs font-bold text-primary transition-all shadow-2xs cursor-pointer disabled:opacity-50"
                    >
                      <Printer className="size-3.5" />
                      <span>Print</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
