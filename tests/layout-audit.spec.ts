import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/shop",
  "/cart",
  "/checkout",
  "/about",
  "/contact"
];

const viewports = [
  { width: 320, height: 800 },
  { width: 390, height: 800 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 }
];

test.describe("Layout Audit", () => {
  for (const route of routes) {
    for (const vp of viewports) {
      test(`Check overflow for ${route} at ${vp.width}px`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(`http://localhost:8080${route}`);
        await page.waitForTimeout(1000); // allow hydration and fonts
        
        const overflow = await page.evaluate(() => {
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          return {
            scrollWidth: docWidth,
            innerWidth: winWidth,
            hasOverflow: docWidth > winWidth
          };
        });
        
        if (overflow.hasOverflow) {
          console.log(`[OVERFLOW DETECTED] ${route} at ${vp.width}px (scrollWidth: ${overflow.scrollWidth}, innerWidth: ${overflow.innerWidth})`);
        }
        
        expect(overflow.hasOverflow).toBe(false);
      });
    }
  }
});
