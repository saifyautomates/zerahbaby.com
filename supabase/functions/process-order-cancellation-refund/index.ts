import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[refund] Supabase server credentials not configured");
      return jsonResponse(
        { success: false, error: "Supabase server credentials not configured" },
        500,
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Authenticate user from JWT token
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return jsonResponse(
        { success: false, error: "Authentication required to process order refund" },
        401,
      );
    }

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse(
        { success: false, error: "Unauthorized: Invalid or expired session" },
        401,
      );
    }

    // 2. Authoritative Admin Role Verification
    // Canonical check order: user_roles, admin_allowlist, profiles, then has_role RPC
    let isAdmin = false;

    // Check user_roles table
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (
      roleRow?.role === "admin" ||
      roleRow?.role === "owner" ||
      roleRow?.role === "manager" ||
      roleRow?.role === "staff"
    ) {
      isAdmin = true;
    }

    // Check admin_allowlist by email
    if (!isAdmin && user.email) {
      const { data: allowRow } = await adminClient
        .from("admin_allowlist")
        .select("email")
        .eq("email", user.email.toLowerCase().trim())
        .maybeSingle();

      if (allowRow) {
        isAdmin = true;
      }
    }

    // Check profiles.is_admin
    if (!isAdmin) {
      const { data: profileRow } = await adminClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (profileRow?.is_admin === true) {
        isAdmin = true;
      }
    }

    // Fallback RPC check
    if (!isAdmin) {
      const { data: rpcAdmin } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (rpcAdmin === true) {
        isAdmin = true;
      }
    }

    // 3. Parse Request Payload
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id || body.orderId;
    const reason = (body.reason || "Admin initiated cancellation refund").trim();
    const requestedOverrideAmount =
      body.amount !== undefined && body.amount !== null ? Number(body.amount) : undefined;

    if (!orderId) {
      return jsonResponse({ success: false, error: "Missing order_id in request payload" }, 400);
    }

    // 4. Fetch target order
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select(
        "id, order_number, user_id, status, payment_status, payment_method, razorpay_payment_id, razorpay_order_id, razorpay_refund_id, razorpay_refund_status, total, refund_amount, phone, full_name, email",
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.warn(`[refund] Target order ${orderId} not found`);
      return jsonResponse({ success: false, error: "Target order not found" }, 404);
    }

    // Authorization: Admin can refund any order; customer can only refund their own order
    if (order.user_id !== user.id && !isAdmin) {
      return jsonResponse(
        { success: false, error: "Unauthorized: You do not have permission to refund this order" },
        403,
      );
    }

    // 5. Idempotency Guard (DB level)
    if (
      order.razorpay_refund_id &&
      order.payment_status === "refunded" &&
      (order.razorpay_refund_status === "processed" ||
        order.razorpay_refund_status === "PROCESSED" ||
        order.razorpay_refund_status === "captured")
    ) {
      return jsonResponse({
        success: true,
        already_refunded: true,
        refund_id: order.razorpay_refund_id,
        amount: Number(order.refund_amount || order.total || 0),
        message: "Refund has already been processed for this order",
      });
    }

    // 6. Handle COD / Offline orders (no Razorpay gateway interaction required)
    const pMethod = (order.payment_method || "").toLowerCase();
    const isOnline =
      pMethod.includes("online") ||
      pMethod.includes("razorpay") ||
      Boolean(order.razorpay_payment_id);

    if (!isOnline) {
      const manualAmount =
        requestedOverrideAmount !== undefined ? requestedOverrideAmount : Number(order.total || 0);

      if (manualAmount <= 0) {
        return jsonResponse(
          { success: false, error: "Refund amount must be greater than zero" },
          400,
        );
      }

      await adminClient
        .from("orders")
        .update({
          payment_status: "refunded",
          refund_amount: manualAmount,
          refund_notes: `Manual / COD refund recorded: ${reason}`,
          refund_completed_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      await adminClient.from("order_status_history").insert({
        order_id: orderId,
        new_status: order.status,
        note: `Manual refund of ₹${manualAmount} recorded: ${reason}`,
        changed_by: user.id,
      });

      return jsonResponse({
        success: true,
        manual_refund: true,
        amount: manualAmount,
        message: "COD / offline order marked as refunded",
      });
    }

    // 7. Validate Razorpay payment ID on online order
    const paymentId = (order.razorpay_payment_id || "").trim();
    if (!paymentId) {
      return jsonResponse(
        {
          success: false,
          error:
            "Razorpay payment ID is missing on this order. Cannot issue automated gateway refund.",
        },
        400,
      );
    }

    // 8. Load & Validate Razorpay Server Secrets
    const rawKeyId = (Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
    const rawKeySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") || "").trim();

    if (!rawKeyId || !rawKeySecret) {
      console.error("[refund] Razorpay API credentials missing in server environment");
      return jsonResponse(
        { success: false, error: "Razorpay server API credentials not configured" },
        500,
      );
    }

    // 9. Detect Mock/Test Tokens against Live Keys
    const isLiveKey = rawKeyId.startsWith("rzp_live_");
    const isMockToken =
      paymentId.startsWith("pay_test_") ||
      paymentId.startsWith("test_") ||
      paymentId.startsWith("order_paid_") ||
      !/^pay_[a-zA-Z0-9]+$/.test(paymentId);

    if (isLiveKey && isMockToken) {
      const safeMockMsg = `Cannot refund: Payment ID '${paymentId}' is a mock test token and does not exist on live Razorpay.`;
      console.warn(`[refund] ${safeMockMsg}`);

      // Record diagnostic failure in database
      await adminClient.rpc("record_order_refund_failure", {
        _order_id: orderId,
        _failure_reason: safeMockMsg,
        _admin_id: user.id,
      });

      return jsonResponse({ success: false, error: safeMockMsg }, 400);
    }

    const credentials = btoa(`${rawKeyId}:${rawKeySecret}`);
    const rzpAuthHeader = {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    };

    // 10. Pre-Flight Gateway Verification: Fetch payment details from Razorpay
    console.log(`[refund] Verifying payment ${paymentId} on Razorpay gateway...`);
    const payCheckRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: "GET",
      headers: rzpAuthHeader,
    });

    if (!payCheckRes.ok) {
      const errBody = await payCheckRes.json().catch(() => ({}));
      const rzpErrDesc =
        errBody.error?.description ||
        errBody.error?.reason ||
        `Razorpay payment lookup failed with status ${payCheckRes.status}`;

      console.error(`[refund] Payment verification failed: ${rzpErrDesc}`);

      // Record failure attempt atomically
      await adminClient.rpc("record_order_refund_failure", {
        _order_id: orderId,
        _failure_reason: rzpErrDesc,
        _admin_id: user.id,
      });

      const userFacingMsg =
        payCheckRes.status === 404
          ? `Payment ID '${paymentId}' was not found on Razorpay gateway. Please verify payment records.`
          : payCheckRes.status === 401
            ? "Razorpay API authentication failed. Server credentials may be invalid."
            : `Razorpay error: ${rzpErrDesc}`;

      return jsonResponse({ success: false, error: userFacingMsg }, 400);
    }

    const paymentData = await payCheckRes.json();

    // 11. Validate Payment Gateway State
    // Check if payment was already refunded directly on Razorpay
    if (
      paymentData.status === "refunded" ||
      (paymentData.amount_refunded && paymentData.amount_refunded >= paymentData.amount)
    ) {
      console.log(
        `[refund] Payment ${paymentId} is already refunded on Razorpay. Synchronizing DB.`,
      );

      // Query existing refunds for this payment
      const refundsRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds`, {
        method: "GET",
        headers: rzpAuthHeader,
      });
      const refundsData = await refundsRes.json().catch(() => ({}));
      const existingRefund = refundsData.items?.[0] || {};
      const existingRefundId = existingRefund.id || order.razorpay_refund_id || "EXT_REFUND";
      const refundedRupees = (paymentData.amount_refunded || paymentData.amount) / 100;

      // Reconcile database atomically
      await adminClient.rpc("record_order_refund_success", {
        _order_id: orderId,
        _refund_id: existingRefundId,
        _refund_status: "processed",
        _refund_amount: refundedRupees,
        _notes: "Synchronized from confirmed gateway refund: " + reason,
        _admin_id: user.id,
      });

      return jsonResponse({
        success: true,
        already_refunded: true,
        refund_id: existingRefundId,
        amount: refundedRupees,
        message: "Payment was already refunded on Razorpay. Synchronized database records.",
      });
    }

    if (paymentData.status !== "captured") {
      const msg = `Cannot refund payment: Razorpay payment status is '${paymentData.status}'. Only captured payments can be refunded.`;
      console.warn(`[refund] ${msg}`);

      await adminClient.rpc("record_order_refund_failure", {
        _order_id: orderId,
        _failure_reason: msg,
        _admin_id: user.id,
      });

      return jsonResponse({ success: false, error: msg }, 400);
    }

    // 12. Server-Side Refund Amount Calculation & Validation
    const gatewayCapturedPaise = Number(paymentData.amount || 0);
    const gatewayRefundedPaise = Number(paymentData.amount_refunded || 0);
    const gatewayRemainingPaise = Math.max(0, gatewayCapturedPaise - gatewayRefundedPaise);

    const orderTotalRupees = Number(order.total || 0);
    const orderAlreadyRefundedRupees = Number(order.refund_amount || 0);
    const orderRemainingRupees =
      order.payment_status === "refunded"
        ? 0
        : Math.max(0, orderTotalRupees - orderAlreadyRefundedRupees);
    const orderRemainingPaise = Math.round(orderRemainingRupees * 100);

    const maxRefundablePaise = Math.min(gatewayRemainingPaise, orderRemainingPaise);

    if (maxRefundablePaise <= 0) {
      const msg = "Payment has already been fully refunded. No refundable balance remains.";
      return jsonResponse({ success: false, error: msg }, 400);
    }

    let refundPaiseToExecute = maxRefundablePaise;

    if (requestedOverrideAmount !== undefined) {
      const reqPaise = Math.round(requestedOverrideAmount * 100);
      if (reqPaise <= 0) {
        return jsonResponse(
          { success: false, error: "Refund amount must be greater than zero." },
          400,
        );
      }
      if (reqPaise > maxRefundablePaise) {
        const maxRupees = (maxRefundablePaise / 100).toFixed(2);
        return jsonResponse(
          {
            success: false,
            error: `Requested refund amount (₹${requestedOverrideAmount}) exceeds the maximum refundable balance of ₹${maxRupees}.`,
          },
          400,
        );
      }
      refundPaiseToExecute = reqPaise;
    }

    const refundAmountRupees = refundPaiseToExecute / 100;
    console.log(
      `[refund] Issuing refund of ₹${refundAmountRupees} (${refundPaiseToExecute} paise) for order ${orderId}`,
    );

    // 13. Call Razorpay Refund API
    const rzpRefundRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: rzpAuthHeader,
      body: JSON.stringify({
        amount: refundPaiseToExecute,
        speed: "optimum",
        receipt: order.order_number || order.id,
        notes: {
          order_id: order.id,
          order_number: order.order_number || "",
          store: "Zerah Baby & Kids",
          reason: reason,
        },
      }),
    });

    const rzpRefundData = await rzpRefundRes.json().catch(() => ({}));

    // 14. Handle Razorpay API Failure
    if (!rzpRefundRes.ok) {
      console.error("[refund] Razorpay Refund API Error:", rzpRefundData);
      const desc =
        rzpRefundData.error?.description ||
        rzpRefundData.error?.reason ||
        `Razorpay refund failed with HTTP status ${rzpRefundRes.status}`;

      // Record failed refund attempt in order
      await adminClient.rpc("record_order_refund_failure", {
        _order_id: orderId,
        _failure_reason: desc,
        _admin_id: user.id,
      });

      return jsonResponse({ success: false, error: `Gateway rejected refund: ${desc}` }, 400);
    }

    // 15. Record Confirmed Refund Atomically in Database
    const refundId = rzpRefundData.id;
    const refundStatus = rzpRefundData.status || "processed";
    const confirmedAmount = Number(rzpRefundData.amount || refundPaiseToExecute) / 100;

    console.log(`[refund] Razorpay refund succeeded: ${refundId}, status: ${refundStatus}`);

    let dbUpdated = false;
    try {
      const { data: rpcRes, error: rpcErr } = await adminClient.rpc("record_order_refund_success", {
        _order_id: orderId,
        _refund_id: refundId,
        _refund_status: refundStatus,
        _refund_amount: confirmedAmount,
        _notes: reason,
        _admin_id: user.id,
      });

      if (!rpcErr && rpcRes?.success) {
        dbUpdated = true;
      } else {
        console.warn("[refund] record_order_refund_success RPC notice:", rpcErr);
      }
    } catch (e) {
      console.warn("[refund] RPC call error:", e);
    }

    // Fallback direct update if RPC had an issue
    if (!dbUpdated) {
      console.warn("[refund] Executing direct table update fallback for refund record");
      try {
        await adminClient
          .from("orders")
          .update({
            razorpay_refund_id: refundId,
            razorpay_refund_status: refundStatus,
            payment_status: "refunded",
            refund_amount: confirmedAmount,
            refund_completed_at: new Date().toISOString(),
            refund_notes: reason,
          })
          .eq("id", orderId);

        await adminClient.from("order_status_history").insert({
          order_id: orderId,
          new_status: order.status,
          note: `Razorpay refund of ₹${confirmedAmount} processed (Refund ID: ${refundId})`,
          changed_by: user.id,
        });

        dbUpdated = true;
      } catch (fallbackErr) {
        // Critical: Gateway succeeded, but DB failed. Log with maximum detail.
        console.error(
          `[CRITICAL] Gateway refund succeeded (${refundId}) for order ${orderId}, but DB record failed:`,
          fallbackErr,
        );
      }
    }

    // 16. Dispatch Transactional Notification SMS (non-blocking)
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
          total: confirmedAmount,
          sale_number: order.order_number,
          notify_owner: true,
        }),
      }).catch((smsErr) => console.warn("[refund] SMS notify error:", smsErr));
    } catch {
      // Non-blocking
    }

    return jsonResponse({
      success: true,
      refund_id: refundId,
      amount: confirmedAmount,
      status: refundStatus,
      message: `Refund of ₹${confirmedAmount} successfully processed via Razorpay (Refund ID: ${refundId})`,
    });
  } catch (err: unknown) {
    const message = (err as Error).message || "Internal server error during refund processing";
    console.error("[refund] Unhandled exception:", message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
