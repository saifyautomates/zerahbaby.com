/**
 * ZÉRAH BABY & KIDS — POS Multi-Customer / Multi-Cart Session Engine
 * Supabase-first single source of truth for concurrent active & held POS carts.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { POSCartItem } from "@/lib/pos";

export type POSSessionStatus = "draft" | "held" | "payment_pending" | "completed" | "cancelled";

export type POSSession = {
  id: string;
  session_number: string;
  cashier_id?: string | null;
  customer_id?: string | null;
  customer_mode: "walkin" | "existing" | "new";
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  status: POSSessionStatus;
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  applied_coupon?: unknown | null;
  payment_method: string;
  notes: string;
  store_credit_applied: number;
  credit_token_input: string;
  subtotal: number;
  discount_total: number;
  total: number;
  held_at?: string | null;
  created_at: string;
  updated_at: string;
  items: POSCartItem[];
};

export const POS_MULTI_SESSIONS_STORAGE_KEY = "zerah_pos_multi_sessions_v2";
export const POS_ACTIVE_SESSION_ID_KEY = "zerah_pos_active_session_id_v2";

export function generateSessionNumber(existingSessions: Array<{ session_number?: string }> = []): string {
  if (!existingSessions || existingSessions.length === 0) return "1";
  const used = existingSessions
    .map((s) => {
      const raw = String(s.session_number || "").replace(/[^0-9]/g, "");
      const n = parseInt(raw, 10);
      return !isNaN(n) && n > 0 && n < 1000 ? n : null;
    })
    .filter((n): n is number => n !== null);
  for (let i = 1; i <= 100; i++) {
    if (!used.includes(i)) return String(i);
  }
  return String(existingSessions.length + 1);
}

export function createDefaultSession(sessionNumber?: string, existingSessions: POSSession[] = []): POSSession {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  return {
    id,
    session_number: sessionNumber ? sessionNumber.replace(/^#/, "") : generateSessionNumber(existingSessions),
    cashier_id: null,
    customer_id: null,
    customer_mode: "walkin",
    customer_name: "Walk-in Customer",
    customer_phone: "",
    customer_email: "",
    status: "draft",
    discount_type: "none",
    discount_value: 0,
    applied_coupon: null,
    payment_method: "cash",
    notes: "",
    store_credit_applied: 0,
    credit_token_input: "",
    subtotal: 0,
    discount_total: 0,
    total: 0,
    created_at: now,
    updated_at: now,
    items: [],
  };
}

export function loadStoredSessionsLocal(): POSSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POS_MULTI_SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Normalize any legacy 4-digit numbers (like #7003) or '#' prefixes to clean numbers (1, 2, 3...)
        return parsed.map((sess: POSSession, idx: number) => {
          const rawNum = String(sess.session_number || "").replace(/^#/, "");
          const isLegacy = !rawNum || /^\d{4,}$/.test(rawNum);
          return {
            ...sess,
            session_number: isLegacy ? String(idx + 1) : rawNum,
          };
        });
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveStoredSessionsLocal(sessions: POSSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POS_MULTI_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

export function loadActiveSessionIdLocal(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(POS_ACTIVE_SESSION_ID_KEY);
  } catch {
    return null;
  }
}

export function saveActiveSessionIdLocal(id: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POS_ACTIVE_SESSION_ID_KEY, id);
  } catch {
    // ignore
  }
}

/**
 * Fetch active POS sessions from Supabase.
 * Falls back to local storage if offline or during network drop.
 */
