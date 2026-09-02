/**
 * POS-Returns — Types, queries, mutations, and return discovery helpers
 * for the Offline POS Returns & Exchange System.
 * Supports: Customer Search, Walk-in Product Barcode Historical Lookup, and Invoice/Transaction QR Scanning.
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
  // Link to original historical transaction line item
  original_sale_id?: string | null;
  original_sale_item_id?: string | null;
  original_sale_number?: string | null;
  original_qty?: number;
  already_returned_qty?: number;
  max_returnable_qty?: number;
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
  unit_mrp?: number;
  mrp_snapshot: number;
  original_sale_item_id?: string | null;
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
  created_by?: string;
  owner_notification_status?: string | null;
  owner_notified_at?: string | null;
  credit_token?: string | null;
  credit_balance?: number;
  credit_used?: number;
  original_sale_id?: string | null;
  original_sale_number?: string | null;
  linked_sale_id?: string | null;
  created_at: string;
  updated_at: string;
  offline_return_items?: OfflineReturnItem[];
};

export type ReturnResult = {
  return_id: string;
  return_number: string;
  refund_amount: number;
  refund_method?: string;
  credit_token: string;
  customer_name: string;
  available_credit?: number;
  customer_credit_balance?: number;
  items_count?: number;
  items_restocked?: number;
  original_sale_id?: string | null;
  original_sale_number?: string | null;
  duplicate?: boolean;
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
  original_sale_id?: string | null;
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
    original_sale_item_id?: string | null;
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
/*  Enriched Sale & Return Metrics Types                               */
/* ------------------------------------------------------------------ */

export type OfflineSaleItemWithReturnStatus = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_slug?: string;
  name: string;
  sku: string;
  barcode: string;
  variant_info?: string;
  color?: string;
  size?: string;
  qty: number;
  price: number;
  mrp?: number;
  created_at: string;
  already_returned_qty: number;
  returnable_qty: number;
  is_fully_returned: boolean;
};

export type OfflineSaleWithReturnMetrics = {
  id: string;
  sale_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  customer_id: string | null;
  total: number;
  subtotal: number;
  discount: number;
  tax?: number;
  payment_method: string;
  status: string;
  pos_token_number?: number | null;
  notes?: string;
  created_at: string;
  offline_sale_items: OfflineSaleItemWithReturnStatus[];
  has_returnable_items: boolean;
  total_items_count: number;
  total_returnable_count: number;
};

/* ------------------------------------------------------------------ */
/*  Barcode & QR Code Parser Helper                                   */
/* ------------------------------------------------------------------ */

export type ScanCodeType = "invoice_qr" | "credit_token" | "product_barcode";

export function parseReturnScanCode(raw: string): { type: ScanCodeType; value: string } {
  const trimmed = raw.trim();

  // 1. Invoice Number format (e.g. POS-2609-00012, INV-2026-...)
  if (/^POS-\d{4}-\d+/i.test(trimmed) || /^INV-/i.test(trimmed)) {
    return { type: "invoice_qr", value: trimmed.toUpperCase() };
  }

  // 2. Store Credit Token format (e.g. A123, P258, or legacy ZCR-..., CR-...)
  if (
    /^[A-Z][0-9]{3}$/i.test(trimmed) ||
    /^ZCR-[A-Z0-9]+/i.test(trimmed) ||
    /^CR-[A-Z0-9-]+/i.test(trimmed)
  ) {
    return { type: "credit_token", value: trimmed.toUpperCase() };
  }

  // 3. URL containing invoice query param (e.g. https://.../receipt?invoice=POS-2609-00012)
  if (trimmed.includes("invoice=") || trimmed.includes("sale_number=")) {
    try {
      const url = new URL(trimmed);
      const inv = url.searchParams.get("invoice") || url.searchParams.get("sale_number");
      if (inv) return { type: "invoice_qr", value: inv.toUpperCase() };
    } catch {
      // Not a valid URL, treat as barcode
    }
  }

  // 4. Default to Product Barcode / SKU
  return { type: "product_barcode", value: trimmed };
}

/**
 * Generates snappy 1 Letter + 3 Digits Store Credit Code (e.g. A123, P258)
 */
export function generateStoreCreditCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // excludes confusing I, O
  const letter = chars.charAt(Math.floor(Math.random() * chars.length));
  const num = Math.floor(100 + Math.random() * 900); // 100 to 999
  return `${letter}${num}`;
}

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
/*  Query Hook: Enriched Offline Sales with Return Status              */
/* ------------------------------------------------------------------ */

