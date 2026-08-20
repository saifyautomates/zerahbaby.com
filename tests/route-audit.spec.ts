import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/shop",
  "/shop?category=clothing",
  "/product/1", // Will probably 404 if not seeded, but checks the route
  "/cart",
  "/checkout",
  "/auth",
  "/about",
  "/contact",
  "/shipping-delivery",
  "/cancellation-refund",
  "/terms-conditions",
  "/privacy-policy",
  "/returns",
  "/pos-test",
  // Protected routes - will likely redirect to /auth, but we can verify the redirect
  "/profile",
  "/orders",
  "/wishlist",
  "/admin",
];

test.describe("Route Audit", () => {
  for (const route of routes) {
    test(`Route: ${route} should not crash`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          // Ignore 404 console errors for the dummy product
          if (
            !msg
              .text()
              .includes("Failed to load resource: the server responded with a status of 404")
          ) {
            errors.push(msg.text());
          }
        }
      });

      const response = await page.goto(`http://localhost:8080${route}`);

      // Allow for redirects (like 302/307 to /auth for protected routes)
      const status = response?.status();
      const isRedirect = response?.request().redirectedFrom();

      console.log(`[${route}] Status: ${status} ${isRedirect ? "(Redirected)" : ""}`);

      // If it's a real 500 error, we fail
      expect(status).not.toBeGreaterThanOrEqual(500);

      // Wait a moment for hydration
      await page.waitForTimeout(1000);

      // Check if the Vite error overlay is present
      const hasViteError = (await page.locator("vite-error-overlay").count()) > 0;
      expect(hasViteError).toBe(false);

      if (errors.length > 0) {
        console.log(`[${route}] Console errors:`, errors);
      }
    });
  }
});
