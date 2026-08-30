import { useState, useMemo, useRef, Suspense, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mapProduct, formatPrice, imageFor, type Product } from "@/lib/store";
import { useDirectLabelPrint } from "@/lib/label-printer";
import type { Database } from "@/integrations/supabase/types";
import { ProductForm, type ProductDraft } from "@/components/admin/ProductForm";
import { PrintLabelsModal } from "@/components/admin/PrintLabelsModal";
import { BulkImportTab } from "@/components/admin/BulkImportTab";
import {
  Printer,
  Trash2,
  Plus,
  Upload,
  Download,
  Package,
  GripVertical,
  Settings2,
  Shield,
  Settings,
  AlertTriangle,
  FileText,
  Store,
  ChevronRight,
  Edit3,
  Image as ImageIcon,
  Archive,
  ExternalLink,
  RefreshCw,
  Check,
  Truck,
  X,
  Pencil,
} from "lucide-react";

export function OnlyOfflineTab() {
  const qc = useQueryClient();
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [printingLabels, setPrintingLabels] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived" | "low_stock">(
    "all",
  );
  const { printLabel, isPrinting } = useDirectLabelPrint();

  // Selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [deleteAllConfirmInput, setDeleteAllConfirmInput] = useState("");

  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-offline-products"],
    queryFn: async () => {
      const [productsRes, costsRes, settingsRes] = await Promise.all([
        supabase
          .from("products")
          .select("*, product_images(public_url, is_primary, sort_order)")
          .eq("sales_channel", "OFFLINE_ONLY")
          .order("sort_order"),
        supabase.from("product_costs").select("product_id, buying_price"),
        supabase
          .from("site_settings")
          .select("value")
          .eq("key", "product_delivery_fees")
          .maybeSingle(),
      ]);

      if (productsRes.error) throw productsRes.error;

      const costMap = new Map((costsRes.data || []).map((c) => [c.product_id, c.buying_price]));
      let deliveryFees: Record<string, number> = {};
      if (settingsRes.data?.value) {
        try {
          deliveryFees = JSON.parse(settingsRes.data.value);
        } catch {
          deliveryFees = {};
        }
      }

      return (productsRes.data || []).map((r) => {
        const prod = mapProduct(r as never);
        prod.buyingPrice = costMap.get(prod.uuid) || 0;
        if (deliveryFees[prod.uuid] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.uuid];
        } else if (deliveryFees[prod.id] !== undefined) {
          prod.deliveryFee = deliveryFees[prod.id];
        }
        return prod;
      });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-offline-products"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["inventory-products"] });
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["admin-search-products"] });
    qc.invalidateQueries({ queryKey: ["product-relations"] });
  };

  const setDeliveryFeeQuick = useMutation({
    mutationFn: async ({ uuid, slug, fee }: { uuid: string; slug: string; fee: number }) => {
      const { data: currentSettings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle();
      let feeMap: Record<string, number> = {};
      if (currentSettings?.value) {
        try {
          feeMap = JSON.parse(currentSettings.value);
        } catch {
          feeMap = {};
        }
      }
      feeMap[uuid] = fee;
      feeMap[slug] = fee;
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
          { onConflict: "key" },
        );
      if (error) throw error;
    },
    onSuccess: (_, { fee }) => {
      toast.success(`Delivery fee updated to ${fee === 0 ? "Free (₹0)" : `₹${fee}`}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDeliveryFeeBulk = useMutation({
    mutationFn: async ({ ids, fee }: { ids: string[]; fee: number }) => {
      const { data: currentSettings } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "product_delivery_fees")
        .maybeSingle();
      let feeMap: Record<string, number> = {};
      if (currentSettings?.value) {
        try {
          feeMap = JSON.parse(currentSettings.value);
        } catch {
          feeMap = {};
        }
      }
      ids.forEach((id) => {
        feeMap[id] = fee;
        const prod = (data || []).find((p) => p.uuid === id || p.id === id);
        if (prod) {
          feeMap[prod.uuid] = fee;
          feeMap[prod.id] = fee;
        }
      });
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
          { onConflict: "key" },
        );
      if (error) throw error;
    },
    onSuccess: (_, { fee }) => {
      toast.success(
        `Delivery fee set to ${fee === 0 ? "Free (₹0)" : `₹${fee}`} for selected products`,
      );
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
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
      };

      if (!uuid) {
        row.rating = 0;
        row.reviews = 0;
      }

      const hasStockChanged = uuid ? Number(draft.stock) !== editing?.stock : true;
      if (hasStockChanged) {
        row.stock = Number(draft.stock);
      }

      // Save product
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

      // Save cost
      if (productId) {
        const { error: costError } = await supabase
          .from("product_costs")
          .upsert({ product_id: productId, buying_price: draft.buyingPrice });
        if (costError) throw costError;

        // Sync product_images
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
          if (del.storage_path) {
            await supabase.rpc("delete_storage_object", {
              bucket: "product-images",
              object_path: del.storage_path,
            });
          }
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
            let storagePath = "";
            if (url.includes("product-images/")) {
              storagePath = url.split("product-images/")[1];
            }
            await supabase.from("product_images").insert({
              product_id: productId,
              public_url: url,
              storage_path: storagePath,
              alt_text: draft.name,
              is_primary: isPrimary,
              sort_order: i,
            });
          }
        }

        // Sync delivery fee setting
        if (draft.deliveryFee !== undefined) {
          const { data: currentSettings } = await supabase
            .from("site_settings")
            .select("value")
            .eq("key", "product_delivery_fees")
            .maybeSingle();
          let feeMap: Record<string, number> = {};
          if (currentSettings?.value) {
            try {
              feeMap = JSON.parse(currentSettings.value);
            } catch {
              feeMap = {};
            }
          }
          feeMap[productId] = draft.deliveryFee;
          feeMap[draft.slug] = draft.deliveryFee;
          await supabase
            .from("site_settings")
            .upsert(
              { key: "product_delivery_fees", value: JSON.stringify(feeMap) },
              { onConflict: "key" },
            );
        }

        // Sync Product Relations
        if (draft.relatedProductIds) {
          const { error: relError } = await supabase.rpc("sync_product_relations", {
            p_product_id: productId,
            p_related_ids: draft.relatedProductIds,
          });
          if (relError) throw relError;
        }
      }
    },
    onSuccess: () => {
      toast.success("Product saved");
      setEditing(null);
      setCreating(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Archive (set is_active=false)
  const archive = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").update({ is_active: false }).eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product archived (hidden from store)");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Hard-delete single product
  const remove = useMutation({
    mutationFn: async (uuid: string) => {
      // Try atomic RPC first
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; deleted?: number; archived?: number } | null;
          error: unknown;
        }>
      )("admin_delete_products", {
        _product_ids: [uuid],
      });

      if (!rpcErr && rpcRes) {
        return rpcRes;
      }

      // Fallback
      const { error } = await supabase.from("products").delete().eq("id", uuid);
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      toast.success("Product deleted successfully");
      invalidate();
    },
    onError: (e: Error) => {
      if (e.message.includes("historical transactions")) {
        toast.error("Cannot delete — product has sales history. Archiving instead.", {
          duration: 5000,
        });
      } else {
        toast.error(e.message);
      }
    },
  });

  // Restore archived product
  const restore = useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").update({ is_active: true }).eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product restored and visible in store");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Batch delete selected products
  const deleteSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return { success: true, deleted: 0, archived: 0 };
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { success?: boolean; deleted?: number; archived?: number } | null;
          error: unknown;
        }>
      )("admin_delete_products", {
        _product_ids: ids,
      });

      if (rpcErr) {
        // Fallback: delete client-side in chunks
        for (const id of ids) {
          await supabase.from("product_images").delete().eq("product_id", id);
          await supabase.from("product_costs").delete().eq("product_id", id);
          await supabase.from("products").delete().eq("id", id);
        }
        return { success: true, deleted: ids.length, archived: 0 };
      }
      return rpcRes;
    },
    onSuccess: (res: { deleted?: number; archived?: number } | null) => {
      const deleted = res?.deleted ?? selectedIds.size;
      const archived = res?.archived ?? 0;
      let msg = `Deleted ${deleted} product${deleted !== 1 ? "s" : ""}`;
      if (archived > 0) {
        msg += ` (${archived} archived due to sales history)`;
      }
      toast.success(msg);
      setSelectedIds(new Set());
      setShowDeleteSelectedModal(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(`Failed to delete selected products: ${e.message}`),
  });

  // Delete all products
  const deleteAll = useMutation({
    mutationFn: async () => {
      const { data: rpcRes, error: rpcErr } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: { deleted?: number; archived?: number; count?: number } | null;
          error: unknown;
        }>
      )("admin_delete_all_products", {
        _force: true,
      });

      if (rpcErr) {
        // Fallback: delete all in batches
        const allIds = (data ?? []).map((p) => p.uuid);
        for (const id of allIds) {
          await supabase.from("product_images").delete().eq("product_id", id);
          await supabase.from("product_costs").delete().eq("product_id", id);
          await supabase.from("products").delete().eq("id", id);
        }
        return { success: true, count: allIds.length, archived: 0 };
      }
      return rpcRes;
    },
    onSuccess: (res: { deleted?: number; count?: number } | null) => {
      const count = res?.deleted ?? data?.length ?? 0;
      toast.success(`All ${count} products deleted successfully`);
      setSelectedIds(new Set());
      setShowDeleteAllModal(false);
      setDeleteAllConfirmInput("");
      invalidate();
    },
    onError: (e: Error) => toast.error(`Failed to delete all products: ${e.message}`),
  });

  // Batch Archive Selected
  const archiveSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ is_active: false }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Archived ${selectedIds.size} product(s)`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Batch Restore Selected
  const restoreSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ is_active: true }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Restored ${selectedIds.size} product(s) to store`);
      setSelectedIds(new Set());
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Batch Set Stock to 10
  const setStockTenSelected = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("products").update({ stock: 10 }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Set stock to 10 for ${selectedIds.size} product(s)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = useMemo(() => {
    return (data ?? []).filter((p) => {
      const matchesSearch = (p.name + p.brand + p.category + p.id + p.sku + p.barcode)
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesCat = categoryFilter === "all" || p.category === categoryFilter;

      let matchesStatus = true;
      if (statusFilter === "active") matchesStatus = p.isActive;
      else if (statusFilter === "archived") matchesStatus = !p.isActive;
      else if (statusFilter === "low_stock") matchesStatus = p.stock <= p.lowStockAt;

      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [data, search, categoryFilter, statusFilter]);

  // Handle header checkbox indeterminate state
  const isAllSelected = list.length > 0 && list.every((p) => selectedIds.has(p.uuid));
  const isSomeSelected = list.some((p) => selectedIds.has(p.uuid)) && !isAllSelected;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSet = new Set(selectedIds);
      list.forEach((p) => newSet.add(p.uuid));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      list.forEach((p) => newSet.delete(p.uuid));
      setSelectedIds(newSet);
    }
  };

  const toggleSelectProduct = (uuid: string, e?: React.MouseEvent) => {
    const newSet = new Set(selectedIds);

    // Shift-click range selection
    if (e?.shiftKey && lastSelectedId && lastSelectedId !== uuid) {
      const currentIndex = list.findIndex((p) => p.uuid === uuid);
      const lastIndex = list.findIndex((p) => p.uuid === lastSelectedId);

      if (currentIndex !== -1 && lastIndex !== -1) {
        const start = Math.min(currentIndex, lastIndex);
        const end = Math.max(currentIndex, lastIndex);
        const shouldSelect = !selectedIds.has(uuid);

        for (let i = start; i <= end; i++) {
          if (shouldSelect) {
            newSet.add(list[i].uuid);
          } else {
            newSet.delete(list[i].uuid);
          }
        }
        setSelectedIds(newSet);
        setLastSelectedId(uuid);
        return;
      }
    }

    if (newSet.has(uuid)) {
      newSet.delete(uuid);
    } else {
      newSet.add(uuid);
    }
    setSelectedIds(newSet);
    setLastSelectedId(uuid);
  };

  const selectedProducts = useMemo(
    () => (data ?? []).filter((p) => selectedIds.has(p.uuid)),
    [data, selectedIds],
  );

  if (showBulkImport) {
    return (
      <Suspense
        fallback={
          <div className="p-8 text-center text-muted-foreground animate-pulse">
            Loading bulk import…
          </div>
        }
      >
        <BulkImportTab onBack={() => setShowBulkImport(false)} />
      </Suspense>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top action & search bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-72 max-w-xs">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products, SKU, barcode…"
              aria-label="Search products"
              className="w-full rounded-xl border border-border bg-card px-4 py-2 pl-9 text-sm text-foreground outline-none focus:border-border focus:ring-4 focus:ring-muted transition-all shadow-xs"
            />
            <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">🔍</span>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-border transition-all shadow-xs cursor-pointer"
          >
            <option value="all">All Categories</option>
            <option value="clothing">Clothing & Fashion</option>
            <option value="toys">Toys & Games</option>
            <option value="care">Nursery & Care</option>
            <option value="gear">Travel Gear & Strollers</option>
            <option value="feeding">Feeding & Nursing</option>
            <option value="diapering">Diapering & Potty</option>
            <option value="bath">Bath & Healthcare</option>
            <option value="footwear">Footwear & Shoes</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | "active" | "archived" | "low_stock")
            }
            className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-border transition-all shadow-xs cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Live Only</option>
            <option value="archived">Archived Only</option>
            <option value="low_stock">Low Stock (≤3)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Delete All Products Button */}
          <button
            onClick={() => setShowDeleteAllModal(true)}
            disabled={!data || data.length === 0}
            title="Delete all products from store catalog"
            className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-bold text-red-700 shadow-2xs transition hover:bg-red-100 hover:text-red-800 active:scale-95 cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
            <span>Delete All</span>
          </button>

          {/* Print Labels Dropdown */}
          <div className="inline-flex rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
            <button
              onClick={() => printLabel(selectedIds.size > 0 ? selectedProducts : list)}
              disabled={
                isPrinting ||
                (selectedIds.size > 0 ? selectedProducts.length === 0 : list.length === 0)
              }
              title={
                selectedIds.size > 0
                  ? `Print labels for ${selectedIds.size} selected`
                  : "Print labels directly for visible products (1-Click)"
              }
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer disabled:opacity-50"
            >
              <Printer className="size-3.5 text-muted-foreground" />
              <span>
                {selectedIds.size > 0 ? `Print Selected (${selectedIds.size})` : "Print Labels"}
              </span>
            </button>
            <button
              onClick={() => setPrintingLabels(true)}
              title="Advanced Print (Custom quantities, layout, discounts)"
              className="px-2.5 py-2 text-xs border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>

          {/* Bulk Import button */}
          <button
            onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2 text-xs font-bold text-primary shadow-xs transition hover:bg-primary/10 active:scale-95 cursor-pointer"
            title="Import or update products in bulk from a CSV or Excel file"
          >
            <Upload className="size-3.5" /> Bulk Import
          </button>

          {/* Add product button */}
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl bg-[#8B2020] px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#7a1c1c] active:scale-95 cursor-pointer"
          >
            <Plus className="size-4" /> Add product
          </button>
        </div>
      </div>

      {/* Floating / Sticky Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-4 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-card p-3 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5 pl-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-[#8B2020] text-[11px] font-bold text-white">
              {selectedIds.size}
            </span>
            <p className="text-xs font-bold text-foreground">
              {selectedIds.size} of {data?.length ?? 0} products selected
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Print labels for selected */}
            <button
              onClick={() => printLabel(selectedProducts)}
              disabled={isPrinting}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition cursor-pointer"
            >
              <Printer className="size-3.5" />
              <span>Print Labels</span>
            </button>

            {/* Set stock to 10 */}
            <button
              onClick={() => setStockTenSelected.mutate(Array.from(selectedIds))}
              disabled={setStockTenSelected.isPending}
              title="Quickly set stock to 10 for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition cursor-pointer"
            >
              <Check className="size-3.5" />
              <span>Set Stock to 10</span>
            </button>

            {/* Set delivery to Free (₹0) */}
            <button
              onClick={() => setDeliveryFeeBulk.mutate({ ids: Array.from(selectedIds), fee: 0 })}
              disabled={setDeliveryFeeBulk.isPending}
              title="Set Delivery to Free (₹0) for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition cursor-pointer"
            >
              <Truck className="size-3.5" />
              <span>Free Delivery (₹0)</span>
            </button>

            {/* Set delivery to ₹79 */}
            <button
              onClick={() => setDeliveryFeeBulk.mutate({ ids: Array.from(selectedIds), fee: 79 })}
              disabled={setDeliveryFeeBulk.isPending}
              title="Set Delivery to ₹79 for all selected products"
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition cursor-pointer"
            >
              <Truck className="size-3.5 text-muted-foreground" />
              <span>Set Delivery ₹79</span>
            </button>

            {/* Archive selected */}
            <button
              onClick={() => archiveSelected.mutate(Array.from(selectedIds))}
              disabled={archiveSelected.isPending}
              className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-2xs hover:bg-amber-100 transition cursor-pointer"
            >
              <Archive className="size-3.5" />
              <span>Archive</span>
            </button>

            {/* Restore selected */}
            <button
              onClick={() => restoreSelected.mutate(Array.from(selectedIds))}
              disabled={restoreSelected.isPending}
              className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-2xs hover:bg-blue-100 transition cursor-pointer"
            >
              <Package className="size-3.5" />
              <span>Restore</span>
            </button>

            {/* Delete Selected (Custom deletion) */}
            <button
              onClick={() => setShowDeleteSelectedModal(true)}
              className="flex items-center gap-1.5 rounded-xl bg-destructive px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700 transition cursor-pointer"
            >
              <Trash2 className="size-3.5" />
              <span>Delete Selected ({selectedIds.size})</span>
            </button>

            {/* Clear Selection */}
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="Clear selection"
              className="rounded-xl border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#8B2020] border-t-transparent"></div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-muted text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
              <tr>
                <th className="w-10 px-4 py-4">
                  <div className="flex items-center">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      aria-label="Select all products"
                      className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                    />
                  </div>
                </th>
                <th className="px-5 py-4">Product</th>
                <th className="px-5 py-4">Category</th>
                <th className="px-5 py-4">SKU / Barcode</th>
                <th className="px-5 py-4">Pricing & Profit</th>
                <th className="px-5 py-4">Delivery</th>
                <th className="px-5 py-4">Stock</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {list.map((p) => {
                const isSelected = selectedIds.has(p.uuid);
                return (
                  <tr
                    key={p.uuid}
                    className={`group transition-colors ${
                      isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/50"
                    } ${!p.isActive ? "opacity-60" : ""}`}
                  >
                    <td className="w-10 px-4 py-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => toggleSelectProduct(p.uuid, e)}
                          onChange={() => {}} // handled in onClick for shift-key support
                          aria-label={`Select ${p.name}`}
                          className="size-4 rounded border-border text-[#8B2020] focus:ring-[#8B2020] cursor-pointer"
                        />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3.5">
                        <Link
                          to="/product/$id"
                          params={{ id: p.id || p.uuid }}
                          className="relative group/thumb block size-12 shrink-0 overflow-hidden rounded-xl border border-border/80 bg-muted/40 shadow-2xs transition-transform hover:scale-105"
                          title="Open product on storefront (new tab)"
                        >
                          <img
                            src={p.image}
                            alt={p.name}
                            loading="lazy"
                            width={48}
                            height={48}
                            className="size-full object-cover transition-opacity duration-200"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = imageFor(p.category, null, p);
                            }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/thumb:opacity-100 text-white">
                            <ExternalLink className="size-3.5" />
                          </span>
                        </Link>
                        <div className="max-w-[280px]">
                          <Link
                            to="/product/$id"
                            params={{ id: p.id || p.uuid }}
                            className="font-semibold text-foreground line-clamp-1 hover:text-primary transition-colors flex items-center gap-1 group/name"
                            title={`Open ${p.name} on storefront`}
                          >
                            <span>{p.name}</span>
                            <ExternalLink className="size-3 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                          </Link>
                          <p className="text-xs font-medium text-muted-foreground mt-0.5">
                            {p.brand} <span className="opacity-50">•</span> {p.id}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-foreground">
                        {p.category}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-mono text-xs font-semibold text-foreground">{p.sku}</p>
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {p.barcode}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-between min-w-[120px]">
                        <div>
                          <p className="font-semibold text-foreground" title="Selling Price">
                            {formatPrice(p.price)}
                          </p>
                          <p
                            className="text-[10px] text-muted-foreground mt-0.5"
                            title="Buying Price"
                          >
                            Cost: {formatPrice(p.buyingPrice || 0)}
                          </p>
                        </div>
                        <div className="text-right pl-3">
                          <p
                            className={`text-xs font-bold ${
                              p.price - (p.buyingPrice || 0) < 0
                                ? "text-destructive"
                                : "text-emerald-600"
                            }`}
                          >
                            {formatPrice(Math.abs(p.price - (p.buyingPrice || 0)))}
                          </p>
                          <p
                            className={`text-[10px] font-medium ${
                              p.price - (p.buyingPrice || 0) < 0
                                ? "text-destructive"
                                : "text-emerald-500"
                            }`}
                          >
                            {p.buyingPrice
                              ? (((p.price - p.buyingPrice) / p.buyingPrice) * 100).toFixed(1)
                              : p.price > 0
                                ? "100.0"
                                : "0.0"}
                            %
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => {
                          const newFee = (p.deliveryFee ?? 79) === 0 ? 79 : 0;
                          setDeliveryFeeQuick.mutate({ uuid: p.uuid, slug: p.id, fee: newFee });
                        }}
                        disabled={setDeliveryFeeQuick.isPending}
                        title="Click to toggle between Free (₹0) and ₹79"
                        className="inline-flex items-center gap-1.5 transition hover:scale-105 cursor-pointer"
                      >
                        {(p.deliveryFee ?? 79) === 0 ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs">
                            <Truck className="size-3" /> Free (₹0)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-foreground bg-muted border border-border px-2.5 py-1 rounded-full text-xs font-bold shadow-2xs">
                            <Truck className="size-3 text-muted-foreground" /> ₹
                            {p.deliveryFee ?? 79}
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          p.stock === 0
                            ? "bg-red-50 text-red-600 border border-red-100"
                            : p.stock <= p.lowStockAt
                              ? "bg-amber-50 text-amber-600 border border-amber-100"
                              : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        }`}
                      >
                        {p.stock === 0 ? "Out of stock" : `${p.stock} in stock`}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          p.isActive
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-muted text-muted-foreground border border-border"
                        }`}
                      >
                        {p.isActive ? "Live" : "Archived"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={() => printLabel(p)}
                          disabled={isPrinting}
                          aria-label={`Print label for ${p.name}`}
                          title="Print Label (1-Click Direct Print)"
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-2xs transition-all hover:border-[#8B2020] hover:text-[#8B2020] hover:bg-red-50/50 cursor-pointer disabled:opacity-50"
                        >
                          <Printer className="size-4" />
                        </button>
                        <button
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                          title="Edit"
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-border hover:text-foreground hover:bg-muted"
                        >
                          <Pencil className="size-4" />
                        </button>
                        {!p.isActive ? (
                          <button
                            onClick={() => restore.mutate(p.uuid)}
                            aria-label={`Restore ${p.name}`}
                            title="Restore to store"
                            className="rounded-lg border border-emerald-200 bg-card p-2 text-emerald-600 shadow-sm transition-all hover:border-emerald-300 hover:bg-emerald-50"
                          >
                            <Package className="size-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Archive "${p.name}"? It will be hidden from the store but kept in records.`,
                                )
                              )
                                archive.mutate(p.uuid);
                            }}
                            aria-label={`Archive ${p.name}`}
                            title="Archive (hide from store)"
                            className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-amber-200 hover:text-amber-700 hover:bg-amber-50"
                          >
                            <Package className="size-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                `Permanently delete "${p.name}"? This cannot be undone.\n\nNote: Products with sales history cannot be deleted.`,
                              )
                            )
                              remove.mutate(p.uuid);
                          }}
                          aria-label={`Delete ${p.name}`}
                          title="Delete permanently"
                          className="rounded-lg border border-border bg-card p-2 text-muted-foreground shadow-sm transition-all hover:border-red-200 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-16 text-center text-sm font-medium text-muted-foreground"
                  >
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Selected Confirmation Modal */}
      {showDeleteSelectedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">
                  Delete {selectedIds.size} Selected Products
                </h3>
                <p className="text-xs text-muted-foreground">Confirm custom product removal</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete these{" "}
              <strong className="text-foreground">{selectedIds.size}</strong> selected products?
            </p>
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
              <strong>Notice:</strong> Any product with previous sales transactions will be
              automatically <em>archived</em> instead of permanently removed to preserve invoice and
              financial audit records.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeleteSelectedModal(false)}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSelected.mutate(Array.from(selectedIds))}
                disabled={deleteSelected.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>
                  {deleteSelected.isPending ? "Deleting..." : `Delete ${selectedIds.size} Products`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Products Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-destructive/10">
                <AlertTriangle className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Delete All Products</h3>
                <p className="text-xs text-muted-foreground">Permanent catalog purge</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              This will permanently delete all{" "}
              <strong className="text-foreground">{data?.length ?? 0} products</strong> currently in
              the store catalog.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Type <span className="font-mono font-bold text-foreground">DELETE ALL</span> to
                confirm:
              </label>
              <input
                value={deleteAllConfirmInput}
                onChange={(e) => setDeleteAllConfirmInput(e.target.value)}
                placeholder="DELETE ALL"
                className="w-full rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-sm font-mono text-foreground outline-none focus:border-destructive"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setDeleteAllConfirmInput("");
                }}
                className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAll.mutate()}
                disabled={deleteAll.isPending || deleteAllConfirmInput !== "DELETE ALL"}
                className="flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-xs font-bold text-white hover:bg-red-700 transition cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                <span>{deleteAll.isPending ? "Purging..." : "Confirm Delete All"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <Suspense
          fallback={
            <div className="p-12 text-center text-muted-foreground animate-pulse border bg-card rounded-2xl shadow-xl">
              Loading product editor...
            </div>
          }
        >
          <ProductForm
            product={editing}
            saving={save.isPending}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSave={(draft) => save.mutate(editing ? { draft, uuid: editing.uuid } : { draft })}
          />
        </Suspense>
      )}

      {printingLabels && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-background p-8 rounded-xl animate-pulse">Loading printer...</div>
            </div>
          }
        >
          <PrintLabelsModal products={data ?? []} onClose={() => setPrintingLabels(false)} />
        </Suspense>
      )}
    </div>
  );
}

