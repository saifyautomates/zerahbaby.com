import { test, expect } from "@playwright/test";

const PROD_URL = "https://zerahkids.com";

test.describe("Final Production Smoke Test - Zerah Kids", () => {
  test("1. Environment & Localhost Leak Verification", async ({ page }) => {
    const errors: string[] = [];
    const consoleLogs: string[] = [];

    // Listen for console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleLogs.push(msg.text());
      }
    });

    // Listen for failed network requests
    page.on("requestfailed", (request) => {
      errors.push(`Request failed: ${request.url()} - ${request.failure()?.errorText}`);
    });

    page.on("response", (response) => {
      if (response.status() >= 400 && response.status() !== 404) {
        // Ignore 404s for tracking pixels etc
        if (!response.url().includes("google-analytics") && !response.url().includes("facebook")) {
          errors.push(`HTTP Error: ${response.url()} - Status: ${response.status()}`);
        }
      }

      // Check for localhost leaks in network requests
      if (response.url().includes("localhost") || response.url().includes("127.0.0.1")) {
        errors.push(`LOCALHOST LEAK FOUND IN NETWORK: ${response.url()}`);
      }
    });

    await page.goto(PROD_URL, { waitUntil: "networkidle" });

    // Verify title and basic layout
    await expect(page).toHaveTitle(/Zerah/i);

    // Check if body content contains localhost
    const pageContent = await page.content();
    if (pageContent.includes("localhost:") || pageContent.includes("127.0.0.1:")) {
      errors.push("LOCALHOST LEAK FOUND IN DOM CONTENT");
    }

    console.log("--- Network & Console Errors ---");
    console.log(errors);
    console.log(consoleLogs);
    console.log("--------------------------------");

    expect(errors.filter((e) => e.includes("LOCALHOST"))).toHaveLength(0);
  });

  test("2. Home Page Smoke Test", async ({ page }) => {
    await page.goto(PROD_URL);

    // Check for logo
    const logo = page
      .locator('header img[alt*="Zérah"], header img[alt*="Zerah"], header img')
      .first();
    await expect(logo).toBeVisible();

    // Check navigation
    const nav = page.locator("header nav, nav").first();
    await expect(nav).toBeVisible();

    // Check search functionality
    const searchTrigger = page.locator('button[aria-label="Search"]:visible').first();
    if ((await searchTrigger.count()) > 0 && (await searchTrigger.isVisible())) {
      await searchTrigger.click();
    }
    const searchInput = page
      .locator('input[type="search"]:visible, input[placeholder*="search" i]:visible')
      .first();
    if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
      console.log("Search input outerHTML:", await searchInput.evaluate((node) => node.outerHTML));
      await searchInput.fill("baby");
      const val = await searchInput.inputValue();
      console.log("Search input value after fill:", val);
      expect(val).toBe("baby");
    }
  });

  test("3. Shop & Product Detail Smoke Test", async ({ page }) => {
    await page.goto(`${PROD_URL}/shop`);

    // Wait for product cards to appear
    const productCard = page.locator('a[href*="/product/"]').first();
    await expect(productCard).toBeVisible({ timeout: 10000 });

    // Click product
    await productCard.click();
    await expect(page).toHaveURL(/\/product\//);

    // Verify product detail elements
    const addToCart = page
      .locator(
        'button:has-text("Add to bag"), button:has-text("Add To Bag"), button:has-text("Add to Cart")',
      )
      .first();
    if (await addToCart.isVisible()) {
      // Add to cart
      await addToCart.click();

      // Verify cart updates
      const cartIcon = page.locator('a[href*="/cart"], button:has-text("Cart")').first();
      await expect(cartIcon).toBeVisible();
    }
  });

  test("4. Admin Login Entry Verification", async ({ page }) => {
    await page.goto(`${PROD_URL}/admin`);
    // Should be redirected to login or show login form
    const emailInput = page.locator("#auth-contact-input");
    await expect(emailInput).toBeVisible();
  });
});
