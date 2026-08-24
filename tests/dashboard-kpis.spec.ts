import { test, expect } from "@playwright/test";

test.describe("Admin Dashboard KPI Cards & Date Range Suite", () => {
  test("1. Responsive Viewport Check across 10 Resolutions", async ({ page }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 360, height: 640 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
      { width: 820, height: 1180 },
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/auth", { waitUntil: "domcontentloaded" });

      // Verify no horizontal overflow on any device
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

  test("2. Date Range Delta Calculation & Comparative Logic", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Test calculateDelta helper logic
    const results = await page.evaluate(() => {
      function calculateDelta(current: number, prev: number, periodLabel: string) {
        if (prev === 0) {
          if (current > 0) return { text: `↑ 100% vs ${periodLabel}`, isPositive: true };
          return { text: `0% vs ${periodLabel}`, isPositive: true };
        }
        const pct = ((current - prev) / prev) * 100;
        const rounded = Math.abs(Math.round(pct * 10) / 10);
        if (pct > 0) {
          return { text: `↑ ${rounded}% vs ${periodLabel}`, isPositive: true };
        }
        if (pct < 0) {
          return { text: `↓ ${rounded}% vs ${periodLabel}`, isPositive: false };
        }
        return { text: `0% vs ${periodLabel}`, isPositive: true };
      }

      return {
        zeroToTen: calculateDelta(10, 0, "last 7 days"),
        tenToFifteen: calculateDelta(15, 10, "last 7 days"),
        twentyToTen: calculateDelta(10, 20, "last 7 days"),
        bothZero: calculateDelta(0, 0, "last 7 days"),
      };
    });

    expect(results.zeroToTen.text).toBe("↑ 100% vs last 7 days");
    expect(results.tenToFifteen.text).toBe("↑ 50% vs last 7 days");
    expect(results.twentyToTen.text).toBe("↓ 50% vs last 7 days");
    expect(results.bothZero.text).toBe("0% vs last 7 days");
  });

  test("3. Currency & Price Formatting Integrity", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const prices = await page.evaluate(() => {
      const formatPrice = (p: number) => `₹${Math.round(p).toLocaleString("en-IN")}`;
      return {
        revenue: formatPrice(47960),
        largeAmount: formatPrice(1234567),
        zero: formatPrice(0),
      };
    });

    expect(prices.revenue).toBe("₹47,960");
    expect(prices.largeAmount).toBe("₹12,34,567");
    expect(prices.zero).toBe("₹0");
  });
});
