import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_NAME = "Zerah Baby & Kids";
const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";
const SMS_TIMEOUT_MS = 10_000;

// Template Configuration:
// Maps each event+recipient pair to the correct MSG91 DLT template
// and the exact DLT-approved var names (var1, var2, var3).

const TEMPLATE_CONFIG = {
  // Template 2: Online Order Confirmed - var1=Order ID, var2=Total
  online_sale_customer: {
    templateId: "6aa1cd275f81de31570d50e2",
    secretKey: "MSG91_TEMPLATE_ORDER_CONFIRMED",
    requiredVars: ["var1", "var2"],
    buildVars: (ctx) => ({ var1: String(ctx.ref || ""), var2: String(ctx.total ?? "") }),
  },
  // Template 4: New Online Order Admin - var1=Order ID, var2=Customer Name, var3=Amount
  online_sale_owner: {
    templateId: "6aa1d097daacdd8930018922",
    secretKey: "MSG91_TEMPLATE_NEW_ORDER_ADMIN",
    requiredVars: ["var1", "var2", "var3"],
    buildVars: (ctx) => ({ var1: String(ctx.ref || ""), var2: String(ctx.name || ""), var3: String(ctx.total ?? "") }),
  },
  // Template 3: Order Delivered - var1=Customer Name, var2=Order ID
  order_delivered_customer: {
    templateId: "6aa1cf5471e712fa250b1732",
    secretKey: "MSG91_TEMPLATE_ORDER_DELIVERED",
    requiredVars: ["var1", "var2"],
    buildVars: (ctx) => ({ var1: String(ctx.name || ""), var2: String(ctx.ref || "") }),
  },
  // Template 5: Offline Purchase - var1=Transaction ID, var2=Amount, var3=Store
  offline_pos_sale_customer: {
    templateId: "6aa1cb843c42b39d420dbff2",
    secretKey: "MSG91_TEMPLATE_OFFLINE_PURCHASE",
    requiredVars: ["var1", "var2", "var3"],
    buildVars: (ctx) => ({ var1: String(ctx.ref || ""), var2: String(ctx.total ?? ""), var3: STORE_NAME }),
  },
  // Template 6: Offline Sale Admin - var1=Transaction ID, var2=Amount, var3=Store
  offline_pos_sale_owner: {
    templateId: "6aa1d17366745ba0d206c582",
    secretKey: "MSG91_TEMPLATE_OFFLINE_SALE_ADMIN",
    requiredVars: ["var1", "var2", "var3"],
    buildVars: (ctx) => ({ var1: String(ctx.ref || ""), var2: String(ctx.total ?? ""), var3: STORE_NAME }),
  },
  // Order Cancelled - customer only, uses order_confirmed template as closest fallback
  order_cancelled_customer: {
    templateId: "6aa1cd275f81de31570d50e2",
    secretKey: "MSG91_TEMPLATE_ORDER_CONFIRMED",
    requiredVars: ["var1", "var2"],
    buildVars: (ctx) => ({ var1: String(ctx.ref || ""), var2: String(ctx.total ?? "") }),
  },
};

// Resolve the template key from (event_type, recipient_type).
// Returns null when the event has no configured template (skip send silently).
function resolveTemplateKey(eventType, recipientType) {
  const key = `${eventType}_${recipientType}`;
  if (key in TEMPLATE_CONFIG) return key;
  return null;
}

// Robust Indian Mobile Number Normalizer: Formats phone to 12 digits (91XXXXXXXXXX).
function normalizeIndianPhone(rawPhone) {
  if (!rawPhone) return { valid: false, phone: "", error: "Phone number is required" };

  let digits = rawPhone.replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");

  // Deduplicate country code: 9191XXXXXXXXXX -> 91XXXXXXXXXX
  while (digits.startsWith("9191") && digits.length > 12) {
    digits = digits.substring(2);
  }

  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return { valid: true, phone: "91" + digits };
  }
  if (digits.length === 12 && /^91[6-9]\d{9}$/.test(digits)) {
    return { valid: true, phone: digits };
  }
  if (digits.length >= 10 && digits.length <= 13) {
    return { valid: true, phone: digits.length === 10 ? "91" + digits : digits };
  }

  return { valid: false, phone: digits, error: `Invalid Indian phone number: ${rawPhone}` };
}

