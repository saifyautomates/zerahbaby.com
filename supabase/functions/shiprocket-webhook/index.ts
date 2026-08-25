import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shiprocket-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase credentials");
    }

    // Parse webhook payload
    const bodyText = await req.text();
    const payload = JSON.parse(bodyText);

    // Important: Shiprocket sends webhooks for tracking updates.
    // Example Payload contains:
    // { "awb": "...", "current_status": "DELIVERED", "shipment_status": "DELIVERED", ... }

    const awbCode = payload.awb;
    const currentStatus = payload.current_status;

    if (!awbCode || !currentStatus) {
      return new Response("OK - Ignored: Missing AWB or Status", {
        status: 200,
        headers: corsHeaders,
      });
    }

    const webhookSecret = Deno.env.get("SHIPROCKET_WEBHOOK_SECRET")?.trim();
    if (webhookSecret) {
      // If a secret is configured, require it in headers
      const providedToken =
        req.headers.get("x-shiprocket-token") || req.headers.get("authorization");
      if (!providedToken || providedToken.replace(/^Bearer\s+/i, "").trim() !== webhookSecret) {
        console.warn(`Unauthorized webhook attempt for AWB: ${awbCode}`);
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Find the order by AWB
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, status, shiprocket_status")
      .eq("awb_code", awbCode)
      .maybeSingle();

    if (orderError || !order) {
      console.log(`Webhook ignored: No order found for AWB ${awbCode}`);
      return new Response("OK - No matching order", { status: 200, headers: corsHeaders });
    }

    // Protect terminal states
    const terminalStates = ["delivered", "cancelled", "returned"];
    if (terminalStates.includes(order.status)) {
      console.log(
        `Webhook ignored: Order ${order.id} is already in terminal state '${order.status}'`,
      );
      return new Response("OK - Terminal state", { status: 200, headers: corsHeaders });
    }

    // Map Shiprocket status to Store status
    const statusUpper = currentStatus.toUpperCase();
    let newStoreStatus = order.status;

    if (["SHIPPED", "IN TRANSIT", "OUT FOR DELIVERY"].includes(statusUpper)) {
      newStoreStatus = "shipped";
    } else if (statusUpper === "DELIVERED") {
      newStoreStatus = "delivered";
    } else if (["RTO INITIATED", "RTO DELIVERED", "RETURNED", "CANCELLED"].includes(statusUpper)) {
      newStoreStatus = "cancelled"; // Or a specific RTO status if they have one
    }

    // Only update if changed to avoid unnecessary DB writes (idempotency check)
    if (order.shiprocket_status !== statusUpper || order.status !== newStoreStatus) {
      const { error: updateError } = await adminClient
        .from("orders")
        .update({
          shiprocket_status: statusUpper,
          status: newStoreStatus,
          tracking_number: awbCode, // Ensure it's stored for frontend display
        })
        .eq("id", order.id);

      if (updateError) {
        throw new Error(`Failed to update order: ${updateError.message}`);
      }
      console.log(`Order ${order.id} updated to ${statusUpper} (${newStoreStatus})`);
    } else {
      console.log(`Order ${order.id} status unchanged`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("[shiprocket-webhook] Error:", error.message);
    // Return 200 even on error so SR doesn't infinitely retry unless we want it to
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
