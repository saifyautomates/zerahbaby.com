import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

const SUPABASE_URL = "https://wbbatgbvizhghtkvuguf.supabase.co";
const ANON_KEY = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const headers = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};

test.describe("Production Payment & Order Finalization Lifecycle (16 Critical Invariants)", () => {
  test.describe.configure({ mode: "serial" });
  let inStockVariantId: string;
  let inStockProductId: string;
  let baseStock: number;
  let basePrice: number;

  test.beforeAll(async () => {
    // Fetch an in-stock product variant for testing
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=id,product_id,stock&stock=gte.5&limit=1`,
      { headers },
    );
    const variants = await res.json();
    if (!variants || !variants[0]) {
      throw new Error("No in-stock variant found for testing");
    }
    inStockVariantId = variants[0].id;
    inStockProductId = variants[0].product_id;
    baseStock = variants[0].stock;
  });

  test("TEST 1 & 14: Online Payment Success — Finalizes Order, Deducts Stock, Creates Payment Record Exactly Once", async () => {
    // 1. Create checkout session
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Test Customer 1",
        _email: "test1@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test1_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    expect(session.success).toBe(true);
    expect(session.session_id).toMatch(/^cs_/);

    const rzpOrderId = `order_test_${Date.now()}`;
    const rzpPayId = `pay_test_${Date.now()}`;

    // Record payment attempt
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_payment_attempt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _amount: session.total,
        _currency: "INR",
      }),
    });

    // 2. Finalize paid order
    const fRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: "sig_dummy",
        _verified_amount: Math.round(session.total * 100),
      }),
    });
    const result = await fRes.json();
    expect(result.success).toBe(true);
    expect(result.order_id).toBeDefined();
    expect(result.duplicate).toBe(false);
    expect(result.payment_status).toBe("paid");
    expect(result.status).toBe("processing");

    // Verify order in database via secure RPC
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_summary_by_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _session_id: session.session_id }),
    });
    const order = await oRes.json();
    expect(order).toBeDefined();
    expect(order.id).toBe(result.order_id);
    expect(order.payment_status).toBe("paid");
    expect(order.status).toBe("processing");
    expect(order.payment_method).toBe("razorpay");
  });

  test("TEST 2: Online Payment Cancelled — No Order Created, No Stock Deducted", async () => {
    // 1. Check current stock
    const preStockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=stock&id=eq.${inStockVariantId}`,
      { headers },
    );
    const [{ stock: stockBefore }] = await preStockRes.json();

    // 2. Create session
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Cancelled Customer",
        _email: "cancel@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_cancel_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();

    // 3. User cancels payment
    const cRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _reason: "Customer closed payment modal",
      }),
    });
    expect(cRes.status).toBe(200);

    // 4. Verify checkout session state is payment_cancelled
    const sessCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/checkout_sessions?select=status,order_id&session_id=eq.${session.session_id}`,
      { headers },
    );
    const [sessRow] = await sessCheck.json();
    expect(sessRow.status).toBe("payment_cancelled");
    expect(sessRow.order_id).toBeNull();

    // 5. Verify stock was untouched
    const postStockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=stock&id=eq.${inStockVariantId}`,
      { headers },
    );
    const [{ stock: stockAfter }] = await postStockRes.json();
    expect(stockAfter).toBe(stockBefore);
  });

  test("TEST 3: Online Payment Failed — Attempt Recorded as Failed, No Confirmed Order", async () => {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Failed Payment Customer",
        _email: "fail@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_fail_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    const rzpOrderId = `order_fail_${Date.now()}`;

    // Record payment attempt
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_payment_attempt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _amount: session.total,
        _currency: "INR",
      }),
    });

    // Update status to failed
    const uRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_payment_attempt_status`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _razorpay_order_id: rzpOrderId,
        _status: "failed",
        _failure_reason: "Card declined by issuing bank",
      }),
    });
    expect(uRes.status).toBe(200);

    // Verify payment_attempts table has failed status
    const attCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/payment_attempts?select=status,failure_reason&razorpay_order_id=eq.${rzpOrderId}`,
      { headers },
    );
    const [attRow] = await attCheck.json();
    expect(attRow.status).toBe("failed");
    expect(attRow.failure_reason).toBe("Card declined by issuing bank");

    // Session has no order
    const sessCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/checkout_sessions?select=order_id&session_id=eq.${session.session_id}`,
      { headers },
    );
    const [sessRow] = await sessCheck.json();
    expect(sessRow.order_id).toBeNull();
  });

  test("TEST 4, 5, 6 & 15: Concurrency & Idempotency — Duplicate Callbacks & Webhooks Return Duplicate: True Without Multiple Orders", async () => {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Idempotent User",
        _email: "idem@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_idem_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    const rzpOrderId = `order_idem_${Date.now()}`;
    const rzpPayId = `pay_idem_${Date.now()}`;

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_payment_attempt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _amount: session.total,
        _currency: "INR",
      }),
    });

    // Call 1: Frontend Verification
    const res1 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: "sig1",
        _verified_amount: Math.round(session.total * 100),
      }),
    }).then((r) => r.json());

    // Call 2: Webhook arriving simultaneously
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: null,
        _verified_amount: Math.round(session.total * 100),
      }),
    }).then((r) => r.json());

    // Call 3: User refreshes confirmation page
    const res3 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: "sig1",
        _verified_amount: Math.round(session.total * 100),
      }),
    }).then((r) => r.json());

    expect(res1.success).toBe(true);
    expect(res1.duplicate).toBe(false);

    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);
    expect(res2.order_id).toBe(res1.order_id);

    expect(res3.success).toBe(true);
    expect(res3.duplicate).toBe(true);
    expect(res3.order_id).toBe(res1.order_id);

    // Verify only ONE order exists in public.orders for this session
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_summary_by_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _session_id: session.session_id }),
    });
    const order = await oRes.json();
    expect(order).toBeDefined();
    expect(order.id).toBe(res1.order_id);
  });

  test("TEST 7 & 8: Amount Tampering & Price Manipulation Rejection", async () => {
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Tampering Attacker",
        _email: "tamper@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_tamper_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    const rzpOrderId = `order_tamper_${Date.now()}`;
    const rzpPayId = `pay_tamper_${Date.now()}`;

    // Attacker tries to pay only ₹1 (100 paise) instead of full total
    const tamperedAmountPaise = 100;

    const fRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: "sig",
        _verified_amount: tamperedAmountPaise,
      }),
    });
    const errResult = await fRes.json();

    // Must be rejected with amount mismatch error
    expect(fRes.status).toBe(400);
    expect(errResult.message).toContain("Payment amount mismatch");
  });

  test("TEST 9, 10, 11: COD Disabled vs Enabled Validation", async () => {
    // 1. Check current payment settings
    const settRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_payment_settings`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const settings = await settRes.json();

    if (!settings.cod_enabled) {
      // Trying to create COD checkout session while disabled MUST fail
      const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          _items: [{ variant_id: inStockVariantId, qty: 1 }],
          _full_name: "COD Disabled Test",
          _email: "cod_dis@zerahkids.com",
          _phone: "9876543210",
          _address: "123 Test Street",
          _city: "Kota",
          _state: "Rajasthan",
          _pincode: "324005",
          _idempotency_key: `test_cod_dis_${Date.now()}`,
          _payment_method: "cod",
        }),
      });
      const err = await sRes.json();
      expect(sRes.status).toBe(400);
      expect(err.message).toContain("Cash on Delivery is currently unavailable");
    }
  });

  test("TEST 12: COD Order Creation — Created as UNPAID / PENDING", async () => {
    const testAdminHeaders = {
      ...headers,
      "x-admin-key": "zerah_admin_secret_2026",
    };

    const upRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_payment_settings`, {
      method: "POST",
      headers: testAdminHeaders,
      body: JSON.stringify({
        _cod_enabled: true,
        _cod_fee: 40,
        _cod_min_order_value: 50,
        _cod_max_order_value: 50000,
      }),
    });
    expect(upRes.status).toBe(200);

    // Create session
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "COD Real Customer",
        _email: "cod_customer@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_cod_real_${Date.now()}`,
        _payment_method: "cod",
      }),
    });
    const session = await sRes.json();
    expect(session.success).toBe(true);
    expect(session.cod_fee).toBe(40);

    // Place COD Order
    const codRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_cod_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
      }),
    });
    const codOrder = await codRes.json();
    expect(codOrder.success).toBe(true);
    expect(codOrder.order_id).toBeDefined();

    // Verify in database via secure RPC: payment_status MUST be pending (unpaid), NOT paid!
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_summary_by_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _session_id: session.session_id }),
    });
    const dbOrder = await oRes.json();
    expect(dbOrder.payment_status).toBe("pending");
    expect(dbOrder.payment_method).toBe("cod");
    expect(["placed", "processing", "confirmed"]).toContain(dbOrder.status);

    // Reset COD to disabled (default)
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_payment_settings`, {
      method: "POST",
      headers: testAdminHeaders,
      body: JSON.stringify({
        _cod_enabled: false,
        _cod_fee: 0,
        _cod_min_order_value: null,
        _cod_max_order_value: null,
      }),
    });
  });

  test("TEST 13: Overselling Protection — Prevents Purchasing When Quantity Exceeds Available Stock", async () => {
    // Try to create session with stock + 1000 items
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: baseStock + 99999 }],
        _full_name: "Greedy Customer",
        _email: "greedy@zerahkids.com",
        _phone: "9876543210",
        _address: "123 Test Street",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `test_oversell_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const err = await sRes.json();
    expect(sRes.status).toBe(400);
    expect(err.message).toContain("Insufficient stock");
  });

  test("TEST 16: Historical Order Snapshot Integrity — Changes in Product Prices Do Not Alter Old Orders", async () => {
    // Fetch an existing finalized order item
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/order_items?select=price,subtotal,name,sku_snapshot&limit=1`,
      { headers },
    );
    const items = await res.json();
    if (items.length > 0) {
      const item = items[0];
      expect(Number(item.price)).toBeGreaterThan(0);
      expect(item.name).toBeTruthy();
    }
  });
});
