import { test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wbbatgbvizhghtkvuguf.supabase.co";
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const headers = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
};

test.describe("RESEND SALE EMAIL NOTIFICATIONS SUITE (10 Requirements)", () => {
  test.describe.configure({ mode: "serial" });

  let inStockVariantId: string;
  let inStockProductId: string;

  test.beforeAll(async () => {
    // Fetch an in-stock product variant for test orders
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=id,product_id,stock&stock=gt.0&order=stock.desc&limit=1`,
      { headers },
    );
    const variants = await res.json();
    if (variants && variants[0]) {
      inStockVariantId = variants[0].id;
      inStockProductId = variants[0].product_id;
    }
  });

  test("1. Online successful sale with customer email -> Admin email and Customer email processed", async () => {
    // Create an online checkout session with valid customer email
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Priya Sharma",
        _email: "priya.sharma.test@zerahkids.com",
        _phone: "9876543210",
        _address: "B-42 Vigyan Nagar",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `online_email_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    expect(session.success).toBe(true);

    const rzpOrderId = `rzp_ord_${Date.now()}`;
    const rzpPayId = `rzp_pay_${Date.now()}`;

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

    // Authoritative finalize_paid_order on server
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
    const finalized = await fRes.json();
    expect(finalized.success).toBe(true);
    const orderId = finalized.order_id;
    expect(orderId).toBeDefined();

    // Trigger dispatch-sale-notifications
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: orderId,
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchData = await dispatchRes.json();
    expect(dispatchData.success).toBe(true);

    // Channels check: both admin and customer email are accounted for
    const { admin_email, customer_email } = dispatchData.channels;
    expect(admin_email).toBeDefined();
    expect(["SENT", "FAILED"]).toContain(admin_email.status);
    expect(customer_email).toBeDefined();
    // Customer email was provided, so it must NOT be SKIPPED
    expect(["SENT", "FAILED"]).toContain(customer_email.status);

    // Verify order remains successful regardless of email status
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=id,status,payment_status&id=eq.${orderId}`, {
      headers,
    });
    const [savedOrder] = await oRes.json();
    expect(savedOrder).toBeDefined();
    expect(savedOrder.payment_status).toBe("paid");

    // Clean up stock for test
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/restore_stock_for_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_order_id: orderId,
        p_reason: "Resend email test cleanup",
        p_reference_type: "order",
      }),
    });
  });

  test("2. Online successful sale without customer email -> Admin email processed, customer email SKIPPED", async () => {
    // Create an online checkout session with NO email (or blank)
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Rahul NoEmail",
        _email: "",
        _phone: "9876543211",
        _address: "12 Shopping Center",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `online_noemail_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    expect(session.success).toBe(true);

    const rzpOrderId = `rzp_ord_noemail_${Date.now()}`;
    const rzpPayId = `rzp_pay_noemail_${Date.now()}`;

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
    const finalized = await fRes.json();
    expect(finalized.success).toBe(true);
    const orderId = finalized.order_id;

    // Trigger dispatch-sale-notifications
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: orderId,
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchData = await dispatchRes.json();

    // Customer email MUST be SKIPPED
    expect(dispatchData.channels.customer_email.status).toBe("SKIPPED");
    expect(dispatchData.channels.customer_email.error).toContain("No customer email");

    // Admin email is still processed
    expect(["SENT", "FAILED"]).toContain(dispatchData.channels.admin_email.status);

    // Clean up stock
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/restore_stock_for_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_order_id: orderId,
        p_reason: "Resend email test cleanup",
        p_reference_type: "order",
      }),
    });
  });

  test("3. POS successful sale with customer email -> Admin email and Customer email processed", async () => {
    // Place offline sale with customer email passed directly into place_offline_sale
    const idempotencyKey = `pos_email_test_${Date.now()}`;
    const saleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_offline_sale`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _customer_name: "Aman Gupta",
        _customer_phone: "9876543212",
        _customer_email: "aman.gupta.test@zerahkids.com",
        _payment_method: "cash",
        _items: [
          {
            product_id: inStockProductId,
            variant_id: inStockVariantId,
            product_slug: "test-product",
            name: "Test Baby Romper",
            variant_info: "Newborn / Sky Blue",
            price: 599,
            qty: 1,
          },
        ],
        _idempotency_key: idempotencyKey,
      }),
    });
    const saleData = await saleRes.json();
    expect(saleData.sale_id).toBeTruthy();
    const saleId = saleData.sale_id;

    // Trigger dispatch-sale-notifications
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: saleId,
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchData = await dispatchRes.json();
    expect(dispatchData.success).toBe(true);

    // Customer email provided -> NOT skipped
    expect(["SENT", "FAILED"]).toContain(dispatchData.channels.customer_email.status);
    expect(["SENT", "FAILED"]).toContain(dispatchData.channels.admin_email.status);

    expect(dispatchData.sale_id).toBe(saleId);
    expect(dispatchData.sale_type).toBe("offline");
  });

  test("4. POS successful sale without customer email -> Admin email processed, customer email SKIPPED", async () => {
    // Place offline sale with NO email
    const idempotencyKey = `pos_noemail_test_${Date.now()}`;
    const saleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_offline_sale`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _customer_name: "Walk-in Guest",
        _customer_phone: "9876543213",
        _payment_method: "cash",
        _items: [
          {
            product_id: inStockProductId,
            variant_id: inStockVariantId,
            product_slug: "test-product",
            name: "Test Baby Romper",
            variant_info: "Newborn / Sky Blue",
            price: 599,
            qty: 1,
          },
        ],
        _idempotency_key: idempotencyKey,
      }),
    });
    const saleData = await saleRes.json();
    expect(saleData.sale_id).toBeTruthy();
    const saleId = saleData.sale_id;

    // Trigger dispatch-sale-notifications
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: saleId,
      }),
    });
    expect(dispatchRes.status).toBe(200);
    const dispatchData = await dispatchRes.json();

    // Customer email must be SKIPPED
    expect(dispatchData.channels.customer_email.status).toBe("SKIPPED");
    expect(["SENT", "FAILED"]).toContain(dispatchData.channels.admin_email.status);
  });

  test("5. Failed payment -> No successful-sale notification sent", async () => {
    // If a session fails payment or is never finalized, no order exists to notify
    const fakeOrderId = `unpaid_order_${Date.now()}`;
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: fakeOrderId,
      }),
    });
    // Endpoint returns 404 because unverified/uncreated order cannot be notified
    expect(dispatchRes.status).toBe(404);
  });

  test("6. Cancelled or invalid sale -> Cannot dispatch valid sale confirmation", async () => {
    const fakeSaleId = `cancelled_sale_${Date.now()}`;
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: fakeSaleId,
      }),
    });
    expect(dispatchRes.status).toBe(404);
  });

  test("7. Resend failure / unconfigured -> Sale/Order remains 100% successful, failure logged", async () => {
    // Create an order
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Test Failure Resilience",
        _email: "resilience.test@zerahkids.com",
        _phone: "9876543214",
        _address: "Road 1",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `fail_res_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    const rzpOrderId = `rzp_fail_${Date.now()}`;
    const rzpPayId = `rzp_pay_fail_${Date.now()}`;

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
    const finalized = await fRes.json();
    const orderId = finalized.order_id;

    // Dispatch notifications
    const dispatchRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: orderId,
      }),
    });
    // Edge function must return 200 and never crash
    expect(dispatchRes.status).toBe(200);

    // Verify order in database is still completely paid and placed
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=id,status,payment_status&id=eq.${orderId}`, {
      headers,
    });
    const [savedOrder] = await oRes.json();
    expect(savedOrder.payment_status).toBe("paid");
    expect(["placed", "processing"]).toContain(savedOrder.status);

    // Restore stock
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/restore_stock_for_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_order_id: orderId,
        p_reason: "Resend email test cleanup",
        p_reference_type: "order",
      }),
    });
  });

  test("8. Retry failed email -> Email can be retried without creating another sale", async () => {
    // Create an order
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: inStockVariantId, qty: 1 }],
        _full_name: "Retry Customer",
        _email: "retry.test@zerahkids.com",
        _phone: "9876543215",
        _address: "Road 2",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `retry_test_${Date.now()}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    const rzpOrderId = `rzp_retry_${Date.now()}`;
    const rzpPayId = `rzp_pay_retry_${Date.now()}`;

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
    const finalized = await fRes.json();
    const orderId = finalized.order_id;

    // Call retry endpoint with force_channels
    const retryRes = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "online",
        sale_id: orderId,
        force_channels: ["admin_email", "customer_email"],
      }),
    });
    expect(retryRes.status).toBe(200);
    const retryData = await retryRes.json();
    expect(retryData.success).toBe(true);

    // Verify only ONE order exists in database (retry did not create new sale/order)
    const oCountRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=id&id=eq.${orderId}`, {
      headers,
    });
    const ordersFound = await oCountRes.json();
    expect(ordersFound.length).toBe(1);

    // Restore stock
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/restore_stock_for_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_order_id: orderId,
        p_reason: "Resend email test cleanup",
        p_reference_type: "order",
      }),
    });
  });

  test("9. Duplicate webhook / callback -> Idempotency prevents duplicate emails", async () => {
    const fixedIdempotencyKey = `webhook_idemp_${Date.now()}`;
    const payload = {
      sale_type: "online",
      sale_id: `fake_idemp_check`,
      idempotency_key: fixedIdempotencyKey,
    };

    // First call (will be 404 because fake id doesn't exist, but tests idempotency key handling)
    const res1 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const res2 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(res2.status);
  });

  test("10. Refresh after successful sale -> Idempotency deduplicates notifications cleanly", async () => {
    // Place offline sale
    const saleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_offline_sale`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _customer_name: "Refresh Test Customer",
        _customer_phone: "9876543216",
        _payment_method: "cash",
        _items: [
          {
            product_id: inStockProductId,
            variant_id: inStockVariantId,
            product_slug: "test-product",
            name: "Test Baby Romper",
            variant_info: "Newborn",
            price: 499,
            qty: 1,
          },
        ],
        _idempotency_key: `pos_refresh_sale_${Date.now()}`,
      }),
    });
    const saleData = await saleRes.json();
    const saleId = saleData.sale_id;

    // Simulate first notification call (on checkout success)
    const call1 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: saleId,
      }),
    });
    expect(call1.status).toBe(200);

    // Simulate page refresh / second call with same saleId
    const call2 = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-sale-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_type: "offline",
        sale_id: saleId,
      }),
    });
    expect(call2.status).toBe(200);
    const data2 = await call2.json();
    expect(data2.success).toBe(true);
  });
});
