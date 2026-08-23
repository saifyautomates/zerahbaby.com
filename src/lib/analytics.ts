import { supabase } from "@/integrations/supabase/client";

/** Tracks a user event for analytics. Fire-and-forget — never blocks UI. */
export function trackEvent(
  eventName: string,
  opts?: {
    productId?: string;
    orderId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  supabase.auth.getUser().then(({ data }) => {
    const userId = data?.user?.id ?? null;
    supabase
      .from("analytics_events")
      .insert({
        user_id: userId,
        session_id: getSessionId(),
        event_name: eventName,
        product_id: opts?.productId ?? null,
        order_id: opts?.orderId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (opts?.metadata ?? null) as any, // Cast to any to satisfy Supabase Json type expectations
      })
      .then(({ error }) => {
        if (error && error.code !== "42501") {
          console.warn("[Analytics]", error.message);
        }
      });
  });
}

/** Stable session ID for the current browser tab. */
function getSessionId(): string {
  const KEY = "zerah-session-id";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
