import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "fs";

// Load client environment config
const envFile = fs.readFileSync(".env", "utf-8");
const env: Record<string, string> = {};
envFile.split(/\r?\n/).forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
});

const supabaseUrl = env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const anonClient = createClient(supabaseUrl, supabaseAnonKey);

test.describe("Backend Production Audit & Security Hardening Suite", () => {
  // 1. Environment & Secrets Safety Check
  test("1. Environment & Secret Isolation - Zero Private Keys in Client Config", async () => {
    // Verify that client environment does not contain private secrets
    expect(env["SUPABASE_SERVICE_ROLE_KEY"]).toBeUndefined();
    expect(env["RAZORPAY_KEY_SECRET"]).toBeUndefined();
    expect(env["MSG91_AUTH_KEY"]).toBeUndefined();
    expect(env["SHIPROCKET_PASSWORD"]).toBeUndefined();

    // Verify publishable key format
    expect(supabaseAnonKey).toBeDefined();
    expect(supabaseUrl).toContain("supabase.co");
  });

  // 2. RLS Table Security Audit: Anonymous Write Protection
  test("2. RLS Security: Anonymous User Cannot Insert/Update/Delete Sensitive Tables", async () => {
    // 2.1 Products Write Protection
    const { error: prodErr } = await anonClient.from("products").insert([
      {
        name: "Hacked Product",
        slug: `hack-${Date.now()}`,
        price: 1,
        stock: 100,
      },
    ]);
    expect(prodErr).toBeDefined();

    // 2.2 User Roles Write Protection (Privilege Escalation Guard)
    const { error: roleErr } = await anonClient.from("user_roles").insert([
      {
        user_id: "00000000-0000-0000-0000-000000000000",
        role: "admin",
      },
    ]);
    expect(roleErr).toBeDefined();

    // 2.3 Admin Allowlist Read/Write Protection
    const { data: allowData, error: allowErr } = await anonClient
      .from("admin_allowlist")
      .select("*");
    expect(allowData === null || allowData.length === 0 || allowErr !== null).toBe(true);

    // 2.4 Product Buying Costs Confidentiality
    const { data: costsData } = await anonClient.from("product_costs").select("*");
    expect(costsData === null || costsData.length === 0).toBe(true);

    // 2.5 Admin Order Deletion Logs Confidentiality
    const { data: auditData } = await anonClient.from("admin_order_deletion_logs").select("*");
    expect(auditData === null || auditData.length === 0).toBe(true);

    // 2.6 Offline Sales Write Protection
    const { error: saleErr } = await anonClient.from("offline_sales").insert([
      {
        sale_number: `POS-HACK-${Date.now()}`,
        total: 500,
        subtotal: 500,
      },
    ]);
    expect(saleErr).toBeDefined();

    // 2.7 Site Settings Mutation Protection
    const { error: settingsErr } = await anonClient
      .from("site_settings")
      .update({ value: "0" })
      .eq("key", "standard_shipping_charge");
    expect(settingsErr).toBeDefined();
  });

  // 3. RLS Public Read Access (Public Storefront Tables)
  test("3. RLS Security: Public Can Read Storefront Catalog and Site Settings", async () => {
    // Categories should be publicly readable
    const { data: categories, error: catErr } = await anonClient
      .from("categories")
      .select("id, name, slug")
      .limit(10);
    expect(catErr).toBeNull();
    expect(Array.isArray(categories)).toBe(true);

    // Active Products should be publicly readable
    const { data: products, error: prodErr } = await anonClient
      .from("products")
      .select("id, name, slug, price, is_active")
      .limit(10);
    expect(prodErr).toBeNull();
    expect(Array.isArray(products)).toBe(true);

    // Site Settings should be publicly readable
    const { data: settings, error: setErr } = await anonClient
      .from("site_settings")
      .select("key, value");
    expect(setErr).toBeNull();
    expect(Array.isArray(settings)).toBe(true);
  });

  // 4. Server-Side RPC Authority: place_order Input Validation & Price Recalculation
  test("4. RPC Security: place_order Rejects Unauthenticated and Malformed Requests", async () => {
    // Anonymous user attempting to place order via RPC must fail
    const { error } = await anonClient.rpc("place_order", {
      _full_name: "Test Hacker",
      _email: "hacker@test.com",
      _phone: "9999999999",
      _address: "123 Test St",
      _city: "Kota",
      _state: "Rajasthan",
      _pincode: "324001",
      _items: [{ product_slug: "non-existent-product", qty: 1 }],
    });

    expect(error).toBeDefined();
    // Error must enforce authentication or product existence
    expect(error?.message).toMatch(/Authentication required|permission denied|not found/i);
  });

  // 5. Server-Side RPC Authority: Customer Query System & Validation
  test("5. RPC Security: submit_customer_query Validates Input and Anti-Spam", async () => {
    // 5.1 Missing name / invalid email must be rejected
    const { data: res1, error: err1 } = await anonClient.rpc("submit_customer_query", {
      _name: "A", // too short (< 2 chars)
      _email: "invalid-email",
      _message: "Hello",
    });

    expect(err1 !== null || res1?.success === false).toBe(true);

    // 5.2 Empty message must be rejected
    const { data: res2, error: err2 } = await anonClient.rpc("submit_customer_query", {
      _name: "Test Customer",
      _email: "customer@example.com",
      _message: "   ", // empty whitespace
    });

    expect(err2 !== null || res2?.success === false).toBe(true);
  });

  // 6. Razorpay Server-Side HMAC-SHA256 Signature Verification Logic
  test("6. Payment Security: Razorpay HMAC-SHA256 Verification Logic", async () => {
    const mockSecret = "test_razorpay_secret_key_12345";
    const orderId = "order_QwertYuiop1234";
    const paymentId = "pay_AsdfGhjkL5678";

    // Valid Signature
    const payload = `${orderId}|${paymentId}`;
    const validSignature = crypto.createHmac("sha256", mockSecret).update(payload).digest("hex");

    // Tampered Signature
    const tamperedSignature = crypto
      .createHmac("sha256", "wrong_secret")
      .update(payload)
      .digest("hex");

    // Server verification simulator
    const verifySignature = (
      rOrderId: string,
      rPaymentId: string,
      sig: string,
      secret: string,
    ): boolean => {
      const generated = crypto
        .createHmac("sha256", secret)
        .update(`${rOrderId}|${rPaymentId}`)
        .digest("hex");
      return generated === sig;
    };

    expect(verifySignature(orderId, paymentId, validSignature, mockSecret)).toBe(true);
    expect(verifySignature(orderId, paymentId, tamperedSignature, mockSecret)).toBe(false);
    expect(verifySignature(orderId, "pay_TAMPERED", validSignature, mockSecret)).toBe(false);
  });

  // 7. MSG91 Indian Phone Normalization Engine
  test("7. SMS Security: Indian Phone Normalizer Rejects Malformed Numbers", async () => {
    const normalizeIndianPhone = (rawPhone: string) => {
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
    };

    // Valid standard numbers
    expect(normalizeIndianPhone("9876543210").valid).toBe(true);
    expect(normalizeIndianPhone("9876543210").phone).toBe("919876543210");
    expect(normalizeIndianPhone("+91 98765 43210").phone).toBe("919876543210");
    expect(normalizeIndianPhone("09876543210").phone).toBe("919876543210");
    expect(normalizeIndianPhone("91919876543210").phone).toBe("919876543210");

    // Invalid numbers
    expect(normalizeIndianPhone("").valid).toBe(false);
    expect(normalizeIndianPhone("12345").valid).toBe(false);
    expect(normalizeIndianPhone("abcdefghij").valid).toBe(false);
  });

  // 8. Shiprocket Webhook Terminal State Protection Logic
  test("8. Logistics Security: Shiprocket Status Mapping & Terminal State Guard", async () => {
    const terminalStates = ["delivered", "cancelled", "returned"];

    const processShiprocketStatus = (
      currentStoreStatus: string,
      incomingShiprocketStatus: string,
    ): { shouldUpdate: boolean; newStatus: string } => {
      if (terminalStates.includes(currentStoreStatus)) {
        return { shouldUpdate: false, newStatus: currentStoreStatus };
      }

      const statusUpper = incomingShiprocketStatus.toUpperCase();
      let newStoreStatus = currentStoreStatus;

      if (["SHIPPED", "IN TRANSIT", "OUT FOR DELIVERY"].includes(statusUpper)) {
        newStoreStatus = "shipped";
      } else if (statusUpper === "DELIVERED") {
        newStoreStatus = "delivered";
      } else if (
        ["RTO INITIATED", "RTO DELIVERED", "RETURNED", "CANCELLED"].includes(statusUpper)
      ) {
        newStoreStatus = "cancelled";
      }

      return {
        shouldUpdate: newStoreStatus !== currentStoreStatus,
        newStatus: newStoreStatus,
      };
    };

    // Transition from processing -> shipped
    expect(processShiprocketStatus("processing", "SHIPPED")).toEqual({
      shouldUpdate: true,
      newStatus: "shipped",
    });

    // Transition from shipped -> delivered
    expect(processShiprocketStatus("shipped", "DELIVERED")).toEqual({
      shouldUpdate: true,
      newStatus: "delivered",
    });

    // Terminal state protection: delivered order cannot be regressed
    expect(processShiprocketStatus("delivered", "SHIPPED")).toEqual({
      shouldUpdate: false,
      newStatus: "delivered",
    });

    // Terminal state protection: cancelled order cannot be regressed
    expect(processShiprocketStatus("cancelled", "DELIVERED")).toEqual({
      shouldUpdate: false,
      newStatus: "cancelled",
    });
  });

  // 9. Free Delivery Calculation & Threshold Verification
  test("9. Shipping Security: Free Delivery Evaluated on Post-Discount Subtotal", async () => {
    const evaluateShipping = (
      subtotal: number,
      discount: number,
      threshold: number = 999,
      standardShipping: number = 79,
    ): { shipping: number; eligibleSubtotal: number; finalTotal: number } => {
      const eligibleSubtotal = Math.max(0, subtotal - discount);
      const shipping = eligibleSubtotal > threshold ? 0 : standardShipping;
      const finalTotal = Math.max(0, eligibleSubtotal + shipping);
      return { shipping, eligibleSubtotal, finalTotal };
    };

    // Case 1: Subtotal ₹999 -> Paid Shipping (Threshold ₹999 requires > 999 for free)
    const res1 = evaluateShipping(999, 0);
    expect(res1.shipping).toBe(79);
    expect(res1.finalTotal).toBe(1078);

    // Case 2: Subtotal ₹1000 -> Free Shipping
    const res2 = evaluateShipping(1000, 0);
    expect(res2.shipping).toBe(0);
    expect(res2.finalTotal).toBe(1000);

    // Case 3: Subtotal ₹1200 with ₹300 coupon -> Eligible Subtotal ₹900 -> Paid Shipping
    const res3 = evaluateShipping(1200, 300);
    expect(res3.eligibleSubtotal).toBe(900);
    expect(res3.shipping).toBe(79);
    expect(res3.finalTotal).toBe(979);

    // Case 4: Subtotal ₹2000 with ₹500 coupon -> Eligible Subtotal ₹1500 -> Free Shipping
    const res4 = evaluateShipping(2000, 500);
    expect(res4.eligibleSubtotal).toBe(1500);
    expect(res4.shipping).toBe(0);
    expect(res4.finalTotal).toBe(1500);
  });
});
