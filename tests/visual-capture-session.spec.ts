import { test, expect } from "@playwright/test";
import path from "node:path";

const ARTIFACT_DIR = "C:/Users/jackx/.gemini/antigravity-ide/brain/d0284833-e478-435a-abc2-783b981a1521";

test.describe("Visual Proof Capture Session", () => {
  test.setTimeout(60000);

  test("Capture Visual Proof of Critical User & Admin Journeys", async ({ page }) => {
    // 1. Storefront Home
    await page.goto("/", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "storefront_home.png"), fullPage: false });

    // 2. Shop Page
    await page.goto("/shop", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "storefront_shop.png"), fullPage: false });

    // 3. Product Detail Page (PDP) & Add to Bag
    const firstProduct = page.locator('a[href^="/product/"]').first();
    if (await firstProduct.count() > 0) {
      const href = await firstProduct.getAttribute("href");
      await page.goto(href!, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(ARTIFACT_DIR, "storefront_pdp.png"), fullPage: false });

      const addBtn = page.getByRole("button", { name: /Add to bag/i }).first();
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // 4. Cart Page
    await page.goto("/cart", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "storefront_cart.png"), fullPage: false });

    // 5. Customer Auth
    await page.goto("/auth", { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "customer_auth.png"), fullPage: false });

    // Set Admin bypass
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    // 6. Admin Dashboard
    await page.goto("/admin?tab=dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "admin_dashboard.png"), fullPage: false });

    // 7. Admin POS Terminal
    await page.goto("/admin?tab=billing&subtab=pos", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "admin_pos_terminal.png"), fullPage: false });

    // 8. Admin Online Orders
    await page.goto("/admin?tab=orders", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "admin_online_orders.png"), fullPage: false });

    // 9. Admin Products Catalog
    await page.goto("/admin?tab=products", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "admin_products.png"), fullPage: false });

    // 10. Admin SMS Logs
    await page.goto("/admin?tab=sms", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "admin_sms_logs.png"), fullPage: false });
  });
});
