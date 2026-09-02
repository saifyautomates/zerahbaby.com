import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAllQueuedSales,
  reconcileLocalQueueWithCloudSales,
  type OfflineQueueItem,
} from "@/lib/offline-sync-engine";

export const CANONICAL_POS_SALES_KEY = ["admin-canonical-pos-sales"] as const;

export interface CanonicalPOSSaleItem {
  id: string;
  sale_id?: string;
  name: string;
  sku?: string | null;
  price: number;
  qty: number;
  subtotal: number;
  buying_price?: number | null;
  product_id?: string | null;
  product_slug?: string | null;
  variant_id?: string | null;
  variant_info?: string | null;
  mrp_snapshot?: number | null;
  barcode_snapshot?: string | null;
}

export interface CanonicalPOSSale {
  id: string;
  sale_number: string;
  idempotency_key?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  subtotal: number;
  discount: number;
  discount_type: string;
  discount_value: number;
  total: number;
  payment_method: string;
  status: string;
  notes?: string | null;
  customer_id?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
  sync_status?: string | null;
  transaction_status?: string | null;
  last_error?: string | null;
  pos_token_number: number | null;
  store_credit_used?: number | null;
  credit_token_used?: string | null;
  return_status?: "none" | "partially_returned" | "returned" | null;
  returned_amount?: number | null;
  returned_units?: number | null;
  is_voided?: boolean | null;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  offline_sale_items: CanonicalPOSSaleItem[];
}

/**
 * Authoritative fetcher for all POS sales.
 * Reconciles remote Supabase offline_sales with local IndexedDB queued transactions.
 * Strict error handling: ALWAYS re-throws network or query errors.
 */
export async function fetchCanonicalPOSSales(): Promise<CanonicalPOSSale[]> {
  // 1. Fetch remote cloud sales
  const { data: dbSales, error } = await supabase
    .from("offline_sales")
    .select("*, offline_sale_items(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[canonical-reporting] Failed to fetch remote offline_sales:", error);
    throw error;
  }

  // 2. Reconcile locally queued items with cloud records
  try {
    await reconcileLocalQueueWithCloudSales(
      (dbSales ?? []) as unknown as Parameters<typeof reconcileLocalQueueWithCloudSales>[0],
    );
  } catch (err) {
    console.warn("[canonical-reporting] Local queue reconciliation warning:", err);
  }

  // 3. Fetch locally queued offline sales
  let queued: OfflineQueueItem[] = [];
  try {
    queued = await getAllQueuedSales();
  } catch (err) {
    console.warn("[canonical-reporting] Failed to read IndexedDB sales queue:", err);
  }

  const existingIdems = new Set(
    (dbSales || []).map((s: Record<string, unknown>) => s.idempotency_key).filter(Boolean),
  );
  const existingIds = new Set(
    (dbSales || []).map((s: Record<string, unknown>) => s.id).filter(Boolean),
  );
  const existingNumbers = new Set(
    (dbSales || []).map((s: Record<string, unknown>) => s.sale_number).filter(Boolean),
  );

  const pendingLocal: CanonicalPOSSale[] = queued
    .filter((q) => {
      if (q.status === "SYNCED") return false;
      if (q.idempotency_key && existingIdems.has(q.idempotency_key)) return false;
      if (q.server_sale_id && existingIds.has(q.server_sale_id)) return false;
      if (q.server_sale_number && existingNumbers.has(q.server_sale_number)) return false;
      if (q.sale_number && existingNumbers.has(q.sale_number)) return false;
      return true;
    })
    .map((q) => ({
      id: q.operation_id,
      sale_number: q.sale_number,
      idempotency_key: q.idempotency_key,
      customer_name: q.customer_name || "Walk-in Customer",
      customer_phone: q.customer_phone || "",
      customer_email: q.customer_email || null,
      subtotal: q.subtotal || q.total,
      discount: q.discount || 0,
      discount_type: q.discount_type || "none",
      discount_value: q.discount_value || 0,
      total: q.total,
      payment_method: q.payment_method || "cash",
      status:
        q.status === "FAILED" || q.status === "FAILED_REQUIRES_ACTION"
          ? "sync_failed"
          : "sync_pending",
      notes: null,
      customer_id: q.customer_id || null,
      created_by: null,
      created_at: q.created_at || new Date().toISOString(),
      updated_at: q.created_at || new Date().toISOString(),
      sync_status:
        q.status === "FAILED" || q.status === "FAILED_REQUIRES_ACTION"
          ? "FAILED_REQUIRES_ACTION"
          : "PENDING_SYNC",
      transaction_status:
        q.status === "FAILED" || q.status === "FAILED_REQUIRES_ACTION"
          ? "FAILED"
          : "PENDING_CONFIRMATION",
      last_error: q.last_error || null,
      pos_token_number: q.token_number || null,
      pos_token_date: q.token_date || null,
      store_credit_used: 0,
      offline_sale_items: (q.items || []).map((it, idx: number) => {
        const itAny = it as Record<string, unknown>;
        return {
          id: (itAny.id as string) || `queued-item-${q.operation_id}-${idx}`,
          sale_id: q.operation_id,
          name: it.name || "POS Item",
          sku: it.sku || "",
          price: it.custom_price || it.price || 0,
          qty: it.qty || 1,
          subtotal: (it.custom_price || it.price || 0) * (it.qty || 1),
          buying_price: Number(itAny.buying_price || 0),
          product_id: it.product_id || null,
          product_slug: it.product_slug || null,
          variant_id: it.variant_id || null,
        };
      }),
    }));

  return [...pendingLocal, ...(dbSales ?? [])] as CanonicalPOSSale[];
}

