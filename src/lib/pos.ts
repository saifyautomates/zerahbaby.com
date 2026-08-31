/**
 * POS-specific hooks and helpers for the offline sales system.
 * Handles barcode lookup, offline sale placement, POS customer management,
 * and offline sale history.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type POSCartItem = {
  product_id: string;
  variant_id: string;
  slug: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  stock: number;
  sku: string;
  barcode: string;
  image_url: string | null;
  age_group: string;
  qty: number;
  isCustom?: boolean;
};

export type POSCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  total_purchases: number;
  total_spend: number;
  created_at: string;
  updated_at: string;
};

export type OfflineSale = {
  id: string;
  sale_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  payment_method: string;
  status: string;
  notes: string;
  customer_id: string | null;
  created_by: string;
  owner_notification_status?: string | null;
  owner_notified_at?: string | null;
  pos_token_number: number | null;
  pos_token_date: string | null;
  created_at: string;
  updated_at: string;
  offline_sale_items?: OfflineSaleItem[];
};

export type OfflineSaleItem = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_slug: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
  subtotal: number;
  variant_info: string;
  mrp_snapshot: number;
  barcode_snapshot: string;
};

export type SaleResult = {
  sale_id: string;
  sale_number: string;
  total: number;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  payment_method: string;
  customer_name: string;
  customer_phone?: string;
  items_count: number;
  duplicate: boolean;
  pos_token_number: number | null;
  pos_token_date: string | null;
};

/* ------------------------------------------------------------------ */
/*  Barcode Lookup                                                     */
/* ------------------------------------------------------------------ */

export type BarcodeResult = {
  found: boolean;
  archived?: boolean;
  error?: string;
  product_id?: string;
  variant_id?: string;
  slug?: string;
  name?: string;
  brand?: string;
  category?: string;
  price?: number;
  mrp?: number;
  stock?: number;
  sku?: string;
  barcode?: string;
  image_url?: string | null;
  age_group?: string;
  description?: string;
};

import {
  findOfflineProductByCode,
  queueOfflineSale,
  getNextOfflineToken,
  getTodayISTDateString,
  processOfflineSyncQueue,
} from "@/lib/offline-sync-engine";

export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const clean = code.trim();
  if (!clean) return { found: false };

  // Try online RPC first if online
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: BarcodeResult; error: { message: string } | null }>
      )("lookup_barcode", {
        _code: clean,
      });
      if (!error && data?.found) {
        return data as BarcodeResult;
      }
    } catch (netErr) {
      console.warn("[pos] Online lookup failed, falling back to local catalog:", netErr);
    }
  }

  // Fallback to local offline catalog
  const localMatch = await findOfflineProductByCode(clean);
  if (localMatch) {
    const vMatch = localMatch.matchedVariant as any;
    return {
      found: true,
      product_id: (localMatch.uuid as string) || (localMatch.id as string),
      variant_id: vMatch?.id,
      slug: (localMatch.slug as string) || (localMatch.id as string),
      name:
        (localMatch.name as string) ||
        "" + (vMatch && vMatch.name !== "Default" ? ` - ${vMatch.name}` : ""),
      brand: (localMatch.brand as string) || "Zérah Baby & Kids",
      category: (localMatch.category as string) || "clothing",
      price: vMatch?.priceOverride ?? (Number(localMatch.price) || 0),
      mrp: Number(localMatch.mrp) || Number(localMatch.price) || 0,
      stock: vMatch?.stock ?? (Number(localMatch.stock) || 10),
      sku: vMatch?.sku || (localMatch.sku as string) || "",
      barcode: (localMatch.barcode as string) || clean,
      image_url: (localMatch.imageUrl as string) || (localMatch.image_url as string) || null,
      age_group: (localMatch.ageGroup as string) || (localMatch.age_group as string) || "",
      description: (localMatch.description as string) || "",
    };
  }

  return { found: false, error: "Product not found in online or offline database" };
}

/* ------------------------------------------------------------------ */
/*  Place Offline Sale                                                 */
/* ------------------------------------------------------------------ */

export type PlaceSaleInput = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  payment_method: string;
  notes: string;
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  customer_id: string | null;
  items: Array<{
    product_id?: string;
    variant_id: string;
    product_slug?: string;
    name?: string;
    sku?: string;
    qty: number;
    custom_price?: number;
    price?: number;
  }>;
  idempotency_key: string;
};

