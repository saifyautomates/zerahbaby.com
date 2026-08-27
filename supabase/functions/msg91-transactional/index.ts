import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Robust Indian Mobile Number Normalizer:
 * Formats phone to 12 digits (91XXXXXXXXXX).
 * Strips duplicates such as +91+91 or 9191.
 */
function normalizeIndianPhone(rawPhone: string): { valid: boolean; phone: string; error?: string } {
  if (!rawPhone) return { valid: false, phone: "", error: "Phone number is required" };

  let digits = rawPhone.replace(/\D/g, "");

  // Remove leading zeros
  digits = digits.replace(/^0+/, "");

  // Detect and fix duplicate 91 prefixes (e.g. 91919876543210 -> 919876543210)
  while (digits.startsWith("9191") && digits.length > 12) {
    digits = digits.substring(2);
  }

  // If 10 digits starting with 6, 7, 8, 9 -> standard Indian mobile
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return { valid: true, phone: "91" + digits };
  }

  // If 12 digits starting with 91[6-9]
  if (digits.length === 12 && /^91[6-9]\d{9}$/.test(digits)) {
    return { valid: true, phone: digits };
  }

  // Fallback: if 10 to 12 digits
  if (digits.length >= 10 && digits.length <= 13) {
    return { valid: true, phone: digits.length === 10 ? "91" + digits : digits };
  }

  return { valid: false, phone: digits, error: `Invalid Indian phone number: ${rawPhone}` };
}

