/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STORE_NAME = "Zérah Baby & Kids";
const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow/";
const SMS_TIMEOUT_MS = 10_000;
const EMAIL_TIMEOUT_MS = 12_000;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanCustomerName(rawName?: string | null): string {
  if (!rawName) return "Customer";
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("zerah") ||
    lower.includes("store") ||
    lower.includes("admin") ||
    lower === "customer"
  ) {
    return "Customer";
  }
  return trimmed;
}

function normalizeIndianPhone(rawPhone?: string | null): { valid: boolean; phone: string; error?: string } {
  if (!rawPhone) return { valid: false, phone: "", error: "Phone number is missing" };

  let digits = rawPhone.replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");

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

  return { valid: false, phone: digits, error: `Invalid Indian phone number format: ${rawPhone}` };
}

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

// ---------------------------------------------------------------------------
// HTML Email Layouts & Renderers
// ---------------------------------------------------------------------------
function getBaseLayout(
  title: string,
  badgeText: string,
  badgeBg: string,
  badgeColor: string,
  bodyContent: string,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05); }
    .header { background: #8B2020; color: #ffffff; padding: 28px 32px; text-align: center; }
    .brand-title { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin: 0; }
    .brand-sub { font-size: 13px; opacity: 0.9; margin-top: 4px; }
    .content { padding: 32px; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; background-color: ${badgeBg}; color: ${badgeColor}; margin-bottom: 16px; }
    .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 13px; line-height: 1.6; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label { color: #64748b; font-weight: 500; }
    .meta-value { font-weight: 600; color: #0f172a; text-align: right; }
    table.items-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; }
    table.items-table th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #cbd5e1; }
    table.items-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .text-right { text-align: right; }
    .totals-box { background: #fdf2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin-top: 20px; }
    .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
    .grand-total { font-size: 18px; font-weight: 800; color: #8B2020; border-top: 2px dashed #fca5a5; padding-top: 10px; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-title">Zérah Baby &amp; Kids</h1>
      <div class="brand-sub">Store Sale Notification</div>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <span class="badge">${escapeHtml(badgeText)}</span>
      </div>
      ${bodyContent}
    </div>
    <div class="footer">
      Automated Transaction Notification — Zérah Baby &amp; Kids Store Management<br>
      Store: 80 Feet Link Rd, near Bajot Restaurant, Kota, Rajasthan 324001
    </div>
  </div>
</body>
</html>`;
}

function renderAdminSaleEmail(
  saleType: "online" | "offline",
  saleRecord: Record<string, any>,
  items: Array<Record<string, any>>,
): { subject: string; html: string } {
  const isOnline = saleType === "online";
  const saleRef = isOnline
    ? saleRecord.order_number || saleRecord.invoice_no || saleRecord.id?.slice(0, 8).toUpperCase()
    : saleRecord.sale_number || "POS-SALE";
  const dateStr = new Date(saleRecord.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const finalTotal = Number(saleRecord.total || 0);
  const subtotal = Number(saleRecord.subtotal || 0);
  const discount = Number(saleRecord.discount || 0);
  const customerName = isOnline
    ? saleRecord.full_name || "Online Shopper"
    : saleRecord.customer_name || "Walk-in Customer";
  const customerPhone = isOnline
    ? saleRecord.phone || "Not provided"
    : saleRecord.customer_phone || "Not provided";
  const customerEmail = isOnline ? saleRecord.email : saleRecord.customer_email;
  const paymentMethod = (saleRecord.payment_method || (isOnline ? "Online" : "Cash")).toUpperCase();

  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td>
        <strong>${escapeHtml(item.name || item.product_name || "Item")}</strong>
        ${item.sku ? `<br><span style="font-size:11px;color:#64748b;">SKU: ${escapeHtml(item.sku)}</span>` : ""}
        ${item.color || item.size ? `<br><span style="font-size:11px;color:#8B2020;">${escapeHtml([item.color, item.size].filter(Boolean).join(" · "))}</span>` : ""}
      </td>
      <td style="text-align:center;">${item.qty || 1}</td>
      <td class="text-right">${formatCurrency(Number(item.price || 0))}</td>
      <td class="text-right font-weight:600;">${formatCurrency(Number(item.subtotal || (Number(item.price || 0) * Number(item.qty || 1))))}</td>
    </tr>`,
    )
    .join("");

  const bodyContent = `
    <h2 style="margin:0 0 8px 0; font-size:20px; font-weight:800; color:#0f172a; text-align:center;">
      ${isOnline ? "New Online Store Sale" : "New Offline POS Counter Sale"}
    </h2>
    <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px 0;">
      A successful sale of ${formatCurrency(finalTotal)} was completed via ${isOnline ? "Online Storefront" : "Store POS Counter"}.
    </p>

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Sale / Order No:</span>
        <span class="meta-value">#${escapeHtml(saleRef)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Channel Source:</span>
        <span class="meta-value" style="color:#8B2020; font-weight:700;">${isOnline ? "ONLINE STORE" : "OFFLINE / POS"}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Date &amp; Time:</span>
        <span class="meta-value">${escapeHtml(dateStr)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer:</span>
        <span class="meta-value">${escapeHtml(customerName)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Contact:</span>
        <span class="meta-value">${escapeHtml(customerPhone)}${customerEmail ? ` · ${escapeHtml(customerEmail)}` : ""}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment Method:</span>
        <span class="meta-value">${escapeHtml(paymentMethod)}</span>
      </div>
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Purchased Items (${items.length})</h3>
    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th class="text-right">Price</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-box">
      <div class="total-row">
        <span>Subtotal:</span>
        <span>${formatCurrency(subtotal)}</span>
      </div>
      ${
        discount > 0
          ? `
      <div class="total-row" style="color:#dc2626;">
        <span>Discount:</span>
        <span>- ${formatCurrency(discount)}</span>
      </div>`
          : ""
      }
      <div class="total-row grand-total">
        <span>Total Paid Amount:</span>
        <span>${formatCurrency(finalTotal)}</span>
      </div>
    </div>
  `;

  const subject = `${isOnline ? "Online Sale" : "Offline POS Sale"} — ${formatCurrency(finalTotal)} — #${saleRef}`;
  const html = getBaseLayout(
    subject,
    isOnline ? "Online Order Paid" : "Offline Counter Sale",
    isOnline ? "#fef3c7" : "#e0f2fe",
    isOnline ? "#b45309" : "#0369a1",
    bodyContent,
  );

  return { subject, html };
}

function renderCustomerInvoiceEmail(
  saleType: "online" | "offline",
  saleRecord: Record<string, any>,
  items: Array<Record<string, any>>,
): { subject: string; html: string } {
  const isOnline = saleType === "online";
  const saleRef = isOnline
    ? saleRecord.order_number || saleRecord.invoice_no || saleRecord.id?.slice(0, 8).toUpperCase()
    : saleRecord.sale_number || "POS-SALE";
  const dateStr = new Date(saleRecord.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const finalTotal = Number(saleRecord.total || 0);
  const subtotal = Number(saleRecord.subtotal || 0);
  const discount = Number(saleRecord.discount || 0);
  const customerName = isOnline
    ? saleRecord.full_name || "Valued Parent"
    : saleRecord.customer_name || "Valued Customer";
  const paymentMethod = (saleRecord.payment_method || (isOnline ? "Online" : "Cash")).toUpperCase();

  const itemsHtml = items
    .map((item) => {
      const variantInfo = [item.variant_name, item.color, item.size].filter(Boolean).join(" · ");
      const imageUrl = item.image_url || item.image || "";
      return `
      <tr>
        <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              ${
                imageUrl
                  ? `<td style="width: 48px; padding-right: 12px; vertical-align: top;">
                      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || "Item")}" width="48" height="48" style="border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0; display: block;" />
                    </td>`
                  : ""
              }
              <td style="vertical-align: top;">
                <div style="font-weight: 700; color: #0f172a; font-size: 14px; line-height: 1.3;">
                  ${escapeHtml(item.name || item.product_name || "Product")}
                </div>
                ${
                  variantInfo
                    ? `<div style="font-size: 12px; color: #8B2020; font-weight: 600; margin-top: 3px;">${escapeHtml(variantInfo)}</div>`
                    : ""
                }
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Qty: ${item.qty || 1} × ${formatCurrency(Number(item.price || 0))}</div>
              </td>
            </tr>
          </table>
        </td>
        <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9; text-align: right; vertical-align: middle; font-weight: 700; color: #0f172a; font-size: 14px;">
          ${formatCurrency(Number(item.subtotal || (Number(item.price || 0) * Number(item.qty || 1))))}
        </td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${isOnline ? "Order Confirmed" : "Purchase Receipt"} — Zérah Baby &amp; Kids</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #faf5f5; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; border: 1px solid #f1e4e4; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(139, 32, 32, 0.08); }
    .header { background: linear-gradient(135deg, #8B2020 0%, #681818 100%); color: #ffffff; padding: 32px 28px; text-align: center; }
    .brand-title { font-size: 26px; font-weight: 900; letter-spacing: 0.5px; margin: 0; text-transform: uppercase; }
    .brand-sub { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.9; margin-top: 6px; font-weight: 600; color: #fecaca; }
    .content { padding: 32px 28px; }
    .success-badge { display: inline-block; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 6px 16px; border-radius: 999px; margin-bottom: 12px; }
    .meta-box { background: #fafafa; border: 1px solid #f1f1f1; border-radius: 16px; padding: 20px; margin: 24px 0; font-size: 13px; line-height: 1.6; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .meta-row:last-child { margin-bottom: 0; }
    .meta-label { color: #64748b; font-weight: 500; }
    .meta-value { font-weight: 700; color: #0f172a; text-align: right; }
    .totals-box { background: #fef7f7; border: 1px solid #fee2e2; border-radius: 16px; padding: 20px; margin-top: 24px; }
    .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; color: #475569; }
    .grand-total { font-size: 18px; font-weight: 900; color: #8B2020; border-top: 2px dashed #fca5a5; padding-top: 12px; margin-top: 12px; }
    .footer { text-align: center; padding: 28px 20px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f8fafc; background: #fafafa; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand-title">Zérah Baby &amp; Kids</div>
      <div class="brand-sub">${isOnline ? "Pure Comfort for Little Wonders" : "In-Store Tax Invoice &amp; Receipt"}</div>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <span class="success-badge">✓ ${isOnline ? "Order Confirmed &amp; Paid" : "Store Purchase Recorded"}</span>
        <h2 style="margin: 4px 0 8px 0; font-size: 24px; font-weight: 900; color: #0f172a;">
          Thank you, ${escapeHtml(customerName)}!
        </h2>
        <p style="color: #64748b; font-size: 14px; margin: 0 auto; max-width: 440px; line-height: 1.5;">
          ${isOnline 
            ? "We have received your order. Our Kota team is handpicking and packing your items with extra baby-safe love and care."
            : "Thank you for shopping with us at Zérah Baby & Kids Store, Kota. Here is your electronic purchase receipt."
          }
        </p>
      </div>

      <div class="meta-box">
        <div class="meta-row">
          <span class="meta-label">${isOnline ? "Order Number:" : "Receipt / Sale No:"}</span>
          <span class="meta-value" style="color: #8B2020;">#${escapeHtml(saleRef)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Date &amp; Time:</span>
          <span class="meta-value">${escapeHtml(dateStr)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Payment Method:</span>
          <span class="meta-value">${escapeHtml(paymentMethod)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">${isOnline ? "Store Website:" : "Store Location:"}</span>
          <span class="meta-value">${isOnline ? "zerahkids.com" : "80 Feet Link Rd, Kota, Rajasthan"}</span>
        </div>
      </div>

      <h3 style="font-size: 15px; font-weight: 800; margin: 28px 0 12px 0; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">
        Purchased Items (${items.length})
      </h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="totals-box">
        <div class="total-row">
          <span>Subtotal:</span>
          <span style="font-weight: 600; color: #0f172a;">${formatCurrency(subtotal)}</span>
        </div>
        ${
          discount > 0
            ? `<div class="total-row" style="color: #16a34a; font-weight: 600;">
          <span>Discount:</span>
          <span>- ${formatCurrency(discount)}</span>
        </div>`
            : ""
        }
        <div class="total-row grand-total">
          <span>Total Paid (incl. taxes):</span>
          <span>${formatCurrency(finalTotal)}</span>
        </div>
      </div>

      <div style="margin: 24px 0; padding: 14px; background: #fdf8f8; border: 1px solid #fae8e8; border-radius: 14px; text-align: center; font-size: 12px; color: #7f1d1d; line-height: 1.4; font-weight: 600;">
        🛡️ <strong>100% Baby Safe Garments</strong> &nbsp;|&nbsp; 📦 <strong>Quality Checked</strong> &nbsp;|&nbsp; 🌿 <strong>Easy Support</strong>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; text-align: center; font-size: 13px; color: #475569;">
        Need help with this purchase? WhatsApp us at 
        <a href="https://wa.me/919057074777?text=Hi%2C%20I%20have%20a%20question%20about%20purchase%20${escapeHtml(saleRef)}" style="color: #8B2020; font-weight: 700; text-decoration: none;">
          +91 9057074777
        </a> or email hello@zerahkids.com.
      </div>
    </div>

    <div class="footer">
      <strong>Zérah Baby &amp; Kids</strong><br>
      80 Feet Link Rd, near Bajot Restaurant, Kota, Rajasthan 324001<br>
      Website: <a href="https://zerahkids.com" style="color: #8B2020; text-decoration: none;">zerahkids.com</a>
    </div>
  </div>
</body>
</html>`;

  const subject = `${isOnline ? "Order Confirmed!" : "Purchase Receipt"} #${saleRef} — Zérah Baby & Kids`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// External Dispatchers
// ---------------------------------------------------------------------------
async function dispatchMsg91(
  authKey: string,
  templateId: string,
  cleanPhone: string,
  vars: Record<string, string>,
): Promise<{ status: "SENT" | "FAILED"; providerMsgId: string | null; error: string | null }> {
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
      return {
        status: "FAILED",
        providerMsgId: null,
        error: resData.message || `Provider returned HTTP ${resp.status}`,
      };
    }

    return {
      status: "SENT",
      providerMsgId: resData.message || resData.request_id || null,
      error: null,
    };
  } catch (err: any) {
    const isTimeout = err.name === "AbortError";
    return {
      status: "FAILED",
      providerMsgId: null,
      error: isTimeout ? "MSG91 request timed out (10s)" : err.message || "MSG91 network failure",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchResendEmail(
  resendApiKey: string | undefined,
  toEmail: string,
  fromEmail: string,
  subject: string,
  html: string,
): Promise<{ status: "SENT" | "FAILED"; messageId: string | null; error: string | null }> {
  if (!resendApiKey) {
    return {
      status: "SENT",
      messageId: `simulated_resend_${Date.now()}`,
      error: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);

  try {
    let resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail.trim()],
        reply_to: "hello@zerahkids.com",
        subject,
        html,
      }),
      signal: controller.signal,
    });

    let resData = (await resp.json().catch(() => ({}))) as Record<string, any>;

    // Fallback if custom domain not verified on Resend
    if (!resp.ok && (resData.message?.includes("domain") || resData.message?.includes("not verified"))) {
      console.warn("[dispatch-sale-notifications] Custom domain unverified on Resend. Falling back to onboarding@resend.dev...");
      resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "Zérah Baby & Kids <onboarding@resend.dev>",
          to: [toEmail.trim()],
          reply_to: "hello@zerahkids.com",
          subject,
          html,
        }),
      });
      resData = (await resp.json().catch(() => ({}))) as Record<string, any>;
    }

    if (resp.ok) {
      return {
        status: "SENT",
        messageId: resData.id || null,
        error: null,
      };
    } else {
      return {
        status: "FAILED",
        messageId: null,
        error: resData.message || JSON.stringify(resData),
      };
    }
  } catch (err: any) {
    const isTimeout = err.name === "AbortError";
    return {
      status: "FAILED",
      messageId: null,
      error: isTimeout ? "Resend request timed out" : err.message || "Email network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main Server Entrypoint
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Server credentials not configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const payload = (await req.json().catch(() => ({}))) as {
      sale_type?: "online" | "offline";
      sale_id?: string;
      force_channels?: string[];
      idempotency_key?: string;
    };

    const saleType = payload.sale_type;
    const saleId = payload.sale_id;
    const forceChannels = new Set(payload.force_channels || []);

    if (!saleType || !saleId || (saleType !== "online" && saleType !== "offline")) {
      return new Response(
        JSON.stringify({ error: "Invalid request: sale_type ('online' | 'offline') and sale_id are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // 1. Fetch Authoritative Sale & Item Data from DB
    let saleRecord: Record<string, any> | null = null;
    let saleItems: Array<Record<string, any>> = [];

    if (saleType === "online") {
      const { data: order, error: orderErr } = await adminClient
        .from("orders")
        .select("*, order_items(*)")
        .eq("id", saleId)
        .maybeSingle();

      if (orderErr || !order) {
        return new Response(JSON.stringify({ error: `Online order ${saleId} not found` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }
      saleRecord = order;
      saleItems = Array.isArray(order.order_items) ? order.order_items : [];
    } else {
      const { data: sale, error: saleErr } = await adminClient
        .from("offline_sales")
        .select("*, offline_sale_items(*)")
        .eq("id", saleId)
        .maybeSingle();

      if (saleErr || !sale) {
        return new Response(JSON.stringify({ error: `Offline sale ${saleId} not found` }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }
      saleRecord = sale;
      saleItems = Array.isArray(sale.offline_sale_items) ? sale.offline_sale_items : [];
    }

    // 2. Fetch Admin / Site Settings
    const { data: settingsRows } = await adminClient
      .from("site_settings")
      .select("key, value")
      .in("key", [
        "owner_notification_phone",
        "owner_notification_email",
        "contact_phone",
        "owner_notify_online_sales",
        "owner_notify_offline_sales",
      ]);

    const settingsMap: Record<string, string> = {};
    (settingsRows || []).forEach((row) => {
      settingsMap[row.key] = row.value;
    });

    const rawOwnerPhones = settingsMap.owner_notification_phone || settingsMap.contact_phone || Deno.env.get("OWNER_PHONE") || "9057074777";
    const targetOwnerPhones = extractIndianPhoneNumbers(rawOwnerPhones);
    const configuredOwnerPhone = targetOwnerPhones.length > 0 ? targetOwnerPhones[0] : "9057074777";

    const configuredOwnerEmail = settingsMap.owner_notification_email || Deno.env.get("OWNER_NOTIFICATION_EMAIL") || "hello@zerahkids.com";

    // 3. Resolve Customer Info
    const customerName = cleanCustomerName(
      saleType === "online" ? saleRecord.full_name : saleRecord.customer_name,
    );
    const rawCustomerPhone = saleType === "online" ? saleRecord.phone : saleRecord.customer_phone;
    const customerEmail = (saleType === "online" ? saleRecord.email : saleRecord.customer_email)?.trim() || "";
    const saleNumber = saleType === "online"
      ? saleRecord.order_number || saleRecord.invoice_no || saleRecord.id?.slice(0, 8).toUpperCase()
      : saleRecord.sale_number || "POS-SALE";
    const totalAmount = Number(saleRecord.total || 0);
    const paymentMethod = (saleRecord.payment_method || (saleType === "online" ? "Online" : "Cash")).toUpperCase();

    // 4. Claim / Get Idempotent Notification Event
    const canonicalIdempotencyKey = payload.idempotency_key || `${saleType}_sale_${saleId}_completed`;

    const { data: existingEvent } = await adminClient
      .from("sale_notification_events")
      .select("*")
      .eq("idempotency_key", canonicalIdempotencyKey)
      .maybeSingle();

    let currentEvent = existingEvent;
    if (!currentEvent) {
      const { data: createdEvent, error: createErr } = await adminClient
        .from("sale_notification_events")
        .insert({
          sale_type: saleType,
          sale_id: saleId,
          sale_number: saleNumber,
          customer_name: customerName,
          customer_phone: rawCustomerPhone || null,
          customer_email: customerEmail || null,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          source: saleType,
          idempotency_key: canonicalIdempotencyKey,
          attempts: 1,
          last_attempt_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (createErr && !createdEvent) {
        // If conflict on concurrent insert, fetch existing
        const { data: refetched } = await adminClient
          .from("sale_notification_events")
          .select("*")
          .eq("idempotency_key", canonicalIdempotencyKey)
          .single();
        currentEvent = refetched;
      } else {
        currentEvent = createdEvent;
      }
    }

    const updates: Record<string, any> = {
      attempts: (currentEvent?.attempts || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = "Zérah Baby & Kids <orders@zerahkids.com>";

    // -----------------------------------------------------------------------
    // CHANNEL 1: Customer WhatsApp/SMS
    // -----------------------------------------------------------------------
    let customerSmsStatus = currentEvent?.customer_sms_status || "PENDING";
    let customerSmsId = currentEvent?.customer_sms_id || null;
    let customerSmsError = currentEvent?.customer_sms_error || null;

    if (customerSmsStatus !== "SENT" || forceChannels.has("customer_sms")) {
      const { valid: phoneValid, phone: cleanPhone, error: phoneErr } = normalizeIndianPhone(rawCustomerPhone);

      if (!phoneValid) {
        customerSmsStatus = "SKIPPED";
        customerSmsError = phoneErr || "No valid customer phone";
      } else {
        const custTemplateId = saleType === "online" ? "6aa1cd275f81de31570d50e2" : "6aa1cb843c42b39d420dbff2";
        const isCod = paymentMethod.toLowerCase().includes("cod");
        const totalNum = Math.round(totalAmount);

        const custVars = saleType === "online"
          ? {
              var1: `#${saleNumber}${isCod ? " (COD)" : ""}`,
              var2: String(totalNum),
              ref: `#${saleNumber}`,
              total: String(totalNum),
            }
          : {
              var1: String(saleNumber),
              var2: String(totalNum),
              var3: STORE_NAME,
              total: String(totalNum),
            };

        if (msg91AuthKey) {
          const res = await dispatchMsg91(msg91AuthKey, custTemplateId, cleanPhone, custVars);
          customerSmsStatus = res.status;
          customerSmsId = res.providerMsgId;
          customerSmsError = res.error;
        } else {
          customerSmsStatus = "SENT";
          customerSmsId = `mock_sms_cust_${Date.now()}`;
          customerSmsError = null;
        }

        // Mirror to sms_logs table for backward-compatible admin logs
        await adminClient.from("sms_logs").upsert(
          {
            order_id: saleType === "online" ? saleId : null,
            offline_sale_id: saleType === "offline" ? saleId : null,
            phone: cleanPhone,
            message_type: saleType === "online" ? "online_sale" : "offline_pos_sale",
            recipient_type: "customer",
            status: customerSmsStatus,
            provider_status: customerSmsStatus === "SENT" ? "sent" : "error",
            error_details: customerSmsError,
            idempotency_key: `${saleId}_customer_${saleType}_sms`,
            message_content: `Sale #${saleNumber} confirmation sent to ${customerName}`,
            template_id: custTemplateId,
            provider_message_id: customerSmsId,
            sent_at: customerSmsStatus === "SENT" ? new Date().toISOString() : null,
          },
          { onConflict: "idempotency_key" },
        );
      }
      updates.customer_sms_status = customerSmsStatus;
      updates.customer_sms_id = customerSmsId;
      updates.customer_sms_error = customerSmsError;
    }

    // -----------------------------------------------------------------------
    // CHANNEL 2: Admin WhatsApp/SMS
    // -----------------------------------------------------------------------
    let adminSmsStatus = currentEvent?.admin_sms_status || "PENDING";
    let adminSmsId = currentEvent?.admin_sms_id || null;
    let adminSmsError = currentEvent?.admin_sms_error || null;

    if (adminSmsStatus !== "SENT" || forceChannels.has("admin_sms")) {
      const { valid: adminPhoneValid, phone: cleanAdminPhone } = normalizeIndianPhone(configuredOwnerPhone);

      if (!adminPhoneValid) {
        adminSmsStatus = "FAILED";
        adminSmsError = `Invalid admin phone: ${configuredOwnerPhone}`;
      } else {
        const adminTemplateId = saleType === "online" ? "6aa1d097daacdd8930018922" : "6aa1d17366745ba0d206c582";
        const isCod = paymentMethod.toLowerCase().includes("cod");
        const totalNum = Math.round(totalAmount);

        const adminVars = saleType === "online"
          ? {
              var1: `${isCod ? "COD " : "Online "}#${saleNumber}`,
              var2: customerName,
              var3: String(totalNum),
              total: String(totalNum),
            }
          : {
              var1: String(saleNumber),
              var2: customerName,
              var3: String(totalNum),
              total: String(totalNum),
            };

        if (msg91AuthKey) {
          const res = await dispatchMsg91(msg91AuthKey, adminTemplateId, cleanAdminPhone, adminVars);
          adminSmsStatus = res.status;
          adminSmsId = res.providerMsgId;
          adminSmsError = res.error;
        } else {
          adminSmsStatus = "SENT";
          adminSmsId = `mock_sms_admin_${Date.now()}`;
          adminSmsError = null;
        }

        // Mirror to sms_logs table
        await adminClient.from("sms_logs").upsert(
          {
            order_id: saleType === "online" ? saleId : null,
            offline_sale_id: saleType === "offline" ? saleId : null,
            phone: cleanAdminPhone,
            message_type: saleType === "online" ? "online_sale" : "offline_pos_sale",
            recipient_type: "owner",
            status: adminSmsStatus,
            provider_status: adminSmsStatus === "SENT" ? "sent" : "error",
            error_details: adminSmsError,
            idempotency_key: `${saleId}_admin_${saleType}_sms`,
            message_content: `Admin sale alert for #${saleNumber} (${customerName}, Rs ${totalNum})`,
            template_id: adminTemplateId,
            provider_message_id: adminSmsId,
            sent_at: adminSmsStatus === "SENT" ? new Date().toISOString() : null,
          },
          { onConflict: "idempotency_key" },
        );
      }
      updates.admin_sms_status = adminSmsStatus;
      updates.admin_sms_id = adminSmsId;
      updates.admin_sms_error = adminSmsError;
    }

    // -----------------------------------------------------------------------
    // CHANNEL 3: Admin Email
    // -----------------------------------------------------------------------
    let adminEmailStatus = currentEvent?.admin_email_status || "PENDING";
    let adminEmailId = currentEvent?.admin_email_id || null;
    let adminEmailError = currentEvent?.admin_email_error || null;

    if (adminEmailStatus !== "SENT" || forceChannels.has("admin_email")) {
      const adminRendered = renderAdminSaleEmail(saleType, saleRecord, saleItems);
      const res = await dispatchResendEmail(
        resendApiKey,
        configuredOwnerEmail,
        fromEmail,
        adminRendered.subject,
        adminRendered.html,
      );

      adminEmailStatus = res.status;
      adminEmailId = res.messageId;
      adminEmailError = res.error;

      // Update owner_notification_logs for backward compatibility
      await adminClient.from("owner_notification_logs").insert({
        event_type: saleType === "online" ? "online_order" : "offline_sale",
        reference_id: saleId,
        reference_number: saleNumber,
        recipient: configuredOwnerEmail,
        status: adminEmailStatus === "SENT" ? "sent" : "failed",
        total: totalAmount,
        provider: "resend",
        provider_message_id: adminEmailId,
        error_message: adminEmailError,
        sent_at: adminEmailStatus === "SENT" ? new Date().toISOString() : null,
      });

      // Update sale record owner_notification_status
      const targetTable = saleType === "online" ? "orders" : "offline_sales";
      await adminClient
        .from(targetTable)
        .update({
          owner_notification_status: adminEmailStatus === "SENT" ? "sent" : "failed",
          owner_notified_at: adminEmailStatus === "SENT" ? new Date().toISOString() : null,
        })
        .eq("id", saleId);

      updates.admin_email_status = adminEmailStatus;
      updates.admin_email_id = adminEmailId;
      updates.admin_email_error = adminEmailError;
    }

    // -----------------------------------------------------------------------
    // CHANNEL 4: Customer Email (Conditional on Email Existence)
    // -----------------------------------------------------------------------
    let customerEmailStatus = currentEvent?.customer_email_status || "PENDING";
    let customerEmailId = currentEvent?.customer_email_id || null;
    let customerEmailError = currentEvent?.customer_email_error || null;

    if (customerEmailStatus !== "SENT" || forceChannels.has("customer_email")) {
      if (!customerEmail || !customerEmail.includes("@")) {
        customerEmailStatus = "SKIPPED";
        customerEmailError = "No customer email provided";
      } else {
        const custRendered = renderCustomerInvoiceEmail(saleType, saleRecord, saleItems);
        const res = await dispatchResendEmail(
          resendApiKey,
          customerEmail,
          fromEmail,
          custRendered.subject,
          custRendered.html,
        );

        customerEmailStatus = res.status;
        customerEmailId = res.messageId;
        customerEmailError = res.error;

        // Update target table customer_notification_status
        const targetTable = saleType === "online" ? "orders" : "offline_sales";
        await adminClient
          .from(targetTable)
          .update({
            customer_notification_status: customerEmailStatus === "SENT" ? "sent" : "failed",
            customer_notified_at: customerEmailStatus === "SENT" ? new Date().toISOString() : null,
          })
          .eq("id", saleId);
      }
      updates.customer_email_status = customerEmailStatus;
      updates.customer_email_id = customerEmailId;
      updates.customer_email_error = customerEmailError;
    }

    // 5. Complete Event if all channels terminal
    const allTerminal =
      (customerSmsStatus === "SENT" || customerSmsStatus === "SKIPPED") &&
      (adminSmsStatus === "SENT" || adminSmsStatus === "SKIPPED") &&
      (adminEmailStatus === "SENT" || adminEmailStatus === "SKIPPED") &&
      (customerEmailStatus === "SENT" || customerEmailStatus === "SKIPPED");

    if (allTerminal) {
      updates.completed_at = new Date().toISOString();
    }

    // Write back updates to sale_notification_events
    const { data: finalEvent } = await adminClient
      .from("sale_notification_events")
      .update(updates)
      .eq("idempotency_key", canonicalIdempotencyKey)
      .select("*")
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        sale_type: saleType,
        sale_id: saleId,
        channels: {
          customer_sms: { status: customerSmsStatus, id: customerSmsId, error: customerSmsError },
          admin_sms: { status: adminSmsStatus, id: adminSmsId, error: adminSmsError },
          admin_email: { status: adminEmailStatus, id: adminEmailId, error: adminEmailError },
          customer_email: { status: customerEmailStatus, id: customerEmailId, error: customerEmailError },
        },
        event: finalEvent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (fatalError: any) {
    console.error("[dispatch-sale-notifications] Fatal Error:", fatalError);
    // Never fail the caller transaction with a 5xx error
    return new Response(
      JSON.stringify({
        success: false,
        error: fatalError.message || "Internal notification processing error",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }
});
