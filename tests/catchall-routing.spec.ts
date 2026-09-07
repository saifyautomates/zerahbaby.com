import { test, expect } from "@playwright/test";

test.describe("Permanent 404 Prevention & Smart Routing", () => {
  test("Trailing slashes resolve seamlessly without 404", async ({ page }) => {
    const urls = [
      "http://localhost:8080/shop/",
      "http://localhost:8080/categories/",
      "http://localhost:8080/cart/",
      "http://localhost:8080/about/",
      "http://localhost:8080/contact/",
    ];

    for (const url of urls) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const text = await page.locator("body").innerText();
      expect(text).not.toContain("Page not found");
      expect(text).not.toContain("The page you're looking for doesn't exist or has been moved.");
    }
  });

  test("Common aliases redirect to canonical destinations", async ({ page }) => {
    const redirects = [
      { from: "http://localhost:8080/products", expectedPath: "/shop" },
      { from: "http://localhost:8080/store", expectedPath: "/shop" },
      { from: "http://localhost:8080/all", expectedPath: "/shop" },
      { from: "http://localhost:8080/privacy", expectedPath: "/privacy-policy" },
      { from: "http://localhost:8080/terms", expectedPath: "/terms-conditions" },
      { from: "http://localhost:8080/refund", expectedPath: "/cancellation-refund" },
      { from: "http://localhost:8080/shipping", expectedPath: "/shipping-delivery" },
      { from: "http://localhost:8080/help", expectedPath: "/contact" },
      { from: "http://localhost:8080/clothing", expectedPath: "/shop" },
      { from: "http://localhost:8080/toys", expectedPath: "/shop" },
    ];

    for (const { from, expectedPath } of redirects) {
      await page.goto(from, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const currentUrl = page.url();
      expect(currentUrl).toContain(expectedPath);
      const text = await page.locator("body").innerText();
      expect(text).not.toContain("Page not found");
    }
  });

  test("Category prefix URLs redirect to shop with category filter", async ({ page }) => {
    await page.goto("http://localhost:8080/category/clothing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    expect(page.url()).toContain("/shop");
    expect(page.url()).toContain("category=clothing");

    await page.goto("http://localhost:8080/categories/toys", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    expect(page.url()).toContain("/shop");
    expect(page.url()).toContain("category=toys");
  });

  test("Single unknown keyword routes directly to shop search without 404", async ({ page }) => {
    await page.goto("http://localhost:8080/wooden-rattles", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    expect(page.url()).toContain("/shop");
    expect(page.url()).toContain("q=wooden");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("The page you're looking for doesn't exist or has been moved.");
  });

  test("Unrecognized multi-segment URL renders rich FallbackRecoveryPage instead of raw 404", async ({
    page,
  }) => {
    await page.goto("http://localhost:8080/unknown/nested/missing/page", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(600);
    const bodyText = await page.locator("body").innerText();
    // Raw 404 must NOT appear
    expect(bodyText).not.toContain("The page you're looking for doesn't exist or has been moved.");
    // Helpful recovery UI must appear
    expect(bodyText).toContain("Looking for something special?");
    expect(bodyText).toMatch(/popular collections/i);
    expect(bodyText).toContain("Explore All Products");
  });
});
