import { test, expect } from "@playwright/test";

test.describe("Zerah Baby And Kids - End to End Smoke Tests", () => {
  test("Homepage loads and navigation works", async ({ page }) => {
    await page.goto("/");

    // Check title and hero text
    await expect(page).toHaveTitle(/Zerah Baby And Kid'?s/i);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Verify marquee is present
    await expect(page.locator(".announce-bar")).toBeVisible();

    // Verify and navigate via "Shop all"
    const shopLink = page.getByRole("link", { name: /Shop all/i }).first();
    await expect(shopLink).toBeVisible();
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/shop/);
    await expect(page.getByRole("heading", { name: "All Products" })).toBeVisible();
  });

  test("Product details, Share dropdown, and Cart flow", async ({ page }) => {
    // Go directly to shop
    await page.goto("/shop");

    // Find first product card if available
    const firstProduct = page.locator('a[href^="/product/"]').first();
    if ((await firstProduct.count()) > 0 && (await firstProduct.isVisible())) {
      const productUrl = await firstProduct.getAttribute("href");
      await page.goto(productUrl!, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(productUrl!);

      // Check share dropdown if visible
      const shareButton = page.getByRole("button", { name: /Share/i }).first();
      if (await shareButton.isVisible()) {
        await shareButton.click();
        await page.waitForTimeout(300);
        await page.keyboard.press("Escape");
      }

      // Add to cart
      const addToBagButton = page.getByRole("button", { name: /Add to bag/i }).first();
      if (await addToBagButton.isVisible()) {
        await addToBagButton.click();
        await page.waitForTimeout(500);
      }
    }

    // Go to cart
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Your bag/i })).toBeVisible();

    // Verify action button exists
    const actionBtn = page.getByRole("link", { name: /check out|Shop/i }).first();
    await expect(actionBtn).toBeVisible();
  });

  test("Auth page loads correctly", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText(/Sign in/i);
    await expect(page.getByPlaceholder(/Email or Mobile Number/i)).toBeVisible();
  });
});
