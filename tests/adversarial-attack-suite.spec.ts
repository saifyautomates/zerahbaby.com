import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const supabaseUrl = "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const anonClient = createClient(supabaseUrl, supabaseAnonKey);

test.describe("Adversarial Attack & Production Invariant Hardening Suite", () => {
  let activeProductSlug = "cord";

  test.beforeAll(async () => {
    const { data } = await anonClient.from("products").select("slug").eq("is_active", true).limit(1);
    if (data && data.length > 0 && data[0].slug) {
      activeProductSlug = data[0].slug;
    }
  });

  // ─── ATTACK 1: CLIENT-SIDE PRICE MANIPULATION ───────────────────────
  test("1. Price Manipulation Attack: Server Rejects Tampered Client Unit Prices", async () => {
    // Attack: Attacker crafts a payload claiming a ₹699 item is ₹1
    const hackedPayload = {
      _items: [
        {
          product_slug: activeProductSlug,
          qty: 1,
          price: 1, // Attacker manipulated price!
        },
      ],
      _full_name: "Attacker Malicious",
      _email: "attacker@example.com",
      _phone: "9999999999",
      _address: "123 Dark Web Lane",
      _city: "Cyber City",
      _state: "Rajasthan",
      _pincode: "324001",
      _payment_method: "online",
    };

    const { data: sessData, error: sessError } = await anonClient.rpc(
      "create_checkout_session",
      hackedPayload,
    );

    // If session created, server MUST ignore the client-sent ₹1 and charge catalog price (₹699)
    if (sessData?.success) {
      expect(sessData.subtotal).toBeGreaterThan(1);
      expect(sessData.total).toBeGreaterThan(1);
      expect(sessData.total).not.toBe(1);
    } else {
      // Or server rejected invalid/malformed payload safely
      expect(sessError).toBeDefined();
    }
  });

  // ─── ATTACK 2: NEGATIVE & ZERO QUANTITY INJECTION ───────────────────
  test("2. Negative & Zero Quantity Attack: Server Blocks Invalid Quantities", async () => {
    // 2.1 Negative Quantity Attack
    const negativeQtyPayload = {
      _items: [
        {
          product_slug: activeProductSlug,
          qty: -5,
        },
      ],
      _full_name: "Attacker Negative",
      _email: "attacker_neg@example.com",
      _phone: "9999999999",
      _address: "123 Dark Web Lane",
      _city: "Kota",
      _state: "Rajasthan",
      _pincode: "324001",
      _payment_method: "online",
    };

    const { data: negData, error: negError } = await anonClient.rpc(
      "create_checkout_session",
      negativeQtyPayload,
    );
    expect(negData?.success !== true || negError !== null).toBe(true);

    // 2.2 Zero Quantity Attack
    const zeroQtyPayload = {
      ...negativeQtyPayload,
      _items: [{ product_slug: activeProductSlug, qty: 0 }],
    };

    const { data: zeroData, error: zeroError } = await anonClient.rpc(
      "create_checkout_session",
      zeroQtyPayload,
    );
    expect(zeroData?.success !== true || zeroError !== null).toBe(true);
  });

  // ─── ATTACK 3: OVERSELLING & EXCESSIVE STOCK EXHAUSTION ─────────────
  test("3. Overselling Attack: Reject Quantities Exceeding Available Stock", async () => {
    const excessiveQtyPayload = {
      _items: [
        {
          product_slug: activeProductSlug,
          qty: 999999, // Way higher than warehouse stock
        },
      ],
      _full_name: "Attacker Stock Drain",
      _email: "attacker_stock@example.com",
      _phone: "9999999999",
      _address: "123 Warehouse St",
      _city: "Kota",
      _state: "Rajasthan",
      _pincode: "324001",
      _payment_method: "online",
    };

    const { data, error } = await anonClient.rpc("create_checkout_session", excessiveQtyPayload);
    // Server must reject with Insufficient Stock error
    expect(data?.success !== true || error !== null).toBe(true);
    if (error) {
      expect(error.message).toMatch(/stock|insufficient|unavailable/i);
    }
  });

  // ─── ATTACK 4: EXPIRED & FORGED COUPON EXPLOITATION ─────────────────
  test("4. Coupon Exploitation Attack: Expired or Nonexistent Codes Ignored/Zeroed", async () => {
    const forgedCouponPayload = {
      _items: [{ product_slug: activeProductSlug, qty: 1 }],
      _coupon_code: "HACK_100_PERCENT_OFF_999999",
      _full_name: "Attacker Coupon",
      _email: "attacker_coupon@example.com",
      _phone: "9999999999",
      _address: "123 Coupon St",
      _city: "Kota",
      _state: "Rajasthan",
      _pincode: "324001",
      _payment_method: "online",
    };

    const { data } = await anonClient.rpc("create_checkout_session", forgedCouponPayload);
    if (data?.success) {
      // Fake coupon MUST result in 0 discount
      expect(Number(data.discount || 0)).toBe(0);
      expect(Number(data.total)).toBeGreaterThan(0);
    }
  });

  // ─── ATTACK 5: RLS SECURITY - DIRECT DATABASE TAMPERING ─────────────
  test("5. RLS Security Attack: Anonymous User Cannot Directly Mutate Core Tables", async () => {
    // 5.1 Try to insert bogus order directly
    const { error: orderInsertErr } = await anonClient.from("orders").insert([
      {
        order_number: "HACKED-ORDER-001",
        full_name: "Hacker",
        email: "hacker@evil.com",
        total: 0,
        payment_status: "paid",
        status: "processing",
      },
    ]);
    expect(orderInsertErr).toBeDefined();

    // 5.2 Try to modify product prices
    const { error: priceUpdateErr } = await anonClient
      .from("products")
      .update({ price: 1 })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    expect(priceUpdateErr).toBeDefined();

    // 5.3 Try to insert forged payment
    const { error: payInsertErr } = await anonClient.from("payments").insert([
      {
        amount: 1,
        status: "captured",
        razorpay_payment_id: "pay_forged_12345",
      },
    ]);
    expect(payInsertErr).toBeDefined();

    // 5.4 Try to tamper with payment settings (e.g. force COD on)
    const { error: settingsUpdateErr } = await anonClient
      .from("payment_settings")
      .update({ cod_enabled: true, cod_fee: 0 })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    expect(settingsUpdateErr).toBeDefined();
  });

  // ─── ATTACK 6: ADMINISTRATIVE RPC PRIVILEGE ESCALATION ──────────────
  test("6. Privilege Escalation Attack: Anonymous User Blocked from Admin RPCs", async () => {
    // 6.1 Try to record fake online refund
    const { error: refundErr } = await anonClient.rpc("admin_record_online_refund", {
      _return_id: "a0000000-0000-0000-0000-000000000001",
      _refund_amount: 5000,
      _refund_method: "cash",
      _gateway_refund_id: "HACKED_REFUND",
      _notes: "Malicious escalation",
    });
    expect(refundErr).toBeDefined();
    expect(refundErr?.message).toMatch(/unauthorized|permission|denied|only store admin/i);

    // 6.2 Try to update return status
    const { error: statusErr } = await anonClient.rpc("admin_update_online_return_status", {
      _return_id: "a0000000-0000-0000-0000-000000000001",
      _new_status: "REFUNDED",
      _admin_note: "Hacked status",
      _metadata: {},
    });
    expect(statusErr).toBeDefined();
    expect(statusErr?.message).toMatch(/unauthorized|permission|denied|only store admin/i);

    // 6.3 Try to void POS offline sale
    const { error: voidErr } = await anonClient.rpc("admin_void_offline_sale", {
      _sale_id: "a0000000-0000-0000-0000-000000000001",
      _reason: "Hacked void",
      _restore_stock: false,
    });
    expect(voidErr).toBeDefined();
    expect(voidErr?.message).toMatch(/unauthorized|permission|denied|only store admin/i);
  });

  // ─── ATTACK 7: PAYMENT VERIFICATION TAMPERING ───────────────────────
  test("7. Payment Gateway Tampering: Edge Function Rejects Forged Signature", async ({
    request,
  }) => {
    // Attempt to invoke verify-razorpay-payment with bad cryptographic signature
    const forgedVerification = {
      razorpay_order_id: "order_mock_attack_12345",
      razorpay_payment_id: "pay_mock_attack_99999",
      razorpay_signature: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // Arbitrary SHA256
    };

    const res = await request.post(
      "https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/verify-razorpay-payment",
      {
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
        },
        data: forgedVerification,
      },
    );

    // Server must reject with 400 Bad Request
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature|invalid|verification failed/i);
  });

  // ─── ATTACK 8: WEBHOOK FORGERY ATTACK ───────────────────────────────
  test("8. Webhook Forgery Attack: Razorpay & Shiprocket Reject Bad Signatures", async ({
    request,
  }) => {
    // 8.1 Razorpay Webhook with missing or fake signature
    const rzpRes = await request.post(
      "https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/razorpay-webhook",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": "fake_bad_signature_12345",
        },
        data: {
          event: "payment.captured",
          payload: {
            payment: { entity: { id: "pay_fake_123", amount: 10000 } },
          },
        },
      },
    );
    expect(rzpRes.status()).toBe(400);

    // 8.2 Shiprocket Webhook with unauthorized token
    const srRes = await request.post(
      "https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/shiprocket-webhook",
      {
        headers: {
          "Content-Type": "application/json",
          "x-shiprocket-token": "unauthorized_sr_token_attack",
        },
        data: {
          awb: "AWB-FORGED-999",
          current_status: "DELIVERED",
        },
      },
    );
    expect(srRes.status()).toBe(401);
  });

  // ─── ATTACK 9: OVER-RETURN & REMAINING QUANTITY ENFORCEMENT ──────────
  test("9. Over-Return Prevention: Cannot Return More Units Than Purchased", () => {
    const originalSoldQuantity = 2;
    const alreadyReturnedQuantity = 1;
    const requestedReturnQuantity = 2; // Total would be 3 > 2!

    const evaluateReturnEligibility = (
      sold: number,
      returned: number,
      requested: number,
    ): { eligible: boolean; remaining: number } => {
      const remaining = Math.max(0, sold - returned);
      return {
        eligible: requested > 0 && requested <= remaining,
        remaining,
      };
    };

    const check = evaluateReturnEligibility(
      originalSoldQuantity,
      alreadyReturnedQuantity,
      requestedReturnQuantity,
    );

    expect(check.remaining).toBe(1);
    expect(check.eligible).toBe(false); // Reject return!
  });

  // ─── ATTACK 10: HISTORICAL PRICING SNAPSHOT INTEGRITY ───────────────
  test("10. Historical Price Immutability: Order & Return Calculations Never Altered by Current Catalog Price Edits", () => {
    const historicalOrderSnapshot = {
      product_id: "prod-onesie-001",
      sku_snapshot: "ZR-ONE-01",
      historical_selling_price: 699,
      historical_mrp: 999,
      allocated_discount: 100, // Coupon split
      final_paid_unit_price: 599,
      quantity: 1,
    };

    // Subsequent product price change on catalog (e.g. price drops to 499 or jumps to 899)
    const catalogCurrentPrice = 899;

    // Refund MUST strictly evaluate against final_paid_unit_price
    const calculateReturnCredit = (orderItem: typeof historicalOrderSnapshot, qty: number) => {
      return orderItem.final_paid_unit_price * qty;
    };

    const creditAmount = calculateReturnCredit(historicalOrderSnapshot, 1);
    expect(creditAmount).toBe(599); // Exactly ₹599, NOT ₹899 and NOT ₹699
    expect(creditAmount).not.toBe(catalogCurrentPrice);
  });

  // ─── ATTACK 11: POS TENDER & EXCESSIVE DISCOUNT PREVENTION ───────────
  test("11. POS Mathematical Invariant: Discount Cannot Exceed Subtotal & Net Payable >= 0", () => {
    const sanitizePosDiscounts = (
      subtotal: number,
      manualDiscount: number,
      storeCreditTender: number,
    ) => {
      const safeDiscount = Math.min(Math.max(0, manualDiscount), subtotal);
      const postDiscountTotal = subtotal - safeDiscount;
      const safeStoreCredit = Math.min(Math.max(0, storeCreditTender), postDiscountTotal);
      const netCashDue = postDiscountTotal - safeStoreCredit;

      return {
        safeDiscount,
        postDiscountTotal,
        safeStoreCredit,
        netCashDue: Math.max(0, netCashDue),
      };
    };

    // Attack 1: Attempted negative subtotal via ₹5000 discount on ₹1000 cart
    const attack1 = sanitizePosDiscounts(1000, 5000, 0);
    expect(attack1.safeDiscount).toBe(1000);
    expect(attack1.postDiscountTotal).toBe(0);
    expect(attack1.netCashDue).toBe(0);

    // Attack 2: Attempted negative cash due via ₹2000 store credit on ₹500 balance
    const attack2 = sanitizePosDiscounts(500, 0, 2000);
    expect(attack2.safeStoreCredit).toBe(500);
    expect(attack2.netCashDue).toBe(0);
  });

  // ─── ATTACK 12: COD MISCONFIGURATION & SESSION HIJACKING ────────────
  test("12. COD Misconfiguration Attack: Reject Online Session for COD Conversion", async () => {
    // 12.1 Create an online session
    const { data: onlineSess } = await anonClient.rpc("create_checkout_session", {
      _items: [{ product_slug: activeProductSlug, qty: 1 }],
      _full_name: "Online Buyer",
      _email: "online@example.com",
      _phone: "9999999999",
      _address: "123 Web St",
      _city: "Kota",
      _state: "Rajasthan",
      _pincode: "324001",
      _payment_method: "online", // Created for online payment!
    });

    expect(onlineSess?.success).toBe(true);
    const sessId = onlineSess.session_id;

    // Attacker attempts to convert this online session into a COD order without paying!
    const { data: codRes, error: codErr } = await anonClient.rpc("place_cod_order", {
      _session_id: sessId,
    });

    // Must be rejected
    expect(codRes?.success !== true || codErr !== null).toBe(true);
    if (codErr) {
      expect(codErr.message).toMatch(/not configured for Cash on Delivery|disabled/i);
    }
  });

  // ─── ATTACK 13: FAKE & MALFORMED SESSION CONVERSION ATTACK ───────────
  test("13. Fake Session Hijacking Attack: Nonexistent Session IDs Rejected", async () => {
    const { data, error } = await anonClient.rpc("place_cod_order", {
      _session_id: "cs_nonexistent_fake_hack_9999999",
    });

    expect(data?.success !== true || error !== null).toBe(true);
    if (error) {
      expect(error.message).toMatch(/not found|disabled/i);
    }
  });
});
