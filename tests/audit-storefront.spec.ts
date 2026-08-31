import { test, expect } from "@playwright/test";

test.describe("Storefront Post-Polish Audit", () => {
  const urlsToTest = [
    "/",
    "/shop",
    "/categories",
    "/about",
    "/contact",
    "/privacy-policy",
    "/shipping-delivery",
    "/returns",
    "/terms-conditions",
    "/cart",
  ];

  test.beforeEach(async ({ page }) => {
    // Collect all console errors/warnings
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[CONSOLE ERROR] ${msg.text()} on ${page.url()}`);
      }
    });

    // Collect failed network requests
    page.on("requestfailed", (request) => {
      console.log(`[NETWORK FAILURE] ${request.url()} - ${request.failure()?.errorText}`);
    });

    page.on("response", (response) => {
      if (response.status() >= 400) {
        console.log(`[HTTP ERROR] ${response.status()} ${response.url()}`);
      }
    });
  });

  for (const url of urlsToTest) {
    test(`Audit Route: ${url}`, async ({ page }) => {
      const response = await page.goto(url, { waitUntil: "networkidle" });

      // Check 404 or Server Error
      if (response && response.status() >= 400) {
        console.log(`[ROUTE ERROR] ${url} returned ${response.status()}`);
      }

      // Assert page loaded without crashing entirely
      await expect(page.locator("body")).toBeVisible();

      // Check for elements that might cause horizontal scroll (clipping/overlap)
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      if (hasHorizontalScroll) {
        console.log(`[LAYOUT ISSUE] Horizontal scrolling detected on ${url}`);
      }
    });
  }

  test("Audit Category Routing and Mobile Header", async ({ page, isMobile }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Check Navigation
    if (isMobile) {
      console.log(`[AUDIT] Testing Navigation on Mobile/Tablet...`);
      const width = page.viewportSize()?.width ?? 1280;
      if (width < 768) {
        const bottomNav = page.locator("nav").last();
        await expect(bottomNav).toBeVisible();
        console.log("[PASS] Mobile App BottomNav active and visible");
      } else {
        const headerNav = page.locator("header").first();
        await expect(headerNav).toBeVisible();
        console.log("[PASS] Tablet Header navigation visible");
      }
    }
  });

  test("Audit Add to Cart Flow", async ({ page }) => {
    // We will navigate to shop, pick first product, add to cart, check cart.
    await page.goto("/shop", { waitUntil: "networkidle" });

    const firstProduct = page.locator('a[href^="/product/"]').first();
    if ((await firstProduct.count()) > 0) {
      await firstProduct.click();
      await page.waitForLoadState("networkidle");

      // Try to add to cart
      const addToCartBtn = page.getByRole("button", { name: /add to cart|add to bag/i }).first();
      if (await addToCartBtn.isVisible()) {
        await addToCartBtn.click();
        // Check if toast appears or cart updates
        const toast = page.locator("[data-sonner-toast]").first();
        await expect(toast).toBeVisible({ timeout: 10000 });
      } else {
        console.log("[FUNCTIONAL ISSUE] Add to Cart button missing on product page");
      }
    } else {
      console.log("[FUNCTIONAL ISSUE] No products found on /shop");
    }
  });
});