// Imported at the top

/* ---------------- Settings ---------------- */

const SETTING_LABELS: Record<string, string> = {
  brand_name: "Brand name",
  hero_title: "Home hero title",
  hero_subtitle: "Home hero subtitle",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  store_address: "Store address",
  store_hours: "Opening hours",
  maps_url: "Google Maps link",
  owner_notification_email: "Owner Sale Alert Email (Recipient)",
  owner_notify_offline_sales: "Enable Offline POS Sale Alerts (true/false)",
  owner_notify_online_sales: "Enable Online Order Alerts (true/false)",
  // The feature toggles won't be rendered in the text list, so they don't strictly need labels here, but good for completeness
  feature_hover_swap: "Hover Image Swap",
  feature_promo_badges: "Floating Promo Badges",
  feature_size_guide: "Size Guide Drawer",
  feature_image_magnifier: "Image Magnifier (Zoom)",
  feature_urgency_badges: "Urgency & Social Proof Badges",
  feature_swatches: "Interactive Visual Swatches",
  feature_sticky_cart: "Sticky 'Add to Cart' Bar",
  urgency_dispatch_cutoff_hour: "Dispatch Cutoff Hour",
};

const SETTING_DESCRIPTIONS: Record<string, string> = {
  brand_name: "Yahan se website ka main naam (logo text) aur footer text change hoga.",
  hero_title: "Homepage par aane wala sabse bada main title yahan se change hota hai.",
  hero_subtitle:
    "Homepage ke main title ke theek niche wala chhota text (subtitle) yahan se badle.",
  contact_email: "Website ke footer aur contact page me dikhne wala aapka Email ID.",
  contact_phone: "Website ke footer aur contact page me dikhne wala Phone/Mobile number.",
  store_address: "Website ke footer aur contact page me dikhne wala dukan ka pata (address).",
  store_hours: "Dukaan khulne aur band hone ka samay (yeh Footer me dikhta hai).",
  maps_url: "Footer me location icon par click karne se jo Google Maps open hoga, uska link.",
};
const DEFAULT_SETTINGS: Record<string, string> = {
  brand_name: "Zerah Baby And Kid's",
  announcement: "Free delivery on orders above ₹999 · Easy 7-day returns",
  hero_title: "Everything little ones need, in one happy place",
  hero_subtitle:
    "Gentle clothing, safe toys, trusted nursery care and travel gear — handpicked for babies and kids.",
  contact_email: "hello@zerahkids.com",
  contact_phone: "9057074777, 9667571712",
  store_address:
    "80 Feet Link Rd, near Bajot Restaurant, Atwal Nagar, Gordhanpura, Kota, Rajasthan 324001, India",
  store_hours: "Open daily · 10:30 AM – 10:00 PM",
  maps_url: "https://maps.app.goo.gl/2MpZr9HmLrxVpZbQA",
  instagram_url: "https://www.instagram.com/zerah_kids/",
  facebook_url: "",
  whatsapp_url: "",
  feature_hover_swap: "true",
  feature_promo_badges: "true",
  feature_size_guide: "true",
  feature_image_magnifier: "true",
  feature_urgency_badges: "true",
  feature_swatches: "true",
  feature_sticky_cart: "true",
  urgency_dispatch_cutoff_hour: "14",
};

