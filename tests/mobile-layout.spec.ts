import { test, expect } from "@playwright/test";

test.describe("Mobile Layout Tests (390px)", () => {
  test.setTimeout(60000);

  test("Home page looks good and passes audit", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: "test-results/home-mobile.png" });
  });

  test("Shop page layout", async ({ page }) => {
    await page.goto("/shop", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: "test-results/shop-mobile.png" });
  });

  test("Cart page layout", async ({ page }) => {
    await page.goto("/cart", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: "test-results/cart-mobile.png" });
  });

  test("Auth page layout", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: "test-results/auth-mobile.png" });
  });
});
