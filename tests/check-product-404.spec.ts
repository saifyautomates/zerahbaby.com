import { test } from "@playwright/test";

test("check routes that may 404", async ({ page }) => {
  const routesToTest = [
    "http://localhost:8080/product/tshirrt",
    "http://localhost:8080/orders",
    "http://localhost:8080/checkout",
    "http://localhost:8080/categories",
    "http://localhost:8080/shop",
    "http://localhost:8080/about",
    "http://localhost:8080/returns",
    "http://localhost:8080/admin/orders",
    "http://localhost:8080/admin/products",
  ];

  for (const url of routesToTest) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const body = await page.locator("body").innerText();
    const is404 = body.includes("Page not found") || body.includes("404");
    console.log(`URL: ${url} | Current URL: ${page.url()} | 404: ${is404}`);
  }
});
