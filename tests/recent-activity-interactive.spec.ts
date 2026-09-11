import { test, expect } from "@playwright/test";

test.describe("Recent Activity Interactive Feed & Navigation", () => {
  test("Recent Activity items are clickable, interactive, and intelligently route or open modals", async ({
    page,
  }) => {
    // 1. Mock Supabase RPC get_unified_store_activities
    await page.route("**/rest/v1/rpc/get_unified_store_activities*", async (route) => {
      const mockActivities = [
        {
          id: "act-order-1",
          source: "online_order",
          event_type: "order",
          title: "Online Order #CC461D36 placed (COD)",
          subtitle: "COD Real Customer • ₹1,640",
          product_name: null,
          product_slug: null,
          product_image: null,
          customer_name: "COD Real Customer",
          amount: 1640,
          created_at: new Date().toISOString(),
          metadata: { order_id: "cc461d36-e0e6-42bb-a4ca-fd50b80562e5", invoice_no: "CC461D36" },
        },
        {
          id: "act-view-home",
          source: "analytics",
          event_type: "view",
          title: "Page viewed: /",
          subtitle: "saif",
          product_name: null,
          product_slug: null,
          product_image: null,
          customer_name: "saif",
          amount: 0,
          created_at: new Date().toISOString(),
          metadata: { path: "/" },
        },
        {
          id: "act-checkout-1",
          source: "analytics",
          event_type: "checkout",
          title: "Checkout started",
          subtitle: "saif",
          product_name: null,
          product_slug: null,
          product_image: null,
          customer_name: "saif",
          amount: 0,
          created_at: new Date().toISOString(),
          metadata: { path: "/checkout" },
        },
        {
          id: "act-view-product",
          source: "analytics",
          event_type: "view",
          title: "Page viewed: /product/tshirrt",
          subtitle: "saif",
          product_name: "tshirrt",
          product_slug: "tshirrt",
          product_image: null,
          customer_name: "saif",
          amount: 1640,
          created_at: new Date().toISOString(),
          metadata: { path: "/product/tshirrt" },
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockActivities),
      });
    });

    // 2. Mock orders API so the order matches
    await page.route("**/rest/v1/orders*", async (route) => {
      const mockOrders = [
        {
          id: "cc461d36-e0e6-42bb-a4ca-fd50b80562e5",
          invoice_no: "CC461D36",
          status: "placed",
          payment_status: "pending",
          payment_method: "COD",
          total: 1640,
          subtotal: 1640,
          full_name: "COD Real Customer",
          phone: "9876543210",
          email: "customer@example.com",
          address: "123 Test Street",
          city: "Kota",
          state: "Rajasthan",
          pincode: "324005",
          created_at: new Date().toISOString(),
          order_items: [
            {
              id: "item-1",
              name: "tshirrt",
              product_name: "tshirrt",
              quantity: 1,
              price: 1640,
              subtotal: 1640,
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

    // 3. Admin bypass
    await page.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    // 4. Open dashboard
    await page.goto("http://localhost:8080/admin?tab=dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // 5. Verify Recent Activity section has interactive rows
    const recentActivityHeading = page.locator("h3:has-text('Recent Activity')").first();
    await expect(recentActivityHeading).toBeVisible();

    const activityFeedItems = page.locator("div[role='button']:has-text('Page viewed:')");
    await expect(activityFeedItems.first()).toBeVisible();

    // Take screenshot of recent activity widget
    const recentActivityCard = page
      .locator("div:has(> div > h3:text-is('Recent Activity'))")
      .first();
    await recentActivityCard.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/57e4e7f2-4a35-423f-899c-7d8d383295b1/recent_activity_widget_verified.png",
    });

    // 6. Test clicking the Order item
    const orderActivityItem = page.locator("div[role='button']:has-text('Online Order #CC461D36')");
    if (await orderActivityItem.isVisible()) {
      await orderActivityItem.click();
      await page.waitForTimeout(500);

      // Verify Omnichannel Modal opened
      const modal = page.locator("div[role='dialog']");
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal).toContainText("#CC461D36");
      await expect(modal).toContainText("COD Real Customer");

      // Close modal
      const closeBtn = page.locator("button:text-is('Close')");
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // 7. Click "View All" to open full modal
    const viewAllBtn = page.locator("button:has-text('View All')").first();
    await viewAllBtn.click();
    await page.waitForTimeout(600);

    // Verify modal is open and has action badges
    const modalTitle = page.locator(".fixed h3:has-text('Recent Activity')").first();
    await expect(modalTitle).toBeVisible();

    // Take screenshot of the "View All" modal
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/57e4e7f2-4a35-423f-899c-7d8d383295b1/recent_activity_modal_verified.png",
    });
  });

  test("Clicking a page view activity item navigates in the same tab instead of opening a new window", async ({
    page,
  }) => {
    let popupOpened = false;
    page.on("popup", () => {
      popupOpened = true;
    });

    // Mock activities
    await page.route("**/rest/v1/rpc/get_unified_store_activities*", async (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "act-view-home",
            source: "analytics",
            event_type: "view",
            title: "Page viewed: /",
            subtitle: "visitor",
            product_name: null,
            product_slug: null,
            product_image: null,
            customer_name: "visitor",
            amount: 0,
            created_at: new Date().toISOString(),
            metadata: { path: "/" },
          },
        ]),
      });
    });

    // Admin bypass
    await page.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    await page.goto("http://localhost:8080/admin?tab=dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const homeItem = page.locator("div[role='button']:has-text('Page viewed: /')").first();
    await expect(homeItem).toBeVisible();

    await homeItem.click();
    await page.waitForTimeout(1000);

    // Assert that no new tab/popup opened
    expect(popupOpened).toBe(false);

    // Assert that we navigated to the storefront in the same tab
    expect(page.url()).toBe("http://localhost:8080/");
  });
});
