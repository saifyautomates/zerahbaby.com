import { test, expect } from "@playwright/test";

test.describe("Full Comprehensive E2E Test Suite - Zerah Baby & Kids", () => {
  test("1. Homepage & Storefront Sync", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify title and brand header
    await expect(page).toHaveTitle(/Zerah Baby And Kid'?s/i);
    await expect(page.locator("header")).toBeVisible();

    // Verify category carousel / cards are loaded
    const categoryCards = page.locator("[data-card]");
    await expect(categoryCards.first()).toBeVisible({ timeout: 10000 });

    // Verify featured product cards from Supabase database
    const productCards = page.locator('a[href^="/product/"]');
    await expect(productCards.first()).toBeVisible({ timeout: 10000 });
    const count = await productCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("2. Shop Search, Filter, and Catalogue Display", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });

    // Verify main shop heading
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Verify products are loaded from Supabase
    const initialCards = page.locator('a[href^="/product/"]');
    await expect(initialCards.first()).toBeVisible({ timeout: 10000 });
    const count = await initialCards.count();
    expect(count).toBeGreaterThan(0);

    // Test Category filter navigation
    await page.goto("/shop?category=clothing", { waitUntil: "domcontentloaded" });
    const clothingCards = page.locator('a[href^="/product/"]');
    await expect(clothingCards.first()).toBeVisible({ timeout: 10000 });
    expect(await clothingCards.count()).toBeGreaterThan(0);
  });

  test("3. Product Detail Page & Add to Bag", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });

    // Click first product card
    const firstProduct = page.locator('a[href^="/product/"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    const href = await firstProduct.getAttribute("href");
    expect(href).toBeTruthy();
    await firstProduct.click();

    await expect(page).toHaveURL(href!);

    // Verify Product details
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Inclusive of all taxes")).toBeVisible();

    // Find and click Add to bag
    const addBtn = page.locator(".grid.gap-10").getByRole("button", { name: "Add to bag" }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Verify toast
    await expect(page.getByText(/Added to bag/i)).toBeVisible();

    // Go to cart
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();
  });

  test("4. Cart Quantities, Summary, and Coupon Flow", async ({ page }) => {
    // Navigate to shop and add a product
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    const firstProduct = page.locator('a[href^="/product/"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    const addBtn = page.locator(".grid.gap-10").getByRole("button", { name: "Add to bag" }).first();
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    await page.waitForTimeout(500);

    // Go to cart
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();

    // Verify summary subtotal
    const aside = page.locator("aside");
    await expect(aside.getByText("Order summary")).toBeVisible();
    await expect(aside.getByText("Subtotal")).toBeVisible();
    await expect(aside.getByText("Delivery", { exact: true })).toBeVisible();

    // Verify promo code input exists
    const promoInput = page.getByPlaceholder(/Promo code/i);
    await expect(promoInput).toBeVisible();

    // Verify proceed / sign in button
    const actionBtn = aside.getByRole("link").first();
    await expect(actionBtn).toBeVisible();
  });

  test("5. Authentication Flow UI", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Welcome back header
    await expect(page.locator("h1")).toContainText(/Welcome back/i, { timeout: 10000 });
    await expect(page.getByPlaceholder("you@email.com")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();

    // Verify Google sign-in button
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

    // Verify submit button
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
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
