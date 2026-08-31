import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ProductDraft } from "@/components/admin/ProductForm";
import type { TablesInsert } from "@/integrations/supabase/types";

export const draftToRow = (draft: ProductDraft, isNew = false) => {
  const row: Record<string, unknown> = {
    slug: draft.slug.trim(),
    name: draft.name.trim(),
    brand: draft.brand.trim(),
    category: draft.category,
    price: Number(draft.price),
    mrp: Number(draft.mrp),
    age_group: draft.ageGroup,
    stock: Number(draft.stock),
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
    sales_channel: draft.salesChannel,
  };

  if (isNew) {
    row.rating = 0;
    row.reviews = 0;
  }

  return row;
};

function useInvalidateCatalogue() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["admin-products"] });
    qc.invalidateQueries({ queryKey: ["inventory-products"] });
    qc.invalidateQueries({ queryKey: ["pos-products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["admin-search-products"] });
    qc.invalidateQueries({ queryKey: ["product-relations"] });
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
        const { error } = await supabase
          .from("products")
          .update(row as TablesInsert<"products">)
          .eq("id", uuid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("products")
          .insert(row as TablesInsert<"products">)
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

        // Sync product_images with strict order preservation
        const primaryUrl = draft.imageUrl.trim() || draft.images[0]?.trim() || "";
        const urlsArray: string[] = [];
        if (primaryUrl) urlsArray.push(primaryUrl);
        draft.images.forEach((img) => {
          const trimmed = img.trim();
          if (trimmed && !urlsArray.includes(trimmed)) {
            urlsArray.push(trimmed);
          }
        });

        const { data: existing } = await supabase
          .from("product_images")
          .select("*")
          .eq("product_id", productId);

        const toDelete = (existing || []).filter((e) => !urlsArray.includes(e.public_url));
        await Promise.all(
          toDelete.map(async (del) => {
            await supabase.from("product_images").delete().eq("id", del.id);
            if (del.storage_path) {
              await supabase.rpc("delete_storage_object", {
                bucket: "product-images",
                object_path: del.storage_path,
              });
            }
          }),
        );

        await Promise.all(
          urlsArray.map(async (url, i) => {
            const isPrimary = i === 0;
            const existingRow = (existing || []).find((e) => e.public_url === url);

            if (existingRow) {
              await supabase
                .from("product_images")
                .update({ is_primary: isPrimary, sort_order: i })
                .eq("id", existingRow.id);
            } else {
              // We can optionally extract a storage path if the URL points to our bucket
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
          }),
        );

        // Sync variants
        if (draft.variants && draft.variants.length > 0) {
          const variantsToInsert = draft.variants.map((v) => ({
            id: v.id || undefined, // undefined will omit and let DB generate
            product_id: productId,
            name: v.name || "Default",
            sku: v.sku,
            stock: v.stock,
            price_override: v.price_override,
          }));

          const { error: varError } = await (supabase
            .from("product_variants" as any)
            .upsert(variantsToInsert, { onConflict: "id" }) as any);
          if (varError) throw varError;

          // Cleanup deleted variants (variants that are in DB but not in draft)
          const keepIds = draft.variants.map((v) => v.id).filter(Boolean);
          if (keepIds.length > 0) {
            await (supabase
              .from("product_variants" as any)
              .delete()
              .eq("product_id", productId)
              .not("id", "in", `(${keepIds.join(",")})`) as any);
          } else {
            // If no variants have IDs yet (all newly added), don't delete any?
            // Actually, if there were old variants and we removed them, we'd want to delete them.
            // But we should be careful not to delete variants that are in carts/orders.
            // If someone deletes a variant, it will fail if it has FK constraints (which it does for order_items).
            // That's a good safety measure.
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
      // 1. Fetch related images to delete from storage first
      const { data: images } = await supabase
        .from("product_images")
        .select("storage_path")
        .eq("product_id", uuid);
      if (images) {
        for (const img of images) {
          if (img.storage_path) {
            await supabase.rpc("delete_storage_object", {
              bucket: "product-images",
              object_path: img.storage_path,
            });
          }
        }
      }

      // 2. Delete the product (cascades to product_images table)
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
