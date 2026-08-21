import { test, expect } from "@playwright/test";

test.describe("Zerah Baby And Kids - End to End Smoke Tests", () => {
  test("Homepage loads and navigation works", async ({ page }) => {
    await page.goto("/");

    // Check title and hero text
    await expect(page).toHaveTitle(/Zerah Baby And Kid'?s/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Verify marquee is present
    await expect(page.locator(".announce-bar")).toBeVisible();

    // Click "Shop all products"
    await page.click('text="Shop all products"');
    await expect(page).toHaveURL(/\/shop/);
    await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();
  });

  test("Product details, Share dropdown, and Cart flow", async ({ page }) => {
    // Go directly to shop
    await page.goto("/shop");

    // Find first product card and click it
    const firstProduct = page.locator('a[href^="/product/"]').first();
    await expect(firstProduct).toBeVisible();

    const productUrl = await firstProduct.getAttribute("href");
    await firstProduct.click();
    await expect(page).toHaveURL(productUrl!);

    // Check share dropdown
    const shareButton = page.getByRole("button", { name: "Share product options" });
    await expect(shareButton).toBeVisible();
    await shareButton.click();
    await expect(page.getByText("Copy link")).toBeVisible();
    await expect(page.getByText("Share to WhatsApp")).toBeVisible();

    // Press Escape to close dropdown
    await page.keyboard.press("Escape");

    // Add to cart (target the main product button, not related products)
    const addToBagButton = page
      .locator(".grid.gap-10")
      .getByRole("button", { name: "Add to bag" })
      .first();
    await expect(addToBagButton).toBeVisible();

    // Verify initial cart state
    const cartLink = page.getByLabel(/Cart with/);

    // Click add to bag
    await addToBagButton.click();

    // Verify toast notification appears
    await expect(page.getByText("Added to bag")).toBeVisible();

    // Check cart counter updated
    await expect(cartLink).toContainText("1");

    // Go to cart
    await cartLink.click();
    await expect(page).toHaveURL("/cart");
    await expect(page.getByRole("heading", { name: "Your bag" })).toBeVisible();

    // Verify checkout button exists
    // Verify checkout/signin button exists
    const checkoutButton = page.getByRole("link", { name: "Sign in to check out" });
    await expect(checkoutButton).toBeVisible();
  });

  test("Auth page loads correctly", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByPlaceholder("you@email.com")).toBeVisible();
  });
});
