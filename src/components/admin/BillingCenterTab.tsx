import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct, type Product, formatPrice } from "@/lib/store";
import { POSTab } from "./POSTab";
import { POSReturnsTab } from "./POSReturnsTab";
import { OfflineAnalyticsTab } from "./OfflineAnalyticsTab";
import { CustomerHistoryPanel } from "./CustomerHistoryPanel";
import { PrintLabelsModal } from "./PrintLabelsModal";
import { useDirectLabelPrint } from "@/lib/label-printer";
import {
  Scan,
  Printer,
  Receipt,
  Users,
  Search,
  CheckSquare,
  Square,
  RotateCcw,
  Settings2,
} from "lucide-react";

type BillingTab = "pos" | "returns" | "labels" | "sales" | "customers";

export function BillingCenterTab({ initialSubTab = "pos" }: { initialSubTab?: BillingTab }) {
  const [activeTab, setActiveTab] = useState<BillingTab>(initialSubTab);

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Header & Sub-navigation */}
      <div className="shrink-0 flex items-center gap-6 border-b border-border px-6 bg-muted/20 pt-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("pos")}
          className={`flex items-center gap-2 pb-4 pt-3 border-b-2 font-semibold text-sm transition-colors shrink-0 cursor-pointer ${
            activeTab === "pos"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Scan className="size-4" /> POS Terminal
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("returns")}
          className={`flex items-center gap-2 pb-4 pt-3 border-b-2 font-semibold text-sm transition-colors shrink-0 cursor-pointer ${
            activeTab === "returns"
              ? "border-rose-600 text-rose-600 dark:text-rose-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <RotateCcw className="size-4" /> Returns
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("labels")}
          className={`flex items-center gap-2 pb-4 pt-3 border-b-2 font-semibold text-sm transition-colors shrink-0 cursor-pointer ${
            activeTab === "labels"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Printer className="size-4" /> Bulk Labels
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sales")}
          className={`flex items-center gap-2 pb-4 pt-3 border-b-2 font-semibold text-sm transition-colors shrink-0 cursor-pointer ${
            activeTab === "sales"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Receipt className="size-4" /> Sales History
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("customers")}
          className={`flex items-center gap-2 pb-4 pt-3 border-b-2 font-semibold text-sm transition-colors shrink-0 cursor-pointer ${
            activeTab === "customers"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="size-4" /> Customers
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 bg-muted/10">
        {activeTab === "pos" && <POSTab />}
        {activeTab === "returns" && <POSReturnsTab />}
        {activeTab === "labels" && <LabelPrintingSubTab />}
        {activeTab === "sales" && (
          <div className="overflow-y-auto h-full pr-2 pb-10">
            <OfflineAnalyticsTab />
          </div>
        )}
        {activeTab === "customers" && (
          <div className="overflow-y-auto h-full pr-2 pb-10">
            <CustomerHistoryPanel />
          </div>
        )}
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
      const { data, error } = await supabase.from("products").select("*").order("sort_order");
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
    <div className="flex flex-col h-full bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products to print..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-2 text-sm outline-none focus:border-[#8B2020] transition-colors shadow-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-500">{selectedIds.size} selected</span>
          <div className="inline-flex rounded-xl border border-border bg-white shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => printLabel(selectedProducts)}
              disabled={selectedIds.size === 0 || isPrinting}
              title="Print selected labels directly (1-Click)"
              className="flex items-center gap-2 bg-[#8B2020] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#7a1c1c] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Printer className="size-4" />
              <span>Print Labels</span>
            </button>
            <button
              type="button"
              onClick={() => setPrintingLabels(true)}
              disabled={selectedIds.size === 0}
              title="Advanced Print (Custom quantities & layouts)"
              className="bg-[#7a1c1c] px-2.5 py-2.5 text-white/90 hover:text-white transition border-l border-white/20 disabled:opacity-50 cursor-pointer"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50/30">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-white text-[11px] font-bold uppercase tracking-wider text-gray-500 sticky top-0 border-b border-gray-200 z-10 shadow-sm">
            <tr>
              <th className="px-5 py-3 w-10 text-center">
                <button onClick={toggleAll} className="text-gray-400 hover:text-gray-700">
                  {selectedIds.size === list.length && list.length > 0 ? (
                    <CheckSquare className="size-4 text-[#8B2020]" />
                  ) : (
                    <Square className="size-4" />
                  )}
                </button>
              </th>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3">SKU / Barcode</th>
              <th className="px-5 py-3">Price</th>
              <th className="px-5 py-3 text-center">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center">
                  <div className="flex justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center text-gray-500">
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
                  className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                    isSelected ? "bg-[#8B2020]/5" : ""
                  }`}
                >
                  <td className="px-5 py-3 text-center">
                    {isSelected ? (
                      <CheckSquare className="size-4 text-[#8B2020] mx-auto" />
                    ) : (
                      <Square className="size-4 text-gray-300 mx-auto" />
                    )}
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
                        <p className="font-semibold text-gray-900 leading-tight">{p.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {p.brand} {p.category && `• ${p.category}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-mono text-xs font-semibold text-gray-900">{p.sku || "—"}</p>
                    <p className="font-mono text-[10px] text-gray-500">{p.barcode || "—"}</p>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {printingLabels && (
        <PrintLabelsModal products={selectedProducts} onClose={() => setPrintingLabels(false)} />
      )}
    </div>
  );
}
