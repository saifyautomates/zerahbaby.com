import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Authenticate user from JWT token
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      throw new Error("Authentication required to process order refund");
    }

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized: Invalid session");
    }

    // 2. Check admin privileges
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: profileRow } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = roleRow?.role === "admin" || profileRow?.is_admin === true;

    // 3. Parse request payload
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id || body.orderId;
    const reason = body.reason || "Order cancellation refund";
    const overrideAmount = body.amount !== undefined ? Number(body.amount) : undefined;

    if (!orderId) {
      throw new Error("Missing order_id in request payload");
    }

    // 4. Fetch target order
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(
        "id, order_number, user_id, status, payment_status, payment_method, razorpay_payment_id, razorpay_refund_id, razorpay_refund_status, total, phone, full_name, email",
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    // Authorization: User can only trigger refund on their own order (or admin on any order)
    if (order.user_id !== user.id && !isAdmin) {
      throw new Error("Unauthorized: You do not have permission to refund this order");
    }

    // 5. Idempotency Check: Don't double refund
    if (
      order.razorpay_refund_id &&
      (order.razorpay_refund_status === "processed" || order.razorpay_refund_status === "PROCESSED")
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          already_refunded: true,
          refund_id: order.razorpay_refund_id,
          message: "Refund already processed for this order",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const finalAmount = overrideAmount !== undefined ? overrideAmount : Number(order.total || 0);

    if (finalAmount <= 0) {
      throw new Error("Invalid refund amount. Must be greater than zero.");
    }

    // 6. Handle based on Payment Method
    const pMethod = (order.payment_method || "").toLowerCase();
    const isOnlinePaid =
      pMethod.includes("online") ||
      pMethod.includes("razorpay") ||
      Boolean(order.razorpay_payment_id);

    if (!isOnlinePaid) {
      // Offline / COD cancellation refund record
      await adminClient
        .from("orders")
        .update({
          payment_status: "refunded",
          refund_amount: finalAmount,
          refund_notes: `Manual / COD refund recorded: ${reason}`,
          refund_completed_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      await adminClient.from("order_status_history").insert({
        order_id: orderId,
        new_status: order.status,
        note: `Manual refund of ₹${finalAmount} recorded: ${reason}`,
        changed_by: user.id,
      });

      return new Response(
        JSON.stringify({
          success: true,
          manual_refund: true,
          amount: finalAmount,
          message: "COD / offline order marked as refunded",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // 7. Online Order — Authoritative Razorpay REST API Refund
    const paymentId = order.razorpay_payment_id;
    if (!paymentId) {
      throw new Error(
        "Razorpay payment_id missing on order. Cannot issue automated gateway refund.",
      );
    }

    const rawKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeyId = rawKeyId.trim();
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error("Razorpay server API credentials not configured");
    }

    const amountInPaise = Math.round(finalAmount * 100);
    const credentials = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const rzpResponse = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        speed: "optimum",
        notes: {
          order_id: order.id,
          order_number: order.order_number || "",
          store: "Zerah Baby & Kids",
          reason: reason,
        },
      }),
    });

    const rzpData = await rzpResponse.json();

    if (!rzpResponse.ok) {
      console.error("[process-order-cancellation-refund] Razorpay Refund Error:", rzpData);
      const desc =
        rzpData.error?.description ||
        rzpData.error?.reason ||
        `Razorpay refund failed with status ${rzpResponse.status}`;

      // Record failed refund attempt in order
      await adminClient
        .from("orders")
        .update({
          razorpay_refund_status: "FAILED",
          refund_notes: `Gateway refund failed: ${desc}`,
        })
        .eq("id", orderId);

      throw new Error(desc);
    }

    // 8. Record successful refund in database
    const refundId = rzpData.id;
    const refundStatus = rzpData.status || "processed";

    await adminClient
      .from("orders")
      .update({
        razorpay_refund_id: refundId,
        razorpay_refund_status: refundStatus,
        payment_status: "refunded",
        refund_amount: Number(rzpData.amount || amountInPaise) / 100,
        refund_completed_at: new Date().toISOString(),
        refund_notes: reason,
      })
      .eq("id", orderId);

    // Insert history
    await adminClient.from("order_status_history").insert({
      order_id: orderId,
      new_status: "cancelled",
      note: `Razorpay refund of ₹${finalAmount} processed (Refund ID: ${refundId})`,
      changed_by: user.id,
    });

    // 9. Dispatch transactional notification SMS (non-blocking)
    try {
      fetch(`${supabaseUrl}/functions/v1/msg91-transactional`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          order_id: orderId,
          event_type: "order_cancelled",
          total: finalAmount,
          sale_number: order.order_number,
          notify_owner: true,
        }),
      }).catch((smsErr) => console.warn("[refund] SMS notify error:", smsErr));
    } catch {
      // Non-blocking
    }

    return new Response(
      JSON.stringify({
        success: true,
        refund_id: refundId,
        amount: finalAmount,
        status: refundStatus,
        message: `Refund of ₹${finalAmount} successfully initiated via Razorpay`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err: unknown) {
    const message = (err as Error).message || "Internal server error during refund processing";
    console.error("[process-order-cancellation-refund] Exception:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
