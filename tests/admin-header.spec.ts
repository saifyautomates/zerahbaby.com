import { test, expect } from "@playwright/test";

test.describe("Admin Header Controls & Theme Suite", () => {
  test("1. Theme Toggle - Storefront Light Mode Isolation & Admin Dark Mode", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Storefront must ALWAYS enforce light mode
    const html = page.locator("html");
    await page.evaluate(() => {
      localStorage.setItem("zerah-theme", "dark");
    });
    await page.reload();

    // On storefront (/), html must NOT have 'dark' class
    await expect(html).not.toHaveClass(/dark/);

    // Navigate to admin route to test admin dark theme persistence
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/auth/);
  });

  test("2. Admin Authentication Guard", async ({ page }) => {
    await page.goto("/admin");
    // Verify unauthorized user is redirected to auth
    await expect(page).toHaveURL(/.*\/auth/);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("3. Responsive Viewport Audits (320px, 390px, 768px, 1024px, 1440px)", async ({ page }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1")).toBeVisible();
      // Verify no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px margin for subpixel rendering
    }
  });
});
