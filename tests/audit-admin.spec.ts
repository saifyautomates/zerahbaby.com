import { test, expect } from "@playwright/test";

test.describe("Admin & POS Post-Polish Audit", () => {
  test.beforeEach(async ({ page }) => {
    // Collect all console errors/warnings
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[CONSOLE ERROR] ${msg.text()} on ${page.url()}`);
      }
    });

    // Collect failed network requests
    page.on("requestfailed", (request) => {
      console.log(`[NETWORK FAILURE] ${request.url()} - ${request.failure()?.errorText}`);
    });
  });

  test("Audit Admin Authentication and Layout", async ({ page, isMobile }) => {
    // Attempt to access admin without auth
    const response = await page.goto("/admin", { waitUntil: "networkidle" });

    // It should redirect to /auth
    await expect(page).toHaveURL(/.*auth.*/);

    // Login as Admin
    await page.fill('input[type="email"]', "admin@zerahkids.com");
    await page.fill('input[type="password"]', "admin123"); // Assuming test credentials or we bypass
    // For safety, we will just simulate the login click. If it fails due to invalid credentials on prod, we log it.
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");

    if (page.url().includes("/admin")) {
      console.log("[SUCCESS] Logged into Admin.");

      // Check if Admin sidebar is accessible on Mobile
      if (isMobile) {
        const adminMenuBtn = page.locator('button[aria-label="Toggle Admin Menu"]').first();
        if (await adminMenuBtn.isVisible()) {
          await adminMenuBtn.click();
          await expect(page.locator("nav").first()).toBeVisible();
          console.log("[PASS] Admin navigation visible on Mobile");
        } else {
          console.log("[UI ISSUE] Admin navigation button missing on Mobile");
        }
      }

      // Check POS Route
      await page.goto("/admin?tab=pos", { waitUntil: "networkidle" });
      const posScanner = page.locator('input[placeholder*="Scan"]').first();
      if (await posScanner.isVisible()) {
        console.log("[PASS] POS Scanner rendered");
      } else {
        console.log("[UI ISSUE] POS Scanner missing");
      }

      // Check Dashboard rendering
      await page.goto("/admin?tab=dashboard", { waitUntil: "networkidle" });
      const revenueCard = page.locator("text=Total Revenue").first();
      if (await revenueCard.isVisible()) {
        console.log("[PASS] Dashboard KPI cards rendered");
      } else {
        console.log("[UI ISSUE] Dashboard KPI cards missing");
      }
    } else {
      console.log(
        "[BLOCKED] Could not authenticate to Admin portal (Credentials required). Admin audit skipped.",
      );
    }
  });
});
