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

// Helper to ensure clean customer name and prevent using store name as customer greeting
function cleanCustomerName(rawName?: string | null): string {
  if (!rawName) return "Customer";
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  // Never allow store name or generic system labels as customer name
  if (
    lower.includes("zerah") ||
    lower.includes("store") ||
    lower.includes("admin") ||
    lower === "customer"
  ) {
    return "Customer";
  }
  // Return the customer's actual first or full name (e.g. "Saif")
  return trimmed;
}

// Helper to extract and normalize all 10-digit Indian phone numbers from setting strings (e.g. "9667571712 AND 9057074777")
function extractIndianPhoneNumbers(raw?: string | null): string[] {
  if (!raw) return [];
  const matches = raw.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/g) || [];
  const normalizedSet = new Set<string>();
  for (const m of matches) {
    const digits = m.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      normalizedSet.add(digits);
    }
  }
  return Array.from(normalizedSet);
}

const TEMPLATE_CONFIG = {
  // 1. Zerah_Online_Order_Confirmed_ (DLT Approved: 6aa1cd275f81de31570d50e2)
  // DLT Approved Content: "Hi Zerah Baby & Kids! Your order ##var1## is confirmed. Total: ₹##var2##..."
  // var1: Order Ref (e.g. #ORD-260911-75368 or #ORD-260911-75368 (COD))
  // var2: Numeric Amount (e.g. 999) - notice '₹' is already part of the template text!
  online_sale_customer: {
    templateId: "6aa1cd275f81de31570d50e2",
    templateName: "Zerah_Online_Order_Confirmed_",
    secretKey: "MSG91_TEMPLATE_ORDER_CONFIRMED",
    requiredVars: ["var1", "var2"],
    formatPreview: (v: Record<string, string>) =>
      `Hi Zerah Baby & Kids! Your order ${v.var1} is confirmed. Total: ₹${v.var2}. Thank you for shopping with us!`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number; payment?: string }) => {
      const isCod = (ctx.payment || "").toLowerCase() === "cod";
      const totalNum = Math.round(Number(ctx.total || 0));
      const orderRef = `#${ctx.ref}${isCod ? " (COD)" : ""}`;
      const custName = cleanCustomerName(ctx.name);
      return {
        var1: orderRef,
        var2: String(totalNum),
        var: orderRef,
        order_id: String(ctx.ref || ""),
        ref: String(ctx.ref || ""),
        total: String(totalNum),
        amount: String(totalNum),
        name: custName,
        customer_name: custName,
        payment_method: isCod ? "COD" : "Online",
      };
    },
  },

  // 2. Zerah_New_Online_Order_Admin_ (DLT Approved: 6aa1d097daacdd8930018922)
  // DLT Approved Content: "Zerah Baby & Kids: New online order received! Order ID:##var1## Customer:##var2## Amount: ₹##var3##..."
  // var1: Order ID / Type (e.g. COD #ORD-12345 or Online #ORD-12345)
  // var2: Customer Name (e.g. Saif)
  // var3: Numeric Amount (e.g. 999) - '₹' is already in template
  online_sale_owner: {
    templateId: "6aa1d097daacdd8930018922",
    templateName: "Zerah_New_Online_Order_Admin_",
    secretKey: "MSG91_TEMPLATE_NEW_ORDER_ADMIN",
    requiredVars: ["var1", "var2", "var3"],
    formatPreview: (v: Record<string, string>) =>
      `Zerah Baby & Kids: New online order received! Order ID:${v.var1} Customer:${v.var2} Amount: ₹${v.var3}`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number; payment?: string }) => {
      const custName = cleanCustomerName(ctx.name);
      const isCod = (ctx.payment || "").toLowerCase() === "cod";
      const totalNum = Math.round(Number(ctx.total || 0));
      return {
        var1: `${isCod ? "COD " : "Online "}#${ctx.ref}`,
        var2: custName,
        var3: String(totalNum),
        name: custName,
        customer_name: custName,
        order_id: String(ctx.ref || ""),
        ref: String(ctx.ref || ""),
        total: String(totalNum),
        amount: String(totalNum),
        payment_method: isCod ? "COD" : "Online",
      };
    },
  },

  // 3. Zerah_Order_Delivered_ (DLT Approved: 6aa1cf5471e712fa250b1732)
  // DLT Approved Content: "Hello ##var1##, your order ##var2## from Zerah Baby & Kids has been delivered..."
  // var1: Customer Name (e.g. Saif)
  // var2: Order ID / Ref (e.g. #ORD-260911-75368)
  order_delivered_customer: {
    templateId: "6aa1cf5471e712fa250b1732",
    templateName: "Zerah_Order_Delivered_",
    secretKey: "MSG91_TEMPLATE_ORDER_DELIVERED",
    requiredVars: ["var1", "var2"],
    formatPreview: (v: Record<string, string>) =>
      `Hello ${v.var1}, your order ${v.var2} from Zerah Baby & Kids has been delivered. We hope your little one loves it!`,
    buildVars: (ctx: { name?: string; ref?: string }) => {
      const custName = cleanCustomerName(ctx.name);
      const orderRef = `#${ctx.ref}`;
      return {
        var1: custName,
        var2: orderRef,
        name: custName,
        customer_name: custName,
        order_id: String(ctx.ref || ""),
        ref: String(ctx.ref || ""),
      };
    },
  },

  // 4. Zerah_Offline_Purchase_ (DLT Approved: 6aa1cb843c42b39d420dbff2)
  // DLT Approved Content: "Thank you for shopping at Zerah Baby & Kids! Invoice No: ##var1## Total: ₹##var2##..."
  // var1: Invoice No / Sale Number (e.g. POS-20260911-001)
  // var2: Numeric Amount (e.g. 450)
  // var3: Store Name (Zerah Baby & Kids)
  offline_pos_sale_customer: {
    templateId: "6aa1cb843c42b39d420dbff2",
    templateName: "Zerah_Offline_Purchase_",
    secretKey: "MSG91_TEMPLATE_OFFLINE_PURCHASE",
    requiredVars: ["var1", "var2"],
    formatPreview: (v: Record<string, string>) =>
      `Thank you for shopping at Zerah Baby & Kids! Invoice No: ${v.var1} Total: ₹${v.var2}. Visit us again!`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number }) => {
      const totalNum = Math.round(Number(ctx.total || 0));
      return {
        var1: String(ctx.ref || "POS-SALE"),
        var2: String(totalNum),
        var3: STORE_NAME,
        invoice_no: String(ctx.ref || "POS-SALE"),
        sale_number: String(ctx.ref || "POS-SALE"),
        order_id: String(ctx.ref || ""),
        ref: String(ctx.ref || ""),
        total: String(totalNum),
        amount: String(totalNum),
        name: cleanCustomerName(ctx.name),
      };
    },
  },

  // 5. Zerah_Offline_Sale_Admin_ (DLT Approved: 6aa1d17366745ba0d206c582)
  // DLT Approved Content: "Zerah Baby & Kids: Your Offline transaction is recorded successfully. Transaction ID: ##var1## Customer: ##var2## Amount: ₹##var3##..."
  // var1: Transaction ID / Invoice No (e.g. POS-20260911-001)
  // var2: Customer Name (e.g. Priya)
  // var3: Numeric Amount (e.g. 450)
  offline_pos_sale_owner: {
    templateId: "6aa1d17366745ba0d206c582",
    templateName: "Zerah_Offline_Sale_Admin_",
    secretKey: "MSG91_TEMPLATE_OFFLINE_SALE_ADMIN",
    requiredVars: ["var1", "var2", "var3"],
    formatPreview: (v: Record<string, string>) =>
      `Zerah Baby & Kids: Your Offline transaction is recorded successfully. Transaction ID: ${v.var1} Customer: ${v.var2} Amount: ₹${v.var3}`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number }) => {
      const custName = cleanCustomerName(ctx.name);
      const totalNum = Math.round(Number(ctx.total || 0));
      return {
        var1: String(ctx.ref || "POS-SALE"),
        var2: custName,
        var3: String(totalNum),
        store: STORE_NAME,
        name: custName,
        customer_name: custName,
        ref: String(ctx.ref || "POS-SALE"),
        sale_number: String(ctx.ref || "POS-SALE"),
        transaction_id: String(ctx.ref || "POS-SALE"),
        total: String(totalNum),
        amount: String(totalNum),
      };
    },
  },

  // Order Cancelled - Customer Notification
  // Only dispatched if user has configured a custom cancellation template in environment
  order_cancelled_customer: {
    templateId: Deno.env.get("MSG91_TEMPLATE_ORDER_CANCELLED_CUSTOMER") || "",
    templateName: "Zerah_Order_Cancelled_Customer",
    secretKey: "MSG91_TEMPLATE_ORDER_CANCELLED_CUSTOMER",
    requiredVars: ["var1", "var2"],
    formatPreview: (v: Record<string, string>) =>
      `Zerah Baby & Kids: Order ${v.var1} has been cancelled. Refund/Status: ${v.var2}`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number; payment?: string }) => {
      const custName = cleanCustomerName(ctx.name);
      const isCod = (ctx.payment || "").toLowerCase() === "cod";
      return {
        var1: `#${ctx.ref}`,
        var2: `Cancelled (${isCod ? "COD" : "Online"}, Rs. ${ctx.total})`,
        var3: String(ctx.total ?? ""),
        name: custName,
        order_id: String(ctx.ref || ""),
        status: "Cancelled",
        total: String(ctx.total ?? ""),
        payment_method: isCod ? "COD" : "Online",
      };
    },
  },

  // Order Cancelled - Admin / Owner Notification
  order_cancelled_owner: {
    templateId: Deno.env.get("MSG91_TEMPLATE_ORDER_CANCELLED_ADMIN") || "",
    templateName: "Zerah_Order_Cancelled_Admin",
    secretKey: "MSG91_TEMPLATE_ORDER_CANCELLED_ADMIN",
    requiredVars: ["var1", "var2", "var3"],
    formatPreview: (v: Record<string, string>) =>
      `Zerah Baby & Kids: CANCELLED ${v.var1} Customer: ${v.var2} Amount: ₹${v.var3}`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number; payment?: string }) => {
      const custName = cleanCustomerName(ctx.name);
      const isCod = (ctx.payment || "").toLowerCase() === "cod";
      return {
        var1: `${ctx.ref} (${isCod ? "COD" : "Online"})`,
        var2: custName,
        var3: String(ctx.total ?? ""),
        name: custName,
        order_id: String(ctx.ref || ""),
        total: String(ctx.total ?? ""),
        status: "Cancelled",
        payment_method: isCod ? "COD" : "Online",
      };
    },
  },
};

