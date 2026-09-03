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

function renderCustomerOrderConfirmationEmail(
  order: Record<string, any>,
  items: Array<Record<string, any>>,
  _settings?: Record<string, string>,
): { subject: string; html: string } {
  const orderRef =
    order.order_number ||
    `#${String(order.id || "")
      .slice(0, 8)
      .toUpperCase()}`;
  const dateStr = new Date(order.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const finalTotal = Number(order.total || 0);
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const shipping = Number(order.shipping || 0);
  const customerName = order.full_name || "Valued Parent";
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

  const paymentMethod = (order.payment_method || "online").toLowerCase().includes("cod")
    ? "Cash on Delivery"
    : "Online Payment (Razorpay)";
  const paymentStatus = (order.payment_status || "paid").toUpperCase();
  const trackingUrl = `https://zerahkids.com/orders`;

  const itemsHtml = items
    .map((item) => {
      const variantInfo = [item.color, item.size].filter(Boolean).join(" · ");
      const imageUrl = item.image_url || item.image || "";
      return `
      <tr>
        <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              ${
                imageUrl
                  ? `<td style="width: 48px; padding-right: 12px; vertical-align: top;">
                      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" width="48" height="48" style="border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0; display: block;" />
                    </td>`
                  : ""
              }
              <td style="vertical-align: top;">
                <div style="font-weight: 700; color: #0f172a; font-size: 14px; line-height: 1.3;">
                  ${escapeHtml(item.name)}
                </div>
                ${
                  variantInfo
                    ? `<div style="font-size: 12px; color: #8B2020; font-weight: 600; margin-top: 3px;">${escapeHtml(variantInfo)}</div>`
                    : ""
                }
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Qty: ${item.qty} × ${formatCurrency(Number(item.price))}</div>
              </td>
            </tr>
          </table>
        </td>
        <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9; text-align: right; vertical-align: middle; font-weight: 700; color: #0f172a; font-size: 14px;">
          ${formatCurrency(Number(item.price) * Number(item.qty))}
        </td>
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Order Confirmed — Zérah Baby &amp; Kids</title>
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
    .track-btn { display: inline-block; background: #8B2020; color: #ffffff !important; font-weight: 800; font-size: 14px; text-decoration: none; padding: 14px 32px; border-radius: 999px; box-shadow: 0 4px 12px rgba(139, 32, 32, 0.25); text-align: center; }
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
      <div class="brand-sub">Pure Comfort for Little Wonders</div>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <span class="success-badge">✓ Order Confirmed</span>
        <h2 style="margin: 4px 0 8px 0; font-size: 24px; font-weight: 900; color: #0f172a;">
          Thank you, ${escapeHtml(customerName)}!
        </h2>
        <p style="color: #64748b; font-size: 14px; margin: 0 auto; max-width: 440px; line-height: 1.5;">
          We have received your order. Our Kota team is handpicking and packing your items with extra baby-safe love and care.
        </p>
      </div>

      <div class="meta-box">
        <div class="meta-row">
          <span class="meta-label">Order Number:</span>
          <span class="meta-value" style="color: #8B2020;">#${escapeHtml(orderRef)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Date Placed:</span>
          <span class="meta-value">${escapeHtml(dateStr)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Payment Method:</span>
          <span class="meta-value">${escapeHtml(paymentMethod)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Payment Status:</span>
          <span class="meta-value" style="color: #16a34a;">${escapeHtml(paymentStatus)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Delivery Address:</span>
          <span class="meta-value" style="max-width: 260px;">${escapeHtml(addressFormatted)}</span>
        </div>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(trackingUrl)}" class="track-btn" target="_blank">
          View &amp; Track Order Status →
        </a>
      </div>

      <h3 style="font-size: 15px; font-weight: 800; margin: 28px 0 12px 0; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">
        Order Details (${items.length} item${items.length > 1 ? "s" : ""})
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
          <span>Coupon Discount:</span>
          <span>- ${formatCurrency(discount)}</span>
        </div>`
            : ""
        }
        <div class="total-row">
          <span>Delivery Charges:</span>
          <span style="font-weight: 700; color: ${shipping === 0 ? "#16a34a" : "#0f172a"};">
            ${shipping === 0 ? "FREE DELIVERY" : formatCurrency(shipping)}
          </span>
        </div>
        <div class="total-row grand-total">
          <span>Total Paid (incl. taxes):</span>
          <span>${formatCurrency(finalTotal)}</span>
        </div>
      </div>

      <div style="margin: 24px 0; padding: 14px; background: #fdf8f8; border: 1px solid #fae8e8; border-radius: 14px; text-align: center; font-size: 12px; color: #7f1d1d; line-height: 1.4; font-weight: 600;">
        🛡️ <strong>Easy 7-Day Returns</strong> &nbsp;|&nbsp; 📦 <strong>Safe Open Box Delivery</strong> &nbsp;|&nbsp; 🌿 <strong>100% Baby Safe</strong>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; text-align: center; font-size: 13px; color: #475569;">
        Need help with this order? Reply directly to this email or chat with us on 
        <a href="https://wa.me/919057074777?text=Hi%2C%20I%20need%20help%20with%20Order%20${escapeHtml(orderRef)}" style="color: #8B2020; font-weight: 700; text-decoration: none;">
          WhatsApp (+91 9057074777)
        </a>.
      </div>
    </div>

    <div class="footer">
      <strong>Zérah Baby &amp; Kids</strong><br>
      80 Feet Link Rd, near Bajot Restaurant, Kota, Rajasthan 324001<br>
      Website: <a href="https://zerahkids.com" style="color: #8B2020; text-decoration: none;">zerahkids.com</a> · Support: hello@zerahkids.com
    </div>
  </div>
</body>
</html>`;

  const subject = `Order Confirmed! #${orderRef} — Zérah Baby & Kids`;
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

function renderOnlineReturnEmail(
  ret: Record<string, any>,
  order: Record<string, any>,
  items: Array<Record<string, any>>,
): { subject: string; html: string } {
  const returnNumber = ret.return_number || "ONLINE-RETURN";
  const orderRef =
    order.invoice_no || (order.id ? `#${order.id.slice(0, 8).toUpperCase()}` : "ORDER");
  const dateStr = new Date(ret.created_at || Date.now()).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const refundAmount = Number(ret.final_refund_amount || 0);
  const eligibleAmount = Number(ret.eligible_refund_amount || 0);
  const returnFee = Number(ret.return_shipping_fee || 0);
  const customerName = order.full_name || "Online Customer";
  const customerPhone = order.phone || "Not provided";
  const returnReason = ret.reason_label || ret.reason_category || "Customer return";
  const customerNote = ret.customer_note || "";

  const itemsHtml = items
    .map((item) => {
      const name = item.product_name_snapshot || "Product";
      const sku = item.sku_snapshot ? `SKU: ${item.sku_snapshot}` : "";
      const variant = [item.color_snapshot, item.size_snapshot].filter(Boolean).join(" / ");
      const meta = [sku, variant].filter(Boolean).join(" | ");
      const qty = Number(item.quantity_requested || 1);
      const price = Number(item.historical_unit_price || 0);
      const lineRefund = Number(item.item_refund_amount || price * qty);

      return `
      <tr>
        <td>
          <div style="font-weight:600; color:#0f172a;">${escapeHtml(name)}</div>
          ${meta ? `<div style="font-size:11px; color:#64748b; margin-top:2px;">${escapeHtml(meta)}</div>` : ""}
        </td>
        <td style="text-align:center; font-weight:600;">${qty}</td>
        <td class="text-right">${formatCurrency(price)}</td>
        <td class="text-right" style="font-weight:600;">${formatCurrency(lineRefund)}</td>
      </tr>`;
    })
    .join("");

  const bodyContent = `
    <div class="meta-box">
      <div class="meta-row">
        <span class="meta-label">Return Request:</span>
        <span class="meta-value" style="color:#b91c1c; font-weight:700;">${escapeHtml(returnNumber)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Original Order:</span>
        <span class="meta-value font-mono">${escapeHtml(orderRef)}</span>
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
        <span class="meta-label">Return Reason:</span>
        <span class="meta-value" style="color:#dc2626;">${escapeHtml(returnReason)}</span>
      </div>
      ${
        customerNote
          ? `
      <div class="meta-row">
        <span class="meta-label">Customer Note:</span>
        <span class="meta-value">${escapeHtml(customerNote)}</span>
      </div>`
          : ""
      }
    </div>

    <h3 style="font-size:15px; font-weight:700; margin:24px 0 10px 0; color:#334155;">Items to Return (${items.length})</h3>
    <table class="items-table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Eligible Refund</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="totals-box" style="background:#fef2f2; border:1px solid #fecaca;">
      <div class="total-row">
        <span>Items Eligible Total:</span>
        <span>${formatCurrency(eligibleAmount)}</span>
      </div>
      ${
        returnFee > 0
          ? `
      <div class="total-row" style="color:#dc2626;">
        <span>Return Logistics Fee:</span>
        <span>- ${formatCurrency(returnFee)}</span>
      </div>`
          : `
      <div class="total-row" style="color:#16a34a;">
        <span>Return Logistics Fee:</span>
        <span>FREE (Waived)</span>
      </div>`
      }
      <div class="total-row grand-total" style="color:#b91c1c;">
        <span>Net Estimated Refund:</span>
        <span>${formatCurrency(refundAmount)}</span>
      </div>
    </div>
  `;

  const subject = `Online Return Requested — ${formatCurrency(refundAmount)} — ${returnNumber}`;
  const html = getBaseLayout(subject, "Online Store Return", "#fee2e2", "#991b1b", bodyContent);

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
    let type = payload.type;
    let order_id = payload.order_id;
    let sale_id = payload.sale_id;
    let return_id = payload.return_id;
    const force_retry = payload.force_retry;
    const customRecipient = payload.recipient;

    // Support Supabase Database Webhook format
    if (payload.table && payload.record && ["INSERT", "UPDATE"].includes(payload.type)) {
      if (payload.table === "offline_sales") {
        type = "offline_sale";
        sale_id = payload.record.id;
      } else if (payload.table === "orders" && payload.record.payment_status === "paid") {
        type = "online_order";
        order_id = payload.record.id;
      } else if (payload.table === "offline_returns") {
        type = "offline_return";
        return_id = payload.record.id;
      } else {
        return new Response(JSON.stringify({ success: true, message: "Ignored webhook event" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    if (
      !type ||
      ![
        "offline_sale",
        "online_order",
        "customer_order_invoice",
        "offline_return",
        "online_return",
        "customer_query",
        "test",
      ].includes(type)
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

    let configuredOwnerEmail =
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
      referenceNumber = order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`;
      totalAmount = Number(order.total);

      const rendered = renderOnlineSaleEmail(order, items || [], costsMap);
      emailSubject = rendered.subject;
      emailHtml = rendered.html;

      // Dispatch Customer Order Confirmation & Tax Invoice Email
      if (order.email && order.email.includes("@")) {
        const customerRendered = renderCustomerOrderConfirmationEmail(order, items || [], settings);

        let customerMsgId: string | null = null;
        let customerDispatchError: string | null = null;

        if (!resendApiKey) {
          console.log(
            `[send-owner-sale-notification] RESEND_API_KEY unconfigured. Simulating customer invoice to: ${order.email}`,
          );
          customerMsgId = `simulated_customer_${Date.now()}`;
        } else {
          try {
            let custRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${resendApiKey}`,
              },
              body: JSON.stringify({
                from: fromEmail,
                to: [order.email.trim()],
                reply_to: "hello@zerahkids.com",
                subject: customerRendered.subject,
                html: customerRendered.html,
              }),
            });

            let custData = await custRes.json();

            // Automatic fallback to onboarding@resend.dev if custom domain is not yet verified on Resend
            if (
              !custRes.ok &&
              (custData.message?.includes("domain") || custData.message?.includes("not verified"))
            ) {
              console.warn(
                "[send-owner-sale-notification] Custom domain not verified on Resend. Retrying customer email with onboarding@resend.dev fallback...",
              );
              custRes = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${resendApiKey}`,
                },
                body: JSON.stringify({
                  from: "Zérah Baby & Kids <onboarding@resend.dev>",
                  to: [order.email.trim()],
                  reply_to: "hello@zerahkids.com",
                  subject: customerRendered.subject,
                  html: customerRendered.html,
                }),
              });
              custData = await custRes.json();
            }

            if (custRes.ok) {
              customerMsgId = custData.id;
              console.log(
                `[send-owner-sale-notification] Customer invoice email delivered: ${customerMsgId} to ${order.email}`,
              );
            } else {
              customerDispatchError = custData.message || JSON.stringify(custData);
              console.error(
                `[send-owner-sale-notification] Customer invoice email error:`,
                customerDispatchError,
              );
            }
          } catch (custFetchErr: unknown) {
            customerDispatchError =
              (custFetchErr as Error).message || "Network error sending customer email";
            console.error(
              `[send-owner-sale-notification] Customer invoice fetch error:`,
              customerDispatchError,
            );
          }
        }

        // Update database with customer notification status
        await adminClient
          .from("orders")
          .update({
            customer_notification_status: customerDispatchError === null ? "sent" : "failed",
            customer_notified_at: customerDispatchError === null ? new Date().toISOString() : null,
          })
          .eq("id", order.id);
      }
    } else if (type === "customer_order_invoice") {
      if (!order_id) throw new Error("Missing order_id for customer invoice dispatch");

      const { data: order, error: orderErr } = await adminClient
        .from("orders")
        .select("*")
        .eq("id", order_id)
        .single();
      if (orderErr || !order) throw new Error(`Order not found: ${orderErr?.message || "unknown"}`);
      if (!order.email || !order.email.includes("@")) {
        throw new Error("Customer email address missing or invalid on this order");
      }

      const { data: items, error: itemsErr } = await adminClient
        .from("order_items")
        .select("*")
        .eq("order_id", order_id);
      if (itemsErr) throw itemsErr;

      const customerRendered = renderCustomerOrderConfirmationEmail(order, items || [], settings);
      emailSubject = customerRendered.subject;
      emailHtml = customerRendered.html;
      referenceId = order.id;
      referenceNumber = order.order_number || `#${order.id.slice(0, 8).toUpperCase()}`;
      totalAmount = Number(order.total);

      // Recipient is the customer directly
      configuredOwnerEmail = order.email.trim();
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
    } else if (type === "online_return") {
      if (!return_id) throw new Error("Missing return_id for online return notification");

      // Fetch online return joined with order
      const { data: retRecord, error: retErr } = await adminClient
        .from("online_returns")
        .select("*, orders(*)")
        .eq("id", return_id)
        .single();
      if (retErr || !retRecord)
        throw new Error(`Online return not found: ${retErr?.message || "unknown"}`);

      // Fetch return items
      const { data: items, error: itemsErr } = await adminClient
        .from("online_return_items")
        .select("*")
        .eq("return_id", return_id);
      if (itemsErr) throw itemsErr;

      referenceId = retRecord.id;
      referenceNumber = retRecord.return_number;
      totalAmount = Number(retRecord.final_refund_amount);

      const rendered = renderOnlineReturnEmail(retRecord, retRecord.orders || {}, items || []);
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
      console.warn(
        "[send-owner-sale-notification] RESEND_API_KEY is not configured. Simulating successful send.",
      );
      resendMessageId = `simulated_${Date.now()}`;
      dispatchError = null;
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

        let resendData = await resendRes.json();
        if (
          !resendRes.ok &&
          (resendData.message?.includes("domain") || resendData.message?.includes("not verified"))
        ) {
          console.warn(
            "[send-owner-sale-notification] Custom domain not verified on Resend. Retrying with onboarding@resend.dev fallback...",
          );
          const retryRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: "Zérah Baby & Kids <onboarding@resend.dev>",
              to: [configuredOwnerEmail],
              reply_to: "hello@zerahkids.com",
              subject: emailSubject,
              html: emailHtml,
            }),
          });
          resendData = await retryRes.json();
          if (retryRes.ok) {
            resendMessageId = resendData.id;
            dispatchError = null;
          } else {
            dispatchError = resendData.message || JSON.stringify(resendData);
            console.error("[send-owner-sale-notification] Resend fallback error:", dispatchError);
          }
        } else if (!resendRes.ok) {
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
    } else if (type === "customer_order_invoice" && order_id) {
      await adminClient
        .from("orders")
        .update({
          customer_notification_status: isSuccess ? "sent" : "failed",
          customer_notified_at: isSuccess ? new Date().toISOString() : null,
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

    if (referenceId && referenceId !== "test") {
      // Upsert into admin_notification_logs
      await adminClient
        .from("admin_notification_logs")
        .upsert(
          {
            event_type: type,
            reference_id: referenceId,
            status: isSuccess ? "sent" : "failed",
            provider_id: resendMessageId,
            error_message: dispatchError,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "event_type,reference_id" },
        )
        .select();
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
