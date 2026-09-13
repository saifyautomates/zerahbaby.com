import { test, expect } from "@playwright/test";

test.describe("React Hook Order & Error #310 Regression Suite", () => {
  test("Homepage and route navigations remain free of React error #310 and hook order violations", async ({
    page,
  }) => {
    const errorLogs: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("Minified React error #310") ||
        text.includes("Rendered more hooks than during the previous render") ||
        text.includes("Rendered fewer hooks than during the previous render") ||
        text.includes("Invalid hook call") ||
        text.includes("Should have a queue")
      ) {
        errorLogs.push(`[Console ${msg.type()}]: ${text}`);
      }
    });

    page.on("pageerror", (err) => {
      const msg = err.message || "";
      if (
        msg.includes("310") ||
        msg.includes("Rendered more hooks") ||
        msg.includes("Rendered fewer hooks") ||
        msg.includes("Invalid hook call")
      ) {
        errorLogs.push(`[PageError]: ${msg}`);
      }
    });

    // 1. Initial page load
    await page.goto("http://localhost:8080/");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Minified React error #310")).not.toBeVisible();
    await expect(page.getByText("Try again")).not.toBeVisible();

    // 2. Perform 5 consecutive reloads (stress testing hook order across SSR/CSR hydration)
    for (let i = 0; i < 5; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText("Minified React error #310")).not.toBeVisible();
      await expect(page.getByText("Try again")).not.toBeVisible();
    }

    // 3. Navigation transitions: / -> /shop -> / -> /shop
    await page.goto("http://localhost:8080/shop");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Minified React error #310")).not.toBeVisible();

    await page.goto("http://localhost:8080/");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Minified React error #310")).not.toBeVisible();

    // 4. Assert zero React hook violations captured in logs
    expect(errorLogs).toHaveLength(0);
  });
});
