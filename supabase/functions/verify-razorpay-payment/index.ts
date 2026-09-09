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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, session_id } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing required Razorpay payment verification parameters");
    }

    // 3. Resolve Secret & Query Server-Stored Payment Attempt (Authoritative Order ID)
    const rawKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
    const rawKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
    const razorpayKeyId = rawKeyId.trim();
    const razorpayKeySecret = rawKeySecret.trim();

    if (!razorpayKeySecret) {
      throw new Error("Razorpay secret not configured on server");
    }

    // Server-Authoritative Order ID Check: Query payment_attempts for original stored record
    let authoritativeOrderId = razorpay_order_id;
    const { data: attemptRecord, error: attemptErr } = await adminClient
      .from("payment_attempts")
      .select("id, razorpay_order_id, checkout_session_id, amount, status")
      .eq("razorpay_order_id", razorpay_order_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptRecord?.razorpay_order_id) {
      authoritativeOrderId = attemptRecord.razorpay_order_id;
    } else {
      console.warn(
        "[verify-razorpay-payment] Notice: No pre-existing payment attempt row found for",
        razorpay_order_id,
      );
    }

    const signaturePayload = `${authoritativeOrderId}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", razorpayKeySecret)
      .update(signaturePayload)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("[verify-razorpay-payment] Signature mismatch:", {
        orderId: authoritativeOrderId,
        paymentId: razorpay_payment_id,
      });

      // Track verification failure
      try {
        await adminClient.rpc("update_payment_attempt_status", {
          _razorpay_order_id: authoritativeOrderId,
          _status: "verification_failed",
          _error_message: "Invalid payment verification signature",
        });
      } catch (e: unknown) {
        console.warn("Failed to record failure status:", e);
      }

      throw new Error("Invalid payment verification signature");
    }

    // 4. Optionally query Razorpay API to independently verify payment status & amount
    let verifiedAmountInPaise = 0;
    if (razorpayKeyId && razorpayKeySecret) {
      try {
        const credentials = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
        const rzpPayRes = await fetch(
          `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
          {
            headers: { Authorization: `Basic ${credentials}` },
          },
        );
        if (rzpPayRes.ok) {
          const payData = await rzpPayRes.json();
          if (payData.currency !== "INR") {
            throw new Error(`Unsupported currency: ${payData.currency}`);
          }
          if (payData.order_id && payData.order_id !== razorpay_order_id) {
            throw new Error("Razorpay payment order mismatch");
          }
          verifiedAmountInPaise = payData.amount;
        }
      } catch (err: unknown) {
        console.warn(
          "[verify-razorpay-payment] Razorpay API payment check notice:",
          (err as Error).message,
        );
      }
    }

    // 5. Call authoritative canonical RPC to finalize paid order atomically
    const { data: finalRes, error: finalErr } = await adminClient.rpc("finalize_paid_order", {
      _session_id: session_id || null,
      _razorpay_order_id: razorpay_order_id,
      _razorpay_payment_id: razorpay_payment_id,
      _razorpay_signature: razorpay_signature,
      _verified_amount: verifiedAmountInPaise > 0 ? verifiedAmountInPaise : null,
    });

    let orderId: string | null = null;
    let orderNumber: string | null = null;
    let invoiceNo: string | null = null;
    let isDuplicate = false;

    if (finalErr) {
      console.warn(
        "[verify-razorpay-payment] finalize_paid_order error, checking legacy order:",
        finalErr,
      );

      // Fallback for pre-session legacy orders
      const { data: legacyOrder } = await adminClient
        .from("orders")
        .select("id, order_number, invoice_no, user_id, status, payment_status")
        .eq("razorpay_order_id", razorpay_order_id)
        .maybeSingle();

      if (legacyOrder) {
        orderId = legacyOrder.id;
        orderNumber = legacyOrder.order_number;
        invoiceNo = legacyOrder.invoice_no;
        isDuplicate = legacyOrder.payment_status === "paid";

        if (!isDuplicate) {
          await adminClient
            .from("orders")
            .update({
              status: "processing",
              payment_status: "paid",
              razorpay_payment_id,
              razorpay_signature,
            })
            .eq("id", legacyOrder.id);
        }
      } else {
        // Stock exhaustion or finalization error after successful payment capture!
        // Automatically issue an immediate refund via Razorpay to prevent customer funds in limbo
        let autoRefundIssued = false;
        if (razorpayKeyId && razorpayKeySecret) {
          try {
            const credentials = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
            const refundRes = await fetch(
              `https://api.razorpay.com/v1/payments/${razorpay_payment_id}/refund`,
              {
                method: "POST",
                headers: {
                  Authorization: `Basic ${credentials}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  notes: {
                    reason: "Order finalization failed / Stock exhausted",
                    error: finalErr.message,
                    razorpay_order_id,
                  },
                }),
              },
            );

            if (refundRes.ok) {
              const refundData = await refundRes.json();
              autoRefundIssued = true;
              console.log("[verify-razorpay-payment] Auto-refund successful:", refundData.id);
            } else {
              const errBody = await refundRes.text();
              console.error("[verify-razorpay-payment] Auto-refund API error:", errBody);
            }
          } catch (refErr: unknown) {
            console.error("[verify-razorpay-payment] Auto-refund request failed:", refErr);
          }
        }

        // Record failure status on payment_attempts
        try {
          await adminClient
            .from("payment_attempts")
            .update({
              status: autoRefundIssued ? "refunded_stock_exhausted" : "failed_finalization",
              razorpay_payment_id,
              error_message: finalErr.message || "Finalize order failed",
            })
            .eq("razorpay_order_id", razorpay_order_id);
        } catch {
          // Non-blocking log
        }

        const userMsg = autoRefundIssued
          ? `Stock was exhausted while completing payment. A full refund has been automatically initiated to your payment method.`
          : finalErr.message || "Failed to finalize paid order. Please contact support.";

        throw new Error(userMsg);
      }
    } else {
      orderId = finalRes.order_id;
      orderNumber = finalRes.order_number;
      invoiceNo = finalRes.invoice_no;
      isDuplicate = Boolean(finalRes.duplicate);
    }

    // 6. Trigger notifications & shipment creation EXACTLY ONCE (skip if duplicate)
    if (orderId && !isDuplicate) {
      // Trigger Owner Sale Notification Email (non-blocking)
      try {
        fetch(`${supabaseUrl}/functions/v1/send-owner-sale-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: "online_order",
            order_id: orderId,
          }),
        }).catch((notifyErr) => {
          console.warn("[verify-razorpay-payment] Owner notification error:", notifyErr);
        });
      } catch {
        // Non-blocking
      }

      // Trigger Transactional SMS for Online Order (Customer + Owner) (non-blocking)
      try {
        fetch(`${supabaseUrl}/functions/v1/msg91-transactional`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            order_id: orderId,
            event_type: "online_sale",
            notify_owner: true,
          }),
        }).catch((smsErr) => {
          console.warn("[verify-razorpay-payment] SMS dispatch non-blocking error:", smsErr);
        });
      } catch {
        // Non-blocking
      }

      // Automatically trigger Shiprocket Shipment Creation (non-blocking)
      try {
        fetch(`${supabaseUrl}/functions/v1/shiprocket-api`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            action: "create_shipment",
            orderId: orderId,
          }),
        }).catch((srErr) => {
          console.warn("[verify-razorpay-payment] Shiprocket auto sync non-blocking error:", srErr);
        });
      } catch {
        // Non-blocking
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: orderId,
        order_number: orderNumber,
        invoice_no: invoiceNo,
        already_paid: isDuplicate,
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
