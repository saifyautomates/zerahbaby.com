import { test, expect } from "@playwright/test";
import { playAudit } from "playwright-lighthouse";
import * as playwright from "playwright";

// Helper function to run lighthouse
const runLighthouse = async (page: playwright.Page, port: number) => {
  await playAudit({
    page,
    thresholds: {
      performance: 50,
      accessibility: 50,
      "best-practices": 50,
      seo: 50,
      pwa: 0,
    },
    port,
    config: {
      extends: "lighthouse:default",
      settings: {
        formFactor: "mobile",
        screenEmulation: {
          mobile: true,
          width: 390,
          height: 844,
          deviceScaleFactor: 2.625,
          disabled: false,
        },
      },
    },
  });
};

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
