import { test, expect } from "@playwright/test";

test.describe("Admin Header Controls & Theme Suite", () => {
  test("1. Theme Toggle - Light and Dark Persistence", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Verify root html does not have dark class by default or matches theme
    const html = page.locator("html");

    // Execute theme toggle via localStorage to test theme system persistence
    await page.evaluate(() => {
      localStorage.setItem("zerah-theme", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "zerah-theme", newValue: "dark" }));
    });

    await page.reload();
    // After reload with dark in localStorage, html should have class 'dark'
    await expect(html).toHaveClass(/dark/);

    // Toggle back to light
    await page.evaluate(() => {
      localStorage.setItem("zerah-theme", "light");
      window.dispatchEvent(new StorageEvent("storage", { key: "zerah-theme", newValue: "light" }));
    });

    await page.reload();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("2. Admin Authentication Guard", async ({ page }) => {
    await page.goto("/admin");
    // Verify unauthorized user is redirected to auth
    await expect(page).toHaveURL(/.*\/auth/);
    await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
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
      await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
      // Verify no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px margin for subpixel rendering
    }
  });
});
