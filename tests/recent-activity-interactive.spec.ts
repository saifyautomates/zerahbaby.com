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
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    // 4. Open dashboard
    await page.goto("http://localhost:8080/admin?tab=dashboard", { waitUntil: "networkidle" });

    // 5. Verify Recent Activity section has interactive rows
    const recentActivityHeading = page.locator("h3:has-text('Recent Activity')").first();
    await expect(recentActivityHeading).toBeVisible({ timeout: 15000 });

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
      const modal = page.locator("div[role='dialog']").filter({ hasText: "#CC461D36" });
      await expect(modal).toBeVisible({ timeout: 10000 });
      await expect(modal).toContainText("#CC461D36");
      await expect(modal).toContainText("COD Real Customer");

      // Close modal
      const closeBtn = page.locator("button[aria-label='Close modal']");
      await closeBtn.click();
      await expect(modal).not.toBeVisible({ timeout: 5000 });
    }

    // 7. Click "View All" to open full modal
    const viewAllBtn = page.locator("button:has-text('View All')").first();
    await viewAllBtn.click();
    await page.waitForTimeout(500);

    const modalTitle = page.locator(".fixed h3:has-text('Recent Activity')").first();
    await expect(modalTitle).toBeVisible({ timeout: 10000 });

    // Take screenshot of modal
    await page.screenshot({
      path: "C:/Users/jackx/.gemini/antigravity-ide/brain/57e4e7f2-4a35-423f-899c-7d8d383295b1/recent_activity_modal_verified.png",
    });
  });

  test("Clicking a page view activity item opens the Activity Details modal on the SAME admin page without new tabs or navigation", async ({
    page,
    context,
  }) => {
    // Track any new tabs/pages opened
    let newPageOpened = false;
    context.on("page", () => {
      newPageOpened = true;
    });

    // Mock activities
    await page.route("**/rest/v1/rpc/get_unified_store_activities*", async (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "act-view-about",
            source: "analytics",
            event_type: "view",
            title: "Page viewed: /about",
            subtitle: "Nikhil chhatani",
            product_name: null,
            product_slug: null,
            product_image: null,
            customer_name: "Nikhil chhatani",
            amount: 0,
            created_at: new Date().toISOString(),
            metadata: { path: "/about" },
          },
          {
            id: "act-cart-item",
            source: "analytics",
            event_type: "cart",
            title: "Added to Cart: Organic Cotton Romper",
            subtitle: "Priya Sharma",
            product_name: "Organic Cotton Romper",
            product_slug: "organic-cotton-romper",
            product_image: null,
            customer_name: "Priya Sharma",
            amount: 899,
            created_at: new Date().toISOString(),
            metadata: { path: "/product/organic-cotton-romper" },
          },
        ]),
      });
    });

    // Admin bypass
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    await page.goto("http://localhost:8080/admin?tab=dashboard", { waitUntil: "networkidle" });

    // 1. Verify Page viewed: /about is visible
    const aboutItem = page.locator("div[role='button']:has-text('Page viewed: /about')").first();
    await expect(aboutItem).toBeVisible({ timeout: 15000 });

    // 2. Click the activity item
    await aboutItem.click();
    await page.waitForTimeout(400);

    // Verify NO new browser tab or window opened
    expect(newPageOpened).toBe(false);

    // Verify URL remains strictly on admin dashboard
    expect(page.url()).toContain("/admin");
    expect(page.url()).not.toContain("/about");

    // 3. Verify Activity Details modal is visible on the same page
    const detailModal = page.locator("div[role='dialog']").filter({ hasText: "Activity Details" });
    await expect(detailModal).toBeVisible({ timeout: 5000 });
    await expect(detailModal).toContainText("Page viewed: /about");
    await expect(detailModal).toContainText("Nikhil chhatani");
    await expect(detailModal).toContainText("/about");

    // 4. Close the modal via Close Details button
    const closeBtn = detailModal.getByRole("button", { name: "Close Details" });
    await closeBtn.click();
    await page.waitForTimeout(300);

    // Verify modal is closed and Recent Activity feed is still present
    await expect(detailModal).not.toBeVisible();
    await expect(aboutItem).toBeVisible();

    // 5. Test another activity item (Cart item with product details)
    const cartItem = page.locator("div[role='button']:has-text('Added to Cart')").first();
    await expect(cartItem).toBeVisible();
    await cartItem.click();
    await page.waitForTimeout(400);

    // Verify modal displays the cart activity with product info
    await expect(detailModal).toBeVisible();
    await expect(detailModal).toContainText("Added to Cart: Organic Cotton Romper");
    await expect(detailModal).toContainText("Priya Sharma");
    await expect(detailModal).toContainText("₹899");

    // Close via header X button
    const closeXBtn = detailModal.locator("button[aria-label='Close activity details']");
    await closeXBtn.click();
    await expect(detailModal).not.toBeVisible();

    // 6. Test Responsive Viewports (Mobile 375px, Tablet 768px, Desktop 1280px)
    for (const vp of [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      await aboutItem.click();
      await expect(detailModal).toBeVisible();
      // Verify modal fits within viewport
      const box = await detailModal.locator("> div").boundingBox();
      if (box) {
        expect(box.width).toBeLessThanOrEqual(vp.width);
      }
      // Close via Escape key
      await page.keyboard.press("Escape");
      await expect(detailModal).not.toBeVisible();
    }
  });
});
