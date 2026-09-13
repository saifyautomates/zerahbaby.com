/**
 * POS-specific hooks and helpers for the offline sales system.
 * Handles barcode lookup, offline sale placement, POS customer management,
 * and offline sale history.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/store";
import {
  invalidateCanonicalReportingQueries,
  notifyPOSSaleChanged,
} from "@/lib/canonical-reporting";

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
  sales_channel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  isCustom?: boolean;
  buying_price?: number | null; // Cost price for profit calculation
  variant_info?: string;
  color?: string;
  size?: string;
};

export type POSCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  city?: string;
  address?: string;
  state?: string;
  pincode?: string;
  notes?: string;
  total_purchases: number;
  total_spend: number;
  store_credit_balance?: number;
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
  store_credit_used?: number;
  credit_token_used?: string | null;
  return_status?: "none" | "partially_returned" | "returned";
  returned_amount?: number;
  returned_units?: number;
  is_voided?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
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

export type POSTransactionState =
  "DRAFT" | "PROCESSING" | "COMPLETED" | "PENDING_SYNC" | "SYNCING" | "SYNCED" | "FAILED";

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
  store_credit_used?: number;
  cash_payable?: number;
  remaining_credit?: number;
  pos_token_number: number | null;
  pos_token_date: string | null;
  credit_token_used?: string | null;
  coupon_code?: string | null;
  coupon_discount?: number;
  status: "completed" | "pending_sync" | "failed";
  is_offline_queued: boolean;
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
  sales_channel?: "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY";
  buying_price?: number | null;
  buyingPrice?: number | null;
};

import {
  findOfflineProductByCode,
  queueOfflineSale,
  getNextOfflineToken,
  getTodayISTDateString,
  processOfflineSyncQueue,
} from "@/lib/offline-sync-engine";

interface DirectProductVariant {
  id: string;
  name: string;
  sku: string;
  stock: number;
  price_override?: number | null;
  priceOverride?: number | null;
  mrp_override?: number | null;
  mrpOverride?: number | null;
  color?: string | null;
  size?: string | null;
  barcode?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
}

interface DirectProductImage {
  public_url: string;
  is_primary: boolean;
  sort_order: number;
}

interface DirectProductResult {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  price: number;
  mrp: number;
  stock: number;
  sku: string | null;
  barcode: string | null;
  is_active: boolean;
  age_group: string | null;
  description: string | null;
  sales_channel: string | null;
  product_variants?: DirectProductVariant[] | null;
  product_images?: DirectProductImage[] | null;
}

export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const clean = code.trim();
  if (!clean) return { found: false };

  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;

  // 1. When online, query authoritative Supabase RPC & database first
  if (isOnline) {
    try {
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: any; error: any }>
      )("lookup_barcode", { _code: clean });

      if (!error && data && data.found) {
        // Keep offline IndexedDB cache fresh with authoritative live stock & pricing
        import("@/lib/offline-sync-engine")
          .then((m) => {
            m.updateOfflineCatalogProduct({
              id: data.product_id,
              uuid: data.product_id,
              slug: data.slug,
              name: data.name,
              brand: data.brand,
              category: data.category,
              price: Number(data.price || 0),
              mrp: Number(data.mrp || data.price || 0),
              stock: Number(data.stock || 0),
              sku: data.sku,
              barcode: data.barcode,
              sales_channel: data.sales_channel,
              is_active: !data.archived,
            }).catch(console.error);
          })
          .catch(console.error);

        return {
          found: true,
          archived: !!data.archived,
          product_id: data.product_id,
          variant_id: data.variant_id || "",
          slug: data.slug,
          name: data.name,
          brand: data.brand || "Zérah Baby & Kids",
          category: data.category || "clothing",
          price: Number(data.price || 0),
          mrp: Number(data.mrp || data.price || 0),
          stock: Number(data.stock || 0),
          sku: data.sku || "",
          barcode: data.barcode || clean,
          image_url: data.image_url,
          age_group: data.age_group || "",
          description: data.description || "",
          sales_channel: (data.sales_channel || "ONLINE_AND_OFFLINE") as
            "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
          buying_price: Number(data.buying_price || 0) || null,
        };
      }
    } catch (rpcErr) {
      console.warn("[pos] Online barcode lookup notice:", rpcErr);
    }

    // Direct online table fallback query
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
      const orFilter = isUuid
        ? `barcode.ilike.${clean},sku.ilike.${clean},slug.ilike.${clean},id.eq.${clean}`
        : `barcode.ilike.${clean},sku.ilike.${clean},slug.ilike.${clean}`;

      const { data: rawDirectProduct } = await supabase
        .from("products")
        .select(
          "*, product_images(public_url, is_primary, sort_order), product_variants(id, name, sku, stock, price_override, mrp_override, color, size, barcode, image_url)",
        )
        .or(orFilter)
        .maybeSingle();

      const directProduct = rawDirectProduct as unknown as DirectProductResult | null;

      if (directProduct) {
        const variants = directProduct.product_variants || [];
        const cleanLower = clean.toLowerCase();
        const matchedVariant =
          variants.find(
            (v) =>
              String(v.barcode || "").toLowerCase() === cleanLower ||
              String(v.sku || "").toLowerCase() === cleanLower,
          ) ||
          variants.find((v) => v.name === "Default") ||
          variants[0] ||
          null;

        const images = directProduct.product_images || [];
        const primaryImage =
          images.find((img) => img.is_primary)?.public_url || images[0]?.public_url || null;

        return {
          found: true,
          archived: directProduct.is_active === false,
          product_id: directProduct.id,
          variant_id: matchedVariant?.id,
          slug: directProduct.slug,
          name:
            directProduct.name +
            (matchedVariant && matchedVariant.name !== "Default" && matchedVariant.name
              ? ` - ${matchedVariant.name}`
              : ""),
          brand: directProduct.brand || "Zérah Baby & Kids",
          category: directProduct.category || "clothing",
          price:
            matchedVariant?.price_override != null
              ? Number(matchedVariant.price_override)
              : Number(directProduct.price || 0),
          mrp:
            matchedVariant?.mrp_override != null
              ? Number(matchedVariant.mrp_override)
              : Number(directProduct.mrp || directProduct.price || 0),
          stock:
            matchedVariant?.stock != null && Number(matchedVariant.stock) > 0
              ? Number(matchedVariant.stock)
              : Math.max(Number(matchedVariant?.stock || 0), Number(directProduct.stock || 0)),
          sku: matchedVariant?.sku || directProduct.sku || "",
          barcode: matchedVariant?.barcode || directProduct.barcode || clean,
          image_url: matchedVariant?.image_url || primaryImage,
          age_group: directProduct.age_group || "",
          description: directProduct.description || "",
          sales_channel: (directProduct.sales_channel || "ONLINE_AND_OFFLINE") as
            "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
        };
      }
    } catch (directErr) {
      console.warn("[pos] Online direct lookup notice:", directErr);
    }
  }

  // 2. Fallback to local offline catalog
  try {
    const offline = await findOfflineProductByCode(clean);
    if (offline) {
      const v = (offline.matchedVariant || null) as {
        id?: string;
        name?: string;
        price_override?: number | null;
        priceOverride?: number | null;
        mrp_override?: number | null;
        mrpOverride?: number | null;
        stock?: number | null;
        sku?: string | null;
        barcode?: string | null;
        image_url?: string | null;
        imageUrl?: string | null;
      } | null;

      const price = Number(v?.price_override ?? v?.priceOverride ?? offline.price ?? 0);
      const mrp = Number(v?.mrp_override ?? v?.mrpOverride ?? offline.mrp ?? price);
      const stock = Number(v ? (v.stock ?? 0) : (offline.stock ?? 0));
      const sku = String(v?.sku || offline.sku || "");
      const barcode = String(v?.barcode || offline.barcode || clean);
      const image =
        v?.image_url ||
        v?.imageUrl ||
        (Array.isArray(offline.images) ? (offline.images[0] as string) : null) ||
        null;

      return {
        found: true,
        archived: offline.is_active === false || offline.isActive === false,
        product_id: String(offline.uuid || offline.id),
        variant_id: v?.id || "",
        slug: String(offline.slug || offline.id),
        name: String(offline.name || ""),
        brand: String(offline.brand || "Zérah Baby & Kids"),
        category: String(offline.category || "clothing"),
        price,
        mrp,
        stock,
        sku,
        barcode,
        image_url: image,
        age_group: String(offline.age_group || ""),
        description: String(offline.description || ""),
        sales_channel: (offline.sales_channel || "ONLINE_AND_OFFLINE") as
          "ONLINE_AND_OFFLINE" | "OFFLINE_ONLY",
        buying_price: Number(offline.buying_price ?? offline.buyingPrice ?? 0) || null,
      };
    }
  } catch {
    // Local catalog lookup failed
  }

  return { found: false, error: `Product not found for barcode/SKU: ${clean}` };
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
  store_credit_used?: number;
  credit_token?: string;
  coupon_code?: string;
  items: Array<{
    product_id?: string;
    variant_id?: string;
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
        let rpcResponse: { data: SaleResult; error: { message: string } | null } | null = null;
        try {
          rpcResponse = await (
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
            _discount_type: input.discount_type || "none",
            _discount_value: input.discount_value || 0,
            _customer_id: input.customer_id || null,
            _items: input.items,
            _idempotency_key: input.idempotency_key || null,
            _store_credit_used: input.store_credit_used || 0,
            _credit_token: input.credit_token || null,
            _coupon_code: input.coupon_code?.trim() || null,
          });
        } catch (fetchErr: unknown) {
          const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          const isNetDrop =
            !navigator.onLine ||
            errMsg.includes("Failed to fetch") ||
            errMsg.includes("NetworkError") ||
            errMsg.includes("network disconnected") ||
            errMsg.includes("The user aborted a request") ||
            errMsg.includes("Load failed") ||
            errMsg.includes("connection refused");

          if (!isNetDrop) {
            // A non-network exception occurred — fail fast, do not swallow into offline queue!
            throw fetchErr;
          }
          // True network drop: fall through to offline resilience fallback below
          rpcResponse = null;
        }

        if (rpcResponse) {
          if (rpcResponse.error) {
            // Authoritative server rejection: stock validation, schema error, or business rule failure.
            // DO NOT route to offline queue. Fail explicitly so cashier can take action.
            throw new Error(rpcResponse.error.message || "Failed to process sale on server");
          }

          if (rpcResponse.data) {
            const result: SaleResult = {
              ...(rpcResponse.data as SaleResult),
              customer_phone: input.customer_phone || "",
              credit_token_used:
                input.credit_token || (rpcResponse.data as SaleResult).credit_token_used,
              status: "completed",
              is_offline_queued: false,
            };

            // Asynchronously trigger transactional SMS & Owner Email Notification (non-blocking)
            if (result.sale_id && !result.duplicate) {
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

              supabase.functions
                .invoke("send-owner-sale-notification", {
                  body: {
                    type: "offline_sale",
                    sale_id: result.sale_id,
                  },
                })
                .catch((emailErr) => {
                  console.warn("[pos] Owner offline sale email notification error:", emailErr);
                });
            }

            return result;
          }
        }
      }

      // Offline-first fallback: executed ONLY when genuinely offline or network disconnected
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
        coupon_code: input.coupon_code || null,
        store_credit_used: input.store_credit_used || 0,
        credit_token: input.credit_token || null,
        items: input.items,
        total,
        subtotal,
        discount,
        token_number: token.number,
        token_date: token.date,
        sale_number: saleNumber,
        created_at: new Date().toISOString(),
        status: "PENDING_SYNC",
        transaction_status: "PENDING_CONFIRMATION",
      });

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
        status: "pending_sync",
        is_offline_queued: true,
      };
    },
    onSuccess: () => {
      invalidateCanonicalReportingQueries(qc);
      notifyPOSSaleChanged();
      qc.invalidateQueries({ queryKey: ["offline-sales-badge-count"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-customers-hub"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-with-return-metrics"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-for-returns-history-lookup"] });
      qc.invalidateQueries({ queryKey: ["offline-analytics"] });
      qc.invalidateQueries({ queryKey: ["admin-dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["admin-dashboard"] });
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
      qc.invalidateQueries({ queryKey: ["pos-customers-ledger-hub"] });
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-analytics-events"] });
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
      id?: string;
      name: string;
      phone: string;
      email?: string;
      city?: string;
      address?: string;
    }): Promise<POSCustomer> => {
      const cleanPhone = customer.phone.trim();
      const cleanName = customer.name.trim();
      const cleanEmail = customer.email?.trim() || "";
      const cleanCity = customer.city?.trim() || "";
      const cleanAddress = customer.address?.trim() || "";

      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: POSCustomer | null; error: { message: string } | null }>
      )("upsert_authoritative_customer", {
        _id: customer.id || null,
        _name: cleanName,
        _phone: cleanPhone,
        _email: cleanEmail,
        _city: cleanCity,
        _address: cleanAddress,
      });

      if (error) {
        throw new Error(error.message);
      }

      return data as POSCustomer;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
      qc.invalidateQueries({ queryKey: ["admin-customers"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-customers-badge"] });
      qc.invalidateQueries({ queryKey: ["offline-sales-customers-hub"] });
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
              ) => {
                limit: (n: number) => Promise<{ data: OfflineSale[] | null; error: unknown }>;
              };
            };
          };
        }
      )
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .order("created_at", { ascending: false })
        .limit(1000);
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pos_${Date.now()}_${crypto.randomUUID()}`;
  }
  return `pos_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/** Calculate discount amount from type and value */
