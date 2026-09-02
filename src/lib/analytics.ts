import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks a user or store event for live real-time analytics.
 * Fire-and-forget — never blocks the UI.
 * Uses the security-definer RPC `record_store_activity` as primary path,
 * with direct table insert as fallback.
 */
export function trackEvent(
  eventName: string,
  opts?: {
    productId?: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const sessionId = getSessionId();

    // 1. Primary path: RPC record_store_activity (bypasses anon/auth permission quirks)
    (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: Error | null }>)(
      "record_store_activity",
      {
        _event_name: eventName,
        _product_id: opts?.productId || null,
        _order_id: opts?.orderId || null,
        _session_id: sessionId,
        _metadata: opts?.metadata || {},
      },
    )
      .then(({ error }) => {
        if (error) {
          // 2. Fallback: Direct table insert
          supabase.auth.getUser().then(({ data }) => {
            const userId = data?.user?.id ?? null;
            supabase
              .from("analytics_events")
              .insert({
                user_id: userId,
                session_id: sessionId,
                event_name: eventName,
                product_id: opts?.productId ?? null,
                order_id: opts?.orderId ?? null,
                metadata: (opts?.metadata ?? null) as unknown as import("@/integrations/supabase/types").Json,
              })
              .then(() => {
                dispatchLocalActivityEvent(eventName, opts);
              });
          });
        } else {
          dispatchLocalActivityEvent(eventName, opts);
        }
      })
      .catch(() => {
        // Silently swallow network aborts
      });
  } catch {
    // Ignore client exceptions
  }
}

function dispatchLocalActivityEvent(eventName: string, opts?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent("zerah-activity-event", {
          detail: { eventName, opts, timestamp: Date.now() },
        }),
      );
    } catch {
      // ignore
    }
  }
}

/** Stable session ID for the current browser tab. */
function getSessionId(): string {
  const KEY = "zerah-session-id";
  if (typeof window === "undefined") return "server_session";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon_session";
  }
}

/* ------------------------------------------------------------------ */
/*  High-level Domain Tracking Helpers                                */
/* ------------------------------------------------------------------ */

export function trackPageView(path: string, title?: string) {
  trackEvent("page_view", {
    metadata: { path, title: title || "" },
  });
}

export function trackProductView(productId: string, productName?: string, price?: number) {
  trackEvent("product_view", {
    productId,
    metadata: { name: productName, price, amount: price },
  });
}

export function trackAddToCart(productId: string, productName?: string, price?: number, qty = 1) {
  trackEvent("add_to_cart", {
    productId,
    metadata: { name: productName, price, qty, amount: (price || 0) * qty },
  });
}

export function trackRemoveFromCart(productId: string, productName?: string) {
  trackEvent("remove_from_cart", {
    productId,
    metadata: { name: productName },
  });
}

export function trackQuickBuy(productId: string, productName?: string, price?: number) {
  trackEvent("buy_now", {
    productId,
    metadata: { name: productName, price, amount: price },
  });
}

export function trackWishlistToggle(productId: string, productName?: string, added = true) {
  trackEvent(added ? "wishlist_add" : "wishlist_remove", {
    productId,
    metadata: { name: productName },
  });
}

export function trackCheckoutStarted(amount?: number, itemsCount?: number) {
  trackEvent("checkout_started", {
    metadata: { amount, itemsCount },
  });
}

export function trackOrderCreated(orderId: string, orderNumber: string, total: number) {
  trackEvent("order_created", {
    orderId,
    metadata: { orderNumber, total, amount: total },
  });
}