export async function fetchActivePOSSessions(): Promise<POSSession[]> {
  try {
    const { data, error } = await (
      supabase.rpc as unknown as (
        fn: string,
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    )("get_active_pos_sessions");

    if (error) {
      console.warn(
        "[POSSessionEngine] get_active_pos_sessions error, using local fallback:",
        error.message,
      );
      const local = loadStoredSessionsLocal();
      return local.length > 0 ? local : [createDefaultSession()];
    }

    if (Array.isArray(data) && data.length > 0) {
      const mapped: POSSession[] = (data as Record<string, unknown>[]).map((d, idx) => {
        const rawNum = String(d.session_number || "").replace(/^#/, "");
        const isLegacy = !rawNum || /^\d{4,}$/.test(rawNum);
        return {
          id: String(d.id),
          session_number: isLegacy ? String(idx + 1) : rawNum,
          cashier_id: d.cashier_id ? String(d.cashier_id) : null,
          customer_id: d.customer_id ? String(d.customer_id) : null,
          customer_mode: (d.customer_mode as "walkin" | "existing" | "new") || "walkin",
          customer_name: String(d.customer_name || "Walk-in Customer"),
          customer_phone: String(d.customer_phone || ""),
          customer_email: String(d.customer_email || ""),
          status: (d.status as POSSessionStatus) || "draft",
          discount_type: (d.discount_type as "none" | "percentage" | "fixed") || "none",
          discount_value: Number(d.discount_value || 0),
          applied_coupon: d.applied_coupon || null,
          payment_method: String(d.payment_method || "cash"),
          notes: String(d.notes || ""),
          store_credit_applied: Number(d.store_credit_applied || 0),
          credit_token_input: String(d.credit_token_input || ""),
          subtotal: Number(d.subtotal || 0),
          discount_total: Number(d.discount_total || 0),
          total: Number(d.total || 0),
          held_at: d.held_at ? String(d.held_at) : null,
          created_at: String(d.created_at || new Date().toISOString()),
          updated_at: String(d.updated_at || new Date().toISOString()),
          items: Array.isArray(d.items) ? (d.items as POSCartItem[]) : [],
        };
      });

      saveStoredSessionsLocal(mapped);
      return mapped;
    }

    // No remote sessions found — return stored local or fresh default
    const local = loadStoredSessionsLocal();
    if (local.length > 0) return local;

    const initial = createDefaultSession();
    // Fire and forget persist initial session
    savePOSSession(initial).catch(() => { });
    return [initial];
  } catch (err) {
    console.warn("[POSSessionEngine] Network exception, using local fallback:", err);
    const local = loadStoredSessionsLocal();
    return local.length > 0 ? local : [createDefaultSession()];
  }
}

/**
 * Persist an active POS session and its items to Supabase & local cache.
 */
export async function savePOSSession(session: POSSession): Promise<void> {
  // Always update local cache immediately
  const local = loadStoredSessionsLocal();
  const existingIdx = local.findIndex((s) => s.id === session.id);
  const updatedLocal =
    existingIdx >= 0
      ? local.map((s, idx) => (idx === existingIdx ? session : s))
      : [...local, session];
  saveStoredSessionsLocal(updatedLocal);

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      session.id,
    );
    const payloadSession = {
      id: isUuid ? session.id : undefined,
      session_number: session.session_number,
      customer_id: session.customer_id,
      customer_mode: session.customer_mode,
      customer_name: session.customer_name,
      customer_phone: session.customer_phone,
      customer_email: session.customer_email,
      status: session.status,
      discount_type: session.discount_type,
      discount_value: session.discount_value,
      applied_coupon: session.applied_coupon,
      payment_method: session.payment_method,
      notes: session.notes,
      store_credit_applied: session.store_credit_applied,
      credit_token_input: session.credit_token_input,
      subtotal: session.subtotal,
      discount_total: session.discount_total,
      total: session.total,
    };

    const payloadItems = session.items.map((item) => {
      const isProdUuid =
        Boolean(item.product_id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.product_id);
      const isVarUuid =
        Boolean(item.variant_id) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.variant_id);
      return {
        product_id: isProdUuid ? item.product_id : undefined,
        variant_id: isVarUuid ? item.variant_id : undefined,
        slug: item.slug || "",
        name: item.name || "Item",
        sku: item.sku || "",
        barcode: item.barcode || "",
        brand: item.brand || "",
        category: item.category || "",
        image_url: item.image_url || null,
        price: item.price || 0,
        mrp: item.mrp || 0,
        stock: item.stock || 0,
        qty: item.qty || 1,
        subtotal: (item.price || 0) * (item.qty || 1),
        isCustom: Boolean(item.isCustom),
      };
    });

    await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    )("save_pos_session_full", {
      p_session: payloadSession,
      p_items: payloadItems,
    });
  } catch (e) {
    console.warn("[POSSessionEngine] Failed to sync session to Supabase, stored locally:", e);
  }
}

/**
 * Close/cancel a session in Supabase & remove from local active list.
 */
export async function closePOSSession(sessionId: string): Promise<void> {
  const local = loadStoredSessionsLocal().filter((s) => s.id !== sessionId);
  saveStoredSessionsLocal(local);

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId,
    );
    if (isUuid) {
      await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      )("close_pos_session", {
        p_session_id: sessionId,
      });
    }
  } catch (e) {
    console.warn("[POSSessionEngine] Failed to close session on server:", e);
  }
}

export function useActivePOSSessions() {
  return useQuery({
    queryKey: ["active_pos_sessions"],
    queryFn: fetchActivePOSSessions,
    staleTime: 5000,
  });
}

export function useSavePOSSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: savePOSSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active_pos_sessions"] });
    },
  });
}

export function useClosePOSSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closePOSSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active_pos_sessions"] });
    },
  });
}
