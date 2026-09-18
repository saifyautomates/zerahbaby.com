import { test, expect } from "@playwright/test";

test.describe("POS Customer Assignment Search Section", () => {
  test.setTimeout(60000);

  test("Search Customer in Section 2 renders results and allows selection", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
      localStorage.setItem(
        "zerah_pos_multi_sessions_v2",
        JSON.stringify([
          {
            id: "session-test-1",
            session_number: 1,
            items: [
              {
                product_id: "test-prod-1",
                name: "Baby Romper",
                price: 750,
                mrp: 999,
                qty: 1,
                stock: 10,
              },
            ],
            status: "active",
            customer_mode: "existing",
          },
        ])
      );
      localStorage.setItem("zerah_pos_active_session_id_v2", "session-test-1");
    });

    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").filter({ hasText: /Billing/i }).first()).toBeVisible({ timeout: 20000 });

    // Click "Proceed to Checkout" to open checkout sheet
    const proceedBtn = page.getByRole("button", { name: /Proceed to Checkout/i }).first();
    await expect(proceedBtn).toBeVisible({ timeout: 10000 });
    await proceedBtn.click();
    await page.waitForTimeout(500);

    // Click "Search Customer" mode button in Section 2
    const searchModeBtn = page.getByRole("button", { name: /Search Customer/i }).first();
    await expect(searchModeBtn).toBeVisible({ timeout: 10000 });
    await searchModeBtn.click();

    // The search input field should be visible
    const searchInput = page.getByPlaceholder("Search by name, phone, email, city...").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Type "saif" to search
    await searchInput.fill("saif");
    await page.waitForTimeout(600);

    // Verify search results dropdown appears with customer
    const customerResult = page.locator("button").filter({ hasText: /saif/i }).first();
    await expect(customerResult).toBeVisible({ timeout: 10000 });

    // Click customer result to assign
    await customerResult.click();
    await page.waitForTimeout(400);

    // Input clears and toast shows selected customer
    await expect(page.locator("text=Selected customer").first()).toBeVisible({ timeout: 5000 });
  });
});
