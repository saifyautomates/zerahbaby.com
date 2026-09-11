import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "Mobile Small (320x568)", width: 320, height: 568 },
  { name: "Mobile Modern (375x667)", width: 375, height: 667 },
  { name: "Mobile iPhone 14 (390x844)", width: 390, height: 844 },
  { name: "Tablet Portrait (768x1024)", width: 768, height: 1024 },
  { name: "Tablet Landscape (1024x768)", width: 1024, height: 768 },
  { name: "User Screen (1536x760)", width: 1536, height: 760 },
  { name: "Desktop FHD (1920x1080)", width: 1920, height: 1080 },
];

test.describe("Global No-Cropping & Responsive Hardening Suite", () => {
  for (const vp of VIEWPORTS) {
    test(`Storefront has zero horizontal overflow on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("http://localhost:8080/");
      await page.waitForLoadState("networkidle");

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      });

      expect(hasHorizontalOverflow).toBe(false);
    });
  }

  test("Product cards use object-contain and are not cropped", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 760 });
    await page.route("**/rest/v1/products*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "prod-test-1",
            uuid: "prod-test-1",
            name: "Organic Cotton Romper",
            slug: "organic-cotton-romper",
            price: 599,
            mrp: 999,
            image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af",
            category: "clothing",
            rating: 4.8,
            reviews_count: 12,
            stock: 10,
            is_active: true,
            sales_channel: "OMNICHANNEL",
          },
        ]),
      });
    });
    await page.goto("http://localhost:8080/shop");
    await page.waitForLoadState("networkidle");

    const article = page.locator("article").first();
    await expect(article).toBeVisible({ timeout: 15000 });

    const firstImage = article.locator("img").first();
    await expect(firstImage).toBeVisible({ timeout: 10000 });

    const objectFit = await firstImage.evaluate((el) => {
      return window.getComputedStyle(el).objectFit;
    });

    expect(objectFit).toBe("contain");
  });

  test("SectionEditorModal is fully contained and not clipped at 1536x760", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 760 });
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-admin-mode", "on");
    });
    await page.goto("http://localhost:8080/");
    await page.waitForLoadState("networkidle");

    // Open Section Editor via inline Edit Section button or Section Manager bar
    const editBtn = page.locator(".edit-section-btn").first();
    await expect(editBtn).toBeVisible({ timeout: 15000 });
    await editBtn.click();

    // Verify modal dialog appears
    const modalTitle = page.getByRole("heading", { name: /Edit Section/i });
    await expect(modalTitle).toBeVisible();

    // Verify modal overlay z-index >= 200
    const overlayZIndex = await page.evaluate(() => {
      const overlay = document.querySelector("#section-editor-modal-overlay") || document.querySelector('[role="dialog"]');
      if (!overlay) return 0;
      return parseInt(window.getComputedStyle(overlay).zIndex, 10);
    });
    expect(overlayZIndex).toBeGreaterThanOrEqual(200);

    // Verify modal header is visible and not clipped above viewport
    const headerBox = await modalTitle.boundingBox();
    expect(headerBox).not.toBeNull();
    if (headerBox) {
      expect(headerBox.y).toBeGreaterThanOrEqual(0);
      expect(headerBox.y + headerBox.height).toBeLessThan(760);
    }

    // Verify footer actions are visible and not pushed off bottom of screen
    const saveButton = page.getByRole("button", { name: /Save & Publish Changes/i });
    await expect(saveButton).toBeVisible();
    const saveBox = await saveButton.boundingBox();
    expect(saveBox).not.toBeNull();
    if (saveBox) {
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(760);
      expect(saveBox.y).toBeGreaterThan(0);
    }

    // Switch to Theme tab and verify theme presets are reachable and clickable
    const themeTab = page.getByRole("button", { name: /Theme & Appearance/i });
    await themeTab.click();

    const festivePreset = page.getByRole("button", { name: /Royal Festive Gold/i });
    await expect(festivePreset).toBeVisible();

    // Verify exact close button works cleanly
    const closeBtn = page.getByRole("button", { name: "Close", exact: true });
    await closeBtn.click();
    await expect(modalTitle).not.toBeVisible();
  });

  test("SectionEditorModal is fully contained and usable on Mobile (375x667)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah-admin-mode", "on");
    });
    await page.goto("http://localhost:8080/");
    await page.waitForLoadState("networkidle");

    // Scroll down to the first section's edit button
    const editBtn = page.locator(".edit-section-btn").first();
    await expect(editBtn).toBeVisible({ timeout: 15000 });
    await editBtn.click();

    // Verify modal header fits on mobile
    const modalTitle = page.getByRole("heading", { name: /Edit Section/i });
    await expect(modalTitle).toBeVisible();
    const headerBox = await modalTitle.boundingBox();
    expect(headerBox).not.toBeNull();
    if (headerBox) {
      expect(headerBox.y).toBeGreaterThanOrEqual(0);
      expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(375);
    }

    // Verify save button fits within mobile viewport height
    const saveButton = page.getByRole("button", { name: /Save & Publish Changes/i });
    await expect(saveButton).toBeVisible();
    const saveBox = await saveButton.boundingBox();
    expect(saveBox).not.toBeNull();
    if (saveBox) {
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(667);
    }

    // Close modal
    const closeBtn = page.getByRole("button", { name: "Close", exact: true });
    await closeBtn.click();
    await expect(modalTitle).not.toBeVisible();
  });
});