export function calculateDiscount(
  subtotal: number,
  discountType: "none" | "percentage" | "fixed",
  discountValue: number,
): number {
  if (discountType === "percentage" || (discountType as string) === "percent") {
    return Math.round((subtotal * Math.min(100, Math.max(0, discountValue))) / 100);
  }
  if (discountType === "fixed") {
    return Math.min(subtotal, Math.max(0, discountValue));
  }
  return 0;
}

/**
 * Validates a coupon code in real-time for POS checkout.
 * Enforces active state, date window, minimum cart value, and usage limits.
 */
export async function validatePOSCoupon(
  code: string,
  subtotal: number,
): Promise<{
  valid: boolean;
  coupon?: {
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    minimumOrderValue?: number;
    maximumDiscount?: number;
  };
  error?: string;
}> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { valid: false, error: "Coupon code cannot be empty" };

  try {
    const { data, error } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", clean)
      .maybeSingle();

    if (error || !data) {
      return { valid: false, error: `Coupon "${clean}" not found` };
    }

    if (!data.active) {
      return { valid: false, error: `Coupon "${clean}" is inactive` };
    }

    const now = new Date();
    if (data.starts_at && new Date(data.starts_at) > now) {
      return { valid: false, error: `Coupon "${clean}" is not yet active` };
    }

    if (data.expires_at && new Date(data.expires_at) < now) {
      return { valid: false, error: `Coupon "${clean}" has expired` };
    }

    if (data.usage_limit && data.usage_count >= data.usage_limit) {
      return { valid: false, error: `Coupon "${clean}" usage limit reached` };
    }

    const minCart = Number(data.minimum_order_value || 0);
    if (minCart > 0 && subtotal < minCart) {
      return {
        valid: false,
        error: `Coupon "${clean}" requires minimum cart value of ₹${minCart}`,
      };
    }

    return {
      valid: true,
      coupon: {
        code: data.code,
        discountType:
          data.discount_type === "percent" || data.discount_type === "percentage"
            ? "percentage"
            : "fixed",
        discountValue: Number(data.discount_value || 0),
        minimumOrderValue: minCart,
        maximumDiscount: Number(data.maximum_discount || 0),
      },
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to validate coupon",
    };
  }
}
