import { useState, useMemo } from "react";
import {
  X,
  Plus,
  Minus,
  Check,
  Layers,
  Package,
  Sparkles,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Product, ProductVariant } from "@/lib/store";

interface QuickVariantStockModalProps {
  product: Product;
  onClose: () => void;
  onSuccess?: () => void;
}

export function QuickVariantStockModal({
  product,
  onClose,
  onSuccess,
}: QuickVariantStockModalProps) {
  const qc = useQueryClient();
  const [variants, setVariants] = useState<ProductVariant[]>(() => {
    return (product.variants || []).map((v) => ({ ...v }));
  });
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const totalStock = useMemo(() => {
    return variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  }, [variants]);

  const handleStockChange = (variantId: string, newStock: number) => {
    const clean = Math.max(0, newStock);
    setVariants((prev) => prev.map((v) => (v.id === variantId ? { ...v, stock: clean } : v)));
  };

  const handleDeleteVariant = (variantId: string) => {
    if (variants.length <= 1) {
      toast.error("A product must maintain at least one variant");
      return;
    }
    setVariants((prev) => prev.filter((v) => v.id !== variantId));
    setDeletedVariantIds((prev) => [...prev, variantId]);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Delete removed variants if any
      if (deletedVariantIds.length > 0) {
        const { error: delErr } = await supabase
          .from("product_variants")
          .delete()
          .in("id", deletedVariantIds);
        if (delErr) throw delErr;
      }

      // 2. Update each remaining variant in product_variants
      const updatePromises = variants.map((v) =>
        supabase
          .from("product_variants")
          .update({ stock: Number(v.stock) || 0 })
          .eq("id", v.id),
      );

      const results = await Promise.all(updatePromises);
      for (const res of results) {
        if (res.error) throw res.error;
      }

      // 3. Update the parent product total stock
      const { error: prodErr } = await supabase
        .from("products")
        .update({ stock: totalStock })
        .eq("id", product.uuid);

      if (prodErr) throw prodErr;

      // 4. Invalidate caches
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-products"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["admin-search-products"] });

      toast.success(
        `Stock updated for ${product.name}: ${totalStock} units across ${variants.length} variant${variants.length === 1 ? "" : "s"}`,
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Failed to update variant stock:", err);
      toast.error(err.message || "Failed to update variant stock");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="variant-modal-title"
        className="relative w-full max-w-lg rounded-3xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 sm:p-6 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="size-12 rounded-xl object-cover border border-border/80 shadow-2xs shrink-0"
              />
            ) : (
              <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Package className="size-6" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="variant-modal-title"
                  className="font-display text-base sm:text-lg font-black text-foreground line-clamp-1"
                >
                  {product.name}
                </h2>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>SKU: {product.sku || "—"}</span>
                <span>•</span>
                <span className="capitalize">{product.category}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="size-8 rounded-full border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Informational Sub-header with Live Total */}
        <div className="px-6 py-3 bg-primary/5 border-b border-primary/15 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Layers className="size-3.5 shrink-0" />
            <span>{variants.length} Distinct Variants</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Total In-Stock:</span>
            <span className="text-sm font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
              {totalStock} units
            </span>
          </div>
        </div>

        {/* Variants List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {variants.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No variants configured for this product.
            </div>
          ) : (
            variants.map((v, idx) => {
              const varStock = Number(v.stock) || 0;
              const hasColor = Boolean(v.color && v.color.trim());
              const hasSize = Boolean(v.size && v.size.trim());

              return (
                <div
                  key={v.id || idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border border-border/80 bg-background hover:border-primary/40 transition-colors shadow-2xs"
                >
                  {/* Variant info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {v.name || `Variant ${idx + 1}`}
                      </span>

                      {hasColor && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted border border-border text-foreground">
                          <span
                            className="size-2 rounded-full border border-black/20"
                            style={{ backgroundColor: v.color?.toLowerCase() || "#ccc" }}
                          />
                          {v.color}
                        </span>
                      )}

                      {hasSize && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-muted border border-border text-muted-foreground uppercase">
                          Size: {v.size}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground font-mono">
                      <span>SKU: {v.sku || "—"}</span>
                      {v.barcode && (
                        <>
                          <span>•</span>
                          <span>Barcode: {v.barcode}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Stock counter input & delete action */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/30 p-1">
                      <button
                        type="button"
                        onClick={() => handleStockChange(v.id, varStock - 1)}
                        disabled={varStock <= 0}
                        title="Decrease stock (-1)"
                        className="size-7 rounded-lg bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-30"
                      >
                        <Minus className="size-3.5" />
                      </button>

                      <input
                        type="number"
                        min="0"
                        value={varStock === 0 ? "" : varStock}
                        placeholder="0"
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : Number(e.target.value);
                          handleStockChange(v.id, val);
                        }}
                        className="w-14 text-center bg-transparent text-xs font-bold text-foreground outline-none py-1"
                        aria-label={`Stock for ${v.name}`}
                      />

                      <button
                        type="button"
                        onClick={() => handleStockChange(v.id, varStock + 1)}
                        title="Increase stock (+1)"
                        className="size-7 rounded-lg bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-1 rounded-lg border uppercase tracking-wider ${
                        varStock === 0
                          ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40"
                          : varStock <= 5
                            ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40"
                      }`}
                    >
                      {varStock === 0 ? "Out" : varStock <= 5 ? "Low" : "In Stock"}
                    </span>

                    {variants.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteVariant(v.id)}
                        title="Delete this variant"
                        className="size-7 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-premium-sm transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            <Check className="size-4" />
            <span>{isSaving ? "Saving..." : `Save Inventory (${totalStock} units)`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