function SettingsTab() {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("key, value")
        .order("key");
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, string>;
    },
  });

  const current = useMemo(() => {
    return { ...DEFAULT_SETTINGS, ...(data ?? {}), ...(values ?? {}) };
  }, [data, values]);

  const save = useMutation({
    mutationFn: async () => {
      const fullMerged = { ...current };
      if (fullMerged.announcement !== undefined) {
        fullMerged.announcement_enabled = fullMerged.announcement.trim() ? "true" : "false";
      }
      const rows = Object.entries(fullMerged).map(([key, value]) => ({ key, value }));
      const { error } = await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All store settings saved & published successfully!");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save settings"),
  });

  async function onSendTestNotification() {
    setTestingEmail(true);
    try {
      const targetEmail =
        current.owner_notification_email || current.contact_email || "hello@zerahkids.com";
      const { data, error } = await supabase.functions.invoke("send-owner-sale-notification", {
        body: { type: "test", recipient: targetEmail },
      });
      if (error) throw error;
      if (data && !data.success && data.error) {
        throw new Error(data.error);
      }
      toast.success(`Test email sent to ${targetEmail}!`);
    } catch (err: unknown) {
      toast.error(`Test email failed: ${(err as Error).message}`);
    } finally {
      setTestingEmail(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      {/* ─── SALE NOTIFICATIONS CARD ──────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground">
              Owner Sale Notifications
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Receive automatic email alerts on every offline POS sale &amp; online paid order via
              Resend.
            </p>
          </div>
          <button
            type="button"
            onClick={onSendTestNotification}
            disabled={testingEmail}
            className="inline-flex items-center justify-center rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50 cursor-pointer"
          >
            {testingEmail ? "Sending Test…" : "Send Test Email"}
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipient Email Address
            </span>
            <input
              type="email"
              value={current.owner_notification_email ?? ""}
              onChange={(e) => setValues({ ...current, owner_notification_email: e.target.value })}
              placeholder="e.g. owner@zerahkids.com"
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <span className="text-sm font-medium text-foreground">Offline POS Sale Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_offline_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_offline_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-border bg-muted/20 p-3.5 cursor-pointer hover:bg-muted/40 transition">
              <span className="text-sm font-medium text-foreground">Online Paid Order Alerts</span>
              <input
                type="checkbox"
                checked={current.owner_notify_online_sales !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    owner_notify_online_sales: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>

      {/* ─── MAINTENANCE MODE ─────────────────────────────────── */}
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-destructive">Maintenance Mode</h3>
            <p className="text-xs text-muted-foreground">
              When enabled, the entire storefront is blocked with a friendly maintenance screen.
              (Admins can still access the site).
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center ml-4 shrink-0">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={current.maintenance_mode === "true"}
              onChange={(e) =>
                setValues({
                  ...current,
                  maintenance_mode: e.target.checked ? "true" : "false",
                })
              }
            />
            <div className="peer h-7 w-12 rounded-full bg-muted border border-border after:absolute after:left-[2px] after:top-[2px] after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow-md after:transition-all after:content-[''] peer-checked:bg-destructive peer-checked:after:translate-x-5 peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-destructive"></div>
          </label>
        </div>
      </div>

      {/* ─── PREMIUM STORE FEATURES ───────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="border-b border-border pb-4">
          <h3 className="font-display text-lg font-bold text-foreground">
            Storefront Interactive Features
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Turn advanced storefront features ON or OFF globally with instant live effect.
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            {
              key: "feature_hover_swap",
              label: "Hover Image Swap",
              desc: "Swap to 2nd image on hover (Product Card)",
            },
            {
              key: "feature_promo_badges",
              label: "Floating Promo Badges",
              desc: "Show 'BUY 3 @1199' & '% OFF' tags",
            },
            {
              key: "feature_size_guide",
              label: "Size Guide Drawer",
              desc: "Slide-out measurement chart on product pages",
            },
            {
              key: "feature_image_magnifier",
              label: "Image Magnifier",
              desc: "Native hover-zoom on main product images",
            },
            {
              key: "feature_urgency_badges",
              label: "Urgency Badges",
              desc: "Live viewer count, low stock tags & dispatch timer",
            },
            {
              key: "feature_swatches",
              label: "Visual Swatches",
              desc: "'More in this style' interactive circles",
            },
            {
              key: "feature_sticky_cart",
              label: "Sticky Cart Bar",
              desc: "Persistent Add to Bag bar on scroll",
            },
          ].map((feat) => (
            <label
              key={feat.key}
              className="flex items-center justify-between rounded-2xl border border-border bg-muted/10 p-4 cursor-pointer hover:bg-muted/20 transition"
            >
              <div>
                <span className="block text-sm font-bold text-foreground">{feat.label}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{feat.desc}</span>
              </div>
              <input
                type="checkbox"
                checked={current[feat.key] !== "false"}
                onChange={(e) =>
                  setValues({
                    ...current,
                    [feat.key]: e.target.checked ? "true" : "false",
                  })
                }
                className="size-4 accent-primary ml-4 shrink-0 cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-border">
          <label className="block max-w-sm space-y-1.5">
            <span className="text-sm font-bold text-foreground">
              Dispatch Cutoff Hour (Same-Day Dispatch Timer)
            </span>
            <p className="text-xs text-muted-foreground">
              What hour (24h format, e.g. 14 = 2:00 PM) does same-day order dispatch close?
            </p>
            <input
              type="number"
              min="0"
              max="23"
              value={current.urgency_dispatch_cutoff_hour ?? "14"}
              onChange={(e) =>
                setValues({ ...current, urgency_dispatch_cutoff_hour: e.target.value })
              }
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-primary shadow-2xs"
            />
          </label>
        </div>
      </div>

      {/* ─── GENERAL STORE SETTINGS & TEXT CONTROL ───────────────────────────── */}
      <div className="rounded-3xl border border-border bg-card p-6 shadow-sm space-y-6">
        <div className="border-b border-border pb-4">
          <h3 className="font-display text-lg font-bold text-foreground">
            Storefront Text &amp; Branding Content
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Update the textual branding and details across your storefront. All updates sync in real
            time.
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-6">
            {Object.keys(SETTING_LABELS)
              .filter(
                (k) =>
                  !k.startsWith("owner_") && !k.startsWith("feature_") && !k.startsWith("urgency_"),
              )
              .map((key) => (
                <div
                  key={key}
                  className="space-y-2 border-b border-border/40 pb-5 last:border-0 last:pb-0"
                >
                  <label className="block space-y-1">
                    <span className="text-sm font-bold text-foreground">
                      {SETTING_LABELS[key] ?? key}
                    </span>
                    {SETTING_DESCRIPTIONS[key] && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-bold text-primary/80">
                          Kya change hoga? (Effect):
                        </span>{" "}
                        {SETTING_DESCRIPTIONS[key]}
                      </p>
                    )}
                    <textarea
                      rows={key.includes("subtitle") || key === "announcement" ? 2 : 1}
                      value={
                        current[key] !== undefined ? current[key] : (DEFAULT_SETTINGS[key] ?? "")
                      }
                      onChange={(e) => setValues({ ...current, [key]: e.target.value })}
                      className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-2xs"
                    />
                  </label>
                </div>
              ))}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:opacity-90 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {save.isPending ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Saving All Settings...
              </>
            ) : (
              <>
                <Check className="size-4" /> Save &amp; Publish All Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Admins ---------------- */

function AdminsTab({ currentEmail }: { currentEmail: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-list"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admins");
      if (error) throw error;
      return data ?? [];
    },
  });

  const grant = useMutation({
    mutationFn: async (value: string) => {
      const { data, error } = await supabase.rpc("grant_admin_by_email", { _email: value });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (result) => {
      toast.success(
        result === "granted"
          ? "Admin access granted"
          : "Added to the admin list â€” they become admin the next time they sign in",
      );
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await supabase.rpc("revoke_admin_by_email", { _email: value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Admin access removed");
      qc.invalidateQueries({ queryKey: ["admin-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-2xl border border-border p-5">
        <h2 className="font-display text-lg font-bold">Give admin access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add someone by email. If they already have an account they become an admin right away,
          otherwise access is applied when they sign in with that email.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@email.com"
            aria-label="Email to make admin"
            className="min-w-56 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={() => grant.mutate(email)}
            disabled={!email.includes("@") || grant.isPending}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {grant.isPending ? "Addingâ€¦" : "Make admin"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((row) => (
              <tr key={row.email} className="border-t border-border">
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      row.status === "active"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {row.status === "active" ? "Active admin" : "Invited"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {row.email.toLowerCase() === currentEmail.toLowerCase() ? (
                    <span className="text-xs text-muted-foreground">You</span>
                  ) : (
                    <button
                      onClick={() => {
                        if (window.confirm(`Remove admin access for ${row.email}?`))
                          revoke.mutate(row.email);
                      }}
                      className="rounded-lg border border-border p-2 text-destructive hover:bg-muted"
                      aria-label={`Remove admin ${row.email}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && (data ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                  No admins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
    </div>
  );
}

/* ---------------- Customers ---------------- */
