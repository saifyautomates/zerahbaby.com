/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

/* ------------------------------------------------------------------ */
/*  Email HTML Templates                                               */
/* ------------------------------------------------------------------ */

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
    .profit-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px 16px; margin-top: 16px; font-size: 13px; }
    .profit-title { font-weight: 700; color: #166534; margin-bottom: 4px; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand-title">Zérah Baby &amp; Kids</h1>
      <div class="brand-sub">Store Owner Sale Notification</div>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <span class="badge">${escapeHtml(badgeText)}</span>
      </div>
      ${bodyContent}
    </div>
    <div class="footer">
      This is an automated internal notification for Zérah Baby &amp; Kids store management.<br>
      Store: 80 Feet Link Rd, near Bajot Restaurant, Kota, Rajasthan 324001
    </div>
  </div>
</body>
</html>`;
}

function renderOfflineSaleEmail(
  sale: Record<string, any>,
  items: Array<Record<string, any>>,
  costsMap: Record<string, number>,
): { subject: string; html: string } {
  const saleNumber = sale.sale_number || "POS-SALE";
  const dateStr = new Date(sale.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const finalTotal = Number(sale.total || 0);
  const subtotal = Number(sale.subtotal || 0);
  const discount = Number(sale.discount || 0);
  const customerName = sale.customer_name || "Walk-in Customer";
  const customerPhone = sale.customer_phone || "Not provided";
  const paymentMethod = (sale.payment_method || "cash").toUpperCase();

  // Calculate profit if cost data is available
  let totalCost = 0;
  let hasCostData = false;
  items.forEach((item) => {
    if (item.product_id && costsMap[item.product_id] !== undefined) {
      totalCost += costsMap[item.product_id] * item.qty;
      hasCostData = true;
    }
  });
  const grossProfit = finalTotal - totalCost;
  const marginPct =
    finalTotal > 0 && hasCostData ? Math.round((grossProfit / finalTotal) * 100) : 0;

  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        ${item.sku ? `<br><span style="font-size:11px;color:#64748b;">SKU: ${escapeHtml(item.sku)}</span>` : ""}
      </td>
      <td style="text-align:center;">${item.qty}</td>
      <td class="text-right">${formatCurrency(Number(item.price))}</td>
      <td class="text-right font-weight:600;">${formatCurrency(Number(item.subtotal))}</td>
    </tr>`,
    )
    .join("");

  const bodyContent = `
    <h2 style="margin:0 0 8px 0; font-size:20px; font-weight:800; color:#0f172a; text-align:center;">
      Offline POS Sale Completed
    </h2>
    <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px 0;">
      A new offline sale has been finalized at the store counter.
    </p>

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Invoice / Sale No:</span>
        <span class="meta-value">${escapeHtml(saleNumber)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Date &amp; Time:</span>
        <span class="meta-value">${escapeHtml(dateStr)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Name:</span>
        <span class="meta-value">${escapeHtml(customerName)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Phone:</span>
        <span class="meta-value">${escapeHtml(customerPhone)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment Method:</span>
        <span class="meta-value" style="color:#0284c7;">${escapeHtml(paymentMethod)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Sale Status:</span>
        <span class="meta-value" style="color:#16a34a;">COMPLETED</span>
      </div>
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Items Sold (${items.length})</h3>
    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-box">
      <div class="total-row">
        <span>Items Subtotal:</span>
        <span>${formatCurrency(subtotal)}</span>
      </div>
      ${
        discount > 0
          ? `
      <div class="total-row" style="color:#dc2626;">
        <span>Discount (${escapeHtml(sale.discount_type || "discount")}):</span>
        <span>- ${formatCurrency(discount)}</span>
      </div>`
          : ""
      }
      <div class="total-row grand-total">
        <span>Total Amount Collected:</span>
        <span>${formatCurrency(finalTotal)}</span>
      </div>
    </div>

    ${
      hasCostData
        ? `
    <div class="profit-box">
      <div class="profit-title">🔒 Owner Financial Analysis</div>
      <div style="display:flex; justify-content:space-between; margin-top:6px;">
        <span>Total Product Cost:</span>
        <strong>${formatCurrency(totalCost)}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:4px;">
        <span>Estimated Gross Profit:</span>
        <strong style="color:#15803d;">${formatCurrency(grossProfit)} (${marginPct}%)</strong>
      </div>
    </div>`
        : ""
    }
  `;

  const subject = `Offline Sale — ${formatCurrency(finalTotal)} — ${saleNumber}`;
  const html = getBaseLayout(subject, "Offline POS Sale", "#dbeafe", "#1e40af", bodyContent);

  return { subject, html };
}

