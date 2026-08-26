import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

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

    // 1. Authenticate user from JWT token
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

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const { orderId } = body;
    if (!orderId) {
      throw new Error("Missing orderId in request payload");
    }

    // 3. Fetch authoritative order details
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, user_id, total, status, payment_status, payment_method, razorpay_order_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found in store records");
    }

    // 4. Validate permissions: User owns the order, or user is admin, or order was placed in current session
    if (order.user_id && authenticatedUserId && order.user_id !== authenticatedUserId && !isAdmin) {
      throw new Error("Unauthorized access to this order");
    }

    if (
      order.payment_status === "paid" ||
      order.status === "processing" ||
      order.status === "confirmed"
    ) {
      throw new Error("This order has already been paid and confirmed");
    }

    // 5. Resolve Razorpay API Credentials
    const rawKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeyId = rawKeyId.trim();
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Razorpay credentials not configured on server");
    }

    // 6. Calculate total in paise (INR 1 = 100 paise)
    const amountInPaise = Math.round(Number(order.total) * 100);
    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      throw new Error(`Invalid order total: ₹${order.total}`);
    }

    // Generate safe receipt identifier (max 40 chars)
    const receipt = `rcpt_${String(orderId).replace(/-/g, "").substring(0, 16)}`;

    // 7. Create Razorpay Order via Official API
    const credentials = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt,
        notes: {
          store: "Zerah Baby & Kids",
          order_id: order.id,
        },
      }),
    });

    const razorpayOrder = await response.json();

    if (!response.ok) {
      console.error("[create-razorpay-order] Razorpay API error:", {
        status: response.status,
        error: razorpayOrder.error,
        key_prefix: razorpayKeyId.substring(0, 8),
      });
      const description =
        razorpayOrder.error?.description ||
        razorpayOrder.error?.reason ||
        `Razorpay API returned HTTP ${response.status}`;
      throw new Error(description);
    }

    // 8. Update order with Razorpay Order ID
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        razorpay_order_id: razorpayOrder.id,
        payment_method: "razorpay",
      })
      .eq("id", orderId);

    if (updateError) {
      console.error(
        "[create-razorpay-order] Failed to update order with razorpay_order_id:",
        updateError,
      );
    }

    // 9. Return safe response including public key and Razorpay order ID
    return new Response(
      JSON.stringify({
        rzp_order_id: razorpayOrder.id,
        key_id: razorpayKeyId,
        amount: amountInPaise,
        currency: "INR",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = (error as Error).message || "Failed to initialize payment order";
    console.error("[create-razorpay-order] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