export function usePlaceOfflineSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlaceSaleInput): Promise<SaleResult> => {
      const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;

      if (isOnline) {
        try {
          const { data, error } = await (
            supabase.rpc as unknown as (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ data: SaleResult; error: { message: string } | null }>
          )("place_offline_sale", {
            _customer_name: input.customer_name || "Walk-in Customer",
            _customer_phone: input.customer_phone || "",
            _customer_email: input.customer_email || "",
            _payment_method: input.payment_method || "cash",
            _notes: input.notes || "",
            _discount: 0, // legacy param
            _discount_type: input.discount_type || "none",
            _discount_value: input.discount_value || 0,
            _customer_id: input.customer_id || null,
            _items: input.items,
            _idempotency_key: input.idempotency_key || null,
          });

          if (!error && data) {
            const result = {
              ...(data as SaleResult),
              customer_phone: input.customer_phone || "",
            };

            // Asynchronously trigger owner sale notification email and transactional SMS
            if (result.sale_id && !result.duplicate) {
              supabase.functions
                .invoke("send-owner-sale-notification", {
                  body: { type: "offline_sale", sale_id: result.sale_id },
                })
                .catch((err) => {
                  console.warn("[pos] Owner sale notification trigger error:", err);
                });

              supabase.functions
                .invoke("msg91-transactional", {
                  body: {
                    offline_sale_id: result.sale_id,
                    event_type: "offline_pos_sale",
                    phone: input.customer_phone || undefined,
                    name: input.customer_name || "Customer",
                    total: result.total,
                    payment_method: input.payment_method || "cash",
                    sale_number: result.sale_number,
                    notify_owner: true,
                  },
                })
                .catch((err) => {
                  console.warn("[pos] Transactional SMS trigger error:", err);
                });
            }

            return result;
          }
        } catch (onlineErr) {
          console.warn("[pos] Online sale placement error, routing to offline queue:", onlineErr);
        }
      }

      // Offline resilience fallback
      const token = await getNextOfflineToken();
      const operationId = `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const saleNumber = `POS-OFF-${Date.now().toString().slice(-6)}`;
      const subtotal = input.items.reduce(
        (sum, item) => sum + (item.custom_price || item.price || 0) * item.qty,
        0,
      );
      const discount = calculateDiscount(subtotal, input.discount_type, input.discount_value);
      const total = Math.max(0, subtotal - discount);

      await queueOfflineSale({
        id: operationId,
        operation_id: operationId,
        idempotency_key: input.idempotency_key,
        customer_name: input.customer_name || "Walk-in Customer",
        customer_phone: input.customer_phone || "",
        customer_email: input.customer_email || "",
        payment_method: input.payment_method || "cash",
        notes: input.notes || "",
        discount_type: input.discount_type || "none",
        discount_value: input.discount_value || 0,
        customer_id: input.customer_id,
        items: input.items,
        total,
        subtotal,
        discount,
        token_number: token.number,
        token_date: token.date,
        sale_number: saleNumber,
        created_at: new Date().toISOString(),
      });

      toast.info("Offline sale recorded locally. Will sync automatically when online.");

      // Background try to sync
      if (typeof navigator !== "undefined" && navigator.onLine) {
        processOfflineSyncQueue().catch(() => null);
      }

      return {
        sale_id: operationId,
        sale_number: saleNumber,
        total,
        subtotal,
        discount,
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        payment_method: input.payment_method || "cash",
        customer_name: input.customer_name || "Walk-in Customer",
        customer_phone: input.customer_phone || "",
        items_count: input.items.reduce((s, i) => s + i.qty, 0),
        duplicate: false,
        pos_token_number: token.number,
        pos_token_date: token.date,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
  });
}

export function useSearchPOSCustomers() {
  return useMutation({
    mutationFn: async (query: string): Promise<POSCustomer[]> => {
      if (!query.trim()) return [];
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: POSCustomer[] | null; error: unknown }>
      )("search_pos_customers", {
        _query: query.trim(),
      });
      if (error) return [];
      return (data ?? []) as POSCustomer[];
    },
  });
}

export function useCreatePOSCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (customer: {
      name: string;
      phone: string;
      email?: string;
    }): Promise<POSCustomer> => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (r: Record<string, unknown>) => {
              select: () => {
                single: () => Promise<{
                  data: POSCustomer | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        }
      )
        .from("pos_customers")
        .insert({
          name: customer.name.trim(),
          phone: customer.phone.trim(),
          email: customer.email?.trim() || "",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as POSCustomer;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Offline Sale History                                                */
/* ------------------------------------------------------------------ */

export function useOfflineSaleHistory() {
  return useQuery({
    queryKey: ["offline-sales"],
    queryFn: async (): Promise<OfflineSale[]> => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (q: string) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: OfflineSale[] | null; error: unknown }>;
            };
          };
        }
      )
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfflineSale[];
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Generate a unique idempotency key for double-submit prevention */
export function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/** Calculate discount amount from type and value */
export function calculateDiscount(
  subtotal: number,
  discountType: "none" | "percentage" | "fixed",
  discountValue: number,
): number {
  if (discountType === "percentage") {
    return Math.round((subtotal * Math.min(100, Math.max(0, discountValue))) / 100);
  }
  if (discountType === "fixed") {
    return Math.min(subtotal, Math.max(0, discountValue));
  }
  return 0;
}
