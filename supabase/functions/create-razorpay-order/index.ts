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
    const { orderId, sessionId } = body;
    if (!orderId && !sessionId) {
      throw new Error("Missing sessionId or orderId in request payload");
    }

    // Resolve Razorpay API Credentials
    const rawKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeyId = rawKeyId.trim();
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Razorpay credentials not configured on server");
    }

    let amountInPaise = 0;
    let receipt = "";
    const notes: Record<string, string> = { store: "Zerah Baby & Kids" };
    let targetSessionId: string | null = null;
    let targetOrderId: string | null = null;

    if (sessionId) {
      // 3A. Primary flow: Checkout Session based
      const { data: session, error: sessError } = await adminClient
        .from("checkout_sessions")
        .select("id, session_id, user_id, total, status, payment_method")
        .eq("session_id", sessionId)
        .single();

      if (sessError || !session) {
        throw new Error("Checkout session not found or expired");
      }

      if (session.status === "converted") {
        throw new Error("This checkout session has already been completed");
      }

      if (
        session.user_id &&
        authenticatedUserId &&
        session.user_id !== authenticatedUserId &&
        !isAdmin
      ) {
        throw new Error("Unauthorized access to this checkout session");
      }

      amountInPaise = Math.round(Number(session.total) * 100);
      receipt = `cs_${String(sessionId)
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 30)}`;
      notes.session_id = session.session_id;
      targetSessionId = session.session_id;
    } else {
      // 3B. Backward compatibility: Order based
      const { data: order, error: orderError } = await adminClient
        .from("orders")
        .select("id, user_id, total, status, payment_status, payment_method, razorpay_order_id")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        throw new Error("Order not found in store records");
      }

      if (
        order.user_id &&
        authenticatedUserId &&
        order.user_id !== authenticatedUserId &&
        !isAdmin
      ) {
        throw new Error("Unauthorized access to this order");
      }

      if (
        order.payment_status === "paid" ||
        order.status === "processing" ||
        order.status === "confirmed"
      ) {
        throw new Error("This order has already been paid and confirmed");
      }

      amountInPaise = Math.round(Number(order.total) * 100);
      receipt = `rcpt_${String(orderId).replace(/-/g, "").substring(0, 16)}`;
      notes.order_id = order.id;
      targetOrderId = order.id;
    }

    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      throw new Error(`Invalid amount calculation: ${amountInPaise}`);
    }

    // 4. Create Razorpay Order via Official API
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
        notes,
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

    // 5. Track attempt in database
    if (targetSessionId) {
      const { error: rpcErr } = await adminClient.rpc("record_payment_attempt", {
        _session_id: targetSessionId,
        _razorpay_order_id: razorpayOrder.id,
        _amount: amountInPaise / 100,
        _currency: "INR",
      });
      if (rpcErr) {
        console.error("[create-razorpay-order] record_payment_attempt error:", rpcErr);
      }
    }

    if (targetOrderId) {
      await adminClient
        .from("orders")
        .update({
          razorpay_order_id: razorpayOrder.id,
          payment_method: "razorpay",
        })
        .eq("id", targetOrderId);
    }

    // 6. Return safe response including public key and Razorpay order ID
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