export function useOfflineSalesForReturnsLookup() {
  return useQuery<OfflineSaleWithReturnMetrics[]>({
    queryKey: ["offline-sales-with-return-metrics"],
    queryFn: async () => {
      // 1. Fetch offline sales with items
      const { data: rawSales, error: salesErr } = await (supabase as any)
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(300);

      if (salesErr || !rawSales) return [];

      // 2. Fetch all return items to calculate already returned quantities
      const { data: rawReturnItems } = await (supabase as any)
        .from("offline_return_items")
        .select("id, return_id, product_id, sku, barcode, qty, original_sale_item_id");

      // Map: original_sale_item_id -> total returned qty
      const returnedQtyByItemId = new Map<string, number>();
      
      ((rawReturnItems || []) as Array<{ original_sale_item_id?: string; qty?: number }>).forEach((ri) => {
        if (ri.original_sale_item_id) {
          const prev = returnedQtyByItemId.get(ri.original_sale_item_id) || 0;
          returnedQtyByItemId.set(ri.original_sale_item_id, prev + (Number(ri.qty) || 1));
        }
      });

      // 3. Enrich sales with item-level returnable calculations
      const enriched: OfflineSaleWithReturnMetrics[] = (rawSales as any[]).map((s) => {
        let totalReturnableCount = 0;
        let totalItemsCount = 0;

        const enrichedItems: OfflineSaleItemWithReturnStatus[] = (s.offline_sale_items || []).map((it: any) => {
          const itemQty = Number(it.qty) || 1;
          totalItemsCount += itemQty;

          const alreadyReturned = returnedQtyByItemId.get(it.id) || 0;
          const returnableQty = Math.max(0, itemQty - alreadyReturned);
          totalReturnableCount += returnableQty;

          return {
            id: it.id,
            sale_id: it.sale_id,
            product_id: it.product_id,
            product_slug: it.product_slug,
            name: it.name || "Item",
            sku: it.sku || "",
            barcode: it.barcode || it.barcode_snapshot || "",
            variant_info: it.variant_info || "",
            color: it.color || "",
            size: it.size || "",
            qty: itemQty,
            price: Number(it.price) || 0,
            mrp: Number(it.mrp) || Number(it.mrp_snapshot) || Number(it.price) || 0,
            created_at: it.created_at || s.created_at,
            already_returned_qty: alreadyReturned,
            returnable_qty: returnableQty,
            is_fully_returned: returnableQty <= 0,
          };
        });

        return {
          id: s.id,
          sale_number: s.sale_number,
          customer_name: s.customer_name || "Walk-in Customer",
          customer_phone: s.customer_phone || "",
          customer_email: s.customer_email || "",
          customer_id: s.customer_id || null,
          total: Number(s.total) || 0,
          subtotal: Number(s.subtotal) || Number(s.total) || 0,
          discount: Number(s.discount) || 0,
          tax: Number(s.tax || 0),
          payment_method: s.payment_method || "cash",
          status: s.status,
          pos_token_number: s.pos_token_number,
          notes: s.notes || "",
          created_at: s.created_at,
          offline_sale_items: enrichedItems,
          has_returnable_items: totalReturnableCount > 0,
          total_items_count: totalItemsCount,
          total_returnable_count: totalReturnableCount,
        };
      });

      return enriched;
    },
    staleTime: 5_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Process Return Mutation Hook                                      */
/* ------------------------------------------------------------------ */

export function useProcessOfflineReturn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProcessReturnInput): Promise<ReturnResult> => {
      // 1. Generate snappy 1 Letter + 3 Digits Store Credit Code (e.g. A123, P258)
      const snappyCreditCode = generateStoreCreditCode();

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
        _refund_method: "exchange_credit",
        _refund_status: input.refund_status,
        _return_reason: input.return_reason,
        _notes: input.notes,
        _items: input.items,
        _idempotency_key: input.idempotency_key,
        _original_sale_id: input.original_sale_id || null,
      });

      if (error) {
        throw new Error(error.message);
      }

      return data as ReturnResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["offline-returns"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-with-return-metrics"] });
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
      qc.invalidateQueries({ queryKey: ["pos-customer-credit"] });
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Customer Store Credit Query Hook                                  */
/* ------------------------------------------------------------------ */

export type CustomerCreditInfo = {
  customer_id: string | null;
  customer_name: string;
  available_credit: number;
  history: Array<{
    id: string;
    type: "CREDIT_ISSUED" | "CREDIT_USED" | "CREDIT_ADJUSTED";
    amount: number;
    balance_before: number;
    balance_after: number;
    credit_token: string;
    notes: string;
    created_at: string;
  }>;
};

export function useCustomerStoreCredit(params: {
  customerId?: string | null;
  phone?: string | null;
  token?: string | null;
}) {
  const { customerId, phone, token } = params;
  const enabled = Boolean(
    customerId ||
      (phone && phone.replace(/\D/g, "").length >= 10) ||
      (token && token.trim().length >= 4),
  );

  return useQuery<CustomerCreditInfo>({
    queryKey: ["pos-customer-credit", customerId, phone, token],
    queryFn: async () => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: CustomerCreditInfo | null; error: { message: string } | null }>
      )("get_customer_store_credit", {
        _customer_id: customerId || null,
        _phone: phone || "",
        _token: token || "",
      });

      if (error) throw new Error(error.message);
      return data || { customer_id: null, customer_name: "Walk-in Customer", available_credit: 0, history: [] };
    },
    enabled,
    staleTime: 5_000,
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