function isValidUuid(val) {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

// MSG91 Flow API Dispatch with 10s timeout and strict error categorization
async function dispatchToMsg91(authKey, templateId, cleanPhone, vars) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SMS_TIMEOUT_MS);
  const senderId = (Deno.env.get("MSG91_SENDER_ID") || "").trim() || "ZERAHH";

  try {
    const flowPayload = {
      template_id: templateId,
      sender: senderId,
      short_url: "0",
      recipients: [{ mobiles: cleanPhone, ...vars }],
    };

    const resp = await fetch(MSG91_FLOW_URL, {
      method: "POST",
      headers: {
        authkey: authKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(flowPayload),
      signal: controller.signal,
    });

    const resData = await resp.json().catch(() => ({}));

    if (!resp.ok || resData.type === "error") {
      let errorCategory = "provider_error";
      if (resp.status === 401 || resp.status === 403) {
        errorCategory = "authentication_error";
      } else if (resp.status === 429) {
        errorCategory = "rate_limit";
      } else if (resData.message?.toLowerCase().includes("template")) {
        errorCategory = "template_error";
      } else if (resData.message?.toLowerCase().includes("dlt")) {
        errorCategory = "dlt_error";
      }

      return {
        providerStatus: "error",
        errorCategory,
        providerMsgId: null,
        errorDetails: `[${errorCategory}] ${resData.message || `Provider returned HTTP ${resp.status}`}`,
      };
    }

    return {
      providerStatus: "sent",
      errorCategory: null,
      providerMsgId: resData.message || resData.request_id || null,
      errorDetails: null,
    };
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    const errorCategory = isTimeout ? "timeout" : "network_error";
    return {
      providerStatus: "error",
      errorCategory,
      providerMsgId: null,
      errorDetails: `[${errorCategory}] ${isTimeout ? "MSG91 request timed out (10s)" : (err.message || "MSG91 network failure")}`,
    };
  } finally {
    clearTimeout(timer);
  }
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

  // Authentication Guard
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  let isAuthorized = Boolean(token && token === supabaseServiceKey);

  if (!isAuthorized && token) {
    try {
      const { data: { user } } = await adminClient.auth.getUser(token);
      if (user) {
        const { data: roleRow } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

        const { data: profile } = await adminClient
          .from("profiles")
          .select("is_admin")
          .eq("id", user.id)
          .maybeSingle();

        if (
          roleRow?.role === "admin" ||
          roleRow?.role === "owner" ||
          roleRow?.role === "staff" ||
          roleRow?.role === "pos_user" ||
          roleRow?.role === "manager" ||
          profile?.is_admin === true
        ) {
          isAuthorized = true;
        }
      }
    } catch {
      isAuthorized = false;
    }
  }

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

    // Action: RETRY an existing failed SMS log
    if (action === "retry") {
      if (!isAuthorized) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Staff or Admin privileges required to retry SMS logs." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
        );
      }

      if (!log_id) {
        return new Response(JSON.stringify({ error: "Missing log_id for retry" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

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

      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let retryProviderStatus = "mock_success";
      let retryError = null;
      let retryMsgId = null;

      if (msg91AuthKey && existingLog.template_id && existingLog.phone) {
        const result = await dispatchToMsg91(msg91AuthKey, existingLog.template_id, existingLog.phone, {});
        retryProviderStatus = result.providerStatus;
        retryError = result.errorDetails;
        retryMsgId = result.providerMsgId;
      }

      const newStatus = retryProviderStatus === "sent" || retryProviderStatus === "mock_success" ? "SENT" : "FAILED";

      const { data: updatedLog } = await adminClient
        .from("sms_logs")
        .update({
          status: newStatus,
          provider_status: retryProviderStatus,
          error_details: retryError,
          provider_message_id: retryMsgId,
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

    // Standard Dispatch
    const hasApiKeyOrToken = Boolean(token || req.headers.get("apikey"));
    if (!hasApiKeyOrToken) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing API key or bearer token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 },
      );
    }

    if (!order_id && !offline_sale_id) {
      return new Response(
        JSON.stringify({ error: "Missing required order_id or offline_sale_id" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const ALLOWED_EVENTS = [
      "online_sale", "offline_pos_sale", "order_placed", "order_confirmed",
      "order_cancelled", "order_shipped", "order_out_for_delivery",
      "order_delivered", "pos_return", "pos_return_credit",
    ];

    const currentEventType = event_type || (order_id ? "online_sale" : "offline_pos_sale");

    if (event_type && !ALLOWED_EVENTS.includes(event_type)) {
      return new Response(JSON.stringify({ error: `Unsupported event type: ${event_type}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Fetch authoritative data from DB
    let authoritativePhone = payload.phone || "";
    let authoritativeName = name || "Customer";
    let authoritativeTotal = payload.total ?? 0;
    let authoritativeItemsCount = payload.item_count ?? 1;
    let authoritativePayment = payload.payment_method || "Online";
    let authoritativeRef =
      payload.sale_number ||
      payload.order_number ||
      (order_id ? (order_id.length > 12 ? order_id.substring(0, 8).toUpperCase() : order_id) : "") ||
      (offline_sale_id ? (offline_sale_id.length > 12 ? offline_sale_id.substring(0, 8).toUpperCase() : offline_sale_id) : "") ||
      "ORD";

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
          authoritativeItemsCount = order.order_items.reduce((sum, it) => sum + (it.qty || 1), 0);
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
          authoritativeItemsCount = sale.offline_sale_items.reduce((sum, it) => sum + (it.qty || 1), 0);
        }
      }
    }

    const smsCtx = {
      name: authoritativeName,
      ref: authoritativeRef,
      total: authoritativeTotal,
      payment: authoritativePayment,
      itemsCount: authoritativeItemsCount,
    };

    const results = [];

    // Inner helper: dispatch one SMS to one recipient
    const dispatchSingleSms = async (targetPhone, targetRecipientType) => {
      const { valid, phone: cleanPhone, error: phoneErr } = normalizeIndianPhone(targetPhone);

      if (!valid) {
        console.warn(`[msg91-transactional] Phone normalization failed for ${targetRecipientType}:`, phoneErr);
        const { data: failLog } = await adminClient
          .from("sms_logs")
          .insert({
            order_id: isValidUuid(order_id) ? order_id : null,
            offline_sale_id: isValidUuid(offline_sale_id) ? offline_sale_id : null,
            phone: targetPhone || "UNKNOWN",
            message_type: currentEventType,
            recipient_type: targetRecipientType,
            status: "FAILED",
            provider_status: "validation_error",
            error_details: phoneErr || "Invalid phone number",
            message_content: "N/A",
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();
        return { success: false, log_id: failLog?.id, error: phoneErr, recipient: targetRecipientType };
      }

      // Canonical Idempotency Guard (normalizes DB triggers, webhooks, retries, double-clicks)
      const canonicalKey = `${order_id || offline_sale_id || "tx"}_${currentEventType}_${cleanPhone}_${targetRecipientType}`;
      const idempotencyKey =
        payload.idempotency_key &&
        targetRecipientType === recipient_type &&
        !payload.idempotency_key.startsWith("ord_") &&
        !payload.idempotency_key.startsWith("off_")
          ? payload.idempotency_key
          : canonicalKey;

      const { data: existingLog } = await adminClient
        .from("sms_logs")
        .select("id, status, provider_status")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (
        existingLog &&
        (existingLog.status === "SENT" ||
          existingLog.status === "PENDING" ||
          existingLog.provider_status === "mock_success" ||
          existingLog.provider_status === "sent")
      ) {
        console.log(`[msg91-transactional] Idempotent hit: SMS already sent or queued (${existingLog.id})`);
        return { success: true, already_sent: true, log_id: existingLog.id };
      }

      // Resolve template
      const templateKey = resolveTemplateKey(currentEventType, targetRecipientType);
      if (!templateKey) {
        console.log(`[msg91-transactional] No template for ${currentEventType}/${targetRecipientType} - skipping`);
        return { success: true, skipped: true };
      }

      const config = TEMPLATE_CONFIG[templateKey];
      const templateId = (Deno.env.get(config.secretKey) || "").trim() || config.templateId || "";
      const templateVars = config.buildVars(smsCtx);

      // Validate required variables
      for (const reqVar of config.requiredVars || []) {
        if (!templateVars[reqVar] || String(templateVars[reqVar]).trim() === "") {
          const varErr = `Missing required template variable '${reqVar}' for ${templateKey}`;
          console.warn(`[msg91-transactional] ${varErr}`);
          const { data: varLog } = await adminClient
            .from("sms_logs")
            .insert({
              order_id: isValidUuid(order_id) ? order_id : null,
              offline_sale_id: isValidUuid(offline_sale_id) ? offline_sale_id : null,
              phone: cleanPhone,
              message_type: currentEventType,
              recipient_type: targetRecipientType,
              status: "FAILED",
              provider_status: "validation_error",
              error_details: `[validation_error] ${varErr}`,
              message_content: `template:${templateKey}`,
              sent_at: new Date().toISOString(),
            })
            .select("id")
            .maybeSingle();
          return { success: false, log_id: varLog?.id, error: varErr, recipient: targetRecipientType, template: templateKey };
        }
      }

      if (!templateId) {
        const tmplErr = `Template ID for '${config.secretKey}' not configured on server`;
        console.warn(`[msg91-transactional] ${tmplErr}`);
        const { data: tmplLog } = await adminClient
          .from("sms_logs")
          .insert({
            order_id: isValidUuid(order_id) ? order_id : null,
            offline_sale_id: isValidUuid(offline_sale_id) ? offline_sale_id : null,
            phone: cleanPhone,
            message_type: currentEventType,
            recipient_type: targetRecipientType,
            status: "FAILED",
            provider_status: "template_error",
            error_details: `[template_error] ${tmplErr}`,
            message_content: `template:${templateKey}`,
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();
        return { success: false, log_id: tmplLog?.id, error: tmplErr, recipient: targetRecipientType, template: templateKey };
      }

      // Dispatch to MSG91
      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let providerStatus = "mock_success";
      let errorDetails = null;
      let providerMsgId = null;

      if (msg91AuthKey && templateId) {
        const result = await dispatchToMsg91(msg91AuthKey, templateId, cleanPhone, templateVars);
        providerStatus = result.providerStatus;
        errorDetails = result.errorDetails;
        providerMsgId = result.providerMsgId;
      } else if (!msg91AuthKey) {
        // Sandbox / mock mode - truthful log, no real SMS sent
        providerStatus = "mock_success";
        console.log(`[msg91-transactional] MSG91_AUTH_KEY not set - mock SMS for ${currentEventType}/${targetRecipientType}`);
      } else if (!templateId) {
        providerStatus = "error";
        errorDetails = `Template secret '${config.secretKey}' not configured on server`;
        console.warn(`[msg91-transactional] ${errorDetails}`);
      }

      const finalStatus = providerStatus === "sent" || providerStatus === "mock_success" ? "SENT" : "FAILED";

      // Log to sms_logs - template_id is the ACTUAL template used; never logs OTP or secret values
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
        message_content: `template:${templateKey} vars:${JSON.stringify(Object.keys(templateVars))}`,
        template_id: templateId || null,
        provider_message_id: providerMsgId,
        sent_at: new Date().toISOString(),
      };

      let insertedLogId;
      const { data: insertedLog, error: logErr } = await adminClient
        .from("sms_logs")
        .upsert(logRow, { onConflict: "idempotency_key" })
        .select("id, status, provider_status")
        .maybeSingle();

      if (logErr) {
        console.warn("[msg91-transactional] Upsert warning, retrying with sanitized foreign keys:", logErr.message);
        const { data: retryLog } = await adminClient
          .from("sms_logs")
          .upsert({ ...logRow, order_id: null, offline_sale_id: null }, { onConflict: "idempotency_key" })
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
        template: templateKey,
      };
    };

    // A. Customer SMS
    if (authoritativePhone && authoritativePhone.trim() !== "") {
      const custResult = await dispatchSingleSms(authoritativePhone, "customer");
      results.push(custResult);
    }

    // B. Owner SMS - fires for online_sale, offline_pos_sale, order_delivered
    const ownerEvents = ["online_sale", "offline_pos_sale", "order_delivered"];
    if (notify_owner && ownerEvents.includes(currentEventType)) {
      const { data: ownerSetting } = await adminClient
        .from("site_settings")
        .select("value")
        .eq("key", "owner_notification_phone")
        .maybeSingle();

      const ownerPhone = ownerSetting?.value || Deno.env.get("OWNER_PHONE") || "";
      if (ownerPhone) {
        const ownerResult = await dispatchSingleSms(ownerPhone, "owner");
        results.push(ownerResult);
      }
    }

    return new Response(
      JSON.stringify({ success: true, event_type: currentEventType, dispatches: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = error.message || "Internal SMS Processing Error";
    console.error("[msg91-transactional] Fatal error:", msg);
    // Never fail the caller transaction with a 5xx - return 200 with error flag
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});