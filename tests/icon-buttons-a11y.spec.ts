import { test, expect } from "@playwright/test";

test.describe("BUG #8 — Accessible Names on Icon-Only Buttons", () => {
  test("ProductCard buttons on /shop have accessible names", async ({ page }) => {
    await page.goto("http://localhost:8080/shop", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 10000 });

    const cards = page.locator("article");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    const firstCard = cards.first();
    const buttons = firstCard.locator("button");
    const btnCount = await buttons.count();
    expect(btnCount).toBeGreaterThan(0);

    for (let i = 0; i < btnCount; i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute("aria-label");
      const text = (await btn.innerText()).trim();
      const hasAccessibleName = Boolean(ariaLabel || text);
      expect(hasAccessibleName).toBe(true);
    }
  });

  test("POS BillingCenter controls have accessible names", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
    });
    await page.goto("http://localhost:8080/admin?tab=billing&subtab=pos", {
      waitUntil: "domcontentloaded",
    });

    const scanInput = page.locator('input[aria-label="POS Universal Scan and Search Bar"]');
    await expect(scanInput).toBeVisible({ timeout: 10000 });

    // Type to trigger clear button
    await scanInput.fill("cord");
    const clearBtn = page.locator('button[aria-label="Clear search"]');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });

    // Click new sale to verify session discard aria-label
    const newSaleBtn = page.locator('[data-testid="pos-new-sale-btn"]');
    if (await newSaleBtn.isVisible()) {
      await newSaleBtn.click();
      const discardBtn = page.locator('button[aria-label^="Discard sale session"]').first();
      await expect(discardBtn).toBeVisible({ timeout: 5000 });
    }
  });
});