function renderOnlineSaleEmail(
  order: Record<string, any>,
  items: Array<Record<string, any>>,
  costsMap: Record<string, number>,
): { subject: string; html: string } {
  const orderRef = order.id ? order.id.slice(0, 8).toUpperCase() : "ORDER";
  const dateStr = new Date(order.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const finalTotal = Number(order.total || 0);
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const shipping = Number(order.shipping || 0);
  const customerName = order.full_name || "Online Customer";
  const customerPhone = order.phone || "Not provided";
  const customerEmail = order.email || "Not provided";
  const addressFormatted = [
    order.address,
    order.address_line2,
    order.landmark ? `Near ${order.landmark}` : "",
    order.city,
    order.state,
    order.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const paymentMethod = (order.payment_method || "Online / Razorpay").toUpperCase();
  const paymentStatus = (order.payment_status || "paid").toUpperCase();
  const razorpayPaymentId = order.razorpay_payment_id || "N/A";

  // Calculate profit if cost data is available
  let totalCost = 0;
  let hasCostData = false;
  items.forEach((item) => {
    if (item.product_id && costsMap[item.product_id] !== undefined) {
      totalCost += costsMap[item.product_id] * item.qty;
      hasCostData = true;
    }
  });
  const grossProfit = finalTotal - totalCost;
  const marginPct =
    finalTotal > 0 && hasCostData ? Math.round((grossProfit / finalTotal) * 100) : 0;

  const itemsHtml = items
    .map(
      (item) => `
    <tr>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
      </td>
      <td style="text-align:center;">${item.qty}</td>
      <td class="text-right">${formatCurrency(Number(item.price))}</td>
      <td class="text-right font-weight:600;">${formatCurrency(Number(item.price) * Number(item.qty))}</td>
    </tr>`,
    )
    .join("");

  const bodyContent = `
    <h2 style="margin:0 0 8px 0; font-size:20px; font-weight:800; color:#0f172a; text-align:center;">
      Online Paid Order Received!
    </h2>
    <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px 0;">
      A customer has placed and paid for an order via the online storefront.
    </p>

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Order Number:</span>
        <span class="meta-value">#${escapeHtml(orderRef)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Order Date:</span>
        <span class="meta-value">${escapeHtml(dateStr)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Name:</span>
        <span class="meta-value">${escapeHtml(customerName)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Phone &amp; Email:</span>
        <span class="meta-value">${escapeHtml(customerPhone)} · ${escapeHtml(customerEmail)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Delivery Address:</span>
        <span class="meta-value" style="max-width:280px;">${escapeHtml(addressFormatted)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment Gateway:</span>
        <span class="meta-value">${escapeHtml(paymentMethod)} (${escapeHtml(razorpayPaymentId)})</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment Status:</span>
        <span class="meta-value" style="color:#16a34a; font-weight:800;">${escapeHtml(paymentStatus)}</span>
      </div>
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Ordered Products (${items.length})</h3>
    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th class="text-right">Unit Price</th>
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
        <span>Discount / Promo:</span>
        <span>- ${formatCurrency(discount)}</span>
      </div>`
          : ""
      }
      <div class="total-row">
        <span>Delivery / Shipping:</span>
        <span>${shipping === 0 ? "FREE" : formatCurrency(shipping)}</span>
      </div>
      <div class="total-row grand-total">
        <span>Total Paid Amount:</span>
        <span>${formatCurrency(finalTotal)}</span>
      </div>
    </div>

    ${
      hasCostData
        ? `
    <div class="profit-box">
      <div class="profit-title">🔒 Owner Financial Analysis</div>
      <div style="display:flex; justify-content:space-between; margin-top:6px;">
        <span>Total Product Cost:</span>
        <strong>${formatCurrency(totalCost)}</strong>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:4px;">
        <span>Estimated Gross Profit:</span>
        <strong style="color:#15803d;">${formatCurrency(grossProfit)} (${marginPct}%)</strong>
      </div>
    </div>`
        : ""
    }
  `;

  const subject = `Online Sale — ${formatCurrency(finalTotal)} — Order #${orderRef}`;
  const html = getBaseLayout(subject, "Online Paid Order", "#fef3c7", "#b45309", bodyContent);

  return { subject, html };
}

function renderTestEmail(): { subject: string; html: string } {
  const dateStr = new Date().toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "medium",
  });
  const bodyContent = `
    <h2 style="margin:0 0 8px 0; font-size:20px; font-weight:800; color:#0f172a; text-align:center;">
      Test Owner Sale Notification
    </h2>
    <p style="text-align:center; color:#64748b; font-size:14px; margin:0 0 20px 0;">
      This is a test message to confirm your Resend email notification configuration is working seamlessly.
    </p>

    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Status:</span>
        <span class="meta-value" style="color:#16a34a;">SYSTEM OPERATIONAL</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Sent At:</span>
        <span class="meta-value">${escapeHtml(dateStr)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Provider:</span>
        <span class="meta-value">Resend (zerahkids.com)</span>
      </div>
    </div>

    <div style="padding:16px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; font-size:13px; color:#166534; line-height:1.6;">
      <strong>✓ Notifications Ready:</strong> When real offline sales are completed in POS or online orders are paid via Razorpay, you will receive full itemized alerts at this address.
    </div>
  `;

  const subject = `Test Notification — Zérah Baby & Kids`;
  const html = getBaseLayout(subject, "Test Notification", "#dcfce7", "#15803d", bodyContent);

  return { subject, html };
}

