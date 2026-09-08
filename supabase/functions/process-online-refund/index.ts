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

    if (!token) throw new Error("Missing Authorization header");

    const {
      data: { user },
    } = await adminClient.auth.getUser(token);

    if (!user) throw new Error("Invalid token");

    // Canonical Admin Role Verification
    let isAdmin = false;

    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleRow?.role === "admin") {
      isAdmin = true;
    }

    if (!isAdmin && user.email) {
      const { data: allowRow } = await adminClient
        .from("admin_allowlist")
        .select("email")
        .eq("email", user.email.toLowerCase().trim())
        .maybeSingle();
      if (allowRow) isAdmin = true;
    }

    if (!isAdmin) {
      const { data: profileRow } = await adminClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (profileRow?.is_admin === true) isAdmin = true;
    }

    if (!isAdmin) {
      const { data: rpcAdmin } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (rpcAdmin === true) isAdmin = true;
    }

    if (!isAdmin) {
      throw new Error("Unauthorized: Admin privileges required to process refunds");
    }

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const { return_id, override_amount, notes } = body;

    if (!return_id) {
      throw new Error("Missing required parameter: return_id");
    }

    // 3. Fetch online return record
    const { data: ret, error: retErr } = await adminClient
      .from("online_returns")
      .select("*, orders(*)")
      .eq("id", return_id)
      .single();

    if (retErr || !ret) {
      throw new Error("Return record not found: " + (retErr?.message || ""));
    }

    if (ret.refund_status === "PROCESSED") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Refund already processed for this return",
          refund_id: ret.razorpay_refund_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const order = ret.orders;
    if (!order) {
      throw new Error("Associated order not found for this return");
    }

    const finalAmount = Number(
      override_amount !== undefined ? override_amount : ret.final_refund_amount,
    );

    if (finalAmount <= 0) {
      // If amount is 0 (e.g. shipping fee exceeded refund), complete return without gateway call
      await adminClient.rpc("admin_record_online_refund", {
        _return_id: return_id,
        _refund_amount: 0,
        _refund_method: "none",
        _gateway_refund_id: "ZERO_REFUND",
        _notes: notes || "Zero-value return completion",
      });

      return new Response(
        JSON.stringify({
          success: true,
          zero_refund: true,
          message: "Return completed with 0 refund",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // 4. Handle based on original payment method
    const paymentMethod = (order.payment_method || "").toLowerCase();
    const isOnlinePaid =
      paymentMethod.includes("razorpay") ||
      paymentMethod.includes("online") ||
      Boolean(order.razorpay_payment_id);

    if (!isOnlinePaid) {
      // For COD or offline orders: manual bank transfer record
      await adminClient.rpc("admin_record_online_refund", {
        _return_id: return_id,
        _refund_amount: finalAmount,
        _refund_method: "bank_transfer_manual",
        _gateway_refund_id: "MANUAL_" + Date.now(),
        _notes: notes || "Manual bank transfer for COD return",
      });

      return new Response(
        JSON.stringify({
          success: true,
          manual_refund: true,
          amount: finalAmount,
          message: "COD refund recorded as manual bank transfer",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // 5. Online Order — Call Razorpay Refunds API
    const paymentId = (order.razorpay_payment_id || "").trim();
    if (!paymentId) {
      throw new Error("Razorpay Payment ID missing on order. Cannot initiate automated refund.");
    }

    const rawKeyId = (Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
    const rawKeySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") || "").trim();

    if (!rawKeyId || !rawKeySecret) {
      throw new Error("Razorpay API credentials not configured on server");
    }

    // Detect mock tokens on live keys
    const isLiveKey = rawKeyId.startsWith("rzp_live_");
    const isMockToken =
      paymentId.startsWith("pay_test_") ||
      paymentId.startsWith("test_") ||
      paymentId.startsWith("order_paid_") ||
      !/^pay_[a-zA-Z0-9]+$/.test(paymentId);

    if (isLiveKey && isMockToken) {
      throw new Error(
        `Cannot refund: Payment ID '${paymentId}' is a mock token and does not exist on live Razorpay.`,
      );
    }

    const credentials = btoa(`${rawKeyId}:${rawKeySecret}`);
    const rzpAuthHeader = {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    };

    // Pre-flight check on payment status
    const payCheckRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: rzpAuthHeader,
    });

    if (!payCheckRes.ok) {
      const errBody = await payCheckRes.json().catch(() => ({}));
      const rzpErrDesc =
        errBody.error?.description ||
        `Razorpay payment lookup failed with status ${payCheckRes.status}`;
      throw new Error(rzpErrDesc);
    }

    const paymentData = await payCheckRes.json();

    // Check if payment was already refunded directly on Razorpay
    if (
      paymentData.status === "refunded" ||
      (paymentData.amount_refunded && paymentData.amount_refunded >= paymentData.amount)
    ) {
      const refundsRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds`, {
        method: "GET",
        headers: rzpAuthHeader,
      });
      const refundsData = await refundsRes.json().catch(() => ({}));
      const existingRefund = refundsData.items?.[0] || {};
      const existingRefundId = existingRefund.id || ret.razorpay_refund_id || "EXT_REFUND";

      await adminClient.rpc("admin_record_online_refund", {
        _return_id: return_id,
        _refund_amount: finalAmount,
        _refund_method: "razorpay",
        _gateway_refund_id: existingRefundId,
        _notes: notes || "Synchronized from confirmed gateway refund",
      });

      return new Response(
        JSON.stringify({
          success: true,
          already_refunded: true,
          refund_id: existingRefundId,
          amount: finalAmount,
          message: "Payment was already refunded on Razorpay. Synchronized database records.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (paymentData.status !== "captured") {
      throw new Error(
        `Cannot refund payment: Razorpay payment status is '${paymentData.status}'. Only captured payments can be refunded.`,
      );
    }

    const amountInPaise = Math.round(finalAmount * 100);

    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: rzpAuthHeader,
      body: JSON.stringify({
        amount: amountInPaise,
        speed: "optimum",
        notes: {
          return_number: ret.return_number,
          order_id: order.id,
          store: "Zerah Baby & Kids",
        },
      }),
    });

    const rzpData = await rzpRes.json();

    if (!rzpRes.ok) {
      console.error("[process-online-refund] Razorpay Refund Error:", rzpData);
      const desc =
        rzpData.error?.description || `Razorpay refund failed with status ${rzpRes.status}`;
      throw new Error(desc);
    }

    // 6. Record refund atomically in database
    await adminClient.rpc("admin_record_online_refund", {
      _return_id: return_id,
      _refund_amount: finalAmount,
      _refund_method: "razorpay",
      _gateway_refund_id: rzpData.id,
      _notes: notes || "Razorpay automated refund initiated",
    });

    return new Response(
      JSON.stringify({
        success: true,
        refund_id: rzpData.id,
        amount: finalAmount,
        currency: "INR",
        status: rzpData.status,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err: unknown) {
    const message = (err as Error).message || "Failed to process refund";
    console.error("[process-online-refund] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
