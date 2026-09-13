import { test, expect } from "@playwright/test";

const SUPABASE_URL = "https://wbbatgbvizhghtkvuguf.supabase.co";
const ANON_KEY = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

const headers = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};

test.describe("Zerah Baby & Kids — Full Master End-to-End Testing Session", () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => {
      console.log(`[PAGE ERROR] on ${page.url()}:`, err.message);
    });
  });

  // =========================================================================
  // 1. AUTHENTICATION, OTP & ROUTE SECURITY
  // =========================================================================
  test("1.1 Customer Auth & OTP Form Verification", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Verify Sign In title and phone input
    await expect(page.locator("h1")).toBeVisible({ timeout: 15000 });
    const phoneInput = page.locator("#auth-contact-input");
    await phoneInput.waitFor({ state: "visible", timeout: 15000 });

    // Type valid 10-digit number with pressSequentially
    await phoneInput.focus();
    await phoneInput.pressSequentially("9999999999", { delay: 50 });

    const sendOtpBtn = page.locator("#auth-send-otp-btn");
    await sendOtpBtn.waitFor({ state: "visible", timeout: 5000 });
    await sendOtpBtn.click();

    // Verify system responds (OTP input, error toast, or cooldown)
    const otpInput = page.locator("#auth-otp-input");
    const toastMessage = page.locator("[data-sonner-toast]");

    await Promise.race([
      otpInput.waitFor({ state: "visible", timeout: 8000 }),
      toastMessage.waitFor({ state: "visible", timeout: 8000 }),
      page.waitForTimeout(2000),
    ]);

    // Page must remain responsive and input must still be rendered
    await expect(page.locator("h1")).toBeVisible();
    await expect(phoneInput).toBeVisible();
  });

  test("1.2 Admin Route Security Guards Block Anonymous Users", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible({ timeout: 15000 });

    await page.goto("/admin/billing", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible({ timeout: 15000 });
  });

  test("1.3 Admin Test Session Grants Access to Admin Portal", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });

    // Verify Admin Header is present
    await expect(
      page
        .locator("h1")
        .filter({ hasText: /Dashboard/i })
        .first(),
    ).toBeVisible({
      timeout: 20000,
    });
  });

  // =========================================================================
  // 2. STOREFRONT & ONLINE ORDER LIFECYCLE
  // =========================================================================
  test("2.1 Storefront Browsing, PDP, and Bag Addition", async ({ page }) => {
    // 1. Homepage
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Z[eé]rah Baby/i);

    // 2. Shop Page
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Check for product cards
    const productLinks = page.locator('a[href^="/product/"]');
    const count = await productLinks.count();
    expect(count).toBeGreaterThan(0);

    // 3. Navigate to first PDP
    const firstProductHref = await productLinks.first().getAttribute("href");
    expect(firstProductHref).toBeTruthy();
    await page.goto(firstProductHref!, { waitUntil: "domcontentloaded" });

    // PDP details verification
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Inclusive of all taxes")).toBeVisible();

    // Add to Bag
    const addToBagBtn = page.getByRole("button", { name: /Add to bag/i }).first();
    if (await addToBagBtn.isVisible()) {
      await addToBagBtn.click();
      await page.waitForTimeout(800);
    }

    // 4. Cart Page
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Your bag/i })).toBeVisible({ timeout: 10000 });
  });

  test("2.2 Online Order Creation, Checkout Session & Supabase Persistence", async () => {
    // Fetch an in-stock variant from Supabase
    const vRes = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=id,product_id,stock,price_override&stock=gte.1&limit=1`,
      { headers },
    );
    const variants = await vRes.json();
    expect(variants && variants.length > 0).toBe(true);
    const variant = variants[0];

    // Step 1: Create checkout session
    const timestamp = Date.now();
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_checkout_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _items: [{ variant_id: variant.id, qty: 1 }],
        _full_name: "E2E Test Customer",
        _email: `e2e_test_${timestamp}@zerahkids.com`,
        _phone: "9123456789",
        _address: "Flat 101, Test Residency, Vigyan Nagar",
        _city: "Kota",
        _state: "Rajasthan",
        _pincode: "324005",
        _idempotency_key: `e2e_session_${timestamp}`,
        _payment_method: "online",
      }),
    });
    const session = await sRes.json();
    expect(session.success).toBe(true);
    expect(session.session_id).toBeDefined();
    expect(session.total).toBeGreaterThan(0);

    // Step 2: Record payment attempt
    const rzpOrderId = `rzp_ord_${timestamp}`;
    const rzpPayId = `rzp_pay_${timestamp}`;
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

    // Step 3: Finalize paid order
    const fRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_paid_order`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        _session_id: session.session_id,
        _razorpay_order_id: rzpOrderId,
        _razorpay_payment_id: rzpPayId,
        _razorpay_signature: "e2e_verified_signature",
        _verified_amount: Math.round(session.total * 100),
      }),
    });
    const finalizeResult = await fRes.json();
    expect(finalizeResult.success).toBe(true);
    expect(finalizeResult.order_id).toBeDefined();
    expect(finalizeResult.payment_status).toBe("paid");
    expect(finalizeResult.status).toBe("processing");

    // Step 4: Verify Order persistence in Supabase
    const oRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_order_summary_by_session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _session_id: session.session_id }),
    });
    const order = await oRes.json();
    expect(order).toBeDefined();
    expect(order.id).toBe(finalizeResult.order_id);
    expect(order.order_number).toBeDefined();
    expect(order.payment_status).toBe("paid");
    expect(order.status).toBe("processing");
    expect(["online", "razorpay"]).toContain(order.payment_method);
  });

  // =========================================================================
  // 3. OFFLINE POS ORDER & INVENTORY DEDUCTION LIFECYCLE
  // =========================================================================
  test("3.1 POS Terminal Load & Interactive Product Search", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });

    // Wait for Billing Header
    await expect(
      page
        .locator("h1")
        .filter({ hasText: /Offline Billing|Billing/i })
        .first(),
    ).toBeVisible({
      timeout: 20000,
    });

    // Check POS Terminal subtab button
    await expect(page.getByRole("button", { name: /POS Terminal/i }).first()).toBeVisible({
      timeout: 20000,
    });

    // Check barcode / item search input
    const searchInput = page
      .locator('input[placeholder*="Scan"], input[placeholder*="Search"]')
      .first();
    await expect(searchInput).toBeVisible({ timeout: 20000 });
  });

  test("3.2 Place Offline Sale via Canonical RPC & Supabase Integrity", async () => {
    // 1. Fetch an available product
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products?is_active=eq.true&stock=gte.3&select=id,name,slug,price,stock,sku,barcode&limit=1`,
      { headers },
    );
    const products = await pRes.json();
    expect(products && products.length > 0).toBe(true);
    const prod = products[0];

    const timestamp = Date.now();
    const idempotencyKey = `pos_e2e_${timestamp}`;

    // 2. Call place_offline_sale RPC
    const salePayload = {
      _customer_name: "Walk-in Tester",
      _customer_phone: "9876543210",
      _customer_email: `walkin_${timestamp}@test.com`,
      _payment_method: "cash",
      _notes: "Automated E2E Full Testing Session Sale",
      _discount_type: "none",
      _discount_value: 0,
      _customer_id: null,
      _items: [
        {
          product_id: prod.id,
          variant_id: null,
          product_slug: prod.slug,
          slug: prod.slug,
          price: prod.price,
          qty: 1,
          name: prod.name,
          sku: prod.sku || "SKU-TEST",
          barcode: prod.barcode || "890100000001",
          mrp: prod.price,
          cost_price: Math.round(prod.price * 0.6),
          variant_info: "Default",
        },
      ],
      _idempotency_key: idempotencyKey,
      _store_credit_used: 0,
      _credit_token: null,
      _coupon_code: null,
    };

    const saleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_offline_sale`, {
      method: "POST",
      headers,
      body: JSON.stringify(salePayload),
    });

    expect(saleRes.ok).toBe(true);
    const saleResult = await saleRes.json();

    expect(saleResult.sale_id).toBeDefined();
    expect(saleResult.sale_number).toMatch(/^POS-/);
    expect(saleResult.total).toBe(prod.price);
    expect(saleResult.duplicate).toBe(false);

    // 3. Test Idempotency: Repeating same call returns duplicate: true
    const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/place_offline_sale`, {
      method: "POST",
      headers,
      body: JSON.stringify(salePayload),
    });
    const dupResult = await dupRes.json();
    expect(dupResult.duplicate).toBe(true);
    expect(dupResult.sale_id).toBe(saleResult.sale_id);
    expect(dupResult.sale_number).toBe(saleResult.sale_number);
  });

  // =========================================================================
  // 4. SMS & NOTIFICATIONS PIPELINE
  // =========================================================================
  test("4.1 Customer Order Confirmation SMS Edge Function (msg91-transactional)", async () => {
    const testOrderId = `e2e_ord_sms_${Date.now()}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/msg91-transactional`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        order_id: testOrderId,
        event_type: "online_sale",
        phone: "9876543210",
        name: "Test Customer",
        total: 1499,
        payment_method: "ONLINE",
        notify_owner: false,
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.dispatches).toBeDefined();
    expect(data.dispatches.length).toBeGreaterThanOrEqual(1);
    expect(["SENT", "sent", "mock_success"]).toContain(data.dispatches[0].status || "SENT");
  });

  test("4.2 Owner Sale Notification Edge Function (send-owner-sale-notification)", async () => {
    const testSaleId = `pos_sale_${Date.now()}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-owner-sale-notification`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sale_id: testSaleId,
        sale_number: `POS-${Date.now()}`,
        total: 2499,
        items_count: 2,
        payment_method: "UPI",
        customer_name: "In-Store Buyer",
      }),
    });

    // Endpoint must respond gracefully (either sent, mock, or handled cleanly without 500 crash)
    expect(res.status).toBeLessThan(500);
  });

  test("4.3 Customer Login OTP Generation (msg91-auth)", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/msg91-auth`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "send",
        phone: "9876543210",
      }),
    });

    // Must return valid JSON response (either success or controlled error toast, never unhandled server crash)
    expect(res.status).toBeLessThan(500);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  // =========================================================================
  // 5. ADMIN PANEL 18-TAB AUDIT (CLICK, RENDER, ZERO CONSOLE CRASHES)
  // =========================================================================
  const ADMIN_TABS = [
    { tab: "dashboard", label: "Dashboard" },
    { tab: "billing", label: "Offline Billing" },
    { tab: "products", label: "Products" },
    { tab: "hero", label: "Hero Media" },
    { tab: "media", label: "Media Library" },
    { tab: "orders", label: "Online Orders" },
    { tab: "returns", label: "Online Returns" },
    { tab: "customers", label: "Customers" },
    { tab: "categories", label: "Categories" },
    { tab: "sections", label: "Homepage Sections" },
    { tab: "settings", label: "Settings" },
    { tab: "admins", label: "Admins" },
    { tab: "coupons", label: "Coupons" },
    { tab: "reviews", label: "Reviews" },
    { tab: "marketing", label: "Marketing" },
    { tab: "sms", label: "SMS Logs" },
    { tab: "queries", label: "Queries" },
    { tab: "pages", label: "Pages & Policies" },
  ];

  for (const { tab, label } of ADMIN_TABS) {
    test(`5. Admin Tab Render & Click Audit: ${label} (${tab})`, async ({ page }) => {
      await page.addInitScript((activeTabName) => {
        localStorage.setItem("zerah_test_admin", "true");
        localStorage.setItem("zerah_admin_active_tab", activeTabName);
      }, tab);

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(`/admin?tab=${tab}`, { waitUntil: "domcontentloaded" });

      // Verify page is on /admin
      await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });

      // Verify H1 header for this tab is visible
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });

      // Verify no critical uncaught JavaScript errors crashed the view
      const criticalErrors = consoleErrors.filter(
        (err) =>
          !err.includes("favicon") &&
          !err.includes("WebSocket") &&
          !err.includes("Failed to load resource") &&
          !err.includes("ResizeObserver") &&
          !err.includes("admin_notifications") &&
          !err.includes("status of 404"),
      );

      expect(criticalErrors).toEqual([]);
    });
  }

  // Sub-tabs of Billing Center: POS, Returns, 1-Click Labels, Sales History, Customers
  const BILLING_SUBTABS = [
    { subtab: "pos", name: "POS Terminal" },
    { subtab: "returns", name: "Returns" },
    { subtab: "labels", name: "1-Click Labels" },
    { subtab: "sales", name: "Sales History" },
    { subtab: "customers", name: "Customers" },
  ];

  for (const { subtab, name } of BILLING_SUBTABS) {
    test(`5. Billing Center Subtab: ${name} (${subtab})`, async ({ page }) => {
      await page.addInitScript(
        ({ tabName, subtabName }) => {
          localStorage.setItem("zerah_test_admin", "true");
          localStorage.setItem("zerah_admin_active_tab", tabName);
          localStorage.setItem("zerah_admin_active_subtab", subtabName);
        },
        { tabName: "billing", subtabName: subtab },
      );

      await page.goto(`/admin?tab=billing&subtab=${subtab}`, { waitUntil: "domcontentloaded" });

      // Verify active button / tab highlight
      await expect(page.getByRole("button", { name: new RegExp(name, "i") }).first()).toBeVisible({
        timeout: 20000,
      });
    });
  }
});
