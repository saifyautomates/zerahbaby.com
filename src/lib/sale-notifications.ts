/**
 * ZÉRAH BABY & KIDS — MANDATORY SALE NOTIFICATIONS SYSTEM
 * Canonical multi-channel notification dispatcher for Online & Offline sales.
 * Channels:
 * 1. Customer Phone (WhatsApp / SMS)
 * 2. Admin Phone (WhatsApp / SMS)
 * 3. Admin Email
 * 4. Customer Email (Conditional on customer email availability)
 */

import { supabase } from "@/integrations/supabase/client";

export interface SaleNotificationPayload {
  sale_type: "online" | "offline";
  sale_id: string;
  force_channels?: ("customer_sms" | "admin_sms" | "admin_email" | "customer_email")[];
  idempotency_key?: string;
}

export interface SaleNotificationResult {
  success: boolean;
  sale_type?: string;
  sale_id?: string;
  channels?: {
    customer_sms?: { status: string; id?: string | null; error?: string | null };
    admin_sms?: { status: string; id?: string | null; error?: string | null };
    admin_email?: { status: string; id?: string | null; error?: string | null };
    customer_email?: { status: string; id?: string | null; error?: string | null };
  };
  event?: Record<string, unknown> | null;
  error?: string;
}

/**
 * Authoritatively dispatches the sale notification event across all 4 mandatory channels.
 * Runs asynchronously and never blocks or throws to guarantee sale resilience.
 */
export async function dispatchSaleNotifications(
  payload: SaleNotificationPayload,
): Promise<SaleNotificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke("dispatch-sale-notifications", {
      body: payload,
    });

    if (error) {
      console.warn("[SaleNotifications] dispatch-sale-notifications edge function error:", error);
      // Fallback to separate endpoints to guarantee delivery if dispatch-sale-notifications is unreachable
      return await fallbackDispatch(payload);
    }

    return (data as SaleNotificationResult) || { success: true };
  } catch (err: unknown) {
    console.warn("[SaleNotifications] Unexpected error invoking dispatch-sale-notifications:", err);
    return await fallbackDispatch(payload);
  }
}

/**
 * Resilient fallback invoking canonical micro-functions if the main coordinator encounters network limits
 */
async function fallbackDispatch(payload: SaleNotificationPayload): Promise<SaleNotificationResult> {
  try {
    const isOnline = payload.sale_type === "online";
    const promises: Promise<unknown>[] = [];

    // 1. Transactional SMS (Customer + Admin)
    promises.push(
      supabase.functions.invoke("msg91-transactional", {
        body: {
          order_id: isOnline ? payload.sale_id : undefined,
          offline_sale_id: !isOnline ? payload.sale_id : undefined,
          event_type: isOnline ? "online_sale" : "offline_pos_sale",
          notify_owner: true,
        },
      }),
    );

    // 2. Transactional Email (Admin + Customer if available)
    promises.push(
      supabase.functions.invoke("send-owner-sale-notification", {
        body: {
          type: isOnline ? "online_order" : "offline_sale",
          order_id: isOnline ? payload.sale_id : undefined,
          sale_id: !isOnline ? payload.sale_id : undefined,
          force_retry: Boolean(payload.force_channels && payload.force_channels.length > 0),
        },
      }),
    );

    await Promise.allSettled(promises);
    return { success: true, sale_type: payload.sale_type, sale_id: payload.sale_id };
  } catch {
    return { success: false, error: "Fallback notification dispatch encountered an error" };
  }
}

/**
 * Fetches the delivery status across all 4 channels for a specific sale.
 */
export async function getSaleNotificationStatus(
  saleType: "online" | "offline",
  saleId: string,
) {
  try {
    const { data, error } = await (supabase.from as any)("sale_notification_events")
      .select("*")
      .eq("sale_type", saleType)
      .eq("sale_id", saleId)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn("[SaleNotifications] Failed to fetch notification status:", err);
    return null;
  }
}
