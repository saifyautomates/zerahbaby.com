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

        // Sync product_images with color association and order preservation
        const incomingImages =
          draft.productImages && draft.productImages.length > 0
            ? draft.productImages
            : draft.images.map((url, idx) => ({
                public_url: url.trim(),
                is_primary: idx === 0,
                sort_order: idx,
                color: null,
                alt_text: draft.name,
              }));

        const primaryUrl = draft.imageUrl?.trim() || incomingImages[0]?.public_url?.trim() || "";
        const processedImages: {
          public_url: string;
          is_primary: boolean;
          sort_order: number;
          color?: string | null;
          alt_text?: string | null;
        }[] = [];

        incomingImages.forEach((img, i) => {
          const url = img.public_url.trim();
          if (url && !processedImages.some((p) => p.public_url === url)) {
            processedImages.push({
              public_url: url,
              is_primary: primaryUrl === url || (i === 0 && !primaryUrl),
              sort_order: i,
              color: img.color ? img.color.trim() : null,
              alt_text: img.alt_text || draft.name,
            });
          }
        });

        const urlsArray = processedImages.map((p) => p.public_url);

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
          processedImages.map(async (img, i) => {
            const existingRow = (existing || []).find((e) => e.public_url === img.public_url);

            if (existingRow) {
              await (supabase
                .from("product_images" as any)
                .update({
                  is_primary: img.is_primary,
                  sort_order: i,
                  color: img.color ?? null,
                  alt_text: img.alt_text ?? draft.name,
                })
                .eq("id", existingRow.id) as any);
            } else {
              let storagePath = "";
              if (img.public_url.includes("product-images/")) {
                storagePath = img.public_url.split("product-images/")[1];
              }
              await (supabase.from("product_images" as any).insert({
                product_id: productId,
                public_url: img.public_url,
                storage_path: storagePath,
                alt_text: img.alt_text || draft.name,
                is_primary: img.is_primary,
                sort_order: i,
                color: img.color ?? null,
              }) as any);
            }
          }),
        );

        // Sync variants (with color, size, barcode, mrp_override, image_url)
        if (draft.variants && draft.variants.length > 0) {
          const variantsToInsert = draft.variants.map((v) => {
            // Build descriptive name if color / size present
            let variantName = v.name;
            if (v.color && v.size) {
              variantName = `${v.color} / ${v.size}`;
            } else if (v.color) {
              variantName = v.color;
            } else if (v.size) {
              variantName = v.size;
            }

            return {
              id: v.id || undefined,
              product_id: productId,
              name: variantName || "Default",
              color: v.color ? v.color.trim() : null,
              size: v.size ? v.size.trim() : null,
              sku: v.sku ? v.sku.trim() : draft.sku,
              barcode: v.barcode ? v.barcode.trim() : null,
              stock: Number(v.stock) || 0,
              price_override: v.price_override,
              mrp_override: v.mrp_override ?? null,
              image_url: v.image_url ?? null,
            };
          });

          const { error: varError } = await (supabase
            .from("product_variants" as any)
            .upsert(variantsToInsert, { onConflict: "id" }) as any);
          if (varError) throw varError;

          // Cleanup deleted variants
          const keepIds = draft.variants.map((v) => v.id).filter(Boolean);
          if (keepIds.length > 0) {
            await (supabase
              .from("product_variants" as any)
              .delete()
              .eq("product_id", productId)
              .not("id", "in", `(${keepIds.join(",")})`) as any);
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
