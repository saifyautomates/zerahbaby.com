import { test, expect } from "@playwright/test";

test.describe("Omnichannel Order Click & Inspection Flow", () => {
  test("Clicking an order row in Omnichannel History opens the Order Details Modal and navigates to Orders Tab", async ({
    page,
  }) => {
    // 1. Mock Supabase orders API to ensure deterministic order data
    await page.route("**/rest/v1/orders*", async (route) => {
      const mockOrders = [
        {
          id: "cc461d36-e0e6-42bb-a4ca-fd50b80562e5",
          order_number: "ORD-20260907-CC461D36",
          status: "cancelled",
          cancelled_at: "2026-09-07T16:57:00Z",
          cancellation_reason: "Customer changed mind",
          payment_status: "pending",
          payment_method: "COD",
          total: 1640,
          subtotal: 1640,
          shipping: 0,
          discount: 0,
          full_name: "COD Real Customer",
          phone: "9876543210",
          email: "customer@example.com",
          address: "123 Test Street",
          city: "Kota",
          state: "Rajasthan",
          pincode: "324005",
          created_at: "2026-09-07T16:57:00Z",
          order_items: [
            {
              id: "item-1",
              name: "tshirrt",
              product_name: "tshirrt",
              quantity: 1,
              price: 1640,
              subtotal: 1640,
              variant_sku: "ZR-TSHIRT-01",
            },
          ],
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockOrders),
      });
    });

    // 2. Setup admin session bypass
    await page.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    // 3. Go to Admin Dashboard
    await page.goto("http://localhost:8080/admin?tab=dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // 4. Scroll to Omnichannel Sales & Transactions History
    const ledgerHeading = page.locator("text=Omnichannel Sales & Transactions History");
    await expect(ledgerHeading).toBeVisible({ timeout: 15000 });
    await ledgerHeading.scrollIntoViewIfNeeded();

    // 5. Find order row containing #CC461D36 or COD Real Customer
    const orderRow = page.locator("tr", { hasText: "#CC461D36" });
    await expect(orderRow).toBeVisible({ timeout: 10000 });

    // 6. Click the order row Details button
    const detailsButton = orderRow.locator("button", { hasText: "Details" });
    await expect(detailsButton).toBeVisible();
    await detailsButton.click();

    // 7. Verify the Omnichannel Order Details Modal opens
    const modal = page.locator("div[role='dialog']");
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal).toContainText("#CC461D36");
    await expect(modal).toContainText("COD Real Customer");
    await expect(modal).toContainText("9876543210");
    await expect(modal).toContainText("tshirrt");
    await expect(modal).toContainText("Order Cancelled");

    // Capture screenshot of the verified modal
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/57e4e7f2-4a35-423f-899c-7d8d383295b1/omnichannel_order_modal_verified.png",
    });

    // 8. Click "Manage in Online Orders" button
    const manageButton = modal.locator("button", { hasText: "Manage in Online Orders" });
    await expect(manageButton).toBeVisible();
    await manageButton.click();

    // 9. Verify transition to Orders tab with order focused
    await expect(page).toHaveURL(/.*tab=orders.*/, { timeout: 10000 });
    const orderCard = page
      .locator("#order-card-cc461d36-e0e6-42bb-a4ca-fd50b80562e5, li[id*='cc461d36']")
      .first();
    await expect(orderCard).toBeVisible({ timeout: 10000 });

    // Capture screenshot of the Orders tab with the focused card
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/57e4e7f2-4a35-423f-899c-7d8d383295b1/orders_tab_order_focused_verified.png",
    });
  });
});
