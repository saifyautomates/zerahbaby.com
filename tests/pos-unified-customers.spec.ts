import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wbbatgbvizhghtkvuguf.supabase.co";
const supabaseAnonKey = "sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP";

test.describe("POS Unified Customers & Manual Price Override — Authoritative Supabase Architecture", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(60000);

  test.beforeEach(async () => {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    try {
      await supabase.rpc("close_all_pos_sessions", { p_except_session_id: null });
    } catch {
      // ignore
    }
  });

  // Test 1: Direct RPC Search Matrix against Authoritative Database
  test("1. Database RPC: Search Matrix (Exact Name, Partial Name, Phone, Email, City, Case-Insensitive)", async () => {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 1. Exact / Partial Name "mirza"
    const { data: resMirza, error: errMirza } = await supabase.rpc("search_pos_customers", {
      _query: "mirza",
    });
    expect(errMirza).toBeNull();
    expect(resMirza && resMirza.length > 0).toBe(true);
    const namesMirza = (resMirza || []).map((c: any) => c.name.toLowerCase());
    expect(namesMirza.some((n: string) => n.includes("mirza"))).toBe(true);

    // 2. Phone search "7014098198"
    const { data: resPhone, error: errPhone } = await supabase.rpc("search_pos_customers", {
      _query: "7014098198",
    });
    expect(errPhone).toBeNull();
    expect(resPhone && resPhone.length > 0).toBe(true);
    expect(resPhone[0].name.toLowerCase()).toContain("saif");

    // 3. Email search "sameermirza"
    const { data: resEmail, error: errEmail } = await supabase.rpc("search_pos_customers", {
      _query: "sameermirza2261@gmail.com",
    });
    expect(errEmail).toBeNull();
    expect(resEmail && resEmail.length > 0).toBe(true);
    expect(resEmail[0].name.toLowerCase()).toContain("mirza");

    // 4. City search "kota"
    const { data: resKota, error: errKota } = await supabase.rpc("search_pos_customers", {
      _query: "kota",
    });
    expect(errKota).toBeNull();
    expect(resKota && resKota.length > 0).toBe(true);
    expect(resKota.some((c: any) => (c.city || "").toLowerCase().includes("kota"))).toBe(true);

    // 5. Case-Insensitive uppercase "SAMEER"
    const { data: resUpper, error: errUpper } = await supabase.rpc("search_pos_customers", {
      _query: "SAMEER",
    });
    expect(errUpper).toBeNull();
    expect(resUpper && resUpper.length > 0).toBe(true);
    expect(resUpper.some((c: any) => c.name.toLowerCase().includes("sameer"))).toBe(true);
  });

  // Test 2: Real Browser Customer Search & UI Selection via POS Quick Customer Button
  test("2. Real POS Terminal UI: Search 'mirza' in Customer Modal, pick customer, verify linked state", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      localStorage.removeItem("zerah_pos_multi_sessions_v2");
      localStorage.removeItem("zerah_pos_active_session_id_v2");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("h1")
        .filter({ hasText: /Offline Billing|Billing/i })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /POS Terminal/i }).first()).toBeVisible({
      timeout: 20000,
    });

    // Clean up leftover tabs if present for clean slate
    const deleteAllBtn = page.getByTestId("pos-delete-all-tabs-inline-btn");
    if (await deleteAllBtn.isVisible()) {
      await deleteAllBtn.click();
      const confirmBtn = page.getByTestId("pos-confirm-delete-all-btn");
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // 1. Double click active tab to open Customer Modal
    const activeTab = page.locator('[data-testid^="pos-sale-tab-"]').first();
    await expect(activeTab).toBeVisible({ timeout: 5000 });
    await activeTab.click();
    await activeTab.dblclick();
    await page.waitForTimeout(400);

    // 2. Customer Modal opens — search for "mirza"
    const modalInput = page.getByPlaceholder("Search by name (e.g. Mirza), phone, email, city...");
    await expect(modalInput).toBeVisible({ timeout: 5000 });
    await modalInput.fill("mirza");
    await page.waitForTimeout(800);

    // 3. Verify real customer appears in list
    const customerItem = page.locator("text=mirza sameer baig").first();
    await expect(customerItem).toBeVisible({ timeout: 5000 });

    // 4. Click "Select" button on that customer row
    const selectBtn = page.locator('[data-testid^="pos-select-customer-"]').first();
    await expect(selectBtn).toBeVisible({ timeout: 5000 });
    await selectBtn.click();
    await page.waitForTimeout(500);

    // 5. Verify the modal closed and tab bar displays linked customer
    await expect(page.getByTestId("pos-sale-tab-customer").first()).toContainText(/mirza/i);
  });

  // Test 3: Multi-Sale Customer Isolation in POS
  test("3. Multi-Sale Customer Isolation: Sale A (Mirza), Sale B (Shahnawaz), Sale C (Walk-in)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      localStorage.removeItem("zerah_pos_multi_sessions_v2");
      localStorage.removeItem("zerah_pos_active_session_id_v2");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("h1")
        .filter({ hasText: /Offline Billing|Billing/i })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /POS Terminal/i }).first()).toBeVisible({
      timeout: 20000,
    });

    // If leftover tabs exist from prior tests, clean them up for deterministic isolation testing
    const deleteAllBtn = page.getByTestId("pos-delete-all-tabs-inline-btn");
    if (await deleteAllBtn.isVisible()) {
      await deleteAllBtn.click();
      const confirmBtn = page.getByTestId("pos-confirm-delete-all-btn");
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Sale A: Assign Mirza Sameer Baig
    const tabA = page.locator('[data-testid^="pos-sale-tab-"]').first();
    await tabA.click();
    await tabA.dblclick();
    const searchInputA = page.getByPlaceholder(
      "Search by name (e.g. Mirza), phone, email, city...",
    );
    await searchInputA.fill("mirza");
    await page.waitForTimeout(800);
    const selectCustA = page.locator('[data-testid^="pos-select-customer-"]').first();
    await expect(selectCustA).toBeVisible({ timeout: 5000 });
    await selectCustA.click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId("pos-sale-tab-customer").first()).toContainText(/mirza/i);

    // Create Sale B
    const newSaleBtn = page.getByTestId("pos-new-sale-btn");
    await newSaleBtn.click();
    await page.waitForTimeout(500);

    // Sale B: Assign Shahnawaz
    await page.locator('[data-testid^="pos-sale-tab-"]').last().dblclick();
    const searchInputB = page.getByPlaceholder(
      "Search by name (e.g. Mirza), phone, email, city...",
    );
    await searchInputB.fill("shahnawaz");
    await page.waitForTimeout(800);
    const selectCustB = page.locator('[data-testid^="pos-select-customer-"]').first();
    await expect(selectCustB).toBeVisible({ timeout: 5000 });
    await selectCustB.click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid="pos-sale-tab-customer"]').last()).toContainText(
      /shahnawaz/i,
    );

    // Create Sale C: Keep as Walk-in
    await newSaleBtn.click();
    await page.waitForTimeout(500);

    // Now switch between customer tabs and verify absolute isolation:
    const tabMirza = page
      .locator('[data-testid^="pos-sale-tab-"]')
      .filter({ hasText: "mirza" })
      .first();
    await expect(tabMirza).toBeVisible({ timeout: 5000 });
    await tabMirza.click();
    await page.waitForTimeout(500);
    await expect(tabMirza).toContainText(/mirza/i);

    // Switch to Sale B (Shahnawaz tab)
    const tabShah = page
      .locator('[data-testid^="pos-sale-tab-"]')
      .filter({ hasText: "shahnawaz" })
      .first();
    await expect(tabShah).toBeVisible({ timeout: 5000 });
    await tabShah.click();
    await page.waitForTimeout(500);
    await expect(tabShah).toContainText(/shahnawaz/i);

    // Switch to Sale C (Walk-in tab)
    const tabWalkin = page.locator('[data-testid^="pos-sale-tab-"]').last();
    await tabWalkin.click();
    await page.waitForTimeout(500);
    await expect(tabWalkin).not.toContainText(/mirza|shahnawaz/i);
  });

  // Test 4: POS Customer Creation into Authoritative Supabase System
  test("4. Authoritative Customer Creation via RPC: Immediately Searchable and Synchronized", async () => {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const testTimestamp = Date.now();
    const testPhone = `98${testTimestamp.toString().slice(-8)}`;
    const testName = `Zerah Test User ${testTimestamp.toString().slice(-4)}`;

    // Upsert authoritative customer
    const { data: createdCust, error: createErr } = await supabase.rpc(
      "upsert_authoritative_customer",
      {
        _name: testName,
        _phone: testPhone,
        _email: `test.${testTimestamp}@zerahkids.com`,
        _city: "Kota",
        _address: "Test Address Kota",
      },
    );

    expect(createErr).toBeNull();
    expect(createdCust).not.toBeNull();
    expect(createdCust.id).toBeDefined();
    expect(createdCust.name).toBe(testName);
    expect(createdCust.phone).toBe(testPhone);

    // Verify immediately searchable by phone in search_pos_customers
    const { data: searchResult, error: searchErr } = await supabase.rpc("search_pos_customers", {
      _query: testPhone,
    });
    expect(searchErr).toBeNull();
    expect(searchResult && searchResult.length > 0).toBe(true);
    expect(searchResult[0].id).toBe(createdCust.id);
    expect(searchResult[0].name).toBe(testName);
  });

  // Test 5: Manual Product Price Override in POS Cart (e.g. ₹500 down to ₹350)
  test("5. POS Manual Price Override: Change Item Price to ₹350, Verify Subtotal and Custom Badge", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      localStorage.removeItem("zerah_pos_multi_sessions_v2");
      localStorage.removeItem("zerah_pos_active_session_id_v2");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("h1")
        .filter({ hasText: /Offline Billing|Billing/i })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /POS Terminal/i }).first()).toBeVisible({
      timeout: 20000,
    });

    // 1. Search for real product by SKU and add to cart
    const scanBar = page.getByPlaceholder(/Scan barcode, or search by product name/i);
    await expect(scanBar).toBeVisible({ timeout: 5000 });
    await scanBar.fill("ZR-CL-4189");
    await page.waitForTimeout(600);
    await scanBar.press("Enter");
    await page.waitForTimeout(800);

    // 3. Locate the editable price input in the cart table
    const priceInput = page.locator('[data-testid^="pos-item-price-input-"]').first();
    await expect(priceInput).toBeVisible({ timeout: 5000 });

    // 4. Manually override price to 350
    await priceInput.fill("350");
    await page.waitForTimeout(300);

    // 5. Verify "Custom Price" badge appears
    await expect(page.locator("text=Custom Price").first()).toBeVisible({ timeout: 3000 });

    // 6. Verify cart subtotal reflects ₹350 (or 350 * qty)
    await expect(page.locator("text=₹350").first()).toBeVisible();
  });
});