// Resolve the template key from (event_type, recipient_type).
// Returns null when the event has no configured template (skip send silently).
function resolveTemplateKey(eventType: string, recipientType: string): string | null {
  // Normalize event aliases to exact template keys
  let normalizedEvent = eventType;
  if (normalizedEvent === "order_placed" || normalizedEvent === "order_confirmed") {
    normalizedEvent = "online_sale";
  }

  const key = `${normalizedEvent}_${recipientType}`;
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

// ---------------------------------------------------------------------------
// Rate Limit Guard: max 5 SMS per (phone, event_type) per rolling 60-minute window.
// Uses the existing sms_logs table — no extra schema required.
// adminClient must be initialised before this is called.
// ---------------------------------------------------------------------------
let _adminClientForRateLimit: ReturnType<typeof createClient> | null = null;

function setAdminClientForRateLimit(client: ReturnType<typeof createClient>) {
  _adminClientForRateLimit = client;
}

async function checkRateLimitAndRecord(
  phone: string,
  eventType: string,
): Promise<{ allowed: boolean; error: string | null }> {
  if (!_adminClientForRateLimit) {
    // No client yet — allow to avoid blocking startup
    return { allowed: true, error: null };
  }
  try {
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await _adminClientForRateLimit
      .from("sms_logs")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .eq("message_type", eventType)
      .gte("sent_at", windowStart);

    const recent = count ?? 0;
    if (recent >= 5) {
      return {
        allowed: false,
        error: `Rate limit: ${recent} SMS already sent for ${eventType} to this number in the last hour`,
      };
    }
    return { allowed: true, error: null };
  } catch {
    // On DB error, allow — never block legitimate sends
    return { allowed: true, error: null };
  }
}

// ---------------------------------------------------------------------------
// Authoritative Template Variable Reconstruction for Failed SMS Retries
// Sources (in priority order):
// 1. Directly stored template_variables on existingLog (if present)
// 2. Authoritative database record: orders table (if order_id is present)
// 3. Authoritative database record: offline_sales table (if offline_sale_id is present)
// 4. Deterministic extraction from stored message_content (regex parse of approved templates)
// ---------------------------------------------------------------------------
async function reconstructTemplateVariables(
  adminClient: ReturnType<typeof createClient>,
  existingLog: Record<string, any>,
  config?: any,
): Promise<{ vars: Record<string, string> | null; source: string; error?: string }> {
  // 1. Directly stored template_variables
  if (
    existingLog.template_variables &&
    typeof existingLog.template_variables === "object" &&
    Object.keys(existingLog.template_variables).length > 0
  ) {
    return { vars: existingLog.template_variables, source: "stored_variables" };
  }

  // 2. Authoritative reconstruction from orders table
  if (existingLog.order_id && isValidUuid(existingLog.order_id)) {
    try {
      const { data: order } = await adminClient
        .from("orders")
        .select("id, phone, full_name, total, payment_method, order_number, invoice_no, order_items(id, qty)")
        .eq("id", existingLog.order_id)
        .maybeSingle();

      if (order) {
        const isCod = (order.payment_method || "").toLowerCase() === "cod";
        const totalNum = Math.round(Number(order.total || 0));
        const orderRef = order.order_number || order.invoice_no || order.id.substring(0, 8);
        const custName = cleanCustomerName(order.full_name);

        if (config && typeof config.buildVars === "function") {
          const built = config.buildVars({
            name: custName,
            ref: orderRef,
            total: totalNum,
            payment: order.payment_method || "ONLINE",
          });
          return { vars: built, source: "orders_table" };
        }

        return {
          vars: {
            var1: `#${orderRef}${isCod ? " (COD)" : ""}`,
            var2: String(totalNum),
            var3: custName,
            order_id: String(orderRef),
            ref: String(orderRef),
            total: String(totalNum),
            amount: String(totalNum),
            name: custName,
            customer_name: custName,
            payment_method: isCod ? "COD" : "Online",
          },
          source: "orders_table",
        };
      }
    } catch (e) {
      console.warn("[msg91-transactional] Failed to query order for retry reconstruction:", e);
    }
  }

  // 3. Authoritative reconstruction from offline_sales table
  if (existingLog.offline_sale_id && isValidUuid(existingLog.offline_sale_id)) {
    try {
      const { data: sale } = await adminClient
        .from("offline_sales")
        .select("id, customer_phone, customer_name, total, payment_method, sale_number, offline_sale_items(id, qty)")
        .eq("id", existingLog.offline_sale_id)
        .maybeSingle();

      if (sale) {
        const totalNum = Math.round(Number(sale.total || 0));
        const saleRef = sale.sale_number || sale.id.substring(0, 8);
        const custName = cleanCustomerName(sale.customer_name);

        if (config && typeof config.buildVars === "function") {
          const built = config.buildVars({
            name: custName,
            ref: saleRef,
            total: totalNum,
            payment: sale.payment_method || "CASH",
          });
          return { vars: built, source: "offline_sales_table" };
        }

        return {
          vars: {
            var1: String(saleRef),
            var2: String(totalNum),
            var3: STORE_NAME,
            invoice_no: String(saleRef),
            sale_number: String(saleRef),
            order_id: String(saleRef),
            ref: String(saleRef),
            total: String(totalNum),
            amount: String(totalNum),
            name: custName,
          },
          source: "offline_sales_table",
        };
      }
    } catch (e) {
      console.warn("[msg91-transactional] Failed to query offline_sales for retry reconstruction:", e);
    }
  }

  // 4. Deterministic reconstruction from stored message_content
  if (existingLog.message_content && typeof existingLog.message_content === "string") {
    const content = existingLog.message_content.trim();

    // Pattern A: online_sale_customer ("Hi Zerah Baby & Kids! Your order #... is confirmed. Total: ₹...")
    const mOnlineCust = content.match(/Your order (.*?) is confirmed\. Total: ₹?(\d+)/i);
    if (mOnlineCust) {
      const orderRef = mOnlineCust[1].trim();
      const amount = mOnlineCust[2].trim();
      return {
        vars: {
          var1: orderRef,
          var2: amount,
          order_id: orderRef.replace(/^#/, "").replace(/\s*\(COD\)$/i, ""),
          ref: orderRef.replace(/^#/, "").replace(/\s*\(COD\)$/i, ""),
          total: amount,
          amount: amount,
        },
        source: "message_content_regex",
      };
    }

    // Pattern B: online_sale_owner ("Zerah Baby & Kids: New online order received! Order ID:... Customer:... Amount: ₹...")
    const mOnlineOwner = content.match(/Order ID:(.*?) Customer:(.*?) Amount: ₹?(\d+)/i);
    if (mOnlineOwner) {
      const orderId = mOnlineOwner[1].trim();
      const custName = mOnlineOwner[2].trim();
      const amount = mOnlineOwner[3].trim();
      return {
        vars: {
          var1: orderId,
          var2: custName,
          var3: amount,
          order_id: orderId,
          ref: orderId,
          name: custName,
          customer_name: custName,
          total: amount,
          amount: amount,
        },
        source: "message_content_regex",
      };
    }

    // Pattern C: order_delivered_customer ("Hello ..., your order ... from Zerah Baby & Kids has been delivered")
    const mDelivered = content.match(/Hello (.*?), your order (.*?) from Zerah Baby & Kids has been delivered/i);
    if (mDelivered) {
      const custName = mDelivered[1].trim();
      const orderRef = mDelivered[2].trim();
      return {
        vars: {
          var1: custName,
          var2: orderRef,
          name: custName,
          customer_name: custName,
          order_id: orderRef.replace(/^#/, ""),
          ref: orderRef.replace(/^#/, ""),
        },
        source: "message_content_regex",
      };
    }

    // Pattern D: offline_pos_sale_customer ("Thank you for shopping at Zerah Baby & Kids! Invoice No: ... Total: ₹...")
    const mOfflineCust = content.match(/Invoice No: (.*?) Total: ₹?(\d+)/i);
    if (mOfflineCust) {
      const invNo = mOfflineCust[1].trim();
      const amount = mOfflineCust[2].trim();
      return {
        vars: {
          var1: invNo,
          var2: amount,
          var3: STORE_NAME,
          invoice_no: invNo,
          sale_number: invNo,
          ref: invNo,
          total: amount,
          amount: amount,
        },
        source: "message_content_regex",
      };
    }

    // Pattern E: offline_pos_sale_owner ("Zerah Baby & Kids: Your Offline transaction is recorded successfully. Transaction ID: ... Customer: ... Amount: ₹...")
    const mOfflineOwner = content.match(/Transaction ID: (.*?) Customer: (.*?) Amount: ₹?(\d+)/i);
    if (mOfflineOwner) {
      const txId = mOfflineOwner[1].trim();
      const custName = mOfflineOwner[2].trim();
      const amount = mOfflineOwner[3].trim();
      return {
        vars: {
          var1: txId,
          var2: custName,
          var3: amount,
          transaction_id: txId,
          ref: txId,
          sale_number: txId,
          name: custName,
          customer_name: custName,
          total: amount,
          amount: amount,
        },
        source: "message_content_regex",
      };
    }

    // Pattern F: order_cancelled_customer ("Zerah Baby & Kids: Order ... has been cancelled. Refund/Status: ...")
    const mCancelCust = content.match(/Order (.*?) has been cancelled\. Refund\/Status: (.*)/i);
    if (mCancelCust) {
      const orderRef = mCancelCust[1].trim();
      const statusText = mCancelCust[2].trim();
      return {
        vars: {
          var1: orderRef,
          var2: statusText,
          order_id: orderRef.replace(/^#/, ""),
          ref: orderRef.replace(/^#/, ""),
          status: "Cancelled",
        },
        source: "message_content_regex",
      };
    }

    // Pattern G: order_cancelled_owner ("Zerah Baby & Kids: CANCELLED ... Customer: ... Amount: ₹...")
    const mCancelOwner = content.match(/CANCELLED (.*?) Customer: (.*?) Amount: ₹?(\d+)/i);
    if (mCancelOwner) {
      const orderRef = mCancelOwner[1].trim();
      const custName = mCancelOwner[2].trim();
      const amount = mCancelOwner[3].trim();
      return {
        vars: {
          var1: orderRef,
          var2: custName,
          var3: amount,
          order_id: orderRef,
          ref: orderRef,
          name: custName,
          customer_name: custName,
          total: amount,
          amount: amount,
        },
        source: "message_content_regex",
      };
    }
  }

  return {
    vars: null,
    source: "none",
    error: "Original template data unavailable; SMS cannot be retried safely.",
  };
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

    const resData = (await resp.json().catch(() => ({}))) as Record<string, any>;

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
      errorDetails: `[${errorCategory}] ${isTimeout ? "MSG91 request timed out (10s)" : err.message || "MSG91 network failure"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
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

  // Wire admin client into rate-limit helper for this request
  setAdminClientForRateLimit(adminClient);

  // Authentication Guard
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  let isAuthorized = Boolean(token && token === supabaseServiceKey);

  if (!isAuthorized && token) {
    try {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);
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
    const payload = (await req.json().catch(() => ({}))) as {
      action?: string;
      log_id?: string;
      order_id?: string;
      offline_sale_id?: string;
      event_type?: string;
      name?: string;
      recipient_type?: string;
      notify_owner?: boolean;
      phone?: string;
      total?: number;
      item_count?: number;
      payment_method?: string;
      sale_number?: string;
      order_number?: string;
      idempotency_key?: string;
    };
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

    // Action: TEST dispatch from Admin Settings panel
    if (action === "test" || payload.is_test) {
      const rawTargetPhones = payload.phone || "9667571712, 9057074777";
      const targetPhones = extractIndianPhoneNumbers(rawTargetPhones);
      if (targetPhones.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "No valid 10-digit Indian phone numbers found in input.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }

      const templateKey =
        payload.template_key ||
        (payload.event_type === "offline_pos_sale"
          ? "offline_pos_sale_owner"
          : "online_sale_owner");
      const config = TEMPLATE_CONFIG[templateKey] || TEMPLATE_CONFIG.online_sale_owner;
      const templateId = (Deno.env.get(config.secretKey) || "").trim() || config.templateId || "";

      const smsCtx = {
        name: cleanCustomerName(payload.name || "Test Customer"),
        ref: String(payload.order_number || payload.sale_number || "TEST-ORD-001"),
        total: Math.round(Number(payload.total || 999)),
        payment: payload.payment_method || "ONLINE",
        itemsCount: 1,
      };

      const templateVars = config.buildVars(smsCtx);
      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      const dispatches = [];

      for (const phone of targetPhones) {
        const cleanPhone = "91" + phone;
        let providerStatus = "mock_success";
        let errorDetails = null;
        let providerMsgId = null;

        if (msg91AuthKey && templateId) {
          const result = await dispatchToMsg91(msg91AuthKey, templateId, cleanPhone, templateVars);
          providerStatus = result.providerStatus;
          errorDetails = result.errorDetails;
          providerMsgId = result.providerMsgId;
        }

        const finalStatus =
          providerStatus === "sent" || providerStatus === "mock_success" ? "SENT" : "FAILED";
        const messagePreview =
          typeof config.formatPreview === "function"
            ? config.formatPreview(templateVars as Record<string, string>)
            : `[${config.templateName || templateKey}]`;

        await adminClient.from("sms_logs").insert({
          phone: cleanPhone,
          message_type: "test_admin_alert",
          recipient_type: "owner",
          status: finalStatus,
          provider_status: providerStatus,
          error_details: errorDetails,
          message_content: messagePreview,
          template_id: templateId || null,
          provider_message_id: providerMsgId,
          sent_at: new Date().toISOString(),
        });

        dispatches.push({
          phone: cleanPhone,
          status: finalStatus,
          providerStatus,
          errorDetails,
        });
      }

      const anySuccess = dispatches.some((d) => d.status === "SENT");
      return new Response(
        JSON.stringify({
          success: anySuccess,
          message: anySuccess
            ? `Test SMS dispatched successfully to: ${targetPhones.join(", ")}!`
            : dispatches[0]?.errorDetails || "Failed to dispatch test SMS",
          dispatches,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Action: RETRY an existing failed SMS log
    if (action === "retry") {
      if (!isAuthorized) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized: Staff or Admin privileges required to retry SMS logs.",
          }),
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

      // Idempotency: Prevent duplicate sending if SMS was already successfully sent
      if (
        existingLog.status === "SENT" ||
        existingLog.provider_status === "sent" ||
        existingLog.provider_status === "mock_success"
      ) {
        return new Response(
          JSON.stringify({
            success: true,
            already_sent: true,
            message: "SMS has already been sent successfully.",
            log: existingLog,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // 1. Identify the template config from existing template_id or message_type + recipient_type
      let matchedKey: string | null = null;
      for (const [key, cfg] of Object.entries(TEMPLATE_CONFIG)) {
        const envId = (Deno.env.get(cfg.secretKey) || "").trim();
        if (
          existingLog.template_id &&
          (existingLog.template_id === cfg.templateId || (envId && existingLog.template_id === envId))
        ) {
          matchedKey = key;
          break;
        }
      }

      if (!matchedKey && existingLog.message_type) {
        matchedKey = resolveTemplateKey(existingLog.message_type, existingLog.recipient_type || "customer");
      }

      if (!matchedKey && existingLog.message_type === "test_admin_alert") {
        matchedKey = "online_sale_owner";
      }

      const config = matchedKey ? TEMPLATE_CONFIG[matchedKey] : null;
      const effectiveTemplateId =
        existingLog.template_id ||
        (config ? (Deno.env.get(config.secretKey) || "").trim() || config.templateId : null);

      if (!effectiveTemplateId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Original template data unavailable; SMS cannot be retried safely.",
            details: "No valid DLT template ID found for this SMS log.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // 2. Authoritative variable reconstruction
      const { vars: templateVars, source: reconSource, error: reconError } =
        await reconstructTemplateVariables(adminClient, existingLog, config);

      if (!templateVars || Object.keys(templateVars).length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Original template data unavailable; SMS cannot be retried safely.",
            details: reconError || "Unable to reconstruct template variables from order, sale, or stored content.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // 3. Strict DLT safety check: all requiredVars must be present, non-empty, and free of unresolved markers
      const requiredVars = config?.requiredVars || ["var1", "var2"];
      const missingVars: string[] = [];
      for (const reqVar of requiredVars) {
        const val = templateVars[reqVar];
        if (!val || String(val).trim() === "" || String(val).includes("##") || String(val).includes("{#")) {
          missingVars.push(reqVar);
        }
      }

      if (missingVars.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Original template data unavailable; SMS cannot be retried safely.",
            details: `Missing required template variable(s): ${missingVars.join(", ")}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // 4. Validate and normalize phone number
      const { valid: phoneValid, phone: cleanPhone, error: phoneErr } = normalizeIndianPhone(existingLog.phone);
      if (!phoneValid) {
        return new Response(
          JSON.stringify({
            success: false,
            error: phoneErr || `Invalid recipient phone number on log: ${existingLog.phone}`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // 5. Dispatch via MSG91 with verified templateVars
      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let retryProviderStatus = "mock_success";
      let retryError = null;
      let retryMsgId = null;

      if (msg91AuthKey) {
        const result = await dispatchToMsg91(
          msg91AuthKey,
          effectiveTemplateId,
          cleanPhone,
          templateVars,
        );
        retryProviderStatus = result.providerStatus;
        retryError = result.errorDetails;
        retryMsgId = result.providerMsgId;
      }

      const newStatus =
        retryProviderStatus === "sent" || retryProviderStatus === "mock_success"
          ? "SENT"
          : "FAILED";

      const updatedPreview =
        config && typeof config.formatPreview === "function"
          ? config.formatPreview(templateVars as Record<string, string>)
          : existingLog.message_content;

      const { data: updatedLog } = await adminClient
        .from("sms_logs")
        .update({
          status: newStatus,
          provider_status: retryProviderStatus,
          error_details: retryError,
          provider_message_id: retryMsgId || existingLog.provider_message_id,
          template_id: effectiveTemplateId,
          message_content: updatedPreview,
          retry_count: (existingLog.retry_count || 0) + 1,
          last_retried_at: new Date().toISOString(),
        })
        .eq("id", log_id)
        .select("*")
        .single();

      return new Response(
        JSON.stringify({
          success: newStatus === "SENT",
          log: updatedLog,
          reconstruction_source: reconSource,
          variables_sent: templateVars,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
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
      "online_sale",
      "offline_pos_sale",
      "order_placed",
      "order_confirmed",
      "order_cancelled",
      "order_shipped",
      "order_out_for_delivery",
      "order_delivered",
      "pos_return",
      "pos_return_credit",
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
      (order_id
        ? order_id.length > 12
          ? order_id.substring(0, 8).toUpperCase()
          : order_id
        : "") ||
      (offline_sale_id
        ? offline_sale_id.length > 12
          ? offline_sale_id.substring(0, 8).toUpperCase()
          : offline_sale_id
        : "") ||
      "ORD";

    if (order_id) {
      const { data: order } = await adminClient
        .from("orders")
        .select(
          "id, phone, full_name, total, payment_method, order_number, invoice_no, order_items(id, qty)",
        )
        .eq("id", order_id)
        .maybeSingle();

      if (order) {
        if (!authoritativePhone) authoritativePhone = order.phone || "";
        if (order.full_name && order.full_name.trim() !== "") {
          authoritativeName = cleanCustomerName(order.full_name);
        } else if (!authoritativeName || authoritativeName === "Customer") {
          authoritativeName = cleanCustomerName(name);
        }
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
        .select(
          "id, customer_phone, customer_name, total, payment_method, sale_number, offline_sale_items(id, qty)",
        )
        .eq("id", offline_sale_id)
        .maybeSingle();

      if (sale) {
        if (!authoritativePhone) authoritativePhone = sale.customer_phone || "";
        if (!authoritativeName || authoritativeName === "Customer")
          authoritativeName = sale.customer_name || "Customer";
        if (!authoritativeTotal) authoritativeTotal = Number(sale.total || 0);
        authoritativePayment = sale.payment_method ? sale.payment_method.toUpperCase() : "CASH";
        authoritativeRef = sale.sale_number || sale.id.substring(0, 8);
        if (Array.isArray(sale.offline_sale_items)) {
          authoritativeItemsCount = sale.offline_sale_items.reduce(
            (sum, it) => sum + (it.qty || 1),
            0,
          );
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

    const dispatchSingleSms = async (targetPhone, targetRecipientType) => {
      const { allowed, error: rateLimitError } = await checkRateLimitAndRecord(
        targetPhone,
        currentEventType,
      );
      if (!allowed)
        return { success: false, error: rateLimitError, recipient: targetRecipientType };

      const { valid, phone: cleanPhone, error: phoneErr } = normalizeIndianPhone(targetPhone);
      if (!valid) {
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
        return {
          success: false,
          log_id: failLog?.id,
          error: phoneErr,
          recipient: targetRecipientType,
        };
      }

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
        return { success: true, already_sent: true, log_id: existingLog.id };
      }

      const templateKey = resolveTemplateKey(currentEventType, targetRecipientType);
      if (!templateKey) return { success: true, skipped: true };

      const config = TEMPLATE_CONFIG[templateKey];
      const templateId = (Deno.env.get(config.secretKey) || "").trim() || config.templateId || "";
      const templateVars = config.buildVars(smsCtx);

      for (const reqVar of config.requiredVars || []) {
        if (!templateVars[reqVar] || String(templateVars[reqVar]).trim() === "") {
          const varErr = `Missing required template variable '${reqVar}'`;
          return {
            success: false,
            error: varErr,
            recipient: targetRecipientType,
            template: templateKey,
          };
        }
      }

      const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
      let providerStatus = "mock_success";
      let errorDetails = null;
      let providerMsgId = null;

      if (msg91AuthKey && templateId) {
        const result = await dispatchToMsg91(msg91AuthKey, templateId, cleanPhone, templateVars);
        providerStatus = result.providerStatus;
        errorDetails = result.errorDetails;
        providerMsgId = result.providerMsgId;
      }

      const finalStatus =
        providerStatus === "sent" || providerStatus === "mock_success" ? "SENT" : "FAILED";
      const messagePreview =
        typeof config.formatPreview === "function"
          ? config.formatPreview(templateVars as Record<string, string>)
          : `[${config.templateName || templateKey}]`;

      const { data: insertedLog } = await adminClient
        .from("sms_logs")
        .upsert(
          {
            order_id: isValidUuid(order_id) ? order_id : null,
            offline_sale_id: isValidUuid(offline_sale_id) ? offline_sale_id : null,
            phone: cleanPhone,
            message_type: currentEventType,
            recipient_type: targetRecipientType,
            status: finalStatus,
            provider_status: providerStatus,
            error_details: errorDetails,
            idempotency_key: idempotencyKey,
            message_content: messagePreview,
            template_id: templateId || null,
            provider_message_id: providerMsgId,
            sent_at: new Date().toISOString(),
          },
          { onConflict: "idempotency_key" },
        )
        .select("id")
        .maybeSingle();

      return {
        success: finalStatus === "SENT",
        log_id: insertedLog?.id,
        recipient: targetRecipientType,
      };
    };

    if (authoritativePhone && authoritativePhone.trim() !== "") {
      results.push(await dispatchSingleSms(authoritativePhone, "customer"));
    }

    // B. Owner SMS - fires for online_sale, offline_pos_sale, order_delivered, and order_cancelled
    const ownerEvents = ["online_sale", "offline_pos_sale", "order_delivered", "order_cancelled"];
    if (notify_owner && ownerEvents.includes(currentEventType)) {
      const { data: ownerSetting } = await adminClient
        .from("site_settings")
        .select("value")
        .eq("key", "owner_notification_phone")
        .maybeSingle();

      const rawOwnerPhones = ownerSetting?.value || Deno.env.get("OWNER_PHONE") || "";
      let targetOwnerPhones = extractIndianPhoneNumbers(rawOwnerPhones);

      if (targetOwnerPhones.length === 0) {
        const { data: contactSetting } = await adminClient
          .from("site_settings")
          .select("value")
          .eq("key", "contact_phone")
          .maybeSingle();
        targetOwnerPhones = extractIndianPhoneNumbers(contactSetting?.value);
      }

      // Canonical default admin numbers: 9667571712 AND 9057074777
      if (targetOwnerPhones.length === 0) {
        targetOwnerPhones = ["9667571712", "9057074777"];
      }

      for (const phone of targetOwnerPhones) {
        const ownerResult = await dispatchSingleSms(phone, "owner");
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
