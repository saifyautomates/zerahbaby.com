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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Supabase server credentials not configured");
    }

    // Create a client with the user's JWT to verify they are authenticated
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing razorpay verification fields");
    }

    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeySecret = rawKeySecret.trim();
    if (!razorpayKeySecret) {
      throw new Error("Razorpay credentials not configured on server");
    }

    // Verify Signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("[verify-razorpay-payment] Signature mismatch:", {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      });
      throw new Error("Invalid payment signature");
    }

    // We use the service key to bypass RLS and update the order
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the order to ensure it belongs to the user and hasn't already been processed
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, user_id, status, payment_status")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found for the given Razorpay order ID");
    }

    // Verify order belongs to the user
    if (order.user_id !== user.id) {
      throw new Error("Unauthorized access to this order");
    }

    // If it's already paid/processing, return success idempotently
    if (
      order.payment_status === "paid" ||
      order.status === "processing" ||
      order.status === "confirmed"
    ) {
      return new Response(JSON.stringify({ success: true, already_paid: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Update order status to paid / processing
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        status: "processing",
        payment_status: "paid",
        razorpay_payment_id,
        razorpay_signature,
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("[verify-razorpay-payment] Failed to update order status:", updateError);
      throw updateError;
    }

    // Asynchronously trigger owner sale notification (failure must not fail payment verification)
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-owner-sale-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          type: "online_order",
          order_id: order.id,
        }),
      });
    } catch (notifyErr) {
      console.warn(
        "[verify-razorpay-payment] Owner notification trigger failed (non-blocking):",
        notifyErr,
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    const message = (error as Error).message || "Payment verification failed";
    console.error("[verify-razorpay-payment] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