/**
 * Standard React Query hook for accessing authoritative POS sales.
 * Uses shared cache key across Dashboard, Sales Details, and POS History.
 */
export function useCanonicalPOSSales() {
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSyncEvent = () => {
      invalidateCanonicalReportingQueries(qc);
    };
    window.addEventListener("zerah:pos-sale-updated", handleSyncEvent);
    return () => {
      window.removeEventListener("zerah:pos-sale-updated", handleSyncEvent);
    };
  }, [qc]);

  return useQuery<CanonicalPOSSale[], Error>({
    queryKey: CANONICAL_POS_SALES_KEY,
    queryFn: fetchCanonicalPOSSales,
    staleTime: 1000 * 30, // 30 seconds fresh window
    refetchOnWindowFocus: true,
  });
}

/**
 * Invalidate all reporting, sales, products, and inventory queries immediately.
 * Dispatches to all unified and legacy keys to guarantee synchronous UI updates.
 */
export function invalidateCanonicalReportingQueries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: CANONICAL_POS_SALES_KEY });
  qc.invalidateQueries({ queryKey: ["admin-offline-sales-with-queue"] });
  qc.invalidateQueries({ queryKey: ["admin-dashboard-offline-sales"] });
  qc.invalidateQueries({ queryKey: ["offline-sales"] });
  qc.invalidateQueries({ queryKey: ["admin-offline-sales"] });
  qc.invalidateQueries({ queryKey: ["offline-analytics"] });
  qc.invalidateQueries({ queryKey: ["offline-returns"] });
  qc.invalidateQueries({ queryKey: ["admin-orders"] });
  qc.invalidateQueries({ queryKey: ["admin-products"] });
  qc.invalidateQueries({ queryKey: ["admin-products-count"] });
  qc.invalidateQueries({ queryKey: ["products"] });
  qc.invalidateQueries({ queryKey: ["admin-dashboard-stats"] });
  qc.invalidateQueries({ queryKey: ["inventory-transactions"] });
}

/**
 * Fire global event to notify all active browser tabs/components of a POS mutation
 */
export function notifyPOSSaleChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("zerah:pos-sale-updated"));
  }
}