function renderOfflineReturnEmail(
  ret: Record<string, any>,
  items: Array<Record<string, any>>,
): { subject: string; html: string } {
  const returnNumber = ret.return_number || "POS-RETURN";
  const dateStr = new Date(ret.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const refundAmount = Number(ret.refund_amount || 0);
  const refundMethod = (ret.refund_method || "cash").toUpperCase();
  const customerName = ret.customer_name || "Walk-in Customer";
  const customerPhone = ret.customer_phone || "Not provided";
  const returnReason = ret.return_reason || "Customer changed mind";
  const notes = ret.notes || "";
  const totalUnits = items.reduce((sum, item) => sum + Number(item.qty || 1), 0);

  const itemsHtml = items
    .map((item) => {
      const name = item.name || "Product";
      const sku = item.sku ? `SKU: ${item.sku}` : "";
      const barcode = item.barcode ? `Barcode: ${item.barcode}` : "";
      const variant = item.variant_info ? `Variant: ${item.variant_info}` : "";
      const meta = [sku, barcode, variant].filter(Boolean).join(" | ");
      const qty = Number(item.qty || 1);
      const price = Number(item.refund_price || 0);
      const lineTotal = Number(item.subtotal || price * qty);

      return `
      <tr>
        <td>
          <div style="font-weight:600; color:#0f172a;">${escapeHtml(name)}</div>
          ${meta ? `<div style="font-size:11px; color:#64748b; margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
          <div style="font-size:11px; color:#16a34a; font-weight:600; margin-top:2px;">+${qty} restocked to inventory</div>
        </td>
        <td style="text-align:center; font-weight:600;">${qty}</td>
        <td class="text-right">${formatCurrency(price)}</td>
        <td class="text-right" style="font-weight:600;">${formatCurrency(lineTotal)}</td>
      </tr>`;
    })
    .join("");

  const bodyContent = `
    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Return Reference:</span>
        <span class="meta-value" style="color:#b91c1c; font-weight:700;">${escapeHtml(returnNumber)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Date & Time:</span>
        <span class="meta-value">${escapeHtml(dateStr)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Name:</span>
        <span class="meta-value">${escapeHtml(customerName)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Phone:</span>
        <span class="meta-value">${escapeHtml(customerPhone)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Refund Method:</span>
        <span class="meta-value" style="color:#0284c7; font-weight:700;">${escapeHtml(refundMethod)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Return Reason:</span>
        <span class="meta-value" style="color:#dc2626;">${escapeHtml(returnReason)}</span>
      </div>
      ${
        notes
          ? `
      <div class="meta-row">
        <span class="meta-label">Notes:</span>
        <span class="meta-value">${escapeHtml(notes)}</span>
      </div>`
          : ""
      }
      <div class="meta-row">
        <span class="meta-label">Inventory Status:</span>
        <span class="meta-value" style="color:#16a34a; font-weight:700;">+${totalUnits} units restocked</span>
      </div>
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Items Returned (${items.length})</h3>
    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th class="text-right">Unit Refund</th>
          <th class="text-right">Line Refund</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-box" style="background:#fef2f2; border:1px solid #fecaca;">
      <div class="total-row grand-total" style="color:#b91c1c; border-top:none; padding-top:0; margin-top:0;">
        <span>Total Refunded Amount:</span>
        <span>${formatCurrency(refundAmount)}</span>
      </div>
    </div>
  `;

  const subject = `Offline Return — ${formatCurrency(refundAmount)} — ${returnNumber}`;
  const html = getBaseLayout(subject, "Offline POS Return", "#fee2e2", "#991b1b", bodyContent);

  return { subject, html };
}

function renderCustomerQueryEmail(
  customerName: string,
  customerEmail: string,
  message: string,
  orderNumber?: string,
  queryId?: string,
): { subject: string; html: string } {
  const bodyContent = `
    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Customer Name:</span>
        <span class="meta-value">${escapeHtml(customerName)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer Email:</span>
        <span class="meta-value"><a href="mailto:${escapeHtml(customerEmail)}" style="color:#8B2020; font-weight:600;">${escapeHtml(customerEmail)}</a></span>
      </div>
      ${
        orderNumber
          ? `<div class="meta-row">
        <span class="meta-label">Order Reference:</span>
        <span class="meta-value font-mono">#${escapeHtml(orderNumber)}</span>
      </div>`
          : ""
      }
      <div class="meta-row">
        <span class="meta-label">Ticket ID:</span>
        <span class="meta-value font-mono">${escapeHtml(queryId ? queryId.slice(0, 8).toUpperCase() : "NEW")}</span>
      </div>
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Customer Message:</h3>
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; font-size:13px; line-height:1.6; color:#0f172a; white-space:pre-wrap;">
      ${escapeHtml(message)}
    </div>

    <div style="margin-top:24px; text-align:center;">
      <a href="mailto:${escapeHtml(customerEmail)}?subject=${encodeURIComponent(`Re: Your inquiry at Zérah Baby & Kids [Ticket #${(queryId || "").slice(0, 8).toUpperCase()}]`)}" style="display:inline-block; background:#8B2020; color:#ffffff; font-size:13px; font-weight:700; padding:12px 24px; border-radius:999px; text-decoration:none;">
        Reply to Customer
      </a>
    </div>
  `;

  const subject = `New Customer Inquiry — ${customerName}${orderNumber ? ` [Order #${orderNumber}]` : ""}`;
  const html = getBaseLayout(subject, "Customer Inquiry", "#fef3c7", "#92400e", bodyContent);

  return { subject, html };
}

/* ------------------------------------------------------------------ */
/*  Main Edge Function Handler                                        */
/* ------------------------------------------------------------------ */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY")?.trim() || "";
  const fromEmail =
    Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "Zérah Store Alerts <orders@zerahkids.com>";

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase server credentials" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    const { type, order_id, sale_id, return_id, force_retry, recipient: customRecipient } = payload;

    if (
      !type ||
      !["offline_sale", "online_order", "offline_return", "customer_query", "test"].includes(type)
    ) {
      return new Response(JSON.stringify({ error: "Invalid or missing notification type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Fetch site settings for owner email and notification toggles
    const { data: settingsRows } = await adminClient.from("site_settings").select("key, value");
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((row: { key: string; value: string }) => {
      settings[row.key] = row.value;
    });

    const configuredOwnerEmail =
      customRecipient ||
      settings.owner_notification_email ||
      Deno.env.get("OWNER_NOTIFICATION_EMAIL")?.trim() ||
      settings.contact_email ||
      "hello@zerahkids.com";

    const notifyOffline = settings.owner_notify_offline_sales !== "false";
    const notifyOnline = settings.owner_notify_online_sales !== "false";

    let emailSubject = "";
    let emailHtml = "";
    let referenceId = "";
    let referenceNumber = "";
    let totalAmount = 0;

    // 2. Process by Type
    if (type === "test") {
      const rendered = renderTestEmail();
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
      referenceId = "test";
      referenceNumber = "TEST-ALERT";
    } else if (type === "offline_sale") {
      if (!sale_id) throw new Error("Missing sale_id for offline sale notification");
      if (!notifyOffline && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Offline sale notifications disabled in settings",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch offline sale
      const { data: sale, error: saleErr } = await adminClient
        .from("offline_sales")
        .select("*")
        .eq("id", sale_id)
        .single();
      if (saleErr || !sale)
        throw new Error(`Offline sale not found: ${saleErr?.message || "unknown"}`);

      // Idempotency check
      if (sale.owner_notification_status === "sent" && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Notification already sent for this sale",
            duplicate: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch sale items
      const { data: items, error: itemsErr } = await adminClient
        .from("offline_sale_items")
        .select("*")
        .eq("sale_id", sale_id);
      if (itemsErr) throw itemsErr;

      // Fetch product costs if available
      const productIds = (items || []).map((i: any) => i.product_id).filter(Boolean);
      const costsMap: Record<string, number> = {};
      if (productIds.length > 0) {
        const { data: costs } = await adminClient
          .from("product_costs")
          .select("product_id, buying_price")
          .in("product_id", productIds);
        (costs || []).forEach((c: any) => {
          costsMap[c.product_id] = Number(c.buying_price);
        });
      }

      referenceId = sale.id;
      referenceNumber = sale.sale_number;
      totalAmount = Number(sale.total);

      const rendered = renderOfflineSaleEmail(sale, items || [], costsMap);
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
    } else if (type === "online_order") {
      if (!order_id) throw new Error("Missing order_id for online order notification");
      if (!notifyOnline && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Online order notifications disabled in settings",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch online order
      const { data: order, error: orderErr } = await adminClient
        .from("orders")
        .select("*")
        .eq("id", order_id)
        .single();
      if (orderErr || !order) throw new Error(`Order not found: ${orderErr?.message || "unknown"}`);

      // Idempotency check
      if (order.owner_notification_status === "sent" && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Notification already sent for this order",
            duplicate: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch order items
      const { data: items, error: itemsErr } = await adminClient
        .from("order_items")
        .select("*")
        .eq("order_id", order_id);
      if (itemsErr) throw itemsErr;

      // Fetch product costs if available
      const productIds = (items || []).map((i: any) => i.product_id).filter(Boolean);
      const costsMap: Record<string, number> = {};
      if (productIds.length > 0) {
        const { data: costs } = await adminClient
          .from("product_costs")
          .select("product_id, buying_price")
          .in("product_id", productIds);
        (costs || []).forEach((c: any) => {
          costsMap[c.product_id] = Number(c.buying_price);
        });
      }

      referenceId = order.id;
      referenceNumber = `#${order.id.slice(0, 8).toUpperCase()}`;
      totalAmount = Number(order.total);

      const rendered = renderOnlineSaleEmail(order, items || [], costsMap);
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
    } else if (type === "offline_return") {
      if (!return_id) throw new Error("Missing return_id for offline return notification");
      if (!notifyOffline && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Offline notifications disabled in settings",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch offline return
      const { data: retRecord, error: retErr } = await adminClient
        .from("offline_returns")
        .select("*")
        .eq("id", return_id)
        .single();
      if (retErr || !retRecord)
        throw new Error(`Offline return not found: ${retErr?.message || "unknown"}`);

      // Idempotency check
      if (retRecord.owner_notification_status === "sent" && !force_retry) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Notification already sent for this return",
            duplicate: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Fetch return items
      const { data: items, error: itemsErr } = await adminClient
        .from("offline_return_items")
        .select("*")
        .eq("return_id", return_id);
      if (itemsErr) throw itemsErr;

      referenceId = retRecord.id;
      referenceNumber = retRecord.return_number;
      totalAmount = Number(retRecord.refund_amount);

      const rendered = renderOfflineReturnEmail(retRecord, items || []);
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
    } else if (type === "customer_query") {
      const customerName = payload.customer_name || "Customer";
      const customerEmail = payload.customer_email || "N/A";
      const queryMessage = payload.message || "";
      const orderNum = payload.order_number || "";
      referenceId = payload.reference_id || `query_${Date.now()}`;
      referenceNumber = `QUERY-${referenceId.slice(0, 8).toUpperCase()}`;
      totalAmount = 0;

      const rendered = renderCustomerQueryEmail(
        customerName,
        customerEmail,
        queryMessage,
        orderNum,
        referenceId,
      );
      emailSubject = rendered.subject;
      emailHtml = rendered.html;
    }

    // 3. Dispatch Email via Resend REST API
    let resendMessageId: string | null = null;
    let dispatchError: string | null = null;

    if (!resendApiKey) {
      dispatchError = "RESEND_API_KEY is not configured in Supabase Edge Function secrets";
      console.warn(`[send-owner-sale-notification] ${dispatchError}`);
    } else {
      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [configuredOwnerEmail],
            subject: emailSubject,
            html: emailHtml,
          }),
        });

        const resendData = await resendRes.json();
        if (!resendRes.ok) {
          dispatchError = resendData.message || JSON.stringify(resendData);
          console.error("[send-owner-sale-notification] Resend API error:", dispatchError);
        } else {
          resendMessageId = resendData.id;
          console.log("[send-owner-sale-notification] Email sent successfully:", resendMessageId);
        }
      } catch (err: unknown) {
        dispatchError = (err as Error).message || "Network error while calling Resend";
        console.error("[send-owner-sale-notification] Fetch error:", dispatchError);
      }
    }

    const isSuccess = dispatchError === null;

    // 4. Update Database State and Log Event
    if (type === "offline_sale" && sale_id) {
      await adminClient
        .from("offline_sales")
        .update({
          owner_notification_status: isSuccess ? "sent" : "failed",
          owner_notified_at: isSuccess ? new Date().toISOString() : null,
        })
        .eq("id", sale_id);
    } else if (type === "online_order" && order_id) {
      await adminClient
        .from("orders")
        .update({
          owner_notification_status: isSuccess ? "sent" : "failed",
          owner_notified_at: isSuccess ? new Date().toISOString() : null,
        })
        .eq("id", order_id);
    } else if (type === "offline_return" && return_id) {
      await adminClient
        .from("offline_returns")
        .update({
          owner_notification_status: isSuccess ? "sent" : "failed",
          owner_notified_at: isSuccess ? new Date().toISOString() : null,
        })
        .eq("id", return_id);
    }

    // Log to owner_notification_logs
    await adminClient.from("owner_notification_logs").insert({
      event_type: type,
      reference_id: referenceId,
      reference_number: referenceNumber,
      recipient: configuredOwnerEmail,
      status: isSuccess ? "sent" : "failed",
      total: totalAmount,
      provider: "resend",
      provider_message_id: resendMessageId,
      error_message: dispatchError,
      sent_at: isSuccess ? new Date().toISOString() : null,
    });

    return new Response(
      JSON.stringify({
        success: isSuccess,
        recipient: configuredOwnerEmail,
        messageId: resendMessageId,
        error: dispatchError,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: isSuccess ? 200 : 202, // 202 Accepted even if email provider had issue so callers don't fail
      },
    );
  } catch (error: unknown) {
    const message = (error as Error).message || "Internal server error";
    console.error("[send-owner-sale-notification] Fatal Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
