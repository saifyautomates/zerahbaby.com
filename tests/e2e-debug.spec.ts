import { test, expect } from "@playwright/test";

test("Debug Shop Page", async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('response', response => {
    if (!response.ok()) console.log(`RESPONSE ERROR: ${response.url()} ${response.status()}`);
  });

  console.log("Navigating to /shop...");
  await page.goto('/shop', { waitUntil: 'networkidle' });
  
  await page.waitForTimeout(2000);
  
  const productsCount = await page.locator('a[href^="/product/"]').count();
  console.log('Number of products found:', productsCount);
  
  if (productsCount === 0) {
    console.log('No products found. Dumping HTML Body:');
    const body = await page.innerHTML('body');
    console.log(body.substring(0, 1500) + '...');
  }
});
