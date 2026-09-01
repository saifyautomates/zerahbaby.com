/**
 * POS-Returns — Types, queries, and mutations for the offline returns system.
 * Handles barcode resolution (with historical price lookup), atomic return processing,
 * inventory restock, and receipt data structures.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ReturnCartItem = {
  product_id: string | null;
  product_slug: string;
  name: string;
  sku: string;
  barcode: string;
  image_url: string | null;
  current_price: number;
  recent_sold_price?: number | null;
  refund_price: number;
  mrp: number;
  current_stock: number;
  variant_info: string;
  qty: number;
};

export type OfflineReturnItem = {
  id: string;
  return_id: string;
  product_id: string | null;
  product_slug: string;
  name: string;
  sku: string;
  barcode: string;
  variant_info: string;
  refund_price: number;
  qty: number;
  subtotal: number;
  mrp_snapshot: number;
  created_at: string;
};

export type OfflineReturn = {
  id: string;
  return_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_id: string | null;
  refund_amount: number;
  refund_method: string;
  refund_status: string;
  return_reason: string;
  notes: string;
  status: string;
  created_by: string;
  owner_notification_status?: string | null;
  owner_notified_at?: string | null;
  created_at: string;
  updated_at: string;
  offline_return_items?: OfflineReturnItem[];
};

export type ReturnResult = {
  return_id: string;
  return_number: string;
  refund_amount: number;
  refund_method: string;
  customer_name: string;
  items_count: number;
  duplicate: boolean;
};

export type ProcessReturnInput = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_id: string | null;
  refund_method: string;
  refund_status: string;
  return_reason: string;
  notes: string;
  items: Array<{
    product_id: string | null;
    product_slug: string;
    name: string;
    sku: string;
    barcode: string;
    variant_info: string;
    refund_price: number;
    qty: number;
    mrp: number;
  }>;
  idempotency_key: string;
};

export const RETURN_REASONS = [
  "Customer changed mind",
  "Wrong size / fit",
  "Wrong product selected",
  "Damaged product",
  "Defective / manufacturing fault",
  "Fabric / quality issue",
  "Gift return",
  "Other",
] as const;

/* ------------------------------------------------------------------ */
/*  Barcode / Product Lookup for Returns                              */
/* ------------------------------------------------------------------ */

export type ReturnProductLookupResult = {
  found: boolean;
  error?: string;
  product_id?: string;
  product_slug?: string;
  name?: string;
  sku?: string;
  barcode?: string;
  image_url?: string | null;
  current_price?: number;
  recent_sold_price?: number | null;
  mrp?: number;
  stock?: number;
  variant_info?: string;
};

export async function lookupProductForReturn(code: string): Promise<ReturnProductLookupResult> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { found: false, error: "Empty barcode" };
  }

  // 1. Try resolving through products table (by barcode, sku, slug, or id)
  const { data: barcodeProduct, error: prodErr } = await supabase
    .from("products")
    .select(
      "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
    )
    .eq("barcode", trimmed)
    .maybeSingle();

  let product = barcodeProduct;

  if (!product && !prodErr) {
    const { data: skuProduct } = await supabase
      .from("products")
      .select(
        "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
      )
      .eq("sku", trimmed)
      .maybeSingle();
    product = skuProduct;
  }

  if (!product && !prodErr) {
    const { data: slugProduct } = await supabase
      .from("products")
      .select(
        "id, slug, name, price, mrp, stock, sku, barcode, is_active, age_group, product_images(public_url, is_primary, sort_order)",
      )
      .eq("slug", trimmed)
      .maybeSingle();
    product = slugProduct;
  }

  if (!product) {
    return { found: false, error: `Product not found for barcode '${trimmed}'` };
  }

  // 2. Check recent offline sales history for historical sold price
  let recentSoldPrice: number | null = null;
  try {
    const { data: recentSaleItem } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string | number,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => {
                  maybeSingle: () => Promise<{
                    data: { price: number; created_at: string } | null;
                    error: unknown;
                  }>;
                };
              };
            };
          };
        };
      }
    )
      .from("offline_sale_items")
      .select("price, created_at")
      .eq("product_id", product.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentSaleItem && typeof recentSaleItem.price === "number") {
      recentSoldPrice = recentSaleItem.price;
    }
  } catch {
    // Non-fatal, fallback to active current_price
  }

  const currentPrice = Number(product.price || 0);
  const mrp = Number(product.mrp || currentPrice);
  const refundPrice = recentSoldPrice ?? currentPrice;

  return {
    found: true,
    product_id: product.id,
    product_slug: product.slug,
    name: product.name,
    sku: product.sku || "",
    barcode: product.barcode || trimmed,
    image_url:
      (product as { product_images?: { public_url: string }[] }).product_images?.[0]?.public_url ||
      null,
    current_price: currentPrice,
    recent_sold_price: recentSoldPrice,
    mrp: mrp,
    stock: Number(product.stock || 0),
    variant_info: product.age_group || "",
  };
}

/* ------------------------------------------------------------------ */
/*  Process Return Mutation Hook                                      */
/* ------------------------------------------------------------------ */

export function useProcessOfflineReturn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProcessReturnInput): Promise<ReturnResult> => {
      // 1. Call atomic database RPC function
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: ReturnResult; error: { message: string } | null }>
      )("process_offline_return", {
        _customer_name: input.customer_name,
        _customer_phone: input.customer_phone,
        _customer_email: input.customer_email,
        _customer_id: input.customer_id,
        _refund_method: input.refund_method,
        _refund_status: input.refund_status,
        _return_reason: input.return_reason,
        _notes: input.notes,
        _items: input.items,
        _idempotency_key: input.idempotency_key,
      });

      if (error) {
        throw new Error(error.message);
      }

      const result = data as ReturnResult;

      // 2. Dispatch internal owner email notification via Webhook (Database will handle this)

      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offline-returns"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-for-returns-history-lookup"] });
      qc.invalidateQueries({ queryKey: ["offline-analytics"] });
      qc.invalidateQueries({ queryKey: ["offline-analytics-timeseries"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["admin-products-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-transactions"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product"] });
      qc.invalidateQueries({ queryKey: ["pos-products"] });
      qc.invalidateQueries({ queryKey: ["admin-search-products"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Offline Returns List Query Hook                                    */
/* ------------------------------------------------------------------ */

export function useOfflineReturnsList() {
  return useQuery<OfflineReturn[]>({
    queryKey: ["offline-returns"],
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (n: number) => Promise<{
                  data: OfflineReturn[] | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .from("offline_returns")
        .select("*, offline_return_items(*)")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return (data ?? []) as unknown as OfflineReturn[];
    },
  });
}
