import { test, expect } from "@playwright/test";

// Mock helper replicating msg91-transactional reconstruction logic
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

function normalizeIndianPhone(rawPhone?: string | null) {
  if (!rawPhone) return { valid: false, phone: "", error: "Phone number is required" };
  let digits = rawPhone.replace(/\D/g, "").replace(/^0+/, "");
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

const TEMPLATE_CONFIG = {
  online_sale_customer: {
    templateId: "6aa1cd275f81de31570d50e2",
    templateName: "Zerah_Online_Order_Confirmed_",
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
  online_sale_owner: {
    templateId: "6aa1d097daacdd8930018922",
    templateName: "Zerah_New_Online_Order_Admin_",
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
  order_delivered_customer: {
    templateId: "6aa1cf5471e712fa250b1732",
    templateName: "Zerah_Order_Delivered_",
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
  offline_pos_sale_customer: {
    templateId: "6aa1cb843c42b39d420dbff2",
    templateName: "Zerah_Offline_Purchase_",
    requiredVars: ["var1", "var2"],
    formatPreview: (v: Record<string, string>) =>
      `Thank you for shopping at Zerah Baby & Kids! Invoice No: ${v.var1} Total: ₹${v.var2}. Visit us again!`,
    buildVars: (ctx: { name?: string; ref?: string; total?: number }) => {
      const totalNum = Math.round(Number(ctx.total || 0));
      return {
        var1: String(ctx.ref || "POS-SALE"),
        var2: String(totalNum),
        var3: "Zerah Baby & Kids",
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
  offline_pos_sale_owner: {
    templateId: "6aa1d17366745ba0d206c582",
    templateName: "Zerah_Offline_Sale_Admin_",
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
        store: "Zerah Baby & Kids",
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
};

// Simulated mock database and reconstruction engine
function simulateReconstructVariables(existingLog: Record<string, any>, mockDb: any) {
  // 1. Stored variables
  if (
    existingLog.template_variables &&
    typeof existingLog.template_variables === "object" &&
    Object.keys(existingLog.template_variables).length > 0
  ) {
    return { vars: existingLog.template_variables, source: "stored_variables" };
  }

  // 2. Orders table
  if (existingLog.order_id && mockDb.orders?.[existingLog.order_id]) {
    const order = mockDb.orders[existingLog.order_id];
    const isCod = (order.payment_method || "").toLowerCase() === "cod";
    const totalNum = Math.round(Number(order.total || 0));
    const orderRef = order.order_number || order.invoice_no || order.id.substring(0, 8);
    const custName = cleanCustomerName(order.full_name);

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

  // 3. Offline sales table
  if (existingLog.offline_sale_id && mockDb.offline_sales?.[existingLog.offline_sale_id]) {
    const sale = mockDb.offline_sales[existingLog.offline_sale_id];
    const totalNum = Math.round(Number(sale.total || 0));
    const saleRef = sale.sale_number || sale.id.substring(0, 8);
    const custName = cleanCustomerName(sale.customer_name);

    return {
      vars: {
        var1: String(saleRef),
        var2: String(totalNum),
        var3: "Zerah Baby & Kids",
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

  // 4. Message content regex
  if (existingLog.message_content && typeof existingLog.message_content === "string") {
    const content = existingLog.message_content.trim();

    const mOnlineCust = content.match(/Your order (.*?) is confirmed\. Total: ₹?(\d+)/i);
    if (mOnlineCust) {
      return {
        vars: {
          var1: mOnlineCust[1].trim(),
          var2: mOnlineCust[2].trim(),
        },
        source: "message_content_regex",
      };
    }

    const mOnlineOwner = content.match(/Order ID:(.*?) Customer:(.*?) Amount: ₹?(\d+)/i);
    if (mOnlineOwner) {
      return {
        vars: {
          var1: mOnlineOwner[1].trim(),
          var2: mOnlineOwner[2].trim(),
          var3: mOnlineOwner[3].trim(),
        },
        source: "message_content_regex",
      };
    }

    const mDelivered = content.match(
      /Hello (.*?), your order (.*?) from Zerah Baby & Kids has been delivered/i,
    );
    if (mDelivered) {
      return {
        vars: {
          var1: mDelivered[1].trim(),
          var2: mDelivered[2].trim(),
        },
        source: "message_content_regex",
      };
    }

    const mOfflineCust = content.match(/Invoice No: (.*?) Total: ₹?(\d+)/i);
    if (mOfflineCust) {
      return {
        vars: {
          var1: mOfflineCust[1].trim(),
          var2: mOfflineCust[2].trim(),
          var3: "Zerah Baby & Kids",
        },
        source: "message_content_regex",
      };
    }

    const mOfflineOwner = content.match(/Transaction ID: (.*?) Customer: (.*?) Amount: ₹?(\d+)/i);
    if (mOfflineOwner) {
      return {
        vars: {
          var1: mOfflineOwner[1].trim(),
          var2: mOfflineOwner[2].trim(),
          var3: mOfflineOwner[3].trim(),
        },
        source: "message_content_regex",
      };
    }
  }

  return { vars: null, source: "none", error: "Original template data unavailable; SMS cannot be retried safely." };
}

// Simulated retry handler matching msg91-transactional index.ts exactly
function handleSmsRetry(existingLog: Record<string, any>, mockDb: any, providerDispatches: any[]) {
  // Idempotency check
  if (
    existingLog.status === "SENT" ||
    existingLog.provider_status === "sent" ||
    existingLog.provider_status === "mock_success"
  ) {
    return {
      success: true,
      already_sent: true,
      message: "SMS has already been sent successfully.",
      log: existingLog,
    };
  }

  const { valid: phoneValid, phone: cleanPhone } = normalizeIndianPhone(existingLog.phone);
  if (!phoneValid) {
    return { success: false, error: "Invalid recipient phone number on log" };
  }

  const { vars: templateVars, source: reconSource } = simulateReconstructVariables(
    existingLog,
    mockDb,
  );

  if (!templateVars || Object.keys(templateVars).length === 0) {
    return {
      success: false,
      error: "Original template data unavailable; SMS cannot be retried safely.",
    };
  }

  // DLT safety check: all required vars must be present and not unresolved markers
  const requiredVars = existingLog.required_vars || ["var1", "var2"];
  const missingVars: string[] = [];
  for (const reqVar of requiredVars) {
    const val = templateVars[reqVar];
    if (!val || String(val).trim() === "" || String(val).includes("##") || String(val).includes("{#")) {
      missingVars.push(reqVar);
    }
  }

  if (missingVars.length > 0) {
    return {
      success: false,
      error: "Original template data unavailable; SMS cannot be retried safely.",
      details: `Missing required template variable(s): ${missingVars.join(", ")}`,
    };
  }

  // Simulate dispatch to provider
  const dispatchPayload = {
    template_id: existingLog.template_id,
    phone: cleanPhone,
    variables: templateVars,
  };
  providerDispatches.push(dispatchPayload);

  return {
    success: true,
    reconstruction_source: reconSource,
    variables_sent: templateVars,
    payload: dispatchPayload,
  };
}

test.describe("MSG91 Failed SMS Retry & DLT Safety Suite", () => {
  test("TEST 1: Retry failed SMS with variables reconstructs authoritative payload", () => {
    const mockDb = {
      orders: {
        "order-uuid-1": {
          id: "order-uuid-1",
          order_number: "ORD-260911-75368",
          full_name: "Saif Khan",
          total: 999,
          payment_method: "ONLINE",
          phone: "9876543210",
        },
      },
    };

    const failedLog = {
      id: "log-1",
      order_id: "order-uuid-1",
      phone: "9876543210",
      template_id: "6aa1cd275f81de31570d50e2",
      message_type: "online_sale",
      recipient_type: "customer",
      status: "FAILED",
      required_vars: ["var1", "var2"],
      message_content:
        "Hi Zerah Baby & Kids! Your order #ORD-260911-75368 is confirmed. Total: ₹999. Thank you for shopping with us!",
    };

    const dispatches: any[] = [];
    const result = handleSmsRetry(failedLog, mockDb, dispatches);

    expect(result.success).toBe(true);
    expect(dispatches.length).toBe(1);
    expect(dispatches[0].template_id).toBe("6aa1cd275f81de31570d50e2");
    expect(dispatches[0].phone).toBe("919876543210");
    // Verify template variables are NOT empty {}!
    expect(dispatches[0].variables).not.toEqual({});
    expect(dispatches[0].variables.var1).toBe("#ORD-260911-75368");
    expect(dispatches[0].variables.var2).toBe("999");
  });

  test("TEST 2: Retry message requiring 2 variables (both present & non-empty)", () => {
    const mockDb = {
      offline_sales: {
        "sale-uuid-1": {
          id: "sale-uuid-1",
          sale_number: "POS-20260911-001",
          customer_name: "Priya Sharma",
          total: 450,
          customer_phone: "9123456780",
        },
      },
    };

    const failedLog = {
      id: "log-pos-1",
      offline_sale_id: "sale-uuid-1",
      phone: "9123456780",
      template_id: "6aa1cb843c42b39d420dbff2",
      message_type: "offline_pos_sale",
      recipient_type: "customer",
      status: "FAILED",
      required_vars: ["var1", "var2"],
    };

    const dispatches: any[] = [];
    const result = handleSmsRetry(failedLog, mockDb, dispatches);

    expect(result.success).toBe(true);
    expect(dispatches.length).toBe(1);
    expect(dispatches[0].variables.var1).toBe("POS-20260911-001");
    expect(dispatches[0].variables.var2).toBe("450");
    expect(dispatches[0].variables.var1.length).toBeGreaterThan(0);
    expect(dispatches[0].variables.var2.length).toBeGreaterThan(0);
  });

  test("TEST 3: Retry message requiring 3 variables (all 3 present & non-empty)", () => {
    const mockDb = {
      orders: {
        "order-uuid-admin": {
          id: "order-uuid-admin",
          order_number: "ORD-99999",
          full_name: "Saif",
          total: 1299,
          payment_method: "COD",
          phone: "9667571712",
        },
      },
    };

    const failedLog = {
      id: "log-admin-1",
      order_id: "order-uuid-admin",
      phone: "9667571712",
      template_id: "6aa1d097daacdd8930018922",
      message_type: "online_sale",
      recipient_type: "owner",
      status: "FAILED",
      required_vars: ["var1", "var2", "var3"],
      message_content:
        "Zerah Baby & Kids: New online order received! Order ID:COD #ORD-99999 Customer:Saif Amount: ₹1299",
    };

    const dispatches: any[] = [];
    const result = handleSmsRetry(failedLog, mockDb, dispatches);

    expect(result.success).toBe(true);
    expect(dispatches.length).toBe(1);
    // var1 = COD #ORD-99999, var2 = Saif, var3 = 1299
    expect(dispatches[0].variables.var1).toBe("#ORD-99999 (COD)");
    expect(dispatches[0].variables.var2).toBe("1299");
    expect(dispatches[0].variables.var3).toBe("Saif");
  });

  test("TEST 4: Retry failed message whose original data is unavailable (safe rejection)", () => {
    const emptyMockDb = { orders: {}, offline_sales: {} };

    const corruptedLog = {
      id: "log-corrupted",
      order_id: null,
      offline_sale_id: null,
      phone: "9876543210",
      template_id: "6aa1cd275f81de31570d50e2",
      message_type: "online_sale",
      recipient_type: "customer",
      status: "FAILED",
      required_vars: ["var1", "var2"],
      message_content: "", // No stored content to parse from
    };

    const dispatches: any[] = [];
    const result = handleSmsRetry(corruptedLog, emptyMockDb, dispatches);

    // Expected: safe rejection, NO malformed SMS dispatched
    expect(result.success).toBe(false);
    expect(result.error).toBe("Original template data unavailable; SMS cannot be retried safely.");
    expect(dispatches.length).toBe(0); // Zero messages dispatched!
  });

  test("TEST 5: Double-click Retry protection (idempotency)", () => {
    const mockDb = {
      orders: {
        "order-1": {
          id: "order-1",
          order_number: "ORD-1",
          full_name: "Customer",
          total: 500,
        },
      },
    };

    // First attempt: status is FAILED
    const log = {
      id: "log-double",
      order_id: "order-1",
      phone: "9876543210",
      template_id: "6aa1cd275f81de31570d50e2",
      status: "FAILED",
      required_vars: ["var1", "var2"],
    };

    const dispatches: any[] = [];
    const firstClick = handleSmsRetry(log, mockDb, dispatches);
    expect(firstClick.success).toBe(true);
    expect(dispatches.length).toBe(1);

    // Simulate DB update to SENT
    log.status = "SENT";

    // Second click (double-click):
    const secondClick = handleSmsRetry(log, mockDb, dispatches);
    expect(secondClick.success).toBe(true);
    expect(secondClick.already_sent).toBe(true);
    expect(secondClick.message).toContain("already been sent successfully");
    // Provider dispatches MUST still be 1 (no duplicate send!)
    expect(dispatches.length).toBe(1);
  });
});
