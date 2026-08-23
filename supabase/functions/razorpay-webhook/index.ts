import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";
import crypto from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const signature = req.headers.get("X-Razorpay-Signature");
    // Razorpay sends event id in header as x-razorpay-event-id
    const eventId = req.headers.get("X-Razorpay-Event-Id");
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")?.trim() || "";

    if (!signature || !secret || !eventId) {
      console.error("[razorpay-webhook] Missing required headers or webhook secret");
      return new Response(JSON.stringify({ error: "Missing signature, secret, or event ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Read the raw body as text for signature verification
    const bodyText = await req.text();

    // Verify signature
    const expectedSignature = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");

    if (expectedSignature !== signature) {
      console.error("[razorpay-webhook] Invalid signature mismatch");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const payload = JSON.parse(bodyText);

    // Create supabase client with Service Role Key to bypass RLS for webhook updates
    const supabaseClient = createClient(
      (Deno.env.get("SUPABASE_URL") ?? "").trim(),
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim(),
    );

    // 1. Check idempotency
    const { data: existingEvent } = await supabaseClient
      .from("webhook_events")
      .select("id, processed")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingEvent) {
      if (existingEvent.processed) {
        return new Response(JSON.stringify({ ok: true, message: "Event already processed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    } else {
      // Insert event to lock it
      const { error: insertError } = await supabaseClient.from("webhook_events").insert({
        event_id: eventId,
        event_type: payload.event,
        payload: payload,
      });
      if (insertError) {
        console.warn("[razorpay-webhook] Possible duplicate event insertion:", insertError);
      }
    }

    // 2. Process event
    let processError: Error | null = null;
    try {
      if (payload.event === "payment.captured" || payload.event === "order.paid") {
        let orderId: string | undefined;
        let paymentId: string | undefined;

        if (payload.event === "payment.captured") {
          paymentId = payload.payload.payment.entity.id;
          orderId = payload.payload.payment.entity.order_id;
        } else {
          paymentId = payload.payload.order.entity.payments?.at(0)?.id;
          orderId = payload.payload.order.entity.id;
        }

        if (orderId) {
          const { error } = await supabaseClient
            .from("orders")
            .update({
              payment_status: "paid",
              status: "processing",
              razorpay_payment_id: paymentId,
            })
            .eq("razorpay_order_id", orderId)
            .neq("payment_status", "paid");

          if (error) throw error;
        }
      } else if (payload.event === "payment.failed") {
        const paymentId = payload.payload.payment.entity.id;
        const orderId = payload.payload.payment.entity.order_id;

        if (orderId) {
          await supabaseClient
            .from("orders")
            .update({
              payment_status: "failed",
              status: "cancelled",
              razorpay_payment_id: paymentId,
            })
            .eq("razorpay_order_id", orderId)
            .neq("payment_status", "paid");
        }
      }
    } catch (err: unknown) {
      processError = err as Error;
      console.error("[razorpay-webhook] Event processing error:", processError);
    }

    // 3. Update event status
    await supabaseClient
      .from("webhook_events")
      .update({
        processed: processError === null,
        error: processError ? processError.message : null,
        processed_at: new Date().toISOString(),
      })
      .eq("event_id", eventId);

    if (processError) {
      throw processError;
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    const message = (error as Error).message || "Webhook processing failed";
    console.error("[razorpay-webhook] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
