import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";
import crypto from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase server credentials not configured");
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authenticate user from JWT token if available
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    let authenticatedUserId: string | null = null;
    let isAdmin = false;

    if (token) {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);

      if (user) {
        authenticatedUserId = user.id;
        const { data: roleRow } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();
        isAdmin = roleRow?.role === "admin";
      }
    }

    // 2. Parse verification payload
    const body = await req.json().catch(() => ({}));
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing required Razorpay payment verification parameters");
    }

    // 3. Resolve Secret & Compute HMAC SHA-256 Signature
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeySecret) {
      throw new Error("Razorpay secret not configured on server");
    }

    const signaturePayload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(signaturePayload)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("[verify-razorpay-payment] Signature mismatch:", {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
      });
      throw new Error("Invalid payment verification signature");
    }

    // 4. Fetch the order from the database
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, user_id, status, payment_status, total")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found for the given Razorpay order reference");
    }

    // 5. Validate ownership if user is authenticated
    if (order.user_id && authenticatedUserId && order.user_id !== authenticatedUserId && !isAdmin) {
      throw new Error("Unauthorized access to this order");
    }

    // 6. Handle Idempotency — If already marked paid, return success immediately
    if (
      order.payment_status === "paid" ||
      order.status === "processing" ||
      order.status === "confirmed"
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          already_paid: true,
          order_id: order.id,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    // 7. Update order status to paid / processing
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

    // 8. Trigger Owner Sale Notification Email (non-blocking)
    try {
      fetch(`${supabaseUrl}/functions/v1/send-owner-sale-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          type: "online_order",
          order_id: order.id,
        }),
      }).catch((notifyErr) => {
        console.warn("[verify-razorpay-payment] Owner notification error:", notifyErr);
      });
    } catch {
      // Non-blocking
    }

    // 9. Trigger Transactional SMS for Online Order (Customer + Owner) (non-blocking)
    try {
      fetch(`${supabaseUrl}/functions/v1/msg91-transactional`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          order_id: order.id,
          event_type: "online_sale",
          notify_owner: true,
        }),
      }).catch((smsErr) => {
        console.warn("[verify-razorpay-payment] SMS dispatch non-blocking error:", smsErr);
      });
    } catch {
      // Non-blocking
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: order.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = (error as Error).message || "Payment verification failed";
    console.error("[verify-razorpay-payment] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
