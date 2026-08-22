//
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ProductDraft } from "@/components/admin/ProductForm";

export const draftToRow = (draft: ProductDraft) => ({
  slug: draft.slug.trim(),
  name: draft.name.trim(),
  brand: draft.brand.trim(),
  category: draft.category,
  price: Number(draft.price),
  mrp: Number(draft.mrp),
  rating: Number(draft.rating),
  reviews: Number(draft.reviews),
  age_group: draft.ageGroup,
  image_url: (draft.imageUrl.trim() || draft.images[0]) ?? null,
  images: draft.images,
  stock: Number(draft.stock),
  low_stock_at: Number(draft.lowStockAt),
  sku: draft.sku.trim(),
  description: draft.description,
  highlights: draft.highlights
    .split("\n")
    .map((h) => h.trim())
    .filter(Boolean),
  is_featured: draft.isFeatured,
  is_active: draft.isActive,
  sort_order: Number(draft.sortOrder),
});

function useInvalidateCatalogue() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
}

/** Create/update a product — used by the admin panel and by inline site editing. */
export function useSaveProduct() {
  const invalidate = useInvalidateCatalogue();
  return useMutation({
    mutationFn: async ({ draft, uuid }: { draft: ProductDraft; uuid?: string }) => {
      const row = draftToRow(draft);

      // Save product
      let productId = uuid;
      if (uuid) {
        const { error } = await supabase.from("products").update(row).eq("id", uuid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("products").insert(row).select("id").single();
        if (error) throw error;
        productId = data.id;
      }

      // Save cost
      if (productId) {
        const { error: costError } = await supabase
          .from("product_costs")
          .upsert({ product_id: productId, buying_price: draft.buyingPrice });
        if (costError) throw costError;
      }
    },
    onSuccess: () => {
      toast.success("Saved to the live store");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalogue();
  return useMutation({
    mutationFn: async (uuid: string) => {
      const { error } = await supabase.from("products").delete().eq("id", uuid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Product removed from the store");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Inline edit of any site_settings value (hero text, announcement, contact info…). */
export function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key, value }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Website text updated");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
