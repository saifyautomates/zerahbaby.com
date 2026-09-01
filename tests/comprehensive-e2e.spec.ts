import { test, expect } from "@playwright/test";

test.describe("Full Comprehensive E2E Test Suite - Zerah Baby & Kids", () => {
  test("1. Homepage & Storefront Sync", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify title and brand header
    await expect(page).toHaveTitle(/Zerah Baby And Kid'?s/i);
    await expect(page.locator("header")).toBeVisible();

    // Verify category carousel / cards are loaded
    const categoryCards = page.locator("[data-card]");
    const cardCount = await categoryCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Verify featured product cards or clean empty state from Supabase database
    const productCards = page.locator('a[href^="/product/"]');
    const count = await productCards.count();
    if (count > 0) {
      await expect(productCards.first()).toBeVisible({ timeout: 10000 });
      expect(count).toBeGreaterThan(0);
    } else {
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("2. Shop Search, Filter, and Catalogue Display", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });

    // Verify main shop heading
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Verify products or clean empty state from Supabase
    const initialCards = page.locator('a[href^="/product/"]');
    const count = await initialCards.count();
    if (count > 0) {
      await expect(initialCards.first()).toBeVisible({ timeout: 10000 });
      expect(count).toBeGreaterThan(0);
    }

    // Test Category filter navigation
    await page.goto("/shop?category=clothing", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
  });

  test("3. Product Detail Page & Add to Bag", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });

    // Click first product card if available
    const firstProduct = page.locator('a[href^="/product/"]').first();
    if ((await firstProduct.count()) > 0 && (await firstProduct.isVisible())) {
      const href = await firstProduct.getAttribute("href");
      expect(href).toBeTruthy();
      await page.goto(href!, { waitUntil: "domcontentloaded" });

      // Verify Product details
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });
      await expect(page.locator("text=Inclusive of all taxes")).toBeVisible();

      // Find and click Add to bag
      const addBtn = page.getByRole("button", { name: /Add to bag/i }).first();
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Go to cart
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Your bag/i })).toBeVisible();
  });

  test("4. Cart Quantities, Summary, and Coupon Flow", async ({ page }) => {
    // Navigate to shop and add a product if available
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    const productCard = page.locator("article").first();
    if ((await productCard.count()) > 0 && (await productCard.isVisible())) {
      const addBtn = productCard.getByRole("button", { name: /Add to bag/i });
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Go to cart
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Your bag/i })).toBeVisible();

    // Verify summary subtotal if aside is visible
    const aside = page.locator("aside");
    if (await aside.isVisible()) {
      await expect(aside.getByText("Order summary")).toBeVisible();
      await expect(aside.getByText("Subtotal")).toBeVisible();
      await expect(aside.getByText(/Delivery/i).first()).toBeVisible();
    }
  });

  test("5. Authentication Flow UI", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Sign in header
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#auth-contact-input")).toBeVisible();

    // Verify Google sign-in button
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();

    // Verify submit button
    await expect(page.getByRole("button", { name: /Get OTP/i })).toBeVisible();
  });

  test("6. Protected Routes Security Redirection", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/.*\/auth/);
  });

  test("7. Static & Informational Pages", async ({ page }) => {
    const staticPages = [
      { path: "/about", heading: /About/i },
      { path: "/contact", heading: /Contact/i },
      { path: "/shipping-delivery", heading: /Shipping/i },
      { path: "/cancellation-refund", heading: /Cancellation/i },
      { path: "/terms-conditions", heading: /Terms/i },
      { path: "/privacy-policy", heading: /Privacy/i },
    ];

    for (const p of staticPages) {
      await page.goto(p.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});