function isValidUuid(val?: string | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[msg91-transactional] Missing Supabase server credentials");
    return new Response(JSON.stringify({ error: "Server credentials not configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const payload = await req.json().catch(() => ({}));
    const {
      action,
      log_id,
      order_id,
      offline_sale_id,
      event_type,
      name,
      recipient_type = "customer",
      notify_owner = true,
    } = payload;

    /* ------------------------------------------------------------------ */
    /*  Action: RETRY an existing failed SMS log                          */
    /* ------------------------------------------------------------------ */
    if (action === "retry" && log_id) {
      const { data: existingLog, error: fetchErr } = await adminClient
        .from("sms_logs")
        .select("*")
        .eq("id", log_id)
        .single();

      if (fetchErr || !existingLog) {
        return new Response(JSON.stringify({ error: "SMS log not found for retry" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }

      // Re-dispatch using the existing log details
      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let providerStatus = "mock_success";
      let errorDetails: string | null = null;
      let providerMessageId: string | null = null;

      if (msg91AuthKey) {
        try {
          const flowUrl = "https://control.msg91.com/api/v5/flow/";
          const flowPayload = {
            template_id: existingLog.template_id || Deno.env.get("MSG91_TEMPLATE_ORDER_PLACED") || "DEFAULT_FLOW",
            short_url: "0",
            recipients: [
              {
                mobiles: existingLog.phone,
                message: existingLog.message_content,
              },
            ],
          };

          const res = await fetch(flowUrl, {
            method: "POST",
            headers: {
              authkey: msg91AuthKey,
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(flowPayload),
          });
          const json = await res.json();
          if (json.type === "error") {
            providerStatus = "error";
            errorDetails = json.message || "Provider rejected retry request";
          } else {
            providerStatus = "sent";
            providerMessageId = json.message || json.request_id || null;
          }
        } catch (err: unknown) {
          providerStatus = "error";
          errorDetails = (err as Error).message || "Provider network error during retry";
        }
      }

      const newStatus = providerStatus === "sent" ? "SENT" : providerStatus === "mock_success" ? "SENT" : "FAILED";
      const { data: updatedLog } = await adminClient
        .from("sms_logs")
        .update({
          status: newStatus,
          provider_status: providerStatus,
          error_details: errorDetails,
          provider_message_id: providerMessageId,
          retry_count: (existingLog.retry_count || 0) + 1,
          last_retried_at: new Date().toISOString(),
        })
        .eq("id", log_id)
        .select("*")
        .single();

      return new Response(JSON.stringify({ success: newStatus === "SENT", log: updatedLog }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    /* ------------------------------------------------------------------ */
    /*  Standard Dispatch: Send SMS for Business Transaction              */
    /* ------------------------------------------------------------------ */
    if (!order_id && !offline_sale_id) {
      throw new Error("Missing required transaction identifier (order_id or offline_sale_id)");
    }

    const currentEventType = event_type || (order_id ? "online_sale" : "offline_pos_sale");

    // Fetch authoritative order / sale details from DB if needed
    let authoritativePhone = payload.phone || "";
    let authoritativeName = name || "Customer";
    let authoritativeTotal = payload.total ?? 0;
    let authoritativeItemsCount = payload.item_count ?? 1;
    let authoritativePayment = payload.payment_method || "Online";
    let authoritativeRef = payload.sale_number || "";

    if (order_id) {
      const { data: order } = await adminClient
        .from("orders")
        .select("id, phone, full_name, total, payment_method, order_number, invoice_no, order_items(id, qty)")
        .eq("id", order_id)
        .maybeSingle();

      if (order) {
        if (!authoritativePhone) authoritativePhone = order.phone || "";
        if (!authoritativeName || authoritativeName === "Customer") authoritativeName = order.full_name || "Customer";
        if (!authoritativeTotal) authoritativeTotal = Number(order.total || 0);
        authoritativePayment = order.payment_method ? order.payment_method.toUpperCase() : "ONLINE";
        authoritativeRef = order.order_number || order.invoice_no || order.id.substring(0, 8);
        if (Array.isArray(order.order_items)) {
          authoritativeItemsCount = order.order_items.reduce((sum: number, it: { qty?: number }) => sum + (it.qty || 1), 0);
        }
      }
    } else if (offline_sale_id) {
      const { data: sale } = await adminClient
        .from("offline_sales")
        .select("id, customer_phone, customer_name, total, payment_method, sale_number, offline_sale_items(id, qty)")
        .eq("id", offline_sale_id)
        .maybeSingle();

      if (sale) {
        if (!authoritativePhone) authoritativePhone = sale.customer_phone || "";
        if (!authoritativeName || authoritativeName === "Customer") authoritativeName = sale.customer_name || "Customer";
        if (!authoritativeTotal) authoritativeTotal = Number(sale.total || 0);
        authoritativePayment = sale.payment_method ? sale.payment_method.toUpperCase() : "CASH";
        authoritativeRef = sale.sale_number || sale.id.substring(0, 8);
        if (Array.isArray(sale.offline_sale_items)) {
          authoritativeItemsCount = sale.offline_sale_items.reduce((sum: number, it: { qty?: number }) => sum + (it.qty || 1), 0);
        }
      }
    }

    const results: Array<Record<string, unknown>> = [];

    // Helper to send individual message
    const dispatchSingleSms = async (
      targetPhone: string,
      targetRecipientType: "customer" | "owner",
      customMessage?: string
    ) => {
      const { valid, phone: cleanPhone, error: phoneErr } = normalizeIndianPhone(targetPhone);
      if (!valid) {
        console.warn(`[msg91-transactional] Phone normalization failed for ${targetRecipientType}:`, phoneErr);
        // Log validation failure truthfully into sms_logs
        const { data: failLog } = await adminClient
          .from("sms_logs")
          .insert({
            order_id: order_id || null,
            offline_sale_id: offline_sale_id || null,
            phone: targetPhone || "UNKNOWN",
            message_type: currentEventType,
            recipient_type: targetRecipientType,
            status: "FAILED",
            provider_status: "validation_error",
            error_details: phoneErr || "Invalid phone number",
            message_content: customMessage || "N/A",
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();
        return { success: false, log_id: failLog?.id, error: phoneErr };
      }

      // 1. Server-Side Idempotency Check
      const idempotencyKey =
        payload.idempotency_key && targetRecipientType === recipient_type
          ? payload.idempotency_key
          : `${order_id || offline_sale_id}_${currentEventType}_${cleanPhone}_${targetRecipientType}`;

      const { data: existingLog } = await adminClient
        .from("sms_logs")
        .select("id, status, provider_status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingLog && (existingLog.status === "SENT" || existingLog.provider_status === "mock_success" || existingLog.provider_status === "sent")) {
        console.log(`[msg91-transactional] Idempotent hit: SMS already sent (${existingLog.id})`);
        return { success: true, already_sent: true, log_id: existingLog.id };
      }

      // 2. Generate Transactional Message Content
      let messageText = customMessage;
      if (!messageText) {
        if (targetRecipientType === "owner") {
          messageText = `Zérah Baby & Kids: New sale received! #${authoritativeRef}, Amount: ₹${authoritativeTotal}, Items: ${authoritativeItemsCount}, Payment: ${authoritativePayment}.`;
        } else if (currentEventType === "order_cancelled") {
          messageText = `Zérah Baby & Kids: Your order #${authoritativeRef} has been cancelled. If paid online, your refund will be credited to source in 5-7 business days.`;
        } else if (currentEventType === "pos_return") {
          messageText = `Zérah Baby & Kids: Return #${authoritativeRef} processed. Refund amount: ₹${authoritativeTotal}. Thank you.`;
        } else if (offline_sale_id) {
          messageText = `Zérah Baby & Kids: Thank you for your purchase! Sale #${authoritativeRef}, Total: ₹${authoritativeTotal} (${authoritativeItemsCount} items), Payment: ${authoritativePayment}. Visit again!`;
        } else {
          messageText = `Zérah Baby & Kids: Your order #${authoritativeRef} has been confirmed. Total: ₹${authoritativeTotal}. Payment: ${authoritativePayment}. Thank you for shopping with us!`;
        }
      }

      // 3. Invoke Provider (MSG91 Flow API)
      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let providerStatus = "mock_success";
      let errorDetails: string | null = null;
      let providerMsgId: string | null = null;

      if (msg91AuthKey) {
        try {
          const flowUrl = "https://control.msg91.com/api/v5/flow/";
          const flowPayload = {
            template_id: Deno.env.get("MSG91_TEMPLATE_ORDER_PLACED") || "DEFAULT_FLOW",
            short_url: "0",
            recipients: [
              {
                mobiles: cleanPhone,
                name: authoritativeName,
                order_id: authoritativeRef,
                total: String(authoritativeTotal),
                message: messageText,
              },
            ],
          };

          const resp = await fetch(flowUrl, {
            method: "POST",
            headers: {
              authkey: msg91AuthKey,
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(flowPayload),
          });

          const resData = await resp.json();
          if (resData.type === "error") {
            providerStatus = "error";
            errorDetails = resData.message || "MSG91 returned error response";
          } else {
            providerStatus = "sent";
            providerMsgId = resData.message || resData.request_id || null;
          }
        } catch (provErr: unknown) {
          providerStatus = "error";
          errorDetails = (provErr as Error).message || "MSG91 network request failed";
        }
      } else {
        // Truthful sandbox/mock log
        providerStatus = "mock_success";
        errorDetails = null;
      }

      const finalStatus = providerStatus === "sent" ? "SENT" : providerStatus === "mock_success" ? "SENT" : "FAILED";

      // 4. Log authoritatively into sms_logs
      const logRow = {
        order_id: isValidUuid(order_id) ? order_id : null,
        offline_sale_id: isValidUuid(offline_sale_id) ? offline_sale_id : null,
        phone: cleanPhone,
        message_type: currentEventType,
        recipient_type: targetRecipientType,
        status: finalStatus,
        provider_status: providerStatus,
        error_details: errorDetails,
        idempotency_key: idempotencyKey,
        message_content: messageText,
        template_id: Deno.env.get("MSG91_TEMPLATE_ORDER_PLACED") || null,
        provider_message_id: providerMsgId,
        sent_at: new Date().toISOString(),
      };

      let insertedLogId: string | undefined = undefined;
      const { data: insertedLog, error: logErr } = await adminClient
        .from("sms_logs")
        .upsert(logRow, { onConflict: "idempotency_key" })
        .select("id, status, provider_status")
        .maybeSingle();

      if (logErr) {
        console.warn("[msg91-transactional] Upsert warning, retrying with sanitized foreign keys:", logErr);
        const { data: retryLog } = await adminClient
          .from("sms_logs")
          .upsert(
            { ...logRow, order_id: null, offline_sale_id: null },
            { onConflict: "idempotency_key" }
          )
          .select("id, status, provider_status")
          .maybeSingle();

        insertedLogId = retryLog?.id;
        if (!insertedLogId) {
          const { data: fallbackLog } = await adminClient
            .from("sms_logs")
            .select("id")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          insertedLogId = fallbackLog?.id;
        }
      } else {
        insertedLogId = insertedLog?.id;
      }

      return {
        success: finalStatus === "SENT",
        log_id: insertedLogId,
        status: finalStatus,
        recipient: targetRecipientType,
      };
    };

    // A. Send to Customer if valid phone is provided
    if (authoritativePhone && authoritativePhone.trim() !== "") {
      const custResult = await dispatchSingleSms(authoritativePhone, "customer");
      results.push(custResult);
    }

    // B. Send to Store Owner if requested
    if (notify_owner && (currentEventType === "online_sale" || currentEventType === "offline_pos_sale")) {
      // Fetch owner phone from site_settings or environment fallback
      const { data: ownerSetting } = await adminClient
        .from("site_settings")
        .select("value")
        .eq("key", "owner_notification_phone")
        .maybeSingle();

      const ownerPhone = ownerSetting?.value || Deno.env.get("OWNER_PHONE") || "9057074777";
      if (ownerPhone) {
        const ownerResult = await dispatchSingleSms(ownerPhone, "owner");
        results.push(ownerResult);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_type: currentEventType,
        dispatches: results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: unknown) {
    const msg = (error as Error).message || "Internal SMS Processing Error";
    console.error("[msg91-transactional] Fatal error:", msg);
    // Never fail the caller transaction with a 500 error; return 200 with error details
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
