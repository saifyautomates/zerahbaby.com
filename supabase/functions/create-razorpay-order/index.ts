import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

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

    const { orderId } = await req.json();
    if (!orderId) throw new Error("Missing orderId");

    // We use the service key to bypass RLS and fetch the order details
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id, user_id, total, status")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    // Verify order belongs to the user
    if (order.user_id !== user.id) {
      throw new Error("Unauthorized access to this order");
    }

    const rawKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeyId = rawKeyId.trim();
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeyId || !razorpayKeySecret) {
      console.error(
        "[create-razorpay-order] Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in secrets",
      );
      throw new Error("Razorpay credentials not configured on server");
    }

    // Razorpay amounts are in paise (smallest currency unit), so multiply by 100
    // Total is calculated server-side in place_order RPC, so it's safe to use.
    const amountInPaise = Math.round(Number(order.total) * 100);

    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      throw new Error(`Invalid order amount: ${order.total}`);
    }

    // Clean receipt ID (max 40 chars for Razorpay)
    const receipt = `rcpt_${String(orderId).replace(/-/g, "").substring(0, 16)}`;

    // Call Razorpay API
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
        `Razorpay API returned status ${response.status}`;
      throw new Error(description);
    }

    // Save Razorpay Order ID to our orders table
    const { error: updateError } = await adminClient
      .from("orders")
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq("id", orderId);

    if (updateError) {
      console.error(
        "[create-razorpay-order] Failed to update order with razorpay_order_id:",
        updateError,
      );
      throw updateError;
    }

    return new Response(JSON.stringify({ rzp_order_id: razorpayOrder.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    const message = (error as Error).message || "Failed to create Razorpay order";
    console.error("[create-razorpay-order] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
