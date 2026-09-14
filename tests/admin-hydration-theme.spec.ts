import { test, expect } from "@playwright/test";

test.describe("Bug #5: Admin SSR & Hydration Theme Consistency Suite", () => {
  test("1. Fresh direct navigation to /admin with dark theme has zero hydration mismatches", async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.toLowerCase().includes("hydration") ||
        text.toLowerCase().includes("server rendered html") ||
        text.toLowerCase().includes("did not match")
      ) {
        hydrationErrors.push(text);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-theme", "dark");
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

    expect(hydrationErrors).toHaveLength(0);
  });

  test("2. Fresh direct navigation to /admin with light theme has zero hydration mismatches", async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.toLowerCase().includes("hydration") ||
        text.toLowerCase().includes("server rendered html") ||
        text.toLowerCase().includes("did not match")
      ) {
        hydrationErrors.push(text);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-theme", "light");
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);

    expect(hydrationErrors).toHaveLength(0);
  });

  test("3. Hard refresh /admin preserves theme without hydration errors", async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.toLowerCase().includes("hydration") ||
        text.toLowerCase().includes("server rendered html") ||
        text.toLowerCase().includes("did not match")
      ) {
        hydrationErrors.push(text);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-theme", "dark");
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

    // Reload page
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

    expect(hydrationErrors).toHaveLength(0);
  });

  test("4. Navigating between storefront and admin maintains appropriate theme", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-theme", "dark");
    });

    // 1. Visit storefront - must be light
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);

    // 2. Visit admin - must be dark
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

    // 3. Return to storefront - must revert to light
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  });
});
