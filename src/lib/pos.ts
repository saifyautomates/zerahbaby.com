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
  items_count: number;
  duplicate: boolean;
};

/* ------------------------------------------------------------------ */
/*  Barcode Lookup                                                     */
/* ------------------------------------------------------------------ */

export type BarcodeResult = {
  found: boolean;
  archived?: boolean;
  error?: string;
  product_id?: string;
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

export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const { data, error } = await (supabase.rpc as any)("lookup_barcode", {
    _code: code.trim(),
  });
  if (error) throw new Error(error.message);
  return data as BarcodeResult;
}

export function useLookupBarcode() {
  return useMutation({
    mutationFn: lookupBarcode,
  });
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
    product_slug: string;
    name?: string;
    sku?: string;
    qty: number;
    custom_price?: number;
  }>;
  idempotency_key: string;
};

export function usePlaceOfflineSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlaceSaleInput): Promise<SaleResult> => {
      const { data, error } = await (supabase.rpc as any)(
        "place_offline_sale",
        {
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
        },
      );
      if (error) throw new Error(error.message);
      return data as SaleResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["offline-sales"] });
      qc.invalidateQueries({ queryKey: ["pos-customers"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  POS Customers                                                      */
/* ------------------------------------------------------------------ */

export function usePOSCustomers() {
  return useQuery({
    queryKey: ["pos-customers"],
    queryFn: async (): Promise<POSCustomer[]> => {
      const { data, error } = await (supabase as any)
        .from("pos_customers")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) return [];
      return (data ?? []) as POSCustomer[];
    },
  });
}

export function useSearchPOSCustomers() {
  return useMutation({
    mutationFn: async (query: string): Promise<POSCustomer[]> => {
      if (!query.trim()) return [];
      const { data, error } = await (supabase.rpc as any)(
        "search_pos_customers",
        { _query: query.trim() },
      );
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
      const { data, error } = await (supabase as any)
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
      const { data, error } = await (supabase as any)
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
