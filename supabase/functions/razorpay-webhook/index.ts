import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";
import crypto from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-razorpay-signature, x-razorpay-event-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const signature =
      req.headers.get("X-Razorpay-Signature") || req.headers.get("x-razorpay-signature");
    const eventIdHeader =
      req.headers.get("X-Razorpay-Event-Id") || req.headers.get("x-razorpay-event-id");
    const secret = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "").trim();

    if (!signature) {
      console.error("[razorpay-webhook] Missing X-Razorpay-Signature header");
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Read raw body text for HMAC-SHA256 signature verification
    const bodyText = await req.text();
    const expectedSignature = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");

    if (expectedSignature !== signature) {
      console.error("[razorpay-webhook] Invalid signature mismatch");
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const payload = JSON.parse(bodyText);
    const eventId =
      eventIdHeader ||
      payload.event_id ||
      payload.id ||
      `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 2. Create Admin Supabase Client
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Webhook Idempotency Guard
    const { data: existingEvent } = await supabaseClient
      .from("webhook_events")
      .select("id, processed")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingEvent?.processed) {
      return new Response(JSON.stringify({ ok: true, message: "Event already processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (!existingEvent) {
      await supabaseClient.from("webhook_events").insert({
        event_id: eventId,
        event_type: payload.event,
        payload: payload,
      });
    }

    // 4. Handle Specific Razorpay Webhook Events
    if (payload.event === "payment.captured" || payload.event === "order.paid") {
      let rzpOrderId: string | undefined;
      let paymentId: string | undefined;
      let amountInPaise: number | undefined;

      if (payload.event === "payment.captured") {
        paymentId = payload.payload?.payment?.entity?.id;
        rzpOrderId = payload.payload?.payment?.entity?.order_id;
        amountInPaise = payload.payload?.payment?.entity?.amount;
      } else {
        paymentId = payload.payload?.order?.entity?.payments?.at(0)?.id;
        rzpOrderId = payload.payload?.order?.entity?.id;
        amountInPaise = payload.payload?.order?.entity?.amount_paid || payload.payload?.order?.entity?.amount;
      }

      if (rzpOrderId) {
        // Call authoritative finalize_paid_order RPC
        const { data: finalRes, error: finalErr } = await supabaseClient.rpc("finalize_paid_order", {
          _session_id: null,
          _razorpay_order_id: rzpOrderId,
          _razorpay_payment_id: paymentId,
          _razorpay_signature: null,
          _verified_amount: amountInPaise || null,
        });

        let targetOrderId: string | null = null;
        let isDuplicate = false;

        if (finalErr) {
          console.warn("[razorpay-webhook] finalize_paid_order notice, checking legacy orders:", finalErr);
          const { data: legacyOrder } = await supabaseClient
            .from("orders")
            .select("id, payment_status")
            .eq("razorpay_order_id", rzpOrderId)
            .maybeSingle();

          if (legacyOrder) {
            targetOrderId = legacyOrder.id;
            isDuplicate = legacyOrder.payment_status === "paid";
            if (!isDuplicate) {
              await supabaseClient
                .from("orders")
                .update({
                  payment_status: "paid",
                  status: "processing",
                  razorpay_payment_id: paymentId,
                })
                .eq("id", legacyOrder.id);
            }
          }
        } else if (finalRes) {
          targetOrderId = finalRes.order_id;
          isDuplicate = Boolean(finalRes.duplicate);
        }

        if (targetOrderId && !isDuplicate) {
          // Trigger owner notification email (non-blocking)
          try {
            fetch(`${supabaseUrl}/functions/v1/send-owner-sale-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                type: "online_order",
                order_id: targetOrderId,
              }),
            }).catch((e) => console.warn("[razorpay-webhook] Notification error:", e));
          } catch {
            // Non-blocking
          }

          // Automatically trigger Shiprocket Shipment Creation (non-blocking)
          try {
            fetch(`${supabaseUrl}/functions/v1/shiprocket-api`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                action: "create_shipment",
                orderId: targetOrderId,
              }),
            }).catch((srErr) => {
              console.warn("[razorpay-webhook] Shiprocket auto sync error:", srErr);
            });
          } catch {
            // Non-blocking
          }
        }
      }
    } else if (payload.event === "payment.failed") {
      const paymentId = payload.payload?.payment?.entity?.id;
      const rzpOrderId = payload.payload?.payment?.entity?.order_id;
      const errorDescription =
        payload.payload?.payment?.entity?.error_description || "Payment failed at gateway";

      if (rzpOrderId) {
        // Record payment attempt failure
        await supabaseClient.rpc("update_payment_attempt_status", {
          _razorpay_order_id: rzpOrderId,
          _status: "failed",
          _error_message: errorDescription,
        }).catch((e: unknown) => console.warn("Failed to record failure status:", e));

        // Legacy order update if exists
        await supabaseClient
          .from("orders")
          .update({
            payment_status: "failed",
            status: "cancelled",
            razorpay_payment_id: paymentId,
          })
          .eq("razorpay_order_id", rzpOrderId)
          .neq("payment_status", "paid");
      }
    } else if (payload.event === "refund.processed" || payload.event === "refund.created") {
      const refundEntity = payload.payload?.refund?.entity;
      const refundId = refundEntity?.id;
      const status = refundEntity?.status;

      if (refundId) {
        await supabaseClient
          .from("online_returns")
          .update({
            razorpay_refund_id: refundId,
            razorpay_refund_status: status || "PROCESSED",
            refund_status: "PROCESSED",
            return_status: "COMPLETED",
            refund_completed_at: new Date().toISOString(),
          })
          .eq("razorpay_refund_id", refundId);

        await supabaseClient
          .from("orders")
          .update({
            razorpay_refund_status: status || "PROCESSED",
            payment_status: "refunded",
            refund_completed_at: new Date().toISOString(),
          })
          .eq("razorpay_refund_id", refundId);
      }
    } else if (payload.event === "refund.failed") {
      const refundEntity = payload.payload?.refund?.entity;
      const refundId = refundEntity?.id;

      if (refundId) {
        await supabaseClient
          .from("online_returns")
          .update({
            razorpay_refund_status: "FAILED",
            refund_status: "FAILED",
          })
          .eq("razorpay_refund_id", refundId);

        await supabaseClient
          .from("orders")
          .update({
            razorpay_refund_status: "FAILED",
          })
          .eq("razorpay_refund_id", refundId);
      }
    }

    // 5. Mark webhook event as processed
    await supabaseClient.from("webhook_events").update({ processed: true }).eq("event_id", eventId);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    console.error("[razorpay-webhook] Error handling webhook:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
